"""Delivered-but-not-received handling, complaints, and refund requests going to a person."""
import pytest

from app import guardrails as g
from app import order_issues as oi


@pytest.mark.parametrize("text,expected", [
    ("I didn't receive my order", True),
    ("no, i didnt still get it", True),
    ("I never got the parcel", True),
    ("my order has not been delivered", True),
    ("parcel nahi mila", True),
    ("where is my order", False),
    ("I received it, thanks", False),
])
def test_reports_not_received(text, expected):
    assert oi.reports_not_received(text) is expected


@pytest.mark.parametrize("text,expected", [
    ("I already checked with my neighbours", True),
    ("I called Blue Dart, no luck", True),
    ("I've already done this", True),
    ("maine pooch liya", True),
    ("what is the tracking number", False),
])
def test_says_already_done(text, expected):
    assert oi.says_already_done(text) is expected


@pytest.mark.parametrize("text,expected", [
    ("I want my money back", True),
    ("I want a refund", True),
    ("give me my refund", True),
    ("refund my order please", True),
    ("mujhe paisa wapas chahiye", True),
    ("How long do refunds take?", False),          # information: answered from help articles
    ("how do I get a refund?", False),
    ("when will my refund come", False),
    ("What is your refund policy?", False),
])
def test_refund_request(text, expected):
    assert g.is_refund_request(text) is expected


@pytest.mark.parametrize("text,kind", [
    ("my order arrived damaged", "damaged_item"),
    ("the box was torn and the bottle is leaking", "damaged_item"),
    ("I got the wrong size in my order", "wrong_item"),
    ("one item is missing from my order", "missing_item"),
    ("I want to cancel my order", "cancel_request"),
    ("can I change the delivery address for my order?", "address_change"),
    ("I want to return my order", "return_request"),
    ("money was deducted but I can't see my order", "payment_issue"),
    ("I was charged twice", "payment_issue"),
    ("where is my order", None),
    ("How long do refunds take?", None),
])
def test_detect_issue(text, kind):
    assert oi.detect_issue(text) == kind


def test_dialogue_helpers():
    from app import dialogue as d
    opts = [{"order": "UX1", "category": "Electronics", "status": "delivered"},
            {"order": "UX2", "category": "Clothing", "status": "shipped"},
            {"order": "UX3", "category": "Clothing", "status": "shipped"}]
    assert d.pick_option("the electronics one", opts) == "UX1"
    assert d.pick_option("the clothing one", opts) is None            # two clothing orders: ambiguous
    assert [o["order"] for o in d.narrow_options("the clothing one", opts)] == ["UX2", "UX3"]
    assert d.pick_option("the second one", opts) == "UX2"
    assert d.is_yes("yes please") and not d.is_yes("yes, where is it?") and d.is_no("no thanks")
    assert d.misunderstood("that's not what I asked") and d.urgent("this is taking forever")
    assert d.repeats("Order UX1 was delivered.", ["Order UX1 was delivered."])
    assert not d.repeats("Refunds take 5-7 days.", ["Order UX1 was delivered."])
