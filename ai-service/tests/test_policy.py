"""Policy-driven guardrails and test-set grading (pure functions, no database)."""
import pytest

from app import guardrails as g
from app.admin import grade
from app.models import AgentPolicy, ChatRequest


@pytest.mark.parametrize("text,expected", [
    ("Can I change the size to L?", True),
    ("I want to exchange this kurta", True),
    ("please replace my order", True),
    ("size exchange karna hai", True),
    ("What is your exchange policy?", False),
    ("How long does an exchange take?", False),
    ("Is exchange free?", False),
    ("Can you change my delivery address?", False),
])
def test_exchange_request(text, expected):
    assert g.is_exchange_request(text) is expected


@pytest.mark.parametrize("text,low,medium,high", [
    ("where is my order", False, False, False),
    ("this is the worst service ever", False, True, True),
    ("I'm really disappointed", False, False, True),
    ("WHERE IS MY PARCEL ALREADY", False, False, True),
    ("you bastard", True, True, True),
])
def test_angry_sensitivity(text, low, medium, high):
    assert [g.is_angry(text, s) for s in ("low", "medium", "high")] == [low, medium, high]


def test_asked_for_human_scope():
    assert g.asked_for_human("insaan se baat karni hai")
    assert not g.asked_for_human("insaan se baat karni hai", english_only=True)
    assert g.asked_for_human("I want to talk to a person", english_only=True)


def test_greeting():
    assert g.is_greeting("Hi!") and g.is_greeting("good morning team") and g.is_greeting("vanakkam")
    assert not g.is_greeting("hi where is my order")


def test_never_say_hits_and_refusals():
    topics = ["Discounts not in policy", "Competitor names"]
    assert g.never_say_hits("Sure, here's a 50% discount for you!", topics) == ["Discounts not in policy"]
    assert g.never_say_hits("I can't add extra discounts, but here are today's offers.", topics) == []
    assert g.never_say_hits("Shipping takes 3-5 days.", topics) == []


def test_policy_defaults_keep_old_behaviour():
    req = ChatRequest(workspace_id="ws", conversation_id="c", messages=[{"role": "user", "content": "hi"}])
    p = req.settings.policy
    assert isinstance(p, AgentPolicy)
    assert p.handover.ask_human and p.handover.sensitive_topics and p.handover.turn_limit
    assert p.handover.angry_sensitivity == "low"            # abusive words only, as before
    assert not p.handover.low_confidence and not p.handover.high_value_order and not p.handover.repeat_contact
    assert p.wismo_enabled and p.faq_enabled and p.model_tier == "standard" and not req.test


def _case(**kw):
    return {"question": "q", "expected": "", "expect_outcome": "answered", "must_include": [],
            "must_not_include": [], "language": None, **kw}


def test_grade_outcomes_and_phrases():
    assert grade(_case(expect_outcome="handover"), "handover", "Connecting you", None, []) == (True, [])
    ok, why = grade(_case(expect_outcome="handover"), "answered", "Wholesale price is 420", None, [])
    assert not ok and why == ["Should hand over"]
    ok, why = grade(_case(must_include=["7 days|seven days"], must_not_include=["refund"]),
                    "answered", "You can exchange within 7 days. Refund too.", None, [])
    assert not ok and why == ["Said: refund"]
    assert grade(_case(expect_outcome="refuse"), "answered", "I can only share orders linked to this number.",
                 None, [])[0]


def test_grade_language():
    ok, why = grade(_case(language="Tamil"), "answered", "Yes, we offer cash on delivery.", "English", [])
    assert not ok and why == ["Wrong language (English)"]
