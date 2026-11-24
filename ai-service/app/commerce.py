"""Order data for WISMO ("where is my order?"), behind one small interface (OrderSource).

Sources:
  * ProvidedOrders  the Next.js app looked the customer up in the store(s) of this conversation's
                    channel (Shopify today, more platforms later) and sent the result with the request
                    (ChatRequest.commerce). Store tokens never reach this service.
  * DemoOrders      the `commerce` schema below, loaded from a CSV for testing (scripts/load_orders.py).
                    Used only when the request carries no order data and DEMO_ORDERS is on.
  * NoOrders        neither: order questions get the "no orders found" / sign-in replies.

The rest of the agent calls the module functions (available, find_customer, recent_orders,
customer_order, extract_order_ref); they use the source bound to the current request with
`using(req.commerce)`. Every lookup is scoped to one workspace AND one identified customer.
"""
import logging
import re
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from typing import Protocol

from .config import get_settings
from .db import conn

log = logging.getLogger("unocx.commerce")

COMMERCE_SQL = """
CREATE SCHEMA IF NOT EXISTS commerce;

CREATE TABLE IF NOT EXISTS commerce.customers (
    workspace_id  TEXT NOT NULL,
    customer_ref  TEXT NOT NULL,              -- the store's customer id (CSV customer_id)
    name          TEXT NOT NULL,
    email         TEXT,
    phone         TEXT,                       -- digits only, with country code
    segment       TEXT,
    synthetic_contact BOOLEAN NOT NULL DEFAULT true,
    PRIMARY KEY (workspace_id, customer_ref)
);
CREATE INDEX IF NOT EXISTS commerce_customers_email ON commerce.customers (workspace_id, lower(email));
CREATE INDEX IF NOT EXISTS commerce_customers_phone ON commerce.customers (workspace_id, phone);

CREATE TABLE IF NOT EXISTS commerce.orders (
    workspace_id      TEXT NOT NULL,
    order_id          UUID NOT NULL,
    order_number      TEXT NOT NULL,          -- short, customer-facing: UX100001
    customer_ref      TEXT NOT NULL,
    product_id        INT,
    category          TEXT,
    unit_price        NUMERIC(10,2),
    quantity          INT,
    total             NUMERIC(12,2),
    currency          TEXT NOT NULL DEFAULT 'USD',
    status            TEXT NOT NULL CHECK (status IN ('Pending','Shipped','Delivered','Returned')),
    order_date        TIMESTAMPTZ NOT NULL,
    shipping_date     TIMESTAMPTZ,            -- dispatched (or planned dispatch for Pending)
    expected_delivery TIMESTAMPTZ,
    delivered_at      TIMESTAMPTZ,
    courier           TEXT,
    tracking_number   TEXT,
    payment_method    TEXT,
    device_type       TEXT,
    sales_channel     TEXT,
    shipping_address  TEXT,
    billing_address   TEXT,
    source_order_date TIMESTAMPTZ,            -- original CSV date, before the date shift
    PRIMARY KEY (workspace_id, order_id),
    UNIQUE (workspace_id, order_number),
    FOREIGN KEY (workspace_id, customer_ref) REFERENCES commerce.customers (workspace_id, customer_ref)
        ON DELETE CASCADE
);
-- How customers can reach each courier. Filled in per business; never guessed by the AI.
CREATE TABLE IF NOT EXISTS commerce.couriers (
    workspace_id  TEXT NOT NULL,
    name          TEXT NOT NULL,
    phone         TEXT,
    website       TEXT,
    email         TEXT,
    PRIMARY KEY (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS commerce_orders_customer ON commerce.orders (workspace_id, customer_ref, order_date DESC);
"""

