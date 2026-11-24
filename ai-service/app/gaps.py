"""Knowledge gaps: help questions the agent couldn't answer well, and the loop that closes them.

A gap is recorded when a help question (the RAG route) is
  - unanswered: nothing relevant in the knowledge, or the model declined to answer from it;
  - low confidence: handed over for low confidence, or answered with a confidence score below GAP_CONFIDENCE;
  - thumbs down: the customer said the answer didn't help.
Questions that mean the same thing are grouped (same content words, or embeddings at least MERGE_SIMILARITY apart),
so the list shows each topic once with how often it was asked.

The business closes a gap by writing the answer. It is added to a Knowledge FAQ ("Answers from knowledge gaps"),
which is what makes the agent answer it next time, and to the checks (Test data), which keep it answered after
later changes. The question is then asked again in the background and the new confidence is stored, so the page
shows the before and after scores. Order, shopping, flow and guardrail replies are never gaps: they don't come
from the knowledge.
"""
import logging
import re
import uuid
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from .db import conn
from .ingest import parse_faq, sync_source
from .llm import content_words
from .models import ChatSettings
from .security import auth

log = logging.getLogger(__name__)
router = APIRouter(dependencies=[Depends(auth)])

GAP_CONFIDENCE = 0.70          # answers below this score are gaps
# Questions this close in meaning are the same gap. Measured on text-embedding-3-small: close paraphrases score
# 0.78-0.81, while different questions on the same theme ("ship to Dubai" / "ship to London") reach 0.72.
MERGE_SIMILARITY = 0.78
# After an answer is saved, open gaps at least this close are asked again too: wordings below the merge line
# ("how long does delivery take" / "when will my parcel arrive", 0.49) often get answered by the same fix
RELATED_SIMILARITY = 0.6
MAX_RELATED_RETESTS = 5
MAX_EXAMPLES = 5
FAQ_URI = "unocx:knowledge-gaps"
FAQ_TITLE = "Answers from knowledge gaps"
# Conversations that are themselves tests of the agent (test runs, gap re-tests) never create gaps
_SKIP_CONVERSATIONS = ("trun_", "gaprt_")


def question_key(question: str) -> str:
    """The question's content words in order ("How long does delivery take?" → "long deliveri take")."""
    return " ".join(content_words(question or ""))[:300]


def gap_reason(route: str, outcome: str, flags: list[str], handover_reason: str | None,
               confidence: float | None) -> str | None:
    if route != "rag" or "off_topic" in flags:   # not about the store: nothing to add to the knowledge
        return None
    if "no_relevant_knowledge" in flags:
        return "unanswered"
    if handover_reason == "low_confidence":
        return "low_confidence"
    if outcome == "answered" and confidence is not None and confidence < GAP_CONFIDENCE:
        return "low_confidence"
    return None


def record(ws: str, conversation_id: str, question: str | None, qvec, *, reason: str, confidence: float | None,
           reply: str | None, run_id: str | None, channel: str | None) -> None:
    """Adds one occurrence to the matching gap, or creates it. Never raises (called while logging a run)."""
    if not question or conversation_id.startswith(_SKIP_CONVERSATIONS):
        return
    key = question_key(question)
    if len(key) < 3:
        return
    conf = 0.0 if reason == "unanswered" else confidence
    try:
        with conn() as c, c.transaction():
            row = c.execute("SELECT * FROM ai.knowledge_gaps WHERE workspace_id=%s AND question_key=%s FOR UPDATE",
                            (ws, key)).fetchone()
            if not row and qvec is not None:
                near = c.execute(
                    "SELECT *, 1 - (embedding <=> %s::vector) AS sim FROM ai.knowledge_gaps"
                    " WHERE workspace_id=%s AND embedding IS NOT NULL ORDER BY embedding <=> %s::vector LIMIT 1",
                    (qvec, ws, qvec)).fetchone()
                row = near if near and near["sim"] >= MERGE_SIMILARITY else None
            if not row:
                c.execute(
                    "INSERT INTO ai.knowledge_gaps (id, workspace_id, question_key, question, examples, embedding,"
                    " reasons, confidence, min_confidence, last_reply, last_run_id, last_channel)"
                    " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (workspace_id, question_key)"
                    " DO UPDATE SET times = ai.knowledge_gaps.times + 1, last_asked = now()",
                    ("gap_" + uuid.uuid4().hex[:12], ws, key, question[:500], Jsonb([question[:500]]), qvec,
                     Jsonb([reason]), conf, conf, (reply or "")[:2000], run_id, channel))
                return
            examples = list(row["examples"] or [])
            if question.lower() not in {e.lower() for e in examples}:
                examples = (examples + [question[:500]])[-MAX_EXAMPLES:]
            reasons = sorted(set(row["reasons"] or []) | {reason})
            # Asked again and still not answered well after it was fixed: the fix didn't work, back to the list
            reopen = row["status"] == "resolved"
            c.execute(
                "UPDATE ai.knowledge_gaps SET times = times + 1, last_asked = now(), examples=%s, reasons=%s,"
                " confidence=%s, min_confidence = LEAST(coalesce(min_confidence, %s), %s), last_reply=%s,"
                " last_run_id=%s, last_channel=%s, status = CASE WHEN %s THEN 'open' ELSE status END,"
                " reopened = reopened OR %s WHERE id=%s",
                (Jsonb(examples), Jsonb(reasons), conf, conf, conf, (reply or "")[:2000], run_id, channel,
                 reopen, reopen, row["id"]))
    except Exception:
        log.exception("could not record a knowledge gap")


