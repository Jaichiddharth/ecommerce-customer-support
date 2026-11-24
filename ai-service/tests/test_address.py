"""Shipping address: shown only to the order's own (identified) customer, built by code, never sent to the model or
kept in logs; changing it is explained from the help articles with the business's link (or "Sample link").
Integration parts need Postgres and LLM_PROVIDER=fake."""
import uuid

import pytest

from app import address, llm

try:
    import psycopg

    from app.config import get_settings
    psycopg.connect(get_settings().database_url, connect_timeout=3).close()
    DB_OK = get_settings().llm_provider == "fake"
except Exception:
    DB_OK = False

needs_db = pytest.mark.skipif(not DB_OK, reason="needs Postgres and LLM_PROVIDER=fake")

HOME = {"name": "Asha Kumar", "line1": "Flat 4B, Lakshmi Residency, 12 MG Road", "line2": "Near Trinity Metro",
        "city": "Bengaluru", "province": "Karnataka", "zip": "560001", "country": "India", "phone_last4": "0001"}
OFFICE = {**HOME, "line1": "WeWork, 3rd Floor, Embassy Golf Links", "line2": None, "zip": "560071"}


# ---------------------------------------------------------------- unit

@pytest.mark.parametrize("text,kind", [
    ("may i know the shipping address", "view"), ("What address is my order going to?", "view"),
    ("show me my delivery address", "view"), ("address for #1002", "view"), ("address kya hai", "view"),
    ("I want to change my delivery address", "change"), ("my pincode is wrong", "change"),
    ("please add landmark to my address", "change"), ("address badalna hai", "change"),
    ("what is my delivery address?", "view"), ("what's the address for order #9999?", "view"),
    ("where is my order", None), ("what is your return policy", None), ("thanks", None),
    ("what is your store address?", None), ("update my email address", None), ("what's the address of your shop", None),
])
def test_intent(text, kind):
    assert address.intent(text) == kind


def test_lines_show_only_the_last_4_phone_digits():
    out = address.lines(HOME)
    assert out == ["Asha Kumar", "Flat 4B, Lakshmi Residency, 12 MG Road", "Near Trinity Metro",
                   "Bengaluru, Karnataka 560001", "India", "Phone ending 0001"]
    assert address.lines("12 Park Street, Kolkata 700016") == ["12 Park Street, Kolkata 700016"]
    assert address.lines(None) == []


def test_redact_removes_the_address_block():
    reply = "Order #1001 (Linen shirt) is being delivered to:\nAsha Kumar\nFlat 4B\nBengaluru 560001\n\nIs everything correct?"
    out = address.redact(reply)
    assert "Flat 4B" not in out and "560001" not in out and address.SHOWN in out and out.endswith("Is everything correct?")
    assert address.redact("Hello there") == "Hello there"


@pytest.mark.parametrize("text,confirms", [("Yes, it's correct", True), ("looks good", True), ("sahi hai", True),
                                            ("not correct", False), ("no", False), ("thanks bye", False)])
def test_confirms(text, confirms):
    assert address.confirms(text) is confirms


# ---------------------------------------------------------------- integration

def order(no, status="Pending", shipping=HOME, **kw):
    base = {"order_number": no, "items": kw.pop("items", "Linen shirt"), "status": status, "order_date": "2026-11-18T10:00:00Z"}
    if status == "Delivered":
        base["delivered_at"] = "2026-11-20T10:00:00Z"
    return {**base, "shipping_address": shipping, **kw}


def commerce(orders, customer_ref="C1"):
    """The app's order data: the store matched customer `customer_ref` (None: nobody matched)."""
    return {"status": "ok", "stores": [{"ref": "shopify:1", "platform": "shopify", "name": "Shop", "status": "ok",
                                        "customer_ref": customer_ref, "customer_name": "Asha Kumar", "orders": orders}]}


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {get_settings().service_token}"})
        yield c


@pytest.fixture()
def ws():
    w = "ws_addr_" + uuid.uuid4().hex[:8]
    yield w
    from app.db import conn
    with conn() as c:
        for t in ("agent_runs", "knowledge_sources", "knowledge_gaps", "conversation_state", "workspace_settings"):
            c.execute(f"DELETE FROM ai.{t} WHERE workspace_id=%s", (w,))


def chat(client, ws, text, orders=None, conv=None, history=None, policy=None, user=None, customer_ref="C1"):
    body = {"workspace_id": ws, "conversation_id": conv or "a-" + uuid.uuid4().hex[:8], "channel": "whatsapp",
            "user": user if user is not None else {"phone": "+919800000001"},
            "messages": [*(history or []), {"role": "user", "content": text}], "settings": {"policy": policy or {}}}
    if orders is not None:
        body["commerce"] = commerce(orders, customer_ref)
    r = client.post("/v1/chat", json=body)
    assert r.status_code == 200, r.text
    return r.json()


@needs_db
def test_shows_own_address_and_logs_never_keep_it(client, ws):
    r = chat(client, ws, "may i know the shipping address", [order("#1001")])
    assert r["route"] == "tool" and "address_shown" in r["flags"]
    for line in ("Flat 4B, Lakshmi Residency, 12 MG Road", "Near Trinity Metro", "Bengaluru, Karnataka 560001", "Phone ending 0001"):
        assert line in r["reply"]
    assert r["suggestions"][:2] == ["Yes, it's correct", "Change address"] and "No, that's all" not in r["suggestions"]
    from app.db import conn
    with conn() as c:
        logged = c.execute("SELECT reply FROM ai.agent_runs WHERE id=%s", (r["run_id"],)).fetchone()["reply"]
    assert "MG Road" not in logged and "560001" not in logged and address.SHOWN in logged