ORDER_NO_RE = re.compile(r"\b#?\s*(UX)\s*-?\s*(\d{6})\b|\border\s*(?:no\.?|number|num|id|#)?\s*[:#]?\s*(\d{6})\b", re.I)
UUID_RE = re.compile(r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I)
# Store order numbers ("#1001", "SO-1001", "1001-A"): only after a "#" or the word "order", so phone
# numbers and amounts in a message are never taken for one
_NUMBER = r"[a-z]{0,6}-?\d{3,12}(?:-[a-z0-9]{1,4})?"
STORE_ORDER_RE = re.compile(
    rf"#\s*({_NUMBER})\b|\border\s*(?:no\.?|number|num|id)?\s*[:#]?\s*#?\s*({_NUMBER})\b", re.I)

_FIELDS = ("order_number, order_id::text AS order_id, category, quantity, total, currency, status, order_date, "
           "shipping_date, expected_delivery, delivered_at, courier, tracking_number")


def _digits(phone: str | None) -> str:
    return re.sub(r"\D", "", phone or "")


def _norm(number: str) -> str:
    """'#1001' / '1001' / 'so-1001' / 'SO 1001' -> a comparable form."""
    return re.sub(r"[^a-z0-9]", "", (number or "").lower())


def _mentions(text: str, number: str) -> bool:
    """Whether the message contains this order number as a whole token: '#1001' matches "any news on 1001?"
    and "#1001"; 'SO1001' also matches "so-1001" / "SO 1001". Never part of a longer number, and not with a
    different prefix ("SO-1001" is not '#1001')."""
    parts = re.findall(r"[a-z]+|\d+", _norm(number))
    if not parts or not any(p.isdigit() and len(p) >= 3 for p in parts):
        return False
    pattern = r"[\s#-]*".join(map(re.escape, parts))
    return re.search(rf"(?<![a-z0-9])(?<![a-z]-){pattern}(?![a-z0-9])", (text or "").lower()) is not None


def _generic_ref(text: str) -> str | None:
    m = STORE_ORDER_RE.search(text or "")
    if not m:
        return None
    raw = (m.group(1) or m.group(2)).upper()
    return f"#{raw}" if raw[0].isdigit() else raw


class OrderSource(Protocol):
    name: str

    def available(self) -> bool: ...
    def unavailable(self) -> bool: ...
    def extract_order_ref(self, text: str) -> str | None: ...
    def find_customer(self, workspace_id: str, user) -> dict | None: ...
    def recent_orders(self, workspace_id: str, customer_ref: str, limit: int = 3) -> list[dict]: ...
    def customer_order(self, workspace_id: str, customer_ref: str, ref: str) -> dict | None: ...
    def shipping_address(self, workspace_id: str, customer_ref: str, order: dict): ...


# ---------------------------------------------------------------- demo data (commerce schema)

