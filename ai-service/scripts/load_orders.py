"""Load an orders CSV into the commerce schema, for testing WISMO ("where is my order?").

    python -m scripts.load_orders                                   # data/ecommerce_orders_clean.csv -> ws_unocx
    python -m scripts.load_orders --workspace ws_eval --reset
    python -m scripts.load_orders --file other.csv --dates keep     # keep the original dates

Expected CSV columns: order_id, customer_id, product_id, category, price, quantity, order_date,
shipping_date, delivery_status, payment_method, device_type, channel, shipping_address,
billing_address, customer_segment.

What it adds (all deterministic, so the same CSV always gives the same result):
  * order_number   UX100001... in order-date order (customers can't type UUIDs)
  * dates shifted  so the newest order was placed yesterday; gaps between dates are kept
                   (--dates keep turns this off). Old orders still "Shipped"/"Pending" then
                   become realistic *delayed* orders.
  * courier, tracking number, expected delivery, delivered date
  * customer name, email and phone: SYNTHETIC (the CSV has none). Phone = 91 9000 + 6-digit id,
    email = customer<ID>@example.com
"""
import argparse
import csv
import hashlib
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.commerce import COMMERCE_SQL
from app.db import conn, init_pool

ROOT = Path(__file__).resolve().parent.parent
COURIERS = [("Delhivery", "DL"), ("Blue Dart", "BD"), ("Ekart", "EK")]
FIRST = ["Priya", "Rahul", "Ananya", "Arjun", "Divya", "Karthik", "Meena", "Vikram", "Sneha", "Rohan",
         "Lakshmi", "Aditya", "Kavya", "Suresh", "Neha", "Imran", "Pooja", "Ravi", "Fatima", "Sanjay"]
LAST = ["Sharma", "Iyer", "Reddy", "Khan", "Patel", "Nair", "Gupta", "Menon", "Das", "Singh",
        "Rao", "Joshi", "Pillai", "Mehta", "Bose"]
STATUSES = {"Pending", "Shipped", "Delivered", "Returned"}


def h(s: str) -> int:
    return int(hashlib.md5(s.encode()).hexdigest(), 16)


def parse_dt(s: str) -> datetime:
    return datetime.fromisoformat(s.strip()).replace(tzinfo=timezone.utc)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=str(ROOT / "data" / "ecommerce_orders_clean.csv"))
    ap.add_argument("--workspace", default="ws_unocx")
    ap.add_argument("--dates", choices=["shift", "keep"], default="shift")
    ap.add_argument("--reset", action="store_true", help="delete this workspace's orders and customers first")
    a = ap.parse_args()

    with open(a.file, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    if not rows:
        raise SystemExit("CSV is empty")
    bad = [r["order_id"] for r in rows if r["delivery_status"] not in STATUSES]
    if bad:
        raise SystemExit(f"{len(bad)} rows have an unknown delivery_status, e.g. {bad[:3]}")

    rows.sort(key=lambda r: (r["order_date"], r["order_id"]))
    now = datetime.now(timezone.utc).replace(microsecond=0)
    shift = timedelta(0)
    if a.dates == "shift":
        # newest order placed one day ago; recent Pending orders keep a future dispatch date
        shift = (now - timedelta(days=1)) - max(parse_dt(r["order_date"]) for r in rows)

    orders, segments = [], {}
    counts = defaultdict(int)
    for i, r in enumerate(rows):
        oid, status = r["order_id"], r["delivery_status"]
        k = h(oid)
        ordered = parse_dt(r["order_date"]) + shift
        shipped = parse_dt(r["shipping_date"]) + shift
        if status != "Pending" and shipped > now:
            shipped = max(ordered, now - timedelta(hours=2))  # can't have shipped in the future
        transit = timedelta(days=2 + k % 6)
        expected = shipped + transit
        courier, prefix = COURIERS[k % 3]
        tracking = f"{prefix}{k % 10**10:010d}"
        delivered = min(expected, now) if status in ("Delivered", "Returned") else None
        if status == "Pending":
            courier = tracking = None
        qty, price = int(r["quantity"]), round(float(r["price"]), 2)
        orders.append((
            a.workspace, oid, f"UX{100001 + i}", str(int(r["customer_id"])), int(r["product_id"]), r["category"],
            price, qty, round(price * qty, 2), "USD", status, ordered, shipped, expected, delivered, courier, tracking,
            r["payment_method"], r["device_type"], r["channel"], r["shipping_address"], r["billing_address"],
            parse_dt(r["order_date"]),
        ))
        segments[str(int(r["customer_id"]))] = r["customer_segment"]  # latest order wins (rows are sorted)
        counts[status] += 1

    customers = []
    for ref, seg in segments.items():
        k = h("cust" + ref)
        name = f"{FIRST[k % len(FIRST)]} {LAST[(k // 7) % len(LAST)]}"
        customers.append((a.workspace, ref, name, f"customer{ref}@example.com", f"919000{int(ref):06d}", seg, True))

    init_pool()
    with conn() as c:
        c.execute(COMMERCE_SQL)
        with c.transaction():
            if a.reset:
                c.execute("DELETE FROM commerce.orders WHERE workspace_id=%s", (a.workspace,))
                c.execute("DELETE FROM commerce.customers WHERE workspace_id=%s", (a.workspace,))
            with c.cursor() as cur:
                with cur.copy("COPY commerce.customers (workspace_id, customer_ref, name, email, phone, segment, "
                              "synthetic_contact) FROM STDIN") as cp:
                    for row in customers:
                        cp.write_row(row)
                with cur.copy("COPY commerce.orders (workspace_id, order_id, order_number, customer_ref, product_id, "
                              "category, unit_price, quantity, total, currency, status, order_date, shipping_date, "
                              "expected_delivery, delivered_at, courier, tracking_number, payment_method, device_type, "
                              "sales_channel, shipping_address, billing_address, source_order_date) FROM STDIN") as cp:
                    for row in orders:
                        cp.write_row(row)
        # Courier contact details shown to customers whose order is marked delivered but missing.
        # Official websites only: phone numbers are left for the business to fill in, never guessed.
        c.execute(
            "INSERT INTO commerce.couriers (workspace_id, name, website) VALUES "
            "(%s,'Delhivery','www.delhivery.com'), (%s,'Blue Dart','www.bluedart.com'), (%s,'Ekart','ekartlogistics.com') "
            "ON CONFLICT (workspace_id, name) DO NOTHING", (a.workspace, a.workspace, a.workspace))
        overdue = c.execute(
            "SELECT count(*) FILTER (WHERE status='Shipped' AND expected_delivery < now()) AS late_shipped,"
            " count(*) FILTER (WHERE status='Pending' AND shipping_date < now()) AS late_pending"
            " FROM commerce.orders WHERE workspace_id=%s", (a.workspace,)).fetchone()

    print(f"loaded {len(orders)} orders and {len(customers)} customers into workspace {a.workspace}")
    print("status:", dict(counts))
    if a.dates == "shift":
        print(f"dates shifted by {shift.days} days: orders now run "
              f"{min(o[11] for o in orders):%d %b %Y} to {max(o[11] for o in orders):%d %b %Y}")
    print(f"delayed (realistic edge cases): {overdue['late_shipped']} shipped past their expected date, "
          f"{overdue['late_pending']} pending past their dispatch date")
    sample = orders[-1][3]  # the customer with the most recent order
    print("courier contacts: websites added; set phone numbers with UPDATE commerce.couriers (see README)")
    print(f"try it: customer id {sample} (phone +919000{int(sample):06d}, email customer{sample}@example.com)")


if __name__ == "__main__":
    main()
