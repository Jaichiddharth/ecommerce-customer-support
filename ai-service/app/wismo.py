"""WISMO: "where is my order?"

Answers order-status questions straight from order data: no LLM call, so it costs nothing and
cannot invent dates, couriers or tracking numbers.

Rules:
  * Only orders that belong to the identified customer are ever shown. The customer is identified
    from the session data Next.js sends (user.id = store customer id, email or phone), never from
    what the customer types.
  * Order numbers typed by the customer only select among THEIR orders. A number that isn't theirs
    gets "not found on your account", never a hint that it exists.
  * No store policy is stated here (refund timelines, claim windows): those come from the
    workspace's own help articles, offered as follow-up suggestions.
  * Addresses, prices and payment details are never included in replies.
"""
import re
from datetime import datetime, timedelta, timezone

from . import commerce, order_issues

WISMO_PATTERNS = [
    r"\bwhere('?s| is| are)? (my|the) (order|parcel|package|delivery|shipment|item)s?\b",
    r"\btrack(ing)?\b.*\b(order|parcel|package|shipment)\b|\b(order|parcel|package|shipment)\b.*\btrack(ing)?\b",
    r"\b(order|delivery|shipping|shipment) status\b|\bstatus of (my|the) (order|delivery|parcel|package)\b",
    r"\bwhen (will|would|does|is) (it|my (order|parcel|package|delivery|item)s?) (arrive|come|reach|be delivered|get delivered|deliver|ship)",
    r"\b(has|is|was) my (order|parcel|package|item) (been )?(shipped|dispatched|delivered|sent|on the way)\b",
    r"\b(haven'?t|have not|didn'?t|did not|never|not yet|still not|not) (got|get|gotten|received?|recieved)( my)? (order|parcel|package|item)",
    r"\bmy (order|parcel|package)s? (hasn'?t|has not|didn'?t|did not|is not|isn'?t|not) (come|arrived?|reached|been delivered|delivered|shipped)",
    r"\b(order|parcel|package|delivery) (kab|kahan|kidhar|kaha)\b|\bkab (aayega|ayega|aaega|milega|pahunchega|aaegi|aayegi)\b",
    r"\bmera order\b|\bmeri delivery\b|\border (enga|eppo|evlo naal)\b|\beppo varum\b",
    r"\bwhere('?s| is) mine\b|\bwhen (will|does) (mine|it) (come|arrive|reach|get here|be delivered)\b",
]
_RE = [re.compile(p, re.I) for p in WISMO_PATTERNS]

RECENT_DAYS = 30


def is_order_question(text: str) -> bool:
    return any(p.search(text or "") for p in _RE)


def _items(o: dict) -> str:
    n = o["quantity"]
    return f"{o['category']}, {n} item{'s' if n != 1 else ''}"


def _day(d: datetime | None, today) -> str:
    if not d:
        return "?"
    dd = d.astimezone(timezone.utc).date()
    if dd == today:
        return "today"
    if dd == today - timedelta(days=1):
        return "yesterday"
    if dd == today + timedelta(days=1):
        return "tomorrow"
    return commerce.fmt_date(d)


def _on(d: datetime | None, today) -> str:
    """'today' / 'yesterday' / 'on 6 Nov 2026' ('recently' when the store didn't record the date)"""
    if not d:
        return "recently"
    label = _day(d, today)
    return label if label in ("today", "yesterday", "tomorrow") else f"on {label}"


DELIVERY_NOTES = {   # carrier states finer than "shipped" (connected stores report these)
    "out_for_delivery": " It's out for delivery today.",
    "attempted_delivery": " The courier tried to deliver it but couldn't, so they'll try again or contact you.",
    "ready_for_pickup": " It's ready for you to pick up.",
    "failure": " The courier reported a problem delivering it.",
}


