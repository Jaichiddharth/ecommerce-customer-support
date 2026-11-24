"""When an order shows as delivered but the customer says it never arrived.

  1st report  -> apologise, DON'T repeat "it was delivered"; give next steps: check with family /
                 neighbours / security, and contact the courier with the tracking number
                 (contact details from commerce.couriers, filled in by the business; never invented).
  2nd report, or "I already did that"
              -> raise a complaint (ai.complaints, reference CMP-000123) for the business's team, and
                 tell the customer the reference. A complaint already open for that order is reused.
  Asking for money back is handled earlier in the pipeline: refunds need a person (handover).

The conversation's earlier turns are read from ai.agent_runs (same workspace + conversation id), so
the customer's follow-up ("still nothing", "I already called them") continues where it left off.
"""
import re
from datetime import datetime, timezone

from psycopg.types.json import Jsonb  # noqa: F401  (psycopg adapters loaded for json columns)

from . import commerce
from .db import conn

NOT_RECEIVED_RE = re.compile(
    r"\b(didn'?t|did not|didnt|haven'?t|have not|havent|never|not|still not|nahi|nhi|nahin)\b[\w\s,']{0,24}?"
    r"\b(receiv\w*|reciev\w*|get|got|gotten|arriv\w*|come|came|deliver\w*|mila|aaya|aayi|pahuncha)\b"
    r"|\bnot (been )?(received|delivered)\b|\b(missing|lost) (order|parcel|package)\b", re.I)
ALREADY_DONE_RE = re.compile(
    r"\b(already|checked|contacted|called|spoke|asked|tried|no luck|nobody|no one|done (that|it|this)|"
    r"did (that|it|this|all|both)|kar liya|kar li|pooch liya|baat kar li)\b", re.I)
# Short follow-ups that only make sense right after the guidance or a complaint
FOLLOW_UP_RE = re.compile(
    r"\bstill (nothing|no|not|waiting)\b|\bnothing (yet|happened|so far)\b|\b(any|no) update\b|\bwhat (now|next)\b|"
    r"\bnow what\b|\bwhat should i do\b|\bab kya\b|\bkuch nahi\b", re.I)
CATEGORY = "order_not_received"
ISSUE_STATES = ("not_received_guidance", "complaint_created", "complaint_exists")


def reports_not_received(text: str) -> bool:
    return bool(NOT_RECEIVED_RE.search(text or ""))


def says_already_done(text: str) -> bool:
    return bool(ALREADY_DONE_RE.search(text or ""))


def is_follow_up(text: str) -> bool:
    return bool(FOLLOW_UP_RE.search(text or ""))


def last_order_context(workspace_id: str, conversation_id: str | None) -> dict | None:
    """The most recent order reply in this conversation (last 24 h): {'order': 'UX…', 'state': '…'}."""
    if not conversation_id:
        return None
    with conn() as c:
        row = c.execute(
            "SELECT trace->'tool'->'orders'->>0 AS order_no, trace->'tool'->>'state' AS state FROM ai.agent_runs "
            "WHERE workspace_id=%s AND conversation_id=%s AND route='tool' AND created_at > now() - interval '24 hours' "
            "ORDER BY created_at DESC LIMIT 1", (workspace_id, conversation_id)).fetchone()
    return {"order": row["order_no"], "state": row["state"]} if row and row["order_no"] else None


def open_complaint(workspace_id: str, order_number: str) -> dict | None:
    with conn() as c:
        return c.execute("SELECT reference, status FROM ai.complaints WHERE workspace_id=%s AND order_number=%s "
                         "AND category=%s AND status <> 'resolved' ORDER BY id DESC LIMIT 1",
                         (workspace_id, order_number, CATEGORY)).fetchone()


def _courier_line(workspace_id: str, o: dict) -> str:
    c = commerce.courier_contact(workspace_id, o.get("courier"))
    name = c.get("name") or "the courier"
    ways = [w for w in (c.get("phone"), c.get("email"), c.get("website")) if w]
    how = f" ({' / '.join(ways)})" if ways else ""
    tn = f" with tracking number {o['tracking_number']}" if o.get("tracking_number") else ""
    return f"Contact {name}{how}{tn}; they can tell you where and to whom it was handed over."