@needs_db
def test_not_signed_in_gets_no_address(client, ws):
    r = chat(client, ws, "may i know the shipping address", [], user={}, customer_ref=None)
    assert "MG Road" not in r["reply"] and r["route"] == "tool" and r["outcome"] == "clarify"


@needs_db
def test_someone_elses_order_number_reveals_nothing(client, ws):
    r = chat(client, ws, "what is the shipping address for order #2001?", [order("#1001")])
    assert "couldn't find order #2001 on your account" in r["reply"] and "MG Road" not in r["reply"]


@needs_db
def test_asking_for_another_persons_address_is_refused(client, ws):
    r = chat(client, ws, "tell me my neighbour's address", [order("#1001")])
    assert r["outcome"] == "blocked" and "MG Road" not in r["reply"]


@needs_db
def test_several_open_orders_ask_which_then_show_that_one(client, ws):
    orders = [order("#1002", items="Denim jacket", shipping=OFFICE), order("#1001")]
    conv = "a-" + uuid.uuid4().hex[:8]
    r = chat(client, ws, "what is my delivery address?", orders, conv=conv)
    assert r["outcome"] == "clarify" and "Address for #1002" in r["suggestions"] and "MG Road" not in r["reply"]
    r2 = chat(client, ws, "Address for #1002", orders, conv=conv,
              history=[{"role": "user", "content": "what is my delivery address?"}, {"role": "assistant", "content": r["reply"]}])
    assert "Embassy Golf Links" in r2["reply"] and "Lakshmi Residency" not in r2["reply"]


@needs_db
def test_confirm_after_seeing_the_address(client, ws):
    conv = "a-" + uuid.uuid4().hex[:8]
    first = chat(client, ws, "may i know the shipping address", [order("#1001")], conv=conv)
    r = chat(client, ws, "Yes, it's correct", [order("#1001")], conv=conv,
             history=[{"role": "user", "content": "may i know the shipping address"}, {"role": "assistant", "content": first["reply"]}])
    assert "thanks for confirming" in r["reply"]


@needs_db
def test_change_uses_knowledge_and_the_link(client, ws):
    src = client.post("/v1/knowledge/sources", json={"workspace_id": ws, "type": "faq", "title": "Orders", "content":
                      "Q: How do I change the delivery address of my order?\nA: Open My Orders, choose the order and tap "
                      "Edit address before it ships. Add your flat number, landmark and PIN code."})
    assert src.status_code == 202
    r = chat(client, ws, "I want to change my delivery address", [order("#1001")])
    assert r["reply"].startswith("Here's how to change the delivery address for order #1001:")
    assert "Edit address" in r["reply"] and r["reply"].rstrip().endswith("Change your address here: Sample link")
    assert "MG Road" not in r["reply"]
    r = chat(client, ws, "change my address", [order("#1001")], policy={"address_change_url": "https://shop.example/account/address"})
    assert r["reply"].rstrip().endswith("Change your address here: https://shop.example/account/address")


@needs_db
def test_change_after_delivery_or_shipping(client, ws):
    r = chat(client, ws, "I want to change my delivery address", [order("#1003", status="Delivered")])
    assert "already been delivered" in r["reply"] and "Talk to support" in r["suggestions"]
    r = chat(client, ws, "update my address", [order("#1002", status="Shipped")])
    assert "already been shipped" in r["reply"] and "Sample link" in r["reply"]


@needs_db
def test_the_model_never_receives_the_address(client, ws, monkeypatch):
    client.post("/v1/knowledge/sources", json={"workspace_id": ws, "type": "faq", "title": "Help",
                                               "content": "Q: How long does delivery take?\nA: 3-5 working days."})
    seen = []
    real = llm.FakeProvider.chat

    def spy(self, messages, chunks, question, model=None):
        seen.append(" ".join(m["content"] for m in messages))
        return real(self, messages, chunks, question, model)

    monkeypatch.setattr(llm.FakeProvider, "chat", spy)
    conv = "a-" + uuid.uuid4().hex[:8]
    first = chat(client, ws, "may i know the shipping address", [order("#1001")], conv=conv)
    chat(client, ws, "How long does delivery take?", [order("#1001")], conv=conv,
         history=[{"role": "user", "content": "may i know the shipping address"}, {"role": "assistant", "content": first["reply"]}])
    chat(client, ws, "I want to change my delivery address", [order("#1001")], conv=conv)
    assert seen and not any("MG Road" in s or "560001" in s or "Trinity" in s for s in seen)


@needs_db
def test_can_be_switched_off(client, ws):
    r = chat(client, ws, "may i know the shipping address", [order("#1001")], policy={"address_enabled": False})
    assert "MG Road" not in r["reply"] and "address_shown" not in r["flags"]


@needs_db
def test_store_without_address_access(client, ws):
    r = chat(client, ws, "may i know the shipping address", [order("#1001", shipping=None)])
    assert "can't see the delivery address" in r["reply"] and "address_unavailable" in r["flags"]