def describe(o: dict, now: datetime | None = None) -> tuple[str, list[str], str]:
    """Reply text, suggestion chips and a state label for one order. Works with demo orders and with
    store orders, which may lack a planned dispatch date, a courier, a tracking number or an ETA."""
    now = now or datetime.now(timezone.utc)
    today = now.date()
    no, items = o["order_number"], _items(o)
    status = o["status"]
    if status == "Pending":
        due = o.get("shipping_date")
        if not due:
            return (f"Order {no} ({items}), placed {_on(o['order_date'], today)}, is being prepared. "
                    "You'll get the tracking details as soon as it ships.", [], "pending")
        if due.date() >= today:
            return (f"Order {no} ({items}), placed {_on(o['order_date'], today)}, is being prepared. "
                    f"It's due to be dispatched by {_day(due, today)}, and you'll get the tracking details "
                    "as soon as it ships.", [], "pending")
        return (f"Order {no} ({items}) was due to be dispatched by {_day(due, today)}, but it hasn't shipped yet. "
                "Sorry about the delay. I can connect you with our support team to check it for you.",
                ["Talk to support"], "pending_delayed")
    if status == "Shipped":
        exp = o.get("expected_delivery")
        part = "Part of order" if o.get("partially_shipped") else "Order"
        base = f"{part} {no} ({items}) was shipped {_on(o.get('shipping_date'), today)}"
        base += f" with {o['courier']}" if o.get("courier") else ""
        base += f", tracking number {o['tracking_number']}." if o.get("tracking_number") else "."
        link = f" You can track it here: {o['tracking_url']}" if o.get("tracking_url") else ""
        note = DELIVERY_NOTES.get(o.get("delivery_status") or "")
        if note:
            chips = ["Talk to support"] if o.get("delivery_status") == "failure" else []
            return base + note + link, chips, o["delivery_status"]
        if not exp:
            return base + link, [], "in_transit"
        if exp.date() >= today:
            return base + f" It's expected to arrive by {_day(exp, today)}." + link, [], "in_transit"
        return (base + f" It was expected by {_day(exp, today)}, so it's running late. Sorry about that. "
                "Our support team can check with the courier for you." + link, ["Talk to support"], "shipped_delayed")
    if status == "Delivered":
        by = f" by {o['courier']}" if o.get("courier") else ""
        when = _on(o["delivered_at"], today) if o.get("delivered_at") else ""
        return (f"Order {no} ({items}) was delivered{' ' + when if when else ''}{by}.",
                ["I didn't receive my order", "Return an item"], "delivered")
    if status == "Cancelled":
        when = f" {_on(o['cancelled_at'], today)}" if o.get("cancelled_at") else ""
        return (f"Order {no} ({items}) was cancelled{when}.", ["How long do refunds take?"], "cancelled")
    when = f" after delivery {_on(o['delivered_at'], today)}" if o.get("delivered_at") else ""
    return f"Order {no} ({items}) was returned{when}.", ["How long do refunds take?"], "returned"


def handle(workspace_id: str, user, question: str, now: datetime | None = None,
           conversation_id: str | None = None, run_id: str | None = None) -> dict | None:
    """Returns {"outcome", "reply", "suggestions", "flags", "tool"} or None to let the normal
    pipeline answer (not an order question, no order data, or customer not identified)."""
    ref = commerce.extract_order_ref(question)
    follow_up = None
    issue_kind = order_issues.detect_issue(question)
    if issue_kind and commerce.available():
        cust = commerce.find_customer(workspace_id, user)
        if cust:
            return plan_issue(workspace_id, cust, question, issue_kind, ref, conversation_id,
                              now or datetime.now(timezone.utc))
    if not ref and not is_order_question(question):
        # "no, I still didn't get it" / "I already called them" only make sense inside an order conversation
        missing_or_done = order_issues.reports_not_received(question) or order_issues.says_already_done(question)
        if not (missing_or_done or order_issues.is_follow_up(question)):
            return None
        if not commerce.available():
            return None
        follow_up = order_issues.last_order_context(workspace_id, conversation_id)
        if not follow_up:
            return None
        # a bare "still nothing?" only continues a delivery-problem conversation, not any order chat
        if not missing_or_done and follow_up.get("state") not in order_issues.ISSUE_STATES:
            return None
    if not commerce.available():
        return None
    now = now or datetime.now(timezone.utc)
    cust = commerce.find_customer(workspace_id, user)

    if not cust:
        if not ref:
            return None  # general policy answer ("track it in My Orders") from flows/articles
        return {"outcome": "clarify", "suggestions": ["Talk to support"], "flags": ["order_lookup_unverified"],
                "tool": {"name": "order_status", "matched": False},
                "reply": "To keep orders private, I can only look up orders on the account you're signed in "
                         "with. Please sign in and ask again, or I can connect you with our support team."}

    return answer_for_customer(workspace_id, cust, question, now, matched_by="keyword",
                               conversation_id=conversation_id, run_id=run_id)


