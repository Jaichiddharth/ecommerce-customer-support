"""Shipping address: "may I know the shipping address?" / "I want to change my delivery address".

Customers (especially in India, where landmark, flat number and PIN code decide whether a parcel arrives) check the
address on their order and correct it. Rules:

  * Only for the customer identified from the session (WhatsApp sender, signed-in visitor), and only for their own
    orders: the order is picked from THEIR orders (commerce.customer_order is scoped to the customer). A number that
    isn't theirs gets "not found on your account", never a hint that it exists. Anonymous visitors are asked to sign
    in. Asking about someone else's address is refused earlier (guardrails.asks_other_customers_data).
  * The address is put in the reply by code. It is never sent to the AI model: not in a prompt, and it is blanked
    out of the chat history the model sees on later turns (redact) and of the AI logs (log_reply).
  * The delivery phone shows only its last 4 digits.
  * Changing the address is never done by the agent: it explains how (from the business's help articles) and gives
    the business's change link, or the placeholder "Sample link" until one is set (Knowledge & actions).
"""
import re
from datetime import datetime, timezone

from . import commerce, dialogue, order_issues, tools

SAMPLE_LINK = "Sample link"
SHOWN = "[shipping address shown to the customer]"
# The reply's address block starts with one of these and ends at the next blank line (see redact)
_BLOCK = re.compile(r"((?:is being|was) delivered to:)\n.*?(?=\n\n|\Z)", re.S)

VIEW_PATTERNS = [
    r"\b(may i|can i|could i|let me|want to|wanna|like to|need to) (know|see|check|confirm|verify|get)\b.{0,25}\baddress\b",
    r"\b(what|which|whats|what's)\b.{0,20}\b(my|shipping|delivery|order'?s?)\b.{0,15}\baddress\b",
    r"\b(what|which) address\b.{0,25}\b(my|the) (order|parcel|package|delivery)\b",
    r"\b(show|tell|give|send|share|confirm|check|verify|read)( me)?\b.{0,20}\b(shipping|delivery|my|the|order'?s?)\b.{0,12}\baddress\b",
    r"\b(shipping|delivery) address\b.{0,25}\b(for|of|on|in) (my|the|this|that) order\b",
    r"\baddress (on|of|for|in) ((my|the|this|that) )?(order|parcel|package|delivery)\b",
    r"\bwhere (is|will|are) (my|the) (order|parcel|package|delivery)\b.{0,15}\b(going|being (sent|delivered|shipped)|delivered|shipped|sent) to\b",
    r"\bis (my|the) (shipping |delivery )?address (correct|right|complete|ok)\b",
    r"^\s*address for\b",
    r"\baddress (kya|kaunsa|konsa|batao|bata do|dikhao|dikha do|check)\b|\bkis address\b|\baddress enna\b|\bpata (kya|batao)\b",
]
CHANGE_PATTERNS = [
    r"\b(change|update|edit|correct|modify|fix|replace|add)\b.{0,30}\b(address|landmark|pin ?code|pincode|flat (no|number)|house (no|number))\b",
    r"\b(wrong|incorrect|incomplete|old|missing) (shipping |delivery )?(address|pin ?code|pincode|landmark)\b",
    r"\b(address|pin ?code|pincode)\b.{0,12}\b(is|was) (wrong|incorrect|incomplete|old|missing)\b",
    r"\b(deliver|send|ship) (it )?to (a )?(different|another|new|other) address\b",
    r"\baddress (badalna|badalni|badal do|change karna|change karo|update karo|galat hai|maathanum|change pannanum)\b",
]
_OTHER_ADDRESS = re.compile(r"\b(e-?mail|mail|ip|web|website|store|shop|showroom|office|company|warehouse|your|billing)"
                            r"\s+(address|addr)\b|\baddress of (your|the) (store|shop|office|company)\b", re.I)
_VIEW = [re.compile(p, re.I) for p in VIEW_PATTERNS]
_CHANGE = [re.compile(p, re.I) for p in CHANGE_PATTERNS]
OPEN = ("Pending", "Shipped")


def intent(text: str) -> str | None:
    """'change', 'view' or None. A change request wins: "my address is wrong, can I see it?" wants a fix.
    Other addresses ("your store address", "my email address") are not the shipping address."""
    t = text or ""
    if _OTHER_ADDRESS.search(t):
        return None
    if any(p.search(t) for p in _CHANGE):
        return "change"
    if any(p.search(t) for p in _VIEW):
        return "view"
    return None


