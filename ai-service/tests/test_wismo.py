"""WISMO: order-question detection, reply wording, and the CSV importer."""
import csv
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import commerce, wismo

NOW = datetime(2026, 11, 13, 10, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("text,expected", [
    ("Where is my order?", True),
    ("where's my parcel", True),
    ("track my order", True),
    ("order status", True),
    ("when will my order arrive?", True),
    ("has my order been shipped?", True),
    ("I haven't received my order", True),
    ("mera order kab aayega?", True),
    ("order kab milega", True),
    ("How long does delivery take to Chennai?", False),     # policy, not a specific order
    ("Can I change my delivery address after dispatch?", False),
    ("What is your return policy?", False),
    ("I was charged twice for the same order", False),
])
def test_is_order_question(text, expected):
    assert wismo.is_order_question(text) is expected


@pytest.mark.parametrize("text,ref", [
    ("Track #ux-109946 please", "UX109946"),
    ("status of order UX100024", "UX100024"),
    ("order number 109958?", "UX109958"),
    ("b8ec9f86-5919-4b71-a5f7-945e7c0a3db0", "b8ec9f86-5919-4b71-a5f7-945e7c0a3db0"),
    ("call me at 9876543210", None),
    ("where is my order", None),
])
def test_extract_order_ref(text, ref):
    assert commerce.extract_order_ref(text) == ref


def order(status, **kw):
    base = dict(order_number="UX100001", category="Toys", quantity=2, status=status,
                order_date=NOW - timedelta(days=3), shipping_date=NOW - timedelta(days=2),
                expected_delivery=NOW + timedelta(days=2), delivered_at=None,
                courier="Delhivery", tracking_number="DL0000000001")
    return {**base, **kw}


def test_describe_states():
    assert wismo.describe(order("Shipped"), NOW)[2] == "in_transit"
    assert wismo.describe(order("Shipped", expected_delivery=NOW - timedelta(days=5)), NOW)[2] == "shipped_delayed"
    assert wismo.describe(order("Pending", shipping_date=NOW + timedelta(days=2)), NOW)[2] == "pending"
    assert wismo.describe(order("Pending", shipping_date=NOW - timedelta(days=4)), NOW)[2] == "pending_delayed"
    text, chips, state = wismo.describe(order("Delivered", delivered_at=NOW - timedelta(days=1)), NOW)
    assert state == "delivered" and "yesterday" in text
    text, chips, state = wismo.describe(order("Returned", delivered_at=NOW - timedelta(days=9)), NOW)
    assert state == "returned" and "business days" not in text and chips == ["How long do refunds take?"]


def test_replies_never_include_price_or_address():
    for st in ("Pending", "Shipped", "Delivered", "Returned"):
        text = wismo.describe(order(st, delivered_at=NOW, total=99.5, shipping_address="1 Main St"), NOW)[0]
        assert "99.5" not in text and "Main St" not in text


try:
    import psycopg

    from app.config import get_settings
    psycopg.connect(get_settings().database_url, connect_timeout=3).close()
    DB_OK = True
except Exception:
    DB_OK = False


@pytest.mark.skipif(not DB_OK, reason="needs Postgres")
def test_loader_on_a_small_csv(tmp_path: Path):
    src = Path(__file__).resolve().parent.parent / "data" / "ecommerce_orders_clean.csv"
    small = tmp_path / "small.csv"
    with open(src, newline="", encoding="utf-8") as f, open(small, "w", newline="", encoding="utf-8") as out:
        r = csv.reader(f)
        w = csv.writer(out)
        for i, row in enumerate(r):
            if i > 40:
                break
            w.writerow(row)
    ws = "ws_test_orders"
    res = subprocess.run([sys.executable, "-m", "scripts.load_orders", "--file", str(small), "--workspace", ws,
                          "--reset"], capture_output=True, text=True, cwd=Path(__file__).resolve().parent.parent)
    assert res.returncode == 0, res.stderr
    assert "loaded 40 orders" in res.stdout
    from app.db import conn
    with conn() as c:
        rows = c.execute("SELECT status, shipping_date, delivered_at, courier FROM commerce.orders "
                         "WHERE workspace_id=%s", (ws,)).fetchall()
        assert len(rows) == 40
        assert all(r["courier"] is None for r in rows if r["status"] == "Pending")
        assert all(r["delivered_at"] for r in rows if r["status"] in ("Delivered", "Returned"))
        assert all(r["shipping_date"] <= datetime.now(timezone.utc) for r in rows if r["status"] != "Pending")
        c.execute("DELETE FROM commerce.orders WHERE workspace_id=%s", (ws,))
        c.execute("DELETE FROM commerce.customers WHERE workspace_id=%s", (ws,))