# ---------------------------------------------------------------- dashboard API

_COLUMNS = """g.id, g.question, g.examples, g.reasons, g.times, g.confidence, g.min_confidence, g.last_reply,
  g.last_channel, g.status, g.answer, g.test_case_id, (tc.id IS NOT NULL) AS in_checks, g.knowledge_source_id,
  g.resolved_at, g.retest_status, g.retest_confidence, g.retest_outcome, g.retest_reply, g.retest_passed,
  g.retested_at, g.reopened, g.first_asked, g.last_asked"""


def _get(c, gid: str, ws: str) -> dict:
    row = c.execute(f"SELECT {_COLUMNS} FROM ai.knowledge_gaps g LEFT JOIN ai.test_cases tc"
                    " ON tc.id = g.test_case_id AND tc.workspace_id = g.workspace_id"
                    " WHERE g.id=%s AND g.workspace_id=%s", (gid, ws)).fetchone()
    if not row:
        raise HTTPException(404, "knowledge gap not found")
    return row


@router.get("/v1/gaps")
def list_gaps(workspace_id: str, status: Literal["open", "resolved", "ignored", "all"] = "open",
              limit: int = Query(200, ge=1, le=500)):
    """Gaps, most worth fixing first (asked often, answered badly), with the page's summary numbers."""
    where = "" if status == "all" else " AND g.status = %(status)s"
    p = {"ws": workspace_id, "status": status, "limit": limit, "t": GAP_CONFIDENCE}
    with conn() as c:
        gaps = c.execute(
            f"SELECT {_COLUMNS} FROM ai.knowledge_gaps g LEFT JOIN ai.test_cases tc"
            " ON tc.id = g.test_case_id AND tc.workspace_id = g.workspace_id"
            f" WHERE g.workspace_id = %(ws)s{where}"
            " ORDER BY g.times * (1 - coalesce(g.confidence, 0)) DESC, g.last_asked DESC LIMIT %(limit)s", p).fetchall()
        summary = c.execute(
            "SELECT count(*) FILTER (WHERE status='open') AS open,"
            " count(*) FILTER (WHERE status='resolved') AS resolved,"
            " count(*) FILTER (WHERE status='ignored') AS ignored,"
            " coalesce(sum(times) FILTER (WHERE status='open'), 0) AS open_asks,"
            " count(*) FILTER (WHERE status='resolved' AND retest_confidence >= %(t)s) AS verified,"
            " round(avg(retest_confidence - min_confidence) FILTER (WHERE status='resolved'"
            "   AND retest_confidence IS NOT NULL)::numeric, 3) AS avg_gain"
            " FROM ai.knowledge_gaps WHERE workspace_id = %(ws)s", p).fetchone()
        # Of the help questions customers asked in the last 30 days, how many got a confident answer
        help_ = c.execute(
            "SELECT count(*) AS asked,"
            " count(*) FILTER (WHERE outcome='answered' AND confidence >= %(t)s) AS confident,"
            " round(avg(confidence) FILTER (WHERE outcome='answered')::numeric, 3) AS avg_confidence"
            " FROM ai.agent_runs WHERE workspace_id = %(ws)s AND route='rag' AND coalesce(channel,'') <> 'test'"
            " AND created_at > now() - interval '30 days'", p).fetchone()
    return {"threshold": GAP_CONFIDENCE, "summary": {**summary, "help": help_}, "gaps": gaps}


class GapStatus(BaseModel):
    workspace_id: str
    status: Literal["open", "ignored"]


@router.patch("/v1/gaps/{gid}")
def set_status(gid: str, body: GapStatus):
    """Ignore a gap (not something the agent should answer), or put it back on the list."""
    with conn() as c:
        _get(c, gid, body.workspace_id)
        c.execute("UPDATE ai.knowledge_gaps SET status=%s, reopened=false WHERE id=%s", (body.status, gid))
        return _get(c, gid, body.workspace_id)


