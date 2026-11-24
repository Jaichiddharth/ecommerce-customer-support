"""Chat widget shopping assistant, bring-your-own model (with fallback), and test cases that carry order data."""
import uuid
from types import SimpleNamespace

import pytest

from app import llm, sales
from app.models import CatalogProduct, LlmOverride

CATALOG = [
    {"ref": "P1", "title": "Linen shirt", "price": "₹1,499", "compare_at_price": "₹1,999", "url": "https://shop.example/p/linen",
     "buy_url": "https://shop.example/cart/11:1", "available": True, "description": "Breathable summer shirt"},
    {"ref": "P2", "title": "Denim jacket", "price": "₹3,299", "url": "https://shop.example/p/denim",
     "buy_url": "https://shop.example/cart/12:1", "available": True},
    {"ref": "P3", "title": "Silk scarf", "price": "₹899", "available": False},
]


@pytest.mark.parametrize("text,expected", [
    ("do you have linen shirts?", True), ("show me something under 2000", True), ("best sellers", True),
    ("I need a gift for my wife", True), ("which one is better", True), ("any offers?", True),
    ("where is my order", False), ("what is your return policy", False), ("hi", False),
])
def test_wants_products(text, expected):
    assert sales.wants_products(text) is expected


def test_pick_products_strips_tags_and_keeps_order():
    cat = [CatalogProduct(**p) for p in CATALOG]
    text, picked = sales.pick_products("Try the Denim jacket [P2] or the Linen shirt [P1] . Also [P2] again [P9].", cat)
    assert [p.ref for p in picked] == ["P2", "P1"]
    assert "[P" not in text and "shirt." in text


def test_catalog_lines_show_sale_price_and_stock():
    lines = sales.catalog_lines([CatalogProduct(**p) for p in CATALOG])
    assert "₹1,499 (was ₹1,999)" in lines and "sold out" in lines


# ---------------------------------------------------------------- bring your own model (no network)

KEY = "sk-test-" + "x" * 20


def _client(reply="OK", error=None):
    def create(**kw):
        if error:
            raise error
        msg = SimpleNamespace(content=reply)
        return SimpleNamespace(choices=[SimpleNamespace(message=msg)], usage=SimpleNamespace(prompt_tokens=10, completion_tokens=2))
    return SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))


def test_byo_check_ok_and_errors_never_leak_the_key():
    o = LlmOverride(provider="anthropic", model="claude-haiku-5-5", api_key=KEY)
    assert llm.byo_check(o, _client("OK"))["ok"]
    bad = Exception("401 Unauthorized")
    bad.status_code = 401
    assert llm.byo_check(o, _client(error=bad)) == {"ok": False, "error": "The provider rejected this API key."}
    leak = Exception(f"boom with {KEY}")
    assert KEY not in llm.byo_check(o, _client(error=leak))["error"]


def test_key_is_secret_in_dumps():
    o = LlmOverride(provider="openai", model="gpt-4o-mini", api_key=KEY)
    assert KEY not in repr(o) and KEY not in o.model_dump_json()


def test_byo_cost_estimates_unknown_models_high():
    assert llm.byo_cost("some-new-model", 1_000_000, 0) == llm.BYO_DEFAULT_PRICE[0]
    assert llm.byo_cost("gpt-4o-mini", 1_000_000, 0) == 0.15


# ---------------------------------------------------------------- whole requests (needs Postgres, fake LLM)

try:
    import psycopg

    from app.config import get_settings
    psycopg.connect(get_settings().database_url, connect_timeout=3).close()
    DB_OK = get_settings().llm_provider == "fake"
except Exception:
    DB_OK = False

needs_db = pytest.mark.skipif(not DB_OK, reason="needs Postgres and LLM_PROVIDER=fake")
WS = "ws_widget_test"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {get_settings().service_token}"})
        yield c


def chat(client, text, **kw):
    body = {"workspace_id": WS, "conversation_id": "w-" + uuid.uuid4().hex[:8], "channel": "web", "test": True,
            "messages": [{"role": "user", "content": text}], **kw}
    r = client.post("/v1/chat", json=body)
    assert r.status_code == 200, r.text
    return r.json()


SALES = {"enabled": True, "assistant_name": "Mia", "offer": "WELCOME10 for 10% off", "goal": "balanced"}


@needs_db
def test_widget_recommends_from_the_catalogue(client):
    r = chat(client, "do you have linen shirts?", catalog=CATALOG, sales=SALES)
    assert r["route"] == "sales" and r["outcome"] == "answered"
    assert [p["ref"] for p in r["products"]] == ["P1"] and "[P1]" not in r["reply"]
    assert r["products"][0]["buy_url"] == "https://shop.example/cart/11:1"
    assert "Any offers?" in r["suggestions"]


@needs_db
def test_no_catalogue_means_no_sales_route(client):
    r = chat(client, "do you have linen shirts?", sales=SALES)
    assert r["route"] != "sales" and r["products"] == []


@needs_db
def test_support_questions_still_follow_the_support_rules(client):
    # website chat: a refund is about an order, so it goes to WhatsApp (where the team approves it for a verified
    # customer); the agent never approves one
    r = chat(client, "I want a refund", catalog=CATALOG, sales=SALES)
    assert "order_redirect" in r["flags"] and "refund" not in r["reply"].lower().replace("refunds", "")
    # without the website chat's sales settings (WhatsApp), refunds still hand over to a person
    body = {"workspace_id": WS, "conversation_id": "w-" + uuid.uuid4().hex[:8], "channel": "whatsapp", "test": True,
            "messages": [{"role": "user", "content": "I want a refund"}]}
    r = client.post("/v1/chat", json=body).json()
    assert r["outcome"] == "handover" and r["handover_reason"] == "refund_request"