class DemoOrders:
    name = "demo"

    def available(self) -> bool:
        with conn() as c:
            return c.execute("SELECT to_regclass('commerce.orders') IS NOT NULL AS ok").fetchone()["ok"]

    def unavailable(self) -> bool:
        return False

    def extract_order_ref(self, text: str) -> str | None:
        """'UX100234', '#ux-100234', 'order number 100234' -> 'UX100234'; a UUID is returned as-is."""
        m = ORDER_NO_RE.search(text or "")
        if m:
            return "UX" + (m.group(2) or m.group(3))
        u = UUID_RE.search(text or "")
        return u.group(0).lower() if u else None

    def find_customer(self, workspace_id: str, user) -> dict | None:
        """Matches the store's customer id, then email, then phone (last 10 digits)."""
        with conn() as c:
            if user.id:
                row = c.execute("SELECT * FROM commerce.customers WHERE workspace_id=%s AND customer_ref=%s",
                                (workspace_id, str(user.id))).fetchone()
                if row:
                    return row
            if user.email:
                row = c.execute("SELECT * FROM commerce.customers WHERE workspace_id=%s AND lower(email)=lower(%s)",
                                (workspace_id, user.email)).fetchone()
                if row:
                    return row
            phone = _digits(getattr(user, "phone", None))
            if len(phone) >= 10:
                row = c.execute("SELECT * FROM commerce.customers WHERE workspace_id=%s AND right(phone, 10)=%s",
                                (workspace_id, phone[-10:])).fetchone()
                if row:
                    return row
        return None

    def recent_orders(self, workspace_id: str, customer_ref: str, limit: int = 3) -> list[dict]:
        with conn() as c:
            return c.execute(f"SELECT {_FIELDS} FROM commerce.orders WHERE workspace_id=%s AND customer_ref=%s "
                             "ORDER BY order_date DESC LIMIT %s", (workspace_id, customer_ref, limit)).fetchall()

    def customer_order(self, workspace_id: str, customer_ref: str, ref: str) -> dict | None:
        col = "order_id::text" if UUID_RE.fullmatch(ref) else "order_number"
        with conn() as c:
            return c.execute(f"SELECT {_FIELDS} FROM commerce.orders WHERE workspace_id=%s AND customer_ref=%s "
                             f"AND {col}=%s", (workspace_id, customer_ref, ref)).fetchone()


    def shipping_address(self, workspace_id: str, customer_ref: str, order: dict):
        """The demo order's one-line address (only for the order's own customer)."""
        try:
            with conn() as c:
                row = c.execute("SELECT shipping_address FROM commerce.orders WHERE workspace_id=%s AND customer_ref=%s"
                                " AND order_number=%s", (workspace_id, customer_ref, order["order_number"])).fetchone()
        except Exception:
            log.exception("could not read the demo shipping address")
            return None
        return row["shipping_address"] if row and row["shipping_address"] else None


class NoOrders:
    """No order data for this request (demo data switched off and nothing provided)."""
    name = "none"

    def available(self) -> bool:
        return False

    def unavailable(self) -> bool:
        return False

    def extract_order_ref(self, text: str) -> str | None:
        return _generic_ref(text)

    def find_customer(self, workspace_id: str, user) -> dict | None:
        return None

    def recent_orders(self, workspace_id: str, customer_ref: str, limit: int = 3) -> list[dict]:
        return []

    def customer_order(self, workspace_id: str, customer_ref: str, ref: str) -> dict | None:
        return None

    def shipping_address(self, workspace_id: str, customer_ref: str, order: dict):
        return None


# ---------------------------------------------------------------- orders provided by the app

class ProvidedOrders:
    """Orders the Next.js app read from the conversation's store(s), already limited to the customer the app
    identified (contact linked to a store customer, or matched by the verified WhatsApp number / email).
    Several stores are merged into one newest-first list; each order remembers its store."""
    name = "provided"

    def __init__(self, ctx):
        self.ctx = ctx
        matched = [s for s in ctx.stores if s.status == "ok" and s.customer_ref]
        self._failed = any(s.status == "unavailable" for s in ctx.stores)
        multi = sum(1 for s in matched if s.orders) > 1   # orders from several stores: name the store
        rows = [self._row(o, s, multi) for s in matched for o in s.orders]
        self._orders = sorted(rows, key=lambda r: r["order_date"], reverse=True)
        self._customer = None
        if matched:
            self._customer = {
                "customer_ref": "|".join(f"{s.ref}:{s.customer_ref}" for s in matched)[:500],
                "name": next((s.customer_name for s in matched if s.customer_name), None),
                "stores": [s.ref for s in matched],
                "source": "provided",
            }

    @staticmethod
    def _row(o, store, multi: bool) -> dict:
        row = o.model_dump()
        items = row.pop("items") or "your items"
        row["category"] = f"{items}, from {store.name}" if multi and store.name else items
        row["store_ref"] = store.ref
        row["platform"] = store.platform
        return row

    def available(self) -> bool:
        return self.ctx.status == "ok" and bool(self.ctx.stores)

    def unavailable(self) -> bool:
        """A store couldn't be read and no store identified the customer: don't claim they have no orders."""
        return self._failed and self._customer is None

    def find_customer(self, workspace_id: str, user) -> dict | None:
        return self._customer

    def _own(self, customer_ref: str) -> bool:
        return bool(self._customer) and customer_ref == self._customer["customer_ref"]

    def recent_orders(self, workspace_id: str, customer_ref: str, limit: int = 3) -> list[dict]:
        return self._orders[:limit] if self._own(customer_ref) else []

    def customer_order(self, workspace_id: str, customer_ref: str, ref: str) -> dict | None:
        if not ref or not self._own(customer_ref):
            return None
        key = _norm(ref)
        for o in self._orders:   # newest first: a number used by two stores resolves to the newer order
            if _norm(o["order_number"]) == key or (o.get("order_id") and o["order_id"].lower() == ref.lower()):
                return o
        return None

    def shipping_address(self, workspace_id: str, customer_ref: str, order: dict):
        """The address the app sent with the customer's own order (dict), or None."""
        if not self._own(customer_ref):
            return None
        return order.get("shipping_address")

    def extract_order_ref(self, text: str) -> str | None:
        """One of the customer's own order numbers if the message mentions it (even without "#" / "order"),
        else anything that looks like an order number after "#" or "order" (it may not be theirs)."""
        for o in self._orders:
            if _mentions(text, o["order_number"]):
                return o["order_number"]
        return _generic_ref(text)


