"""Layer 2 of order-intent detection: similarity of meaning, not keywords.

The question's embedding is already computed for search, so this costs nothing per message. It is
compared with example ORDER questions ("about my specific order") and example POLICY questions
("about delivery in general"). A question counts as an order question only if it is close to an
order example AND closer to the order examples than to the policy examples. That margin is what
stops "How long does delivery take to Chennai?" from being treated as "where is my order?".

The example vectors are embedded once (well under 1 cent), stored in ai.intent_vectors and loaded
when the service starts, so no customer waits for them.
"""
import logging

from .config import get_settings

log = logging.getLogger("unocx.intent")

ORDER_EXAMPLES = [
    "where is my order", "when will my order arrive", "how long until my order is delivered",
    "how many days until my package arrives", "is my parcel on its way", "has my order been shipped yet",
    "I'm still waiting for my delivery", "any update on my shipment", "when can I expect my order",
    "my order hasn't arrived yet", "can you check the status of my order", "track my package",
    "did you dispatch my order", "what's the delivery date for my order", "is my order out for delivery",
    "how far away is my parcel", "my package is taking too long", "has the courier picked up my parcel",
    "give me an ETA for my order", "when should I expect what I bought", "what's happening with my purchase",
    "it's been days and my order still hasn't come", "is my delivery coming today",
    "mera order kab aayega", "mera parcel kahan hai", "order kab tak aa jayega", "meri delivery kab hogi",
    "मेरा ऑर्डर कब आएगा", "मेरा पार्सल कहाँ है", "என் ஆர்டர் எப்போது வரும்", "என் பார்சல் எங்கே",
    "en order eppo varum", "en parcel enga irukku",
]

POLICY_EXAMPLES = [
    "how long does delivery take", "how many days does shipping take to Chennai",
    "what are the delivery timelines for metro cities", "how much is the shipping charge",
    "do you ship internationally", "do you deliver on Sundays", "do you offer same-day or express delivery",
    "can I change my delivery address after dispatch", "what happens if I'm not home when the courier comes",
    "which courier partners do you use", "what is your return policy", "how long do refunds take",
    "how do I cancel an order", "what payment methods do you accept", "is cash on delivery available",
    "how do I reset my password", "do you deliver to my pincode", "what does out for delivery mean",
    "how do I track an order", "what should I do if my order arrives damaged",
]

def _vectors():
    from . import examples
    return examples.vectors("order", ORDER_EXAMPLES), examples.vectors("policy", POLICY_EXAMPLES)


def warm() -> int:
    """Load (or create) the example vectors now, at startup, instead of on a customer's question."""
    from . import examples
    examples.reset()
    pos, neg = _vectors()
    return len(pos) + len(neg)


def _dot(a, b) -> float:
    return sum(x * y for x, y in zip(a, b))


def order_scores(qvec: list[float]) -> tuple[float, float]:
    """(closest order example, closest policy example), as cosine similarity."""
    pos, neg = _vectors()
    return max(_dot(qvec, v) for v in pos), max(_dot(qvec, v) for v in neg)


def classify(order_sim: float, policy_sim: float) -> str:
    """'order' (look it up), 'maybe' (let the AI decide, layer 3) or 'no'."""
    s = get_settings()
    t, maybe = s.order_intent_thresholds
    margin = s.order_intent_margin
    if order_sim >= t and order_sim - policy_sim >= margin:
        return "order"
    if order_sim >= maybe and order_sim - policy_sim >= -margin:
        return "maybe"
    return "no"