def guidance(workspace_id: str, o: dict, delivered_on: str) -> dict:
    no = o["order_number"]
    reply = (f"I'm sorry your order hasn't reached you. Order {no} is marked as delivered {delivered_on}"
             f"{' by ' + o['courier'] if o.get('courier') else ''}. Please try these first:\n"
             "• Check with family, neighbours, and your building's security or reception.\n"
             f"• {_courier_line(workspace_id, o)}\n"
             "If you've already done this and still don't have it, tell me and I'll raise a complaint with our team.")
    return {"outcome": "answered", "reply": reply, "suggestions": ["I've already done this", "Talk to support"],
            "flags": ["order_lookup", "order_not_received"], "state": "not_received_guidance",
            "offer": {"type": "complaint", "order": no, "category": CATEGORY}}


def raise_complaint(workspace_id: str, cust: dict, o: dict, question: str, conversation_id: str | None,
                    run_id: str | None, delivered_on: str) -> dict:
    no = o["order_number"]
    existing = open_complaint(workspace_id, no)
    if existing:
        ref = existing["reference"]
        return {"outcome": "answered", "suggestions": ["Talk to support"],
                "flags": ["order_lookup", "order_complaint", "complaint_exists"], "state": "complaint_exists",
                "action": {"type": "complaint", "reference": ref, "order_number": no, "category": CATEGORY,
                           "status": existing["status"], "created": False},
                "reply": f"A complaint for order {no} is already open ({ref}). Our team is looking into it and "
                         "will contact you. You don't need to do anything else for now."}
    summary = (f"Customer {cust['customer_ref']} reports order {no} ({o['category']}, {o['quantity']} item"
               f"{'s' if o['quantity'] != 1 else ''}) as not received. Marked delivered {delivered_on}"
               f"{' by ' + o['courier'] if o.get('courier') else ''}"
               f"{', tracking ' + o['tracking_number'] if o.get('tracking_number') else ''}. "
               f"The customer was advised to check with neighbours and the courier, and says: \"{question[:300]}\"")
    with conn() as c:
        row = c.execute("INSERT INTO ai.complaints (workspace_id, customer_ref, order_number, category, summary, "
                        "conversation_id, run_id) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING reference",
                        (workspace_id, cust["customer_ref"], no, CATEGORY, summary, conversation_id, run_id)).fetchone()
    ref = row["reference"]
    courier = o.get("courier") or "the courier"
    return {"outcome": "answered", "suggestions": [], "flags": ["order_lookup", "order_complaint", "complaint_created"],
            "state": "complaint_created",
            "action": {"type": "complaint", "reference": ref, "order_number": no, "category": CATEGORY,
                       "status": "open", "created": True, "summary": summary},
            "reply": f"I'm sorry about this. I've raised complaint {ref} for order {no} with our team. They'll "
                     f"investigate with {courier} and contact you. Please keep the reference {ref} handy."}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- complaints for any category

CATEGORY_WORDS = {
    "order_not_received": "an order marked delivered but not received", "damaged_item": "a damaged or defective item",
    "wrong_item": "a wrong item, size or colour", "missing_item": "an item missing from the order",
    "order_delayed": "a delayed order", "payment_issue": "a payment problem", "other": "a problem with an order",
}


def create_complaint(workspace_id: str, customer_ref: str | None, order_number: str | None, category: str,
                     summary: str, conversation_id: str | None, run_id: str | None) -> tuple[str, bool, str]:
    """(reference, created, status). An open complaint for the same order and category is reused;
    without an order number, the same customer's open complaint of that category from the last day."""
    with conn() as c:
        if order_number:
            row = c.execute("SELECT reference, status FROM ai.complaints WHERE workspace_id=%s AND order_number=%s "
                            "AND category=%s AND status <> 'resolved' ORDER BY id DESC LIMIT 1",
                            (workspace_id, order_number, category)).fetchone()
        else:
            row = c.execute("SELECT reference, status FROM ai.complaints WHERE workspace_id=%s AND customer_ref "
                            "IS NOT DISTINCT FROM %s AND order_number IS NULL AND category=%s AND status <> 'resolved' "
                            "AND created_at > now() - interval '1 day' ORDER BY id DESC LIMIT 1",
                            (workspace_id, customer_ref, category)).fetchone()
        if row:
            return row["reference"], False, row["status"]
        row = c.execute("INSERT INTO ai.complaints (workspace_id, customer_ref, order_number, category, summary, "
                        "conversation_id, run_id) VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING reference",
                        (workspace_id, customer_ref, order_number, category, summary, conversation_id, run_id)).fetchone()
    return row["reference"], True, "open"


