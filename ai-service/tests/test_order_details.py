"""Order details (test data): questions about any column of the customer's own order, answered from that order's
record only. Status questions stay with wismo. Integration parts need Postgres and LLM_PROVIDER=fake."""
import uuid

import pytest

from app import order_details

try:
    import psycopg

    from app.config import get_settings
    psycopg.connect(get_settings().database_url, connect_timeout=3).close()
    DB_OK = get_settings().llm_provider == "fake"
except Exception:
    DB_OK = False

needs_db = pytest.mark.skipif(not DB_OK, reason="needs Postgres and LLM_PROVIDER=fake")

DETAILS = {"Ship Mode": "Second Class", "Segment": "Consumer", "Payment Mode": "COD", "Region": "South"}
ITEMS = [{"Category": "Furniture", "Product Name": "Bookcase", "Discount": "0.2"},
         {"Category": "Office Supplies", "Product Name": "Labels", "Discount": "0"}]


def order(no="#1001", status="Shipped", details=DETAILS, **kw):
    return {"order_number": no, "items": "Bookcase + 1 more", "status": status, "order_date": "2026-11-18T10:00:00Z",
            "shipping_date": "2026-11-19T10:00:00Z", "details": details, "item_details": ITEMS, **kw}


# ---------------------------------------------------------------- unit

@pytest.mark.parametrize("text,yes", [
    ("What payment mode did I use for my order?", True),
    ("what was the ship mode of order #1001", True),
    ("which segment is my order in?", True),
    ("how much discount did I get on my order", True),
    ("what category are the items in my order", True),
    ("give me the details of my order", True),
    ("where is my order", False),            # status: wismo
    ("when will my delivery arrive", False),  # delivery words aren't columns
    ("what is your return policy", False),    # not about their order
])
def test_asks_about(text, yes):
    assert order_details.asks_about(text, order()) is yes


def test_record_lists_every_column_and_item():
    text = order_details.record_text(order())
    for part in ("Order number: #1001", "Payment Mode: COD", "Ship Mode: Second Class",
                 "Item 1: Category: Furniture; Product Name: Bookcase; Discount: 0.2", "Item 2: Category: Office Supplies"):
        assert part in text


# ---------------------------------------------------------------- integration

@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {get_settings().service_token}"})
        yield c


@pytest.fixture()
def ws():
    w = "ws_od_" + uuid.uuid4().hex[:8]
    yield w
    from app.db import conn
    with conn() as c:
        for t in ("agent_runs", "knowledge_sources", "knowledge_gaps", "conversation_state", "workspace_settings"):
            c.execute(f"DELETE FROM ai.{t} WHERE workspace_id=%s", (w,))


def chat(client, ws, text, orders, customer_ref="C1"):
    body = {"workspace_id": ws, "conversation_id": "od-" + uuid.uuid4().hex[:8], "channel": "whatsapp",
            "user": {"phone": "+919800000001"}, "messages": [{"role": "user", "content": text}], "settings": {"policy": {}},
            "commerce": {"status": "ok", "stores": [{"ref": "sample:orders", "platform": "shopify", "name": "Sample orders",
                                                    "status": "ok", "customer_ref": customer_ref, "orders": orders}]}}
    r = client.post("/v1/chat", json=body)
    assert r.status_code == 200, r.text
    return r.json()


@needs_db
def test_answers_a_column_of_the_customers_order(client, ws):
    r = chat(client, ws, "What payment mode did I use for order #1001?", [order()])
    assert r["route"] == "tool" and "order_details" in r["flags"] and "COD" in r["reply"]


@needs_db
def test_status_question_still_goes_to_wismo(client, ws):
    r = chat(client, ws, "where is my order #1001?", [order()])
    assert "order_details" not in r["flags"] and "shipped" in r["reply"].lower()


@needs_db
def test_store_orders_without_details_never_use_it(client, ws):
    r = chat(client, ws, "What payment mode did I use for order #1001?", [order(details=None, item_details=None)])
    assert "order_details" not in r["flags"]


@needs_db
def test_not_their_order_reveals_nothing(client, ws):
    r = chat(client, ws, "What payment mode did I use for order #2002?", [order()])
    assert "COD" not in r["reply"]
