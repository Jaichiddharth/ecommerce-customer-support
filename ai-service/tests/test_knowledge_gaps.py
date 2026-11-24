"""Knowledge gaps: recorded from unanswered / low-confidence help questions, grouped, and closed by an answer
that goes into a Knowledge FAQ and the checks, then re-tested. Integration parts need Postgres and fake mode."""
import uuid

import pytest

from app.gaps import GAP_CONFIDENCE, gap_reason, question_key

try:
    import psycopg

    from app.config import get_settings
    psycopg.connect(get_settings().database_url, connect_timeout=3).close()
    DB_OK = get_settings().llm_provider == "fake"
except Exception:
    DB_OK = False

needs_db = pytest.mark.skipif(not DB_OK, reason="needs Postgres and LLM_PROVIDER=fake")


# ---------------------------------------------------------------- unit

def test_question_key_groups_wordings():
    assert question_key("How long does delivery take?") == question_key("how long does the delivery take")
    assert question_key("Do you ship to Dubai?") != question_key("Do you ship to London?")
    assert question_key("is it?") == ""


@pytest.mark.parametrize("route,outcome,flags,reason,conf,expected", [
    ("rag", "clarify", ["no_relevant_knowledge"], None, None, "unanswered"),
    ("rag", "handover", ["no_relevant_knowledge"], "no_answer", None, "unanswered"),
    ("rag", "handover", ["low_confidence"], "low_confidence", 0.3, "low_confidence"),
    ("rag", "answered", [], None, GAP_CONFIDENCE - 0.01, "low_confidence"),
    ("rag", "answered", [], None, GAP_CONFIDENCE, None),
    ("rag", "clarify", [], None, None, None),             # "which of these do you mean?" is not a gap
    ("tool", "answered", [], None, 1.0, None),            # order answers don't come from the knowledge
    ("flow", "answered", [], None, 1.0, None),
    ("guardrail", "blocked", [], None, 1.0, None),
    ("fallback", "handover", [], "refund_request", None, None),
])
def test_gap_reason(route, outcome, flags, reason, conf, expected):
    assert gap_reason(route, outcome, flags, reason, conf) == expected


# ---------------------------------------------------------------- integration

@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {get_settings().service_token}"})
        yield c


@pytest.fixture()
def ws():
    w = "ws_gap_" + uuid.uuid4().hex[:8]
    yield w
    from app.db import conn
    with conn() as c:
        for table in ("knowledge_gaps", "test_cases", "agent_runs", "knowledge_sources"):
            c.execute(f"DELETE FROM ai.{table} WHERE workspace_id=%s", (w,))


def ask(client, ws, text, conversation=None):
    r = client.post("/v1/chat", json={
        "workspace_id": ws, "conversation_id": conversation or "gap-" + uuid.uuid4().hex[:8],
        "messages": [{"role": "user", "content": text}], "channel": "whatsapp"})
    assert r.status_code == 200, r.text
    return r.json()


def gaps(client, ws, status="open"):
    r = client.get("/v1/gaps", params={"workspace_id": ws, "status": status})
    assert r.status_code == 200, r.text
    return r.json()


@needs_db
def test_unanswered_questions_become_one_gap(client, ws):
    ask(client, ws, "Do you offer gift wrapping?")
    ask(client, ws, "do you offer gift wrapping")
    ask(client, ws, "Hi")                                # a greeting is never a gap
    data = gaps(client, ws)
    assert data["threshold"] == GAP_CONFIDENCE
    assert len(data["gaps"]) == 1
    g = data["gaps"][0]
    assert g["times"] == 2 and g["reasons"] == ["unanswered"] and g["confidence"] == 0
    assert g["status"] == "open" and not g["in_checks"]
    assert data["summary"]["open"] == 1 and data["summary"]["open_asks"] == 2


@needs_db
def test_test_runs_never_create_gaps(client, ws):
    ask(client, ws, "Do you offer gift wrapping?", conversation="trun_abc_tc1")
    ask(client, ws, "Do you offer gift wrapping?", conversation="gaprt_gap_x_1")
    assert gaps(client, ws)["gaps"] == []


