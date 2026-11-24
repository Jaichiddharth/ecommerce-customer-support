"""Layers 2 and 3 of order-intent detection, with controlled scores (no real embeddings needed)."""
import json
import uuid

import pytest

from app import agent, intent
from app.config import get_settings

try:
    import psycopg
    psycopg.connect(get_settings().database_url, connect_timeout=3).close()
    DB_OK = get_settings().llm_provider == "fake"
except Exception:
    DB_OK = False


@pytest.mark.parametrize("o,p,expected", [
    (0.90, 0.10, "order"),   # clearly an order question
    (0.60, 0.59, "maybe"),   # close to both: let the AI decide
    (0.40, 0.10, "maybe"),   # weak match: let the AI decide
    (0.30, 0.00, "no"),
    (0.60, 0.90, "no"),      # much closer to a policy question
])
def test_classify(o, p, expected):
    assert intent.classify(o, p) == expected


def test_examples_are_distinct_from_each_other():
    assert not set(intent.ORDER_EXAMPLES) & set(intent.POLICY_EXAMPLES)


pytestmark_db = pytest.mark.skipif(not DB_OK, reason="needs Postgres and LLM_PROVIDER=fake")


@pytest.fixture
def client(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app
    calls = {}

    def fake_answer(ws, cust, question, now=None, matched_by="keyword", **kwargs):
        calls["matched_by"] = matched_by
        return {"outcome": "answered", "reply": "Order UX999999 is on its way.", "suggestions": [],
                "flags": ["order_lookup"], "tool": {"name": "order_status", "matched": True, "matched_by": matched_by}}

    monkeypatch.setattr(agent, "_identified_customer", lambda req: {"customer_ref": "42"})
    # each test chat uses its own user id, so back-to-back test runs never hit the per-user rate limit
    monkeypatch.setattr(agent.wismo, "answer_for_customer", fake_answer)
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {get_settings().service_token}"})
        c.calls = calls
        yield c


def ask(c, text):
    r = c.post("/v1/chat", json={"workspace_id": "ws_unocx", "conversation_id": "oi-" + uuid.uuid4().hex[:8],
                                 "user": {"id": "t-" + uuid.uuid4().hex[:8]}, "messages": [{"role": "user", "content": text}]})
    assert r.status_code == 200, r.text
    return r.json()


@pytestmark_db
def test_layer2_semantic_match(client, monkeypatch):
    monkeypatch.setattr(intent, "order_scores", lambda v: (0.9, 0.1))
    r = ask(client, "Is my stuff on the way yet?")
    assert r["route"] == "tool" and "order_intent_semantic" in r["flags"]
    assert client.calls["matched_by"] == "semantic" and r["trace"]["order_intent"]["decision"] == "order"


@pytestmark_db
def test_layer3_ai_decides(client, monkeypatch):
    monkeypatch.setattr(intent, "order_scores", lambda v: (0.40, 0.10))       # "maybe"
    r = ask(client, "Is my stuff on the way yet?")
    assert r["route"] == "tool" and "order_intent_llm" in r["flags"] and client.calls["matched_by"] == "llm"


@pytestmark_db
def test_general_question_not_hijacked(client, monkeypatch):
    monkeypatch.setattr(intent, "order_scores", lambda v: (0.50, 0.90))
    r = ask(client, "How long does delivery take to Chennai?")
    assert r["route"] == "rag" and "matched_by" not in client.calls


@pytestmark_db
def test_real_order_beats_generic_keyword_reply(client, monkeypatch):
    # "why is my order taking so long" fuzzily matches the generic "Track order" keyword reply
    monkeypatch.setattr(intent, "order_scores", lambda v: (0.9, 0.1))
    r = ask(client, "Why is my order taking so long?")
    assert r["route"] == "tool" and r["trace"]["order_intent"].get("checked_before_flow")


@pytestmark_db
def test_stream_never_shows_the_control_word(client, monkeypatch):
    monkeypatch.setattr(intent, "order_scores", lambda v: (0.40, 0.10))
    body = {"workspace_id": "ws_unocx", "conversation_id": "oi-s-" + uuid.uuid4().hex[:6], "user": {"id": "t-" + uuid.uuid4().hex[:8]},
            "messages": [{"role": "user", "content": "Is my stuff on the way yet?"}]}
    with client.stream("POST", "/v1/chat/stream", json=body) as r:
        raw = "".join(r.iter_text())
    deltas = "".join(json.loads(b.split("data: ", 1)[1])["text"] for b in raw.split("\n\n") if b.startswith("event: delta"))
    done = json.loads([b for b in raw.split("\n\n") if b.startswith("event: done")][0].split("data: ", 1)[1])
    assert "ORDER_STATUS" not in deltas and done["route"] == "tool"