@needs_db
def test_own_model_failure_falls_back(client, monkeypatch):
    class Broken:
        def __init__(self, *a, **k):
            raise RuntimeError("provider down")

    monkeypatch.setattr("app.agent.ByoProvider", Broken)
    settings = {"llm": {"provider": "groq", "model": "llama-3.3-70b-versatile", "api_key": KEY}}
    r = chat(client, "do you have linen shirts?", catalog=CATALOG, sales=SALES, settings=settings)
    assert r["outcome"] == "answered" and "byo_failed" in r["flags"] and r["products"]


@needs_db
def test_own_model_is_used_and_logged_separately(client, monkeypatch):
    class Fake(llm.FakeProvider):
        def __init__(self, *a, **k):
            pass

    monkeypatch.setattr("app.agent.ByoProvider", Fake)
    settings = {"llm": {"provider": "openai", "model": "gpt-4o-mini", "api_key": KEY, "monthly_limit_usd": 50}}
    r = chat(client, "do you have linen shirts?", catalog=CATALOG, sales=SALES, settings=settings)
    assert r["route"] == "sales" and r["usage"]["cost_usd"] == 0.0 and "byo_failed" not in r["flags"]


@needs_db
def test_own_model_over_its_limit_uses_unocx(client, monkeypatch):
    monkeypatch.setattr("app.agent.byo_spent_this_month", lambda ws: 99.0)
    settings = {"llm": {"provider": "openai", "model": "gpt-4o-mini", "api_key": KEY, "monthly_limit_usd": 10}}
    r = chat(client, "do you have linen shirts?", catalog=CATALOG, sales=SALES, settings=settings)
    assert "byo_limit_reached" in r["flags"] and r["products"]


@needs_db
def test_llm_test_endpoint_validates(client):
    r = client.post("/v1/llm/test", json={"llm": {"provider": "nope", "model": "x", "api_key": KEY}})
    assert r.status_code == 422


@needs_db
def test_test_case_with_uploaded_orders(client):
    order = {"order_number": "#2001", "items": "Linen shirt", "quantity": 1, "status": "Delivered",
             "order_date": "2026-11-10T10:00:00Z", "delivered_at": "2026-11-14T10:00:00Z"}
    commerce = {"stores": [{"ref": "upload:1", "platform": "shopify", "name": "Uploaded orders",
                            "customer_ref": "c1", "customer_name": "Asha", "orders": [order]}]}
    ws = "ws_case_" + uuid.uuid4().hex[:6]
    r = client.post("/v1/tests/cases", json={"workspace_id": ws, "cases": [{
        "question": "Where is my order #2001?", "category": "Order status", "must_include": ["#2001", "delivered"],
        "as_user": {"id": "c1", "name": "Asha"}, "commerce": commerce}]})
    assert r.status_code == 201, r.text
    run = client.post("/v1/tests/runs", json={"workspace_id": ws}).json()
    done = client.get(f"/v1/tests/runs/{run['id']}", params={"workspace_id": ws}).json()
    assert done["status"] == "done" and done["passed"] == 1, done["results"]


# ---------------------------------------------------------------- website chat: requirements and order questions

WA = "https://wa.me/919000000001?text=Hi"


@needs_db
@pytest.mark.parametrize("text", ["Where is my order?", "I want to return my order", "can I change my delivery address",
                                  "I want a refund", "track order #1023", "cancel my order"])
def test_web_order_questions_go_to_whatsapp(client, text):
    r = chat(client, text, catalog=CATALOG, sales={**SALES, "order_help_url": WA})
    assert r["route"] == "guardrail" and "order_redirect" in r["flags"]
    assert r["action"] == {"type": "whatsapp", "url": WA} and r["outcome"] == "answered"


@needs_db
def test_web_order_question_without_whatsapp_number(client):
    r = chat(client, "Where is my order?", catalog=CATALOG, sales=SALES)
    assert "order_redirect" in r["flags"] and r["action"] is None and "order confirmation" in r["reply"]


@needs_db
def test_shopping_questions_are_not_order_questions(client):
    for text in ("how long does delivery take?", "do you have linen shirts under 2000?"):
        r = chat(client, text, catalog=CATALOG, sales={**SALES, "order_help_url": WA})
        assert "order_redirect" not in r["flags"], text


def test_sales_prompt_says_what_fits_and_what_doesnt():
    from app.models import ChatRequest, Message
    base = {"workspace_id": "w", "conversation_id": "c", "messages": [Message(role="user", content="shoes")],
            "catalog": [CatalogProduct(**p) for p in CATALOG]}
    fits = ChatRequest(**base, sales={**SALES, "criteria": "budget up to $100 · size M", "criteria_matched": True})
    system = sales.sales_prompt(fits, "shoes", "English", [], [])[0]["content"]
    assert "looking for: budget up to $100 · size M" in system and "meets all of it" in system
    misses = ChatRequest(**base, sales={**SALES, "criteria": "looking for: shoe", "criteria_matched": False, "relaxed": ["product"]})
    system = sales.sales_prompt(misses, "shoes", "English", [], [])[0]["content"]
    assert "Nothing in the store matches that kind of product" in system and "honestly" in system


@needs_db
def test_budget_from_earlier_in_the_chat_is_a_trusted_amount(client, monkeypatch):
    monkeypatch.setattr(llm.FakeProvider, "_recommend", staticmethod(
        lambda system, q: "Within your $3,500 budget, the Denim jacket [P2] at ₹3,299 is a great pick."))
    r = chat(client, "show me jackets", catalog=CATALOG,
             sales={**SALES, "criteria": "budget up to $3,500 · looking for: jacket", "criteria_matched": True})
    assert "unsupported_price_removed" not in r["flags"] and "$3,500" in r["reply"]