class GapResolve(BaseModel):
    workspace_id: str
    answer: str = Field(min_length=1, max_length=4000)
    question: str | None = Field(default=None, max_length=500)   # the question as it should read in the FAQ
    add_to_knowledge: bool = True
    add_check: bool = True
    settings: ChatSettings = ChatSettings()


def _faq_upsert(c, ws: str, question: str, answer: str) -> str:
    """Adds (or updates) one Q&A in the workspace's "Answers from knowledge gaps" FAQ source."""
    clean_a = re.sub(r"(?im)^\s*Q:", "Q -", answer.strip())    # an answer line starting "Q:" would split the FAQ
    clean_q = " ".join(question.split())
    src = c.execute("SELECT id, content FROM ai.knowledge_sources WHERE workspace_id=%s AND type='faq' AND uri=%s"
                    " ORDER BY created_at LIMIT 1", (ws, FAQ_URI)).fetchone()
    pairs = parse_faq(src["content"] or "") if src else []
    pairs = [(q, a) for q, a in pairs if q.lower() != clean_q.lower()] + [(clean_q, clean_a)]
    content = "\n\n".join(f"Q: {q}\nA: {a}" for q, a in pairs)
    if src:
        c.execute("UPDATE ai.knowledge_sources SET content=%s, status='queued', enabled=true, updated_at=now()"
                  " WHERE id=%s", (content, src["id"]))
        return src["id"]
    sid = "ks_" + uuid.uuid4().hex[:12]
    c.execute("INSERT INTO ai.knowledge_sources (id, workspace_id, type, title, uri, content)"
              " VALUES (%s,%s,'faq',%s,%s,%s)", (sid, ws, FAQ_TITLE, FAQ_URI, content))
    return sid


def _add_check(c, ws: str, question: str, expected: str, existing: str | None) -> str:
    if existing and c.execute("SELECT 1 FROM ai.test_cases WHERE id=%s AND workspace_id=%s",
                              (existing, ws)).fetchone():
        c.execute("UPDATE ai.test_cases SET question=%s, expected=%s WHERE id=%s", (question, expected, existing))
        return existing
    n = c.execute("SELECT count(*) AS n FROM ai.test_cases WHERE workspace_id=%s", (ws,)).fetchone()["n"]
    if n >= 500:
        raise HTTPException(422, "a test set can hold at most 500 cases")
    cid = "tc_" + uuid.uuid4().hex[:12]
    c.execute("INSERT INTO ai.test_cases (id, workspace_id, question, expected, category, expect_outcome, source)"
              " VALUES (%s,%s,%s,%s,'Policy & FAQ','answered','knowledge_gap')", (cid, ws, question, expected))
    return cid


@router.post("/v1/gaps/{gid}/resolve")
def resolve(gid: str, body: GapResolve, bg: BackgroundTasks):
    """The business's answer: into the Knowledge FAQ and the checks, then the question is asked again."""
    if not (body.add_to_knowledge or body.add_check):
        raise HTTPException(422, "add the answer to the knowledge, the checks, or both")
    ws = body.workspace_id
    with conn() as c, c.transaction():
        gap = _get(c, gid, ws)
        question = " ".join((body.question or gap["question"]).split())
        sid = _faq_upsert(c, ws, question, body.answer) if body.add_to_knowledge else gap["knowledge_source_id"]
        cid = _add_check(c, ws, question, body.answer.strip(), gap["test_case_id"]) if body.add_check else gap["test_case_id"]
        c.execute("UPDATE ai.knowledge_gaps SET status='resolved', answer=%s, question=%s, test_case_id=%s,"
                  " knowledge_source_id=%s, resolved_at=now(), reopened=false, retest_status='pending'"
                  " WHERE id=%s", (body.answer.strip(), question, cid, sid, gid))
    bg.add_task(_after_resolve, gid, ws, sid if body.add_to_knowledge else None, body.settings)
    with conn() as c:
        return _get(c, gid, ws)


def _after_resolve(gid: str, ws: str, sid: str | None, settings: ChatSettings):
    if sid:
        try:
            sync_source(sid)     # index the new answer before asking again
        except Exception:
            log.exception("could not index the knowledge gap answers")
    retest(gid, ws, settings)
    if not sid:
        return
    # Related open gaps: the same answer may cover them; they close by themselves if now answered confidently
    try:
        with conn() as c:
            related = c.execute(
                "SELECT o.id FROM ai.knowledge_gaps o, ai.knowledge_gaps g WHERE g.id=%s AND o.workspace_id=%s"
                " AND o.id <> g.id AND o.status='open' AND o.embedding IS NOT NULL AND g.embedding IS NOT NULL"
                " AND 1 - (o.embedding <=> g.embedding) >= %s ORDER BY o.embedding <=> g.embedding LIMIT %s",
                (gid, ws, RELATED_SIMILARITY, MAX_RELATED_RETESTS)).fetchall()
        for r in related:
            retest(r["id"], ws, settings)
    except Exception:
        log.exception("could not re-test related knowledge gaps")