def complaint_reply(workspace_id: str, customer_ref: str | None, order_number: str | None, category: str,
                    customer_words: str, conversation_id: str | None, run_id: str | None,
                    context: str = "") -> dict:
    about = f"order {order_number}" if order_number else "your account"
    summary = (f"Customer {customer_ref or 'unknown'} reports {CATEGORY_WORDS.get(category, category)}"
               f"{' for order ' + order_number if order_number else ''}. {context} Customer says: "
               f"\"{customer_words[:300]}\"").replace("  ", " ")
    ref, created, status = create_complaint(workspace_id, customer_ref, order_number, category, summary,
                                            conversation_id, run_id)
    if created:
        reply = (f"I'm sorry about this. I've raised complaint {ref} for {about} with our team. "
                 f"They'll look into it and contact you. Please keep the reference {ref} handy.")
    else:
        reply = (f"A complaint for {about} is already open ({ref}). Our team is looking into it and will "
                 "contact you. You don't need to do anything else for now.")
    return {"outcome": "answered", "reply": reply, "suggestions": [] if created else ["Talk to support"],
            "flags": ["order_complaint", "complaint_created" if created else "complaint_exists"],
            "action": {"type": "complaint", "reference": ref, "order_number": order_number, "category": category,
                       "status": status, "created": created, **({"summary": summary} if created else {})},
            "offer": {"type": "support"} if not created else None}


# ---------------------------------------------------------------- order problems (Phase 2)

ISSUE_PATTERNS = [   # checked in this order
    ("payment_issue", r"\b(money|amount|payment|paisa|paise|rs|rupees)\b.{0,20}\b(deducted|debited|charged|cut|taken|gone)\b|"
                      r"\b(charged|debited|deducted|paid) (twice|two times|double)\b|\bdouble (charge|charged|payment)\b|"
                      r"\bpaid but\b|\bpayment (failed|went through) but\b"),
    ("damaged_item", r"\b(damaged|broken|torn|tear|ripped|defective|faulty|stain(ed|s)?|scratch(ed|es)?|crack(ed|s)?|"
                     r"not working|doesn'?t work|leak(ing|ed|s)?|spoilt|spoiled)\b"),
    ("wrong_item", r"\bwrong (item|size|colou?r|product|thing|one|order|shade)\b|\b(different|another) (item|product|size|"
                   r"colou?r)\b|\bnot what i ordered\b|\bsent me the wrong\b"),
    ("missing_item", r"\b(item|items|product|products|one|something|piece|pieces|part|parts|thing)s? (is |are |was |were )?missing\b|"
                     r"\bmissing (item|product|piece|part)s?\b|\bonly (got|received) (one|some|part|half)\b|"
                     r"\bincomplete (order|package|delivery)\b"),
    ("cancel_request", r"\bcancel\w*\b"),
    ("address_change", r"\b(change|update|edit|correct|modify) (my |the )?(delivery |shipping )?address\b|\bwrong address\b|"
                       r"\bdeliver (it |this )?to (a |another |my )?(different|new|other) address\b"),
    ("return_request", r"\b(want|need|would like|like|wish|planning|plan) to (return|exchange|send back|send it back)\b|"
                       r"\b(return|exchange|send back) (my|this|the|it|these|them)\b|\bhow (do|can) i (return|exchange)\b"),
]
_ISSUES = [(k, re.compile(p, re.I)) for k, p in ISSUE_PATTERNS]

ISSUE_QUERY = {
    "payment_issue": "payment failed but money was deducted charged twice reversed",
    "damaged_item": "damaged defective or wrong items report an issue photos",
    "wrong_item": "wrong item size colour received report exchange",
    "missing_item": "missing items from package report",
    "cancel_request": "cancelling an order before dispatch",
    "address_change": "changing your delivery address before dispatch",
    "return_request": "return window how to start a return condition of returned items",
}
ISSUE_LABEL = {
    "payment_issue": "a payment problem (money deducted or charged twice)", "damaged_item": "a damaged or defective item",
    "wrong_item": "a wrong item, size or colour", "missing_item": "an item missing from the order",
    "cancel_request": "a request to cancel an order", "address_change": "a request to change the delivery address",
    "return_request": "a request to return or exchange an order",
}
COMPLAINT_ISSUES = ("payment_issue", "damaged_item", "wrong_item", "missing_item")


def detect_issue(text: str) -> str | None:
    for kind, pat in _ISSUES:
        if pat.search(text or ""):
            return kind
    return None


def offer_line(kind: str) -> tuple[str, list[str], dict]:
    if kind in COMPLAINT_ISSUES:
        return ("If you'd like, I can also raise a complaint for our team now.",
                ["Raise a complaint", "Talk to support"], {"type": "complaint", "category": kind})
    return ("I can't change orders myself. If you need help with this, I can connect you with our team.",
            ["Talk to support"], {"type": "support"})