def answer_for_customer(workspace_id: str, cust: dict, question: str, now: datetime | None = None,
                        matched_by: str = "keyword", conversation_id: str | None = None,
                        run_id: str | None = None) -> dict:
    """Answer an order question for an already-identified customer (intent already decided)."""
    now = now or datetime.now(timezone.utc)
    ref = commerce.extract_order_ref(question)
    tool = {"name": "order_status", "matched": True, "matched_by": matched_by}

    # Delivered but not received: guidance first, then a complaint (never just repeat "it was delivered")
    issue = _not_received(workspace_id, cust, question, ref, now, conversation_id, run_id)
    if issue:
        return {**issue, "tool": {**tool, "orders": [issue.pop("order_number")], "state": issue.pop("state")}}

    if ref:
        order = commerce.customer_order(workspace_id, cust["customer_ref"], ref)
        if order:
            text, chips, state = describe(order, now)
            return {"outcome": "answered", "reply": text, "suggestions": chips, "flags": ["order_lookup"],
                    "tool": {**tool, "orders": [order["order_number"]], "state": state}}
        recent = commerce.recent_orders(workspace_id, cust["customer_ref"], 3)
        lines = "".join(f"\n• {o['order_number']} ({_items(o)}), {o['status'].lower()}" for o in recent)
        return {"outcome": "clarify", "flags": ["order_lookup", "order_not_on_account"],
                "offer": _choose(recent),
                "suggestions": [f"Track {o['order_number']}" for o in recent],
                "tool": {**tool, "orders": [o["order_number"] for o in recent], "state": "not_found"},
                "reply": f"I couldn't find order {ref} on your account. Please check the number."
                         + (f" These are your most recent orders:{lines}" if recent else "")}

    recent = commerce.recent_orders(workspace_id, cust["customer_ref"], 3)
    if not recent:
        return {"outcome": "answered", "reply": "I can't see any orders on your account yet.", "suggestions": [],
                "flags": ["order_lookup"], "tool": {**tool, "orders": [], "state": "no_orders"}}
    newest = recent[0]
    others_recent = [o for o in recent[1:] if o["order_date"] >= now - timedelta(days=RECENT_DAYS)]
    if not others_recent:
        text, chips, state = describe(newest, now)
        return {"outcome": "answered", "reply": text, "suggestions": chips, "flags": ["order_lookup"],
                "tool": {**tool, "orders": [newest["order_number"]], "state": state}}
    lines = "".join(f"\n• {o['order_number']} ({_items(o)}), placed {_on(o['order_date'], now.date())}, "
                    f"{o['status'].lower()}" for o in recent)
    return {"outcome": "clarify", "flags": ["order_lookup"], "offer": _choose(recent),
            "suggestions": [f"Track {o['order_number']}" for o in recent],
            "tool": {**tool, "orders": [o["order_number"] for o in recent], "state": "choose"},
            "reply": f"You have a few recent orders. Which one would you like to check?{lines}"}


def _not_received(workspace_id: str, cust: dict, question: str, ref: str | None, now: datetime,
                  conversation_id: str | None, run_id: str | None) -> dict | None:
    says_missing = order_issues.reports_not_received(question)
    says_done = order_issues.says_already_done(question)
    follow_up = order_issues.is_follow_up(question)
    if not (says_missing or says_done or follow_up):
        return None
    prev = order_issues.last_order_context(workspace_id, conversation_id)
    number = ref or (prev or {}).get("order")
    order = commerce.customer_order(workspace_id, cust["customer_ref"], number) if number else None
    if not order and says_missing and not ref:
        newest = commerce.recent_orders(workspace_id, cust["customer_ref"], 1)
        order = newest[0] if newest else None
    if not order or order["status"] != "Delivered":
        return None  # not delivered yet: the normal status reply (in transit, delayed) answers it
    delivered_on = _on(order["delivered_at"], now.date())
    escalate = bool(prev) and prev.get("order") == order["order_number"] and prev.get("state") in order_issues.ISSUE_STATES
    if escalate:
        res = order_issues.raise_complaint(workspace_id, cust, order, question, conversation_id, run_id, delivered_on)
    elif says_missing:
        res = order_issues.guidance(workspace_id, order, delivered_on)
    else:
        return None
    return {**res, "order_number": order["order_number"]}