def retest(gid: str, ws: str, settings: ChatSettings) -> dict:
    """Asks the gap's question again as a new customer and stores how well the agent answers it now."""
    from .admin import run_case    # admin imports the agent, which imports this module

    with conn() as c:
        row = c.execute("SELECT question, answer, status FROM ai.knowledge_gaps WHERE id=%s AND workspace_id=%s",
                        (gid, ws)).fetchone()
        if not row:
            raise HTTPException(404, "knowledge gap not found")
        c.execute("UPDATE ai.knowledge_gaps SET retest_status='pending' WHERE id=%s", (gid,))
    case = {"id": uuid.uuid4().hex[:10], "question": row["question"], "expected": row["answer"] or "",
            "expect_outcome": "answered", "category": "Policy & FAQ", "must_include": [], "must_not_include": [],
            "language": None, "as_user": None}
    try:
        res = run_case(ws, f"gaprt_{gid}", case, settings)
    except Exception as e:
        log.exception("knowledge gap re-test failed")
        res = {"outcome": "error", "reply": str(e)[:300], "confidence": None, "passed": False}
    error = res.get("outcome") == "error"
    answered = res.get("outcome") == "answered"
    conf = (res.get("confidence") or 0.0) if answered else 0.0
    # Now answered confidently: an open gap is closed by itself (e.g. the answer was added to another source)
    auto_resolve = row["status"] == "open" and answered and conf >= GAP_CONFIDENCE
    with conn() as c:
        c.execute("UPDATE ai.knowledge_gaps SET retest_status=%s, retest_confidence=%s, retest_outcome=%s,"
                  " retest_reply=%s, retest_passed=%s, retested_at=now(),"
                  " status = CASE WHEN %s THEN 'resolved' ELSE status END,"
                  " resolved_at = CASE WHEN %s THEN now() ELSE resolved_at END,"
                  " reopened = CASE WHEN %s THEN false ELSE reopened END WHERE id=%s",
                  ("error" if error else "done", None if error else conf, res.get("outcome"),
                   (res.get("reply") or "")[:2000], bool(res.get("passed")), auto_resolve, auto_resolve,
                   auto_resolve, gid))
        return _get(c, gid, ws)


class GapRetest(BaseModel):
    workspace_id: str
    settings: ChatSettings = ChatSettings()


@router.post("/v1/gaps/{gid}/retest")
def retest_now(gid: str, body: GapRetest):
    return retest(gid, body.workspace_id, body.settings)


class GapCheck(BaseModel):
    workspace_id: str


@router.post("/v1/gaps/{gid}/check", status_code=201)
def add_check(gid: str, body: GapCheck):
    """Adds the question to the checks as it is (it must get an answer), without writing an answer yet."""
    with conn() as c, c.transaction():
        gap = _get(c, gid, body.workspace_id)
        cid = _add_check(c, body.workspace_id, gap["question"], gap["answer"] or "", gap["test_case_id"])
        c.execute("UPDATE ai.knowledge_gaps SET test_case_id=%s WHERE id=%s", (cid, gid))
        return _get(c, gid, body.workspace_id)


def update_from_run(ws: str, results: list[dict]) -> None:
    """After a test run: the latest score of every gap whose check was in it."""
    by_case = {r["case_id"]: r for r in results if r.get("case_id")}
    if not by_case:
        return
    try:
        with conn() as c:
            gaps = c.execute("SELECT id, test_case_id FROM ai.knowledge_gaps WHERE workspace_id=%s"
                             " AND test_case_id = ANY(%s)", (ws, list(by_case))).fetchall()
            for g in gaps:
                r = by_case[g["test_case_id"]]
                answered = r.get("outcome") == "answered"
                c.execute("UPDATE ai.knowledge_gaps SET retest_status='done', retest_confidence=%s, retest_outcome=%s,"
                          " retest_reply=%s, retest_passed=%s, retested_at=now() WHERE id=%s",
                          ((r.get("confidence") or 0.0) if answered else 0.0, r.get("outcome"),
                           (r.get("reply") or "")[:2000], bool(r.get("passed")), g["id"]))
    except Exception:
        log.exception("could not update knowledge gaps from the test run")
