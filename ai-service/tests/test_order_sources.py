"""Order data provided by the app (connected stores such as Shopify): number matching, isolation,
several stores, a store that couldn't be read, and reply wording for store-shaped orders."""
from datetime import datetime, timedelta, timezone

import pytest

from app import commerce, wismo
from app.models import ChatRequest, CommerceContext

NOW = datetime(2026, 11, 13, 10, 0, tzinfo=timezone.utc)


def order(number, status="Shipped", days_ago=3, **kw):
    return {"order_number": number, "order_id": f"gid://shopify/Order/{number.strip('#')}", "items": "Linen shirt",
            "quantity": 1, "total": 1499.0, "currency": "INR", "status": status,
            "order_date": (NOW - timedelta(days=days_ago)).isoformat(), **kw}


def ctx(*stores, status="ok"):
    return CommerceContext.model_validate({"status": status, "stores": list(stores)})


def store(ref="shopify:1", name="Main store", customer="gid://shopify/Customer/7", orders=(), **kw):
    return {"ref": ref, "platform": "shopify", "name": name, "customer_ref": customer, "customer_name": "Asha",
            "orders": list(orders), **kw}


def test_request_accepts_commerce_context():
    req = ChatRequest.model_validate({"workspace_id": "org_1", "conversation_id": "c1",
                                      "messages": [{"role": "user", "content": "where is my order"}],
                                      "commerce": {"stores": [store(orders=[order("#1001")])]}})
    assert req.commerce.stores[0].orders[0].order_number == "#1001"


@pytest.mark.parametrize("text,ref", [
    ("where is #1002?", "#1002"),
    ("status of order 1001", "#1001"),
    ("1001 please", "#1001"),                  # the customer's own number, typed on its own
    ("hey, any news on 1001?", "#1001"),
    ("my number is 9810010000", None),        # never part of a longer number
    ("track order no. 5555", "#5555"),        # looks like an order number, not theirs
    ("track SO-1001", None),                  # no '#' / 'order' and not one of theirs
    ("call me on 9876543210", None),
    ("where is my order", None),
])
def test_extract_ref_with_store_orders(text, ref):
    src = commerce.ProvidedOrders(ctx(store(orders=[order("#1001"), order("#1002", days_ago=1)])))
    assert src.extract_order_ref(text) == ref


def test_prefixed_store_numbers():
    src = commerce.ProvidedOrders(ctx(store(orders=[order("SO-1001")])))
    assert src.extract_order_ref("what about so 1001") == "SO-1001"
    assert src.extract_order_ref("so1001?") == "SO-1001"


def test_customer_and_orders_newest_first():
    src = commerce.ProvidedOrders(ctx(store(orders=[order("#1001", days_ago=9), order("#1002", days_ago=1)])))
    cust = src.find_customer("org_1", None)
    assert cust and cust["name"] == "Asha"
    assert [o["order_number"] for o in src.recent_orders("org_1", cust["customer_ref"], 3)] == ["#1002", "#1001"]
    assert src.customer_order("org_1", cust["customer_ref"], "1001")["order_number"] == "#1001"
    assert src.customer_order("org_1", cust["customer_ref"], "#9999") is None
    # only the customer this source identified
    assert src.recent_orders("org_1", "someone-else", 3) == []
    assert src.customer_order("org_1", "someone-else", "#1001") is None


def test_no_matching_customer_means_no_orders_not_unavailable():
    src = commerce.ProvidedOrders(ctx(store(customer=None)))
    assert src.available() and src.find_customer("org_1", None) is None and not src.unavailable()


def test_unavailable_only_when_nothing_identified_the_customer():
    down = store(ref="shopify:2", name="Second", customer=None, status="unavailable")
    assert commerce.ProvidedOrders(ctx(down)).unavailable()
    both = commerce.ProvidedOrders(ctx(store(orders=[order("#1001")]), down))
    assert not both.unavailable() and both.find_customer("org_1", None)


def test_several_stores_are_merged_and_named():
    src = commerce.ProvidedOrders(ctx(
        store(orders=[order("#1001", days_ago=5)]),
        store(ref="shopify:2", name="Outlet", customer="gid://shopify/Customer/99", orders=[order("#1001", days_ago=1)]),
    ))
    cust = src.find_customer("org_1", None)
    recent = src.recent_orders("org_1", cust["customer_ref"], 3)
    assert [o["store_ref"] for o in recent] == ["shopify:2", "shopify:1"]
    assert recent[0]["category"] == "Linen shirt, from Outlet"
    # the same number in two stores resolves to the newer order
    assert src.customer_order("org_1", cust["customer_ref"], "#1001")["store_ref"] == "shopify:2"


def test_no_store_for_channel():
    assert not commerce.ProvidedOrders(ctx(status="no_store")).available()


def test_using_binds_and_restores():
    provided = ctx(store(orders=[order("#1001")]))
    with commerce.using(provided) as src:
        assert commerce.active() is src and src.name == "provided"
        assert commerce.extract_order_ref("order 1001") == "#1001"
    assert commerce.active().name in ("demo", "none")


def _o(status, **kw):
    base = dict(order_number="#1001", category="Linen shirt", quantity=1, status=status,
                order_date=NOW - timedelta(days=3))
    return {**base, **kw}


def test_describe_store_shaped_orders():
    text, _, state = wismo.describe(_o("Pending"), NOW)
    assert state == "pending" and "being prepared" in text and "?" not in text
    text, _, state = wismo.describe(_o("Shipped", shipping_date=NOW - timedelta(days=1)), NOW)
    assert state == "in_transit" and "None" not in text and "yesterday" in text
    text, _, state = wismo.describe(_o("Shipped", shipping_date=NOW - timedelta(days=1), courier="Delhivery",
                                       tracking_number="DL1", tracking_url="https://track.example/DL1",
                                       delivery_status="out_for_delivery"), NOW)
    assert state == "out_for_delivery" and "https://track.example/DL1" in text and "out for delivery" in text
    text, _, _ = wismo.describe(_o("Shipped", partially_shipped=True), NOW)
    assert text.startswith("Part of order #1001")
    text, chips, state = wismo.describe(_o("Cancelled", cancelled_at=NOW - timedelta(days=1)), NOW)
    assert state == "cancelled" and "cancelled yesterday" in text
    text, _, state = wismo.describe(_o("Delivered"), NOW)
    assert state == "delivered" and text == "Order #1001 (Linen shirt, 1 item) was delivered."
