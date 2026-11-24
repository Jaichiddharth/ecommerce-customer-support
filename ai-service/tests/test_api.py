"""Integration tests against a real Postgres (DATABASE_URL) with LLM_PROVIDER=fake.
Skipped automatically if the database isn't reachable. Run `python -m scripts.seed --reset` first."""
import json
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent

try:
    import psycopg

    from app.config import get_settings
    psycopg.connect(get_settings().database_url, connect_timeout=3).close()
    DB_OK = get_settings().llm_provider == "fake"
except Exception:
    DB_OK = False

pytestmark = pytest.mark.skipif(not DB_OK, reason="needs Postgres and LLM_PROVIDER=fake")
WS = "ws_unocx"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {get_settings().service_token}"})
        yield c


def ask(client, text, **kw):
    body = {"workspace_id": WS, "conversation_id": "t-" + uuid.uuid4().hex[:8],
            "messages": [{"role": "user", "content": text}], **kw}
    r = client.post("/v1/chat", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_health(client):
    assert client.get("/health").json()["ok"]


def test_auth_required(client):
    r = client.post("/v1/chat", json={}, headers={"Authorization": "Bearer wrong"})
    assert r.status_code == 401


def test_last_message_must_be_user(client):
    r = client.post("/v1/chat", json={"workspace_id": WS, "conversation_id": "x",
                                      "messages": [{"role": "assistant", "content": "hi"}]})
    assert r.status_code == 422


def test_workspace_isolation(client):
    r = ask(client, "What is your return policy?", workspace_id="ws_other_" + uuid.uuid4().hex[:6])
    assert r["outcome"] == "clarify" and not r["citations"]


def test_answer_has_citation_and_suggestions(client):
    r = ask(client, "How long do refunds take?")
    assert r["outcome"] == "answered" and r["citations"] and r["citations"][0]["url"].startswith("/help/")


def test_stream(client):
    body = {"workspace_id": WS, "conversation_id": "s-" + uuid.uuid4().hex[:8],
            "messages": [{"role": "user", "content": "How long do refunds take?"}]}
    with client.stream("POST", "/v1/chat/stream", json=body) as r:
        raw = "".join(r.iter_text())
    events = [blk for blk in raw.split("\n\n") if blk.strip()]
    names = [e.split("\n")[0].removeprefix("event: ") for e in events]
    assert names[0] == "meta" and names[-1] == "done" and "delta" in names
    done = json.loads(events[-1].split("data: ", 1)[1])
    streamed = "".join(json.loads(e.split("data: ", 1)[1])["text"] for e in events if e.startswith("event: delta"))
    assert done["outcome"] == "answered" and "[1]" not in streamed


def test_stream_guardrail_path(client):
    body = {"workspace_id": WS, "conversation_id": "s-" + uuid.uuid4().hex[:8],
            "messages": [{"role": "user", "content": "talk to a human"}]}
    with client.stream("POST", "/v1/chat/stream", json=body) as r:
        raw = "".join(r.iter_text())
    assert '"handover"' in raw


def test_llm_outage_falls_back_to_handover(client, monkeypatch):
    from app import llm

    def boom(*a, **k):
        raise TimeoutError("simulated OpenAI timeout")
    monkeypatch.setattr(llm.provider(), "chat", boom)
    r = ask(client, "How long do refunds take?")
    assert r["outcome"] == "handover" and r["handover_reason"] == "error" and r["route"] == "fallback"


def test_budget_exceeded_still_serves_free_routes(client, monkeypatch):
    from app import agent
    monkeypatch.setattr(agent, "budget_ok", lambda: False)
    assert ask(client, "hi")["route"] == "flow"                       # keyword flows still work
    r = ask(client, "How long do refunds take?")
    assert r["handover_reason"] == "budget_exceeded"


def test_feedback_once_per_run(client):
    r = ask(client, "How do I reset my password?")
    fb = {"workspace_id": WS, "run_id": r["run_id"], "helpful": False}
    assert client.post("/v1/feedback", json=fb).json()["ok"]
    assert "already" in client.post("/v1/feedback", json=fb).json().get("note", "")
    assert client.post("/v1/feedback", json={**fb, "run_id": "run_missing"}).status_code == 404


def test_pdf_upload_and_scanned_pages(client):
    pdf = (ROOT / "knowledge" / "size-guide.pdf").read_bytes()
    ws = "ws_upload_" + uuid.uuid4().hex[:6]
    r = client.post("/v1/knowledge/upload", data={"workspace_id": ws, "title": "Size guide"},
                    files={"file": ("size.pdf", pdf, "application/pdf")})
    assert r.status_code == 202 and r.json()["scanned_pages"] == [3]
    src = client.get(f"/v1/knowledge/sources/{r.json()['id']}", params={"workspace_id": ws}).json()
    assert src["status"] == "live" and src["item_count"] >= 1 and "scanned" in src["error"]
    assert client.delete(f"/v1/knowledge/sources/{src['id']}", params={"workspace_id": ws}).status_code == 200


def test_upload_rejects_non_pdf(client):
    r = client.post("/v1/knowledge/upload", data={"workspace_id": WS, "title": "x"},
                    files={"file": ("x.pdf", b"hello", "application/pdf")})
    assert r.status_code == 422


def test_text_source_lifecycle_and_flow_crud(client):
    ws = "ws_crud_" + uuid.uuid4().hex[:6]
    r = client.post("/v1/knowledge/sources", json={"workspace_id": ws, "type": "faq", "title": "FAQ",
                                                   "content": "Q: Do you sell gift cards?\nA: Yes, from Rs 500."})
    sid = r.json()["id"]
    assert client.get(f"/v1/knowledge/sources/{sid}", params={"workspace_id": ws}).json()["status"] == "live"
    f = client.post("/v1/flows", json={"workspace_id": ws, "name": "Hours", "keywords": ["opening hours"],
                                       "reply_text": "We are open 10-7."}).json()
    assert ask(client, "what are your opening hours", workspace_id=ws)["route"] == "flow"
    client.delete(f"/v1/flows/{f['id']}", params={"workspace_id": ws})
    assert client.get(f"/v1/knowledge/sources/{sid}", params={"workspace_id": "ws_someone_else"}).status_code == 404


def test_bad_url_source_records_error(client):
    r = client.post("/v1/knowledge/sources", json={"workspace_id": WS, "type": "url", "title": "Bad",
                                                   "uri": "https://nonexistent.invalid/help"})
    src = client.get(f"/v1/knowledge/sources/{r.json()['id']}", params={"workspace_id": WS}).json()
    assert src["status"] == "error" and src["error"]
    client.delete(f"/v1/knowledge/sources/{src['id']}", params={"workspace_id": WS})


def test_insights(client):
    ask(client, "zxqv plorf")
    gaps = client.get("/v1/insights/gaps", params={"workspace_id": WS}).json()
    assert any("zxqv" in g["question"] for g in gaps)
    assert client.get("/v1/insights/summary", params={"workspace_id": WS}).json()["runs"] > 0


def test_trace_and_confidence(client):
    r = ask(client, "How long do refunds take?")
    t = r["trace"]
    assert 0 <= r["confidence"] <= 1
    assert {"rules", "embed", "retrieval", "llm", "total"} <= set(t["timings_ms"])
    assert t["retrieval"]["top"] and t["retrieval"]["passed_gate"] is True
    assert ask(client, "hi")["confidence"] == 1.0          # rule-based reply


def test_quality_endpoint(client):
    ask(client, "How long do refunds take?")
    q = client.get("/v1/insights/quality", params={"workspace_id": WS, "days": 7}).json()
    assert q["totals"]["runs"] > 0 and 0 <= q["rates"]["answer_rate"] <= 1
    assert any(s["stage"] == "llm" for s in q["latency_by_stage"])
    assert q["articles"] and "thumbs_down" in q["articles"][0]


def test_quality_reports_conversation_signals(client):
    conv = "q-" + uuid.uuid4().hex[:8]
    msgs = [{"role": "user", "content": "how do I reset my password?"}]
    r1 = client.post("/v1/chat", json={"workspace_id": WS, "conversation_id": conv, "messages": msgs}).json()
    msgs += [{"role": "assistant", "content": r1["reply"]}, {"role": "user", "content": "that's not what I asked"}]
    client.post("/v1/chat", json={"workspace_id": WS, "conversation_id": conv, "messages": msgs})
    q = client.get("/v1/insights/quality", params={"workspace_id": WS, "days": 1}).json()
    assert q["rates"]["unhappy_customer_rate"] and q["rates"]["unhappy_customer_rate"] > 0
    assert any("customer_unhappy" in (row["flags"] or []) for row in q["review_queue"])


def test_resume_after_handover(client):
    conv = "h-" + uuid.uuid4().hex[:8]
    first = client.post("/v1/chat", json={"workspace_id": WS, "conversation_id": conv,
                                          "messages": [{"role": "user", "content": "talk to a human"}]}).json()
    assert first["outcome"] == "handover"
    again = client.post("/v1/chat", json={"workspace_id": WS, "conversation_id": conv,
                                          "messages": [{"role": "user", "content": "How long do refunds take?"}]}).json()
    assert "awaiting_agent" in again["flags"]
    client.post("/v1/conversations/resume", json={"workspace_id": WS, "conversation_id": conv})
    after = client.post("/v1/chat", json={"workspace_id": WS, "conversation_id": conv,
                                          "messages": [{"role": "user", "content": "How long do refunds take?"}]}).json()
    assert after["outcome"] == "answered"