@needs_db
def test_answer_goes_to_knowledge_and_checks_then_is_retested(client, ws):
    ask(client, ws, "Do you offer gift wrapping?")
    gid = gaps(client, ws)["gaps"][0]["id"]
    answer = "Yes, gift wrapping is available at checkout for Rs 49 per order, with a printed message card."
    r = client.post(f"/v1/gaps/{gid}/resolve", json={"workspace_id": ws, "answer": answer})
    assert r.status_code == 200, r.text
    g = r.json()
    assert g["status"] == "resolved" and g["answer"] == answer and g["in_checks"]

    # the FAQ source holds the answer, and the check expects it
    src = client.get(f"/v1/knowledge/sources/{g['knowledge_source_id']}/content", params={"workspace_id": ws}).json()
    assert src["type"] == "faq" and "Q: Do you offer gift wrapping?" in src["content"] and answer in src["content"]
    cases = client.get("/v1/tests/cases", params={"workspace_id": ws}).json()
    assert [(c["source"], c["expected"]) for c in cases] == [("knowledge_gap", answer)]

    # the background re-test ran after indexing: the agent now answers from the new FAQ
    g = gaps(client, ws, "resolved")["gaps"][0]
    assert g["retest_status"] == "done" and g["retest_outcome"] == "answered", g
    assert g["retest_confidence"] > g["min_confidence"]

    # answering again updates the same FAQ entry and check instead of adding new ones
    r = client.post(f"/v1/gaps/{gid}/resolve", json={"workspace_id": ws, "answer": answer + " Free above Rs 2000."})
    src = client.get(f"/v1/knowledge/sources/{g['knowledge_source_id']}/content", params={"workspace_id": ws}).json()
    assert src["content"].count("Q: ") == 1 and "Free above Rs 2000." in src["content"]
    assert len(client.get("/v1/tests/cases", params={"workspace_id": ws}).json()) == 1


@needs_db
def test_ignore_reopen_and_add_to_checks(client, ws):
    ask(client, ws, "Do you offer engraving on rings?")
    gid = gaps(client, ws)["gaps"][0]["id"]
    r = client.patch(f"/v1/gaps/{gid}", json={"workspace_id": ws, "status": "ignored"})
    assert r.json()["status"] == "ignored" and gaps(client, ws)["gaps"] == []
    ask(client, ws, "Do you offer engraving on rings?")    # still counted, still ignored
    g = gaps(client, ws, "ignored")["gaps"][0]
    assert g["times"] == 2 and g["status"] == "ignored"
    client.patch(f"/v1/gaps/{gid}", json={"workspace_id": ws, "status": "open"})
    r = client.post(f"/v1/gaps/{gid}/check", json={"workspace_id": ws})
    assert r.status_code == 201 and r.json()["in_checks"]
    assert client.get("/v1/tests/cases", params={"workspace_id": ws}).json()[0]["source"] == "knowledge_gap"


@needs_db
def test_resolved_gap_reopens_when_still_unanswered(client, ws):
    ask(client, ws, "Can I pay with crypto?")
    gid = gaps(client, ws)["gaps"][0]["id"]
    # only a check, no knowledge: customers still get no answer
    client.post(f"/v1/gaps/{gid}/resolve", json={"workspace_id": ws, "answer": "No.", "add_to_knowledge": False})
    ask(client, ws, "Can I pay with crypto?")
    g = gaps(client, ws)["gaps"][0]
    assert g["status"] == "open" and g["reopened"] and g["times"] == 2


@needs_db
def test_thumbs_down_records_a_gap(client, ws):
    from app.db import conn
    run_id = "run_" + uuid.uuid4().hex[:10]
    with conn() as c:
        c.execute("INSERT INTO ai.agent_runs (id, workspace_id, conversation_id, question, outcome, route, reply,"
                  " confidence, channel) VALUES (%s,%s,'conv1','what are your store hours','answered','rag',"
                  " 'We are open 9 to 5.',0.9,'whatsapp')", (run_id, ws))
    r = client.post("/v1/feedback", json={"workspace_id": ws, "run_id": run_id, "helpful": False})
    assert r.status_code == 200
    g = gaps(client, ws)["gaps"][0]
    assert g["reasons"] == ["thumbs_down"] and g["question"] == "what are your store hours"