_CONFIRM = re.compile(r"\b(correct|right|perfect|looks good|that'?s it|sahi|theek|seri)\b", re.I)
_NEGATED = re.compile(r"\b(not|isn'?t|wrong|nahi|illa)\b", re.I)


def confirms(text: str) -> bool:
    """ "Yes", "Yes, it's correct", "looks good", "sahi hai" (not "not correct")."""
    return dialogue.is_yes(text) or (bool(_CONFIRM.search(text or "")) and not _NEGATED.search(text or ""))


def answers_check(text: str) -> bool:
    """An answer to "Is everything correct?" after an address was shown: yes, no, or a change request."""
    return confirms(text) or dialogue.is_no(text) or bool(_NEGATED.search(text or "")) or intent(text) is not None


def lines(address) -> list[str]:
    """Display lines of a stored address (dict from the store, or a one-line demo string)."""
    if isinstance(address, str):
        return [address.strip()] if address.strip() else []
    a = address or {}
    out = [a.get("name"), a.get("line1"), a.get("line2")]
    place = ", ".join(x for x in (a.get("city"), a.get("province")) if x)
    if a.get("zip"):
        place = f"{place} {a['zip']}".strip()
    out += [place or None, a.get("country")]
    if a.get("phone_last4"):
        out.append(f"Phone ending {a['phone_last4']}")
    return [str(x).strip() for x in out if x and str(x).strip()]


def redact(text: str) -> str:
    """The text with any address block from an earlier reply replaced, for the model's chat history and logs."""
    return _BLOCK.sub(lambda m: f"{m.group(1)}\n{SHOWN}", text or "")


def _items(o: dict) -> str:
    return o.get("category") or o.get("items") or "your items"


def _choose(orders: list[dict]) -> dict:
    return {"type": "choose_order", "purpose": "address",
            "options": [{"order": o["order_number"], "category": _items(o), "status": o["status"].lower()} for o in orders]}


def _pick(workspace_id: str, cust: dict, question: str, conversation_id: str | None, offered: str | None) -> dict:
    """{"order": o} | {"reply": ...} (not on the account / several open orders / none)."""
    ref = commerce.extract_order_ref(question) or offered
    if ref:
        o = commerce.customer_order(workspace_id, cust["customer_ref"], ref)
        if o:
            return {"order": o}
        return {"reply": {"outcome": "clarify", "flags": ["address_lookup", "order_not_on_account"],
                          "suggestions": [], "tool": {"name": "shipping_address", "orders": [], "state": "not_found"},
                          "reply": f"I couldn't find order {ref} on your account. Please check the number."}}
    last = order_issues.last_order_context(workspace_id, conversation_id)
    if last:
        o = commerce.customer_order(workspace_id, cust["customer_ref"], last["order"])
        if o:
            return {"order": o}
    recent = commerce.recent_orders(workspace_id, cust["customer_ref"], 5)
    if not recent:
        return {"reply": {"outcome": "answered", "flags": ["address_lookup"], "suggestions": [],
                          "tool": {"name": "shipping_address", "orders": [], "state": "no_orders"},
                          "reply": "I can't see any orders on your account yet."}}
    open_ = [o for o in recent if o["status"] in OPEN]
    if len(open_) > 1:
        bullets = "".join(f"\n• {o['order_number']} ({_items(o)}), {o['status'].lower()}" for o in open_)
        return {"reply": {"outcome": "clarify", "flags": ["address_lookup"], "offer": _choose(open_),
                          "suggestions": [f"Address for {o['order_number']}" for o in open_][:3],
                          "tool": {"name": "shipping_address", "orders": [o["order_number"] for o in open_], "state": "choose"},
                          "reply": f"Which order would you like to check?{bullets}"}}
    return {"order": open_[0] if open_ else recent[0]}