# ---------------------------------------------------------------- the source of the current request

_DEMO = DemoOrders()
_NONE = NoOrders()
_current: ContextVar[OrderSource | None] = ContextVar("order_source", default=None)


def source_for(commerce_ctx) -> OrderSource:
    if commerce_ctx is not None:
        return ProvidedOrders(commerce_ctx)
    return _DEMO if get_settings().demo_orders else _NONE


@contextmanager
def using(commerce_ctx) -> Iterator[OrderSource]:
    """Bind the request's order source. In generators keep `yield` outside the block: the streaming
    endpoint runs each step of a generator in a fresh copy of the context."""
    token = _current.set(source_for(commerce_ctx))
    try:
        yield _current.get()
    finally:
        _current.reset(token)


def active() -> OrderSource:
    return _current.get() or (_DEMO if get_settings().demo_orders else _NONE)


def available() -> bool:
    return active().available()


def unavailable() -> bool:
    return active().unavailable()


def extract_order_ref(text: str) -> str | None:
    return active().extract_order_ref(text)


def find_customer(workspace_id: str, user) -> dict | None:
    """Identify the person chatting from what the app's session says about them, never from what they type."""
    return active().find_customer(workspace_id, user)


def recent_orders(workspace_id: str, customer_ref: str, limit: int = 3) -> list[dict]:
    return active().recent_orders(workspace_id, customer_ref, limit)


def customer_order(workspace_id: str, customer_ref: str, ref: str) -> dict | None:
    """The order with this number, ONLY if it belongs to this customer."""
    return active().customer_order(workspace_id, customer_ref, ref)


def shipping_address(workspace_id: str, customer_ref: str, order: dict):
    """The order's shipping address: a dict (store data) or a one-line string (demo data); None when unknown.
    Only ever for an order of `customer_ref`, the customer identified from the session."""
    return active().shipping_address(workspace_id, customer_ref, order)


def fmt_date(d: datetime | None) -> str:
    return f"{d.day} {d.strftime('%b %Y')}" if d else "?"   # "%-d" is Linux-only


def courier_contact(workspace_id: str, name: str | None) -> dict:
    """The business's stored contact details for a courier (phone / website / email may be empty).
    Business configuration, so it's read for every order source."""
    if not name:
        return {"name": None}
    try:
        with conn() as c:
            row = c.execute("SELECT name, phone, website, email FROM commerce.couriers "
                            "WHERE workspace_id=%s AND lower(name)=lower(%s)", (workspace_id, name)).fetchone()
    except Exception:
        row = None
    return dict(row) if row else {"name": name}