def _choose(orders: list[dict]) -> dict:
    """What the bot just offered: pick one of these orders (so 'the clothing one' can be understood)."""
    return {"type": "choose_order", "options": [{"order": o["order_number"], "category": o["category"],
                                                 "status": o["status"].lower()} for o in orders]}


def plan_issue(workspace_id: str, cust: dict, question: str, kind: str, ref: str | None,
               conversation_id: str | None, now: datetime) -> dict:
    """A problem with an order: which order it's about and the facts to open the reply with.
    The agent then adds the business's own process from its help articles, and a next step."""
    today = now.date()
    recent = commerce.recent_orders(workspace_id, cust["customer_ref"], 5)
    prev = order_issues.last_order_context(workspace_id, conversation_id) or {}
    order = None
    if ref:
        order = commerce.customer_order(workspace_id, cust["customer_ref"], ref)
    elif prev.get("order"):
        order = commerce.customer_order(workspace_id, cust["customer_ref"], prev["order"])
    if kind in ("damaged_item", "wrong_item", "missing_item", "return_request"):
        if not order or order["status"] != "Delivered":
            order = next((o for o in recent if o["status"] == "Delivered"), order)
    elif kind in ("cancel_request", "address_change"):
        if not order:
            order = next((o for o in recent if o["status"] in ("Pending", "Shipped")), recent[0] if recent else None)
    elif kind == "payment_issue" and not order:
        order = recent[0] if recent and recent[0]["order_date"] >= now - timedelta(days=3) else None

    if not order:
        preface = ("I can't see a new order on your account from the last few days, so the payment may not have "
                   "gone through." if kind == "payment_issue" else "I couldn't find a matching order on your account.")
    else:
        no, items, st = order["order_number"], _items(order), order["status"]
        if kind in ("damaged_item", "wrong_item", "missing_item"):
            preface = (f"I'm sorry about this. This is about order {no} ({items}), delivered {_on(order['delivered_at'], today)}."
                       if st == "Delivered" else f"I'm sorry about this. Order {no} ({items}) is marked {st.lower()}.")
        elif kind == "return_request":
            preface = (f"Order {no} ({items}) was delivered {_on(order['delivered_at'], today)}." if st == "Delivered"
                       else f"Order {no} ({items}) is {st.lower()}, so it can't be returned yet.")
        elif kind in ("cancel_request", "address_change"):
            preface = {"Pending": f"Order {no} ({items}) hasn't been dispatched yet.",
                       "Shipped": f"Order {no} ({items}) has already been shipped ({_on(order['shipping_date'], today)}).",
                       "Delivered": f"Order {no} ({items}) has already been delivered.",
                       "Returned": f"Order {no} ({items}) has already been returned.",
                       "Cancelled": f"Order {no} ({items}) has already been cancelled."}.get(st, f"Order {no} ({items}) is {st.lower()}.")
        else:
            preface = f"I can see order {no} ({items}), placed {_on(order['order_date'], today)}."
    line, chips, offer = order_issues.offer_line(kind)
    if order:
        offer = {**offer, "order": order["order_number"]}
    return {"issue": {"kind": kind, "preface": preface, "query": order_issues.ISSUE_QUERY[kind],
                      "label": order_issues.ISSUE_LABEL[kind], "offer_line": line, "suggestions": chips, "offer": offer},
            "tool": {"name": "order_issue", "matched": True, "matched_by": "keyword", "issue": kind,
                     "orders": [order["order_number"]] if order else [], "state": f"issue_{kind}"},
            "flags": ["order_issue", f"issue:{kind}"]}