def view(workspace_id: str, cust: dict, o: dict) -> dict:
    no, status = o["order_number"], o["status"]
    tool = {"name": "shipping_address", "orders": [no]}
    if status == "Cancelled":
        return {"outcome": "answered", "flags": ["address_lookup"], "suggestions": [],
                "tool": {**tool, "state": "cancelled"}, "reply": f"Order {no} ({_items(o)}) was cancelled, so it won't be delivered."}
    shown = lines(commerce.shipping_address(workspace_id, cust["customer_ref"], o))
    if not shown:
        return {"outcome": "answered", "flags": ["address_lookup", "address_unavailable"], "offer": {"type": "support"},
                "suggestions": ["Talk to support"], "tool": {**tool, "state": "unavailable"},
                "reply": f"I can't see the delivery address for order {no} here. You'll find it in your order "
                         "confirmation message or email. If something needs correcting, I can connect you with our team."}
    verb = "was delivered to:" if status == "Delivered" else "is being delivered to:"
    head = f"Order {no} ({_items(o)}) {verb}"
    if status == "Delivered":
        tail, chips, offer = "", [], None
    else:
        tail = "\n\nPlease check the house or flat number, street, landmark and PIN code. Is everything correct?"
        chips, offer = ["Yes, it's correct", "Change address"], {"type": "address", "order": no}
    reply = head + "\n" + "\n".join(shown) + tail
    return {"outcome": "answered", "flags": ["address_lookup", "address_shown"], "suggestions": chips, "offer": offer,
            "tool": {**tool, "state": "shown"}, "reply": reply, "log_reply": redact(reply)}


def change(o: dict, change_url: str | None) -> dict:
    """A change request: a fixed reply when it can't be changed any more, else the plan for the agent to explain
    the business's own process (help articles) with the change link underneath."""
    no, status = o["order_number"], o["status"]
    tool = {"name": "shipping_address", "orders": [no]}
    if status == "Delivered":
        return {"outcome": "answered", "flags": ["address_change"], "offer": {"type": "support"},
                "suggestions": ["Talk to support"], "tool": {**tool, "state": "delivered"},
                "reply": f"Order {no} has already been delivered, so its address can't be changed now. If there's a "
                         "problem with the delivery, I can connect you with our team."}
    if status not in OPEN:
        return {"outcome": "answered", "flags": ["address_change"], "suggestions": [], "tool": {**tool, "state": status.lower()},
                "reply": f"Order {no} was {status.lower()}, so there's no delivery address to update."}
    link = f"\n\nChange your address here: {change_url or SAMPLE_LINK}"
    preface = (f"Here's how to change the delivery address for order {no}:" if status == "Pending" else
               f"Order {no} has already been shipped, so it may be too late to change the address. Here's what you can do:")
    return {"plan": {
        "issue": {"kind": "address_change", "label": "that they want to change the delivery address of their order",
                  "preface": preface, "offer_line": link, "suggestions": ["Talk to support"], "offer": {"type": "support"},
                  "query": "how to change or update the delivery address of an order",
                  "fallback": "You can update it using the link below, or I can connect you with our team."},
        "tool": {**tool, "state": "change_requested"},
        "flags": ["address_change"],
    }}


def handle(workspace_id: str, user, question: str, *, conversation_id: str | None, prev_offer: dict,
           change_url: str | None, now: datetime | None = None) -> dict | None:
    """None when this isn't about the shipping address. Else one of:
      {"sign_in": True}                      not identified: the agent asks them to sign in
      {"confirmed": order_number}            "yes, it's correct" after the address was shown
      {"plan": {...}}                        a change request to explain from the help articles
      {"outcome", "reply", ...}              a reply built here (wismo-style dict, maybe with "log_reply")
    """
    offered = prev_offer.get("order") if prev_offer.get("type") == "address" else None
    kind = intent(question)
    if offered and kind is None:
        if confirms(question):
            return {"confirmed": offered}
        if dialogue.is_no(question) or _NEGATED.search(question):
            kind = "change"
    if kind is None:
        return None
    if not commerce.available():
        return None                     # no order data at all: general policy answer from the articles
    cust = commerce.find_customer(workspace_id, user)
    if not cust and kind == "change":
        return None                     # how to change an address is general help: the articles answer it
    try:
        tools.authorize("show_shipping_address", identified=bool(cust))
    except tools.ToolDenied:
        return {"sign_in": True}
    picked = _pick(workspace_id, cust, question, conversation_id, offered)
    if "reply" in picked:
        return picked["reply"]
    o = picked["order"]
    return view(workspace_id, cust, o) if kind == "view" else change(o, change_url)
