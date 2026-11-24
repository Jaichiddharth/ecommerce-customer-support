"""Endpoints behind the UnoCX dashboard's AI agent screens (Overview, Knowledge, Model, Test set).

Every query is scoped to one workspace and leaves out dashboard test chats (flag "test"), so the
numbers merchants see are real customer conversations only.
"""
import logging
import re
import uuid
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from . import agent
from .config import get_settings
from .db import conn
from .ingest import sync_source
from .language import detect_language
from .llm import byo_check, log_usage, provider
from .models import (CatalogProduct, ChatRequest, ChatSettings, CommerceContext, LlmOverride, Message, SalesSettings,
                     UserInfo)
from .security import auth

log = logging.getLogger("unocx.admin")


router = APIRouter(dependencies=[Depends(auth)])

REAL = "workspace_id = %(ws)s AND NOT flags ? 'test'"

# One topic per run, without an extra model call: order tools, refund/exchange requests, otherwise the
# top-level title of the help article the answer cited ("Store policies > Exchange" -> "Store policies").
TOPIC_SQL = """CASE
  WHEN route = 'tool' AND coalesce(trace->'tool'->>'name', '') = 'complaint' THEN 'Order problems'
  WHEN route = 'tool' THEN 'Order status & tracking'
  WHEN handover_reason IN ('refund_request') THEN 'Refunds'
  WHEN handover_reason IN ('exchange_request') THEN 'Returns & exchange'
  WHEN handover_reason = 'high_value_order' THEN 'High-value orders'
  WHEN jsonb_array_length(citations) > 0 THEN split_part(citations->0->>'title', ' > ', 1)
  ELSE NULL END"""

HANDOVER_LABELS = {
    "customer_asked_human": "Asked for a person", "sensitive_topic": "Legal, medical or safety topic",
    "no_answer": "No answer in knowledge", "turn_limit": "Turn limit reached", "budget_exceeded": "AI budget reached",
    "error": "Technical problem", "refund_request": "Refund request", "unresolved": "Couldn't resolve",
    "exchange_request": "Exchange request", "angry_tone": "Complaint / angry tone",
    "high_value_order": "Order value above limit", "repeat_contact": "Repeat contact",
    "low_confidence": "Low confidence answer", "skill_disabled": "Skill switched off",
}


# ---------------------------------------------------------------- overview

def _conv_cte(where: str) -> str:
    return f"""
      WITH runs AS (
        SELECT *, {TOPIC_SQL} AS topic FROM ai.agent_runs WHERE {REAL} AND {where}),
      conv AS (
        SELECT conversation_id,
          min(created_at) AS started_at,
          bool_or(outcome = 'handover') AS handed_over,
          coalesce(bool_or(feedback = -1), false) AS disliked,
          (array_agg(outcome ORDER BY created_at DESC))[1] AS last_outcome,
          (array_agg(latency_ms ORDER BY created_at))[1] AS first_latency_ms,
          (array_agg(topic ORDER BY created_at) FILTER (WHERE topic IS NOT NULL))[1] AS topic,
          array_agg(DISTINCT channel) FILTER (WHERE channel IS NOT NULL) AS channels
        FROM runs GROUP BY conversation_id),
      scored AS (
        SELECT *, (NOT handed_over AND NOT disliked AND last_outcome = 'answered') AS resolved FROM conv)
    """


@router.get("/v1/insights/overview")
def overview(workspace_id: str, days: int = Query(30, ge=7, le=180), chart_days: int = Query(14, ge=7, le=60)):
    p = {"ws": workspace_id, "days": days, "chart": chart_days}
    cur = "created_at > now() - make_interval(days => %(days)s)"
    prev = ("created_at <= now() - make_interval(days => %(days)s)"
            " AND created_at > now() - make_interval(days => %(days)s * 2)")
    with conn() as c:
        k = c.execute(_conv_cte(cur) + """
            SELECT count(*) AS conversations,
              count(*) FILTER (WHERE resolved) AS resolved,
              count(*) FILTER (WHERE handed_over) AS handed_over,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY first_latency_ms) AS median_first_reply_ms,
              percentile_cont(0.9) WITHIN GROUP (ORDER BY first_latency_ms) AS p90_first_reply_ms
            FROM scored""", p).fetchone()
        pk = c.execute(_conv_cte(prev) + """
            SELECT count(*) AS conversations, count(*) FILTER (WHERE resolved) AS resolved FROM scored""", p).fetchone()
        chans = c.execute(f"SELECT DISTINCT channel FROM ai.agent_runs WHERE {REAL} AND {cur} AND channel IS NOT NULL",
                          p).fetchall()
        by_day = c.execute(_conv_cte("created_at > now() - make_interval(days => %(chart)s)") + """
            SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
              count(*) FILTER (WHERE resolved) AS resolved,
              count(*) FILTER (WHERE handed_over) AS handed_over
            FROM scored GROUP BY 1 ORDER BY 1""", p).fetchall()
        topics = c.execute(_conv_cte(cur) + """
            SELECT topic, count(*) AS conversations, count(*) FILTER (WHERE resolved) AS resolved
            FROM scored WHERE topic IS NOT NULL AND topic <> ''
            GROUP BY topic ORDER BY conversations DESC LIMIT 6""", p).fetchall()
        handovers = c.execute(f"""
            SELECT DISTINCT ON (conversation_id) id AS run_id, conversation_id, user_id, handover_reason,
              {TOPIC_SQL} AS topic, question, channel, created_at
            FROM ai.agent_runs WHERE {REAL} AND outcome = 'handover' AND {cur}
            ORDER BY conversation_id, created_at DESC""", p).fetchall()
        low = c.execute(f"""
            SELECT count(*) AS n FROM ai.agent_runs WHERE {REAL} AND route = 'rag' AND outcome = 'answered'
              AND confidence < 0.5 AND created_at > now() - interval '7 days'""", p).fetchone()

    def rate(a, b):
        return round(a / b, 4) if b else None

    handovers = sorted(handovers, key=lambda r: r["created_at"], reverse=True)[:8]
    for h in handovers:
        h["reason_label"] = HANDOVER_LABELS.get(h["handover_reason"] or "", h["handover_reason"])
    return {
        "window_days": days,
        "kpis": {
            "resolution_rate": rate(k["resolved"], k["conversations"]),
            "previous_resolution_rate": rate(pk["resolved"], pk["conversations"]),
            "conversations": k["conversations"], "resolved": k["resolved"],
            "handed_over": k["handed_over"], "handover_rate": rate(k["handed_over"], k["conversations"]),
            "median_first_reply_ms": k["median_first_reply_ms"], "p90_first_reply_ms": k["p90_first_reply_ms"],
            "channels": [r["channel"] for r in chans],
        },
        "by_day": by_day,
        "topics": [{**t, "resolution_rate": rate(t["resolved"], t["conversations"])} for t in topics],
        "recent_handovers": handovers,
        "low_confidence_7d": low["n"],
    }


@router.get("/v1/insights/usage")
def usage(workspace_id: str):
    """Month to date: AI resolutions (for the plan meter), speed, tokens and model cost."""
    p = {"ws": workspace_id}
    month = "created_at >= date_trunc('month', now())"
    with conn() as c:
        res = c.execute(_conv_cte(month) + "SELECT count(*) FILTER (WHERE resolved) AS resolutions,"
                        " count(*) AS conversations FROM scored", p).fetchone()
        runs = c.execute(f"""
            SELECT round(avg(latency_ms))::int AS avg_latency_ms,
              round(avg(input_tokens + output_tokens) FILTER (WHERE model IS NOT NULL))::int AS tokens_per_reply,
              count(*) FILTER (WHERE model IS NOT NULL) AS llm_replies
            FROM ai.agent_runs WHERE {REAL} AND {month}""", p).fetchone()
        cost = c.execute(f"SELECT coalesce(sum(cost_usd), 0) AS usd FROM ai.usage_log WHERE workspace_id = %(ws)s AND {month}",
                         p).fetchone()
    return {**res, **runs, "cost_usd": float(cost["usd"])}


# ---------------------------------------------------------------- knowledge

class SourceUpdate(BaseModel):
    workspace_id: str
    title: str | None = Field(default=None, min_length=1, max_length=300)
    content: str | None = None
    uri: str | None = None
    enabled: bool | None = None


def _source(c, sid: str, ws: str) -> dict:
    row = c.execute("SELECT * FROM ai.knowledge_sources WHERE id=%s AND workspace_id=%s", (sid, ws)).fetchone()
    if not row:
        raise HTTPException(404, "source not found")
    return row


@router.patch("/v1/knowledge/sources/{sid}")
def update_source(sid: str, body: SourceUpdate, bg: BackgroundTasks):
    """Rename, edit content (re-indexed in the background) or switch a source on/off (draft)."""
    resync = False
    with conn() as c:
        src = _source(c, sid, body.workspace_id)
        if body.content is not None:
            if src["type"] in ("pdf", "url"):
                raise HTTPException(422, f"{src['type']} sources can't be edited; upload again or sync instead")
            if not body.content.strip():
                raise HTTPException(422, "content is required")
            resync = body.content != src["content"]
        if body.uri is not None and src["type"] == "url":
            if not body.uri.startswith(("http://", "https://")):
                raise HTTPException(422, "url sources need an http(s) uri")
            resync = resync or body.uri != src["uri"]
        c.execute("UPDATE ai.knowledge_sources SET title=coalesce(%s,title), content=coalesce(%s,content),"
                  " uri=coalesce(%s,uri), enabled=coalesce(%s,enabled), updated_at=now(),"
                  " status=CASE WHEN %s THEN 'queued' ELSE status END WHERE id=%s",
                  (body.title, body.content, body.uri, body.enabled, resync, sid))
        row = c.execute("SELECT id, type, title, uri, status, enabled, item_count, flagged_count, error, last_synced_at, created_at,"
                        " updated_at FROM ai.knowledge_sources WHERE id=%s", (sid,)).fetchone()
    if resync:
        bg.add_task(sync_source, sid)
    return row


@router.get("/v1/knowledge/sources/{sid}/content")
def source_content(sid: str, workspace_id: str):
    with conn() as c:
        src = _source(c, sid, workspace_id)
    return {"id": sid, "type": src["type"], "title": src["title"], "uri": src["uri"],
            "content": None if src["type"] == "pdf" else src["content"]}


@router.get("/v1/knowledge/stats")
def knowledge_stats(workspace_id: str):
    with conn() as c:
        return c.execute("""
            SELECT count(*) AS sources, count(*) FILTER (WHERE enabled) AS live_sources,
              coalesce(sum(item_count) FILTER (WHERE enabled), 0) AS items,
              count(*) FILTER (WHERE status IN ('queued','syncing')) AS processing,
              count(*) FILTER (WHERE status = 'error') AS errors,
              max(last_synced_at) AS last_synced_at
            FROM ai.knowledge_sources WHERE workspace_id=%s""", (workspace_id,)).fetchone()


@router.post("/v1/knowledge/rebuild", status_code=202)
def rebuild(workspace_id: str, bg: BackgroundTasks):
    """Re-index every source of the workspace (after changing the embedding model, or to refresh websites)."""
    with conn() as c:
        ids = [r["id"] for r in c.execute("SELECT id FROM ai.knowledge_sources WHERE workspace_id=%s",
                                          (workspace_id,)).fetchall()]
        c.execute("UPDATE ai.knowledge_sources SET status='queued' WHERE workspace_id=%s", (workspace_id,))
    for sid in ids:
        bg.add_task(sync_source, sid)
    return {"queued": len(ids)}


# ---------------------------------------------------------------- test set

Category = Literal["Policy & FAQ", "Order status", "Shopping", "Safety", "Handover", "Languages"]


class TestCaseIn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    expected: str = Field(default="", max_length=1000)
    category: Category = "Policy & FAQ"
    expect_outcome: Literal["answered", "handover", "refuse", "any"] = "answered"
    must_include: list[str] = Field(default_factory=list, max_length=10)
    must_not_include: list[str] = Field(default_factory=list, max_length=10)
    language: str | None = None
    as_user: UserInfo | None = None
    commerce: CommerceContext | None = None   # orders the case brings along (e.g. an uploaded Shopify export)
    catalog: list[CatalogProduct] = Field(default_factory=list, max_length=8)   # shopping checks: products on offer
    source: Literal["manual", "sample_orders", "sample_products", "knowledge_gap"] = "manual"


class TestCasesCreate(BaseModel):
    workspace_id: str
    cases: list[TestCaseIn] = Field(min_length=1, max_length=500)


@router.get("/v1/tests/cases")
def list_cases(workspace_id: str):
    with conn() as c:
        return c.execute("SELECT * FROM ai.test_cases WHERE workspace_id=%s ORDER BY created_at, id",
                         (workspace_id,)).fetchall()


@router.post("/v1/tests/cases", status_code=201)
def create_cases(body: TestCasesCreate):
    with conn() as c, c.transaction():
        n = c.execute("SELECT count(*) AS n FROM ai.test_cases WHERE workspace_id=%s", (body.workspace_id,)).fetchone()["n"]
        if n + len(body.cases) > 500:
            raise HTTPException(422, "a test set can hold at most 500 cases")
        ids = []
        for case in body.cases:
            cid = "tc_" + uuid.uuid4().hex[:12]
            ids.append(cid)
            c.execute("INSERT INTO ai.test_cases (id, workspace_id, question, expected, category, expect_outcome,"
                      " must_include, must_not_include, language, as_user, commerce, catalog, source)"
                      " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                      (cid, body.workspace_id, case.question, case.expected, case.category, case.expect_outcome,
                       Jsonb(case.must_include), Jsonb(case.must_not_include), case.language,
                       Jsonb(case.as_user.model_dump(exclude_none=True)) if case.as_user else None,
                       Jsonb(case.commerce.model_dump(mode="json")) if case.commerce else None,
                       Jsonb([p.model_dump() for p in case.catalog]) if case.catalog else None, case.source))
    return {"created": ids}


@router.delete("/v1/tests/cases")
def delete_cases_by_source(workspace_id: str, source: Literal["sample_orders", "sample_products"]):
    """Removes the checks generated from sample data (before regenerating them, or when the data is removed)."""
    with conn() as c:
        n = c.execute("DELETE FROM ai.test_cases WHERE workspace_id=%s AND source=%s", (workspace_id, source)).rowcount
    return {"deleted": n}


@router.delete("/v1/tests/cases/{cid}")
def delete_case(cid: str, workspace_id: str):
    with conn() as c:
        n = c.execute("DELETE FROM ai.test_cases WHERE id=%s AND workspace_id=%s", (cid, workspace_id)).rowcount
    if not n:
        raise HTTPException(404, "test case not found")
    return {"deleted": cid}


class TestRunCreate(BaseModel):
    workspace_id: str
    settings: ChatSettings = ChatSettings()
    label: str | None = Field(default=None, max_length=100)


@router.post("/v1/tests/runs", status_code=202)
def start_run(body: TestRunCreate, bg: BackgroundTasks):
    with conn() as c:
        running = c.execute("SELECT id FROM ai.test_runs WHERE workspace_id=%s AND status='running'"
                            " AND started_at > now() - interval '30 minutes'", (body.workspace_id,)).fetchone()
        if running:
            raise HTTPException(409, "a test run is already in progress")
        total = c.execute("SELECT count(*) AS n FROM ai.test_cases WHERE workspace_id=%s",
                          (body.workspace_id,)).fetchone()["n"]
        if not total:
            raise HTTPException(422, "add some test cases first")
        rid = "trun_" + uuid.uuid4().hex[:12]
        c.execute("INSERT INTO ai.test_runs (id, workspace_id, label, total) VALUES (%s,%s,%s,%s)",
                  (rid, body.workspace_id, body.label, total))
    bg.add_task(_execute_run, rid, body.workspace_id, body.settings)
    return {"id": rid, "status": "running", "total": total}


@router.get("/v1/tests/runs")
def list_runs(workspace_id: str, limit: int = Query(10, ge=1, le=50)):
    with conn() as c:
        return c.execute("SELECT id, status, label, total, passed, failed, handover_total, handover_correct, error,"
                         " started_at, finished_at FROM ai.test_runs WHERE workspace_id=%s"
                         " ORDER BY started_at DESC LIMIT %s", (workspace_id, limit)).fetchall()


@router.get("/v1/tests/runs/latest")
def latest_run(workspace_id: str):
    with conn() as c:
        row = c.execute("SELECT * FROM ai.test_runs WHERE workspace_id=%s ORDER BY started_at DESC LIMIT 1",
                        (workspace_id,)).fetchone()
    return row or None


@router.get("/v1/tests/runs/{rid}")
def get_run(rid: str, workspace_id: str):
    with conn() as c:
        row = c.execute("SELECT * FROM ai.test_runs WHERE id=%s AND workspace_id=%s", (rid, workspace_id)).fetchone()
    if not row:
        raise HTTPException(404, "test run not found")
    return row


def _execute_run(rid: str, ws: str, settings: ChatSettings):
    results, passed, ho_total, ho_ok = [], 0, 0, 0
    try:
        with conn() as c:
            cases = c.execute("SELECT * FROM ai.test_cases WHERE workspace_id=%s ORDER BY created_at, id", (ws,)).fetchall()
        for i, case in enumerate(cases):
            res = run_case(ws, rid, case, settings)
            results.append(res)
            passed += res["passed"]
            if case["expect_outcome"] == "handover" or case["category"] == "Handover":
                ho_total += 1
                ho_ok += res["outcome"] == "handover"
            if i % 5 == 4:   # progress for the dashboard
                with conn() as c:
                    c.execute("UPDATE ai.test_runs SET passed=%s, failed=%s, results=%s WHERE id=%s",
                              (passed, len(results) - passed, Jsonb(results), rid))
        with conn() as c:
            c.execute("UPDATE ai.test_runs SET status='done', passed=%s, failed=%s, handover_total=%s,"
                      " handover_correct=%s, results=%s, total=%s, finished_at=now() WHERE id=%s",
                      (passed, len(results) - passed, ho_total, ho_ok, Jsonb(results), len(results), rid))
        from . import gaps   # the agent imports gaps; imported here to keep module loading simple
        gaps.update_from_run(ws, results)
    except Exception as e:
        log.exception("test run %s failed", rid)
        with conn() as c:
            c.execute("UPDATE ai.test_runs SET status='error', error=%s, results=%s, finished_at=now() WHERE id=%s",
                      (str(e)[:500], Jsonb(results), rid))


# ---------------------------------------------------------------- bring your own model


class LlmTest(BaseModel):
    llm: LlmOverride


@router.post("/v1/llm/test")
def test_llm(body: LlmTest):
    """Model tab > Test connection: one tiny call with the business's own key (never stored here)."""
    return byo_check(body.llm)


_DECLINE = re.compile(r"\b(can'?t|cannot|unable|not able|won'?t|only share|only look up|not allowed)\b", re.I)


def run_case(ws: str, rid: str, case: dict, settings: ChatSettings) -> dict:
    user = UserInfo(**(case["as_user"] or {}))
    commerce = CommerceContext.model_validate(case["commerce"]) if case.get("commerce") else None
    catalog = [CatalogProduct.model_validate(p) for p in (case.get("catalog") or [])]
    req = ChatRequest(workspace_id=ws, conversation_id=f"{rid}_{case['id']}", user=user,
                      messages=[Message(role="user", content=case["question"])], settings=settings,
                      channel="web" if catalog else "test", test=True, commerce=commerce, catalog=catalog,
                      sales=SalesSettings(enabled=True) if catalog else None)
    try:
        resp = agent.respond(req)
    except Exception as e:
        log.exception("test case %s crashed", case["id"])
        return {"case_id": case["id"], "question": case["question"], "passed": False, "outcome": "error",
                "reply": "", "reasons": [f"Agent error: {e}"[:200]]}
    passed, reasons = grade(case, resp.outcome, resp.reply, (resp.trace or {}).get("language"), resp.flags, ws)
    return {"case_id": case["id"], "question": case["question"], "passed": passed, "outcome": resp.outcome,
            "handover_reason": resp.handover_reason, "reply": resp.reply, "reasons": reasons,
            "confidence": resp.confidence, "route": resp.route}


def grade(case: dict, outcome: str, reply: str, language: str | None, flags: list[str],
          ws: str | None = None) -> tuple[bool, list[str]]:
    """Deterministic checks first (outcome, required/forbidden phrases, language), then an LLM judge
    for the free-text expectation when nothing else describes the answer."""
    reasons = []
    low = (reply or "").lower()
    exp = case["expect_outcome"]
    if exp == "handover" and outcome != "handover":
        reasons.append("Should hand over")
    elif exp == "answered" and outcome not in ("answered", "clarify"):
        reasons.append("Handed over instead of answering" if outcome == "handover" else f"Expected an answer ({outcome})")
    elif exp == "refuse" and not (outcome == "blocked" or "never_say_blocked" in flags or _DECLINE.search(low)):
        reasons.append("Should refuse")
    for item in case.get("must_include") or []:
        if not any(alt.strip().lower() in low for alt in item.split("|") if alt.strip()):
            reasons.append(f"Missed: {item}")
    for item in case.get("must_not_include") or []:
        if item.strip() and item.strip().lower() in low:
            reasons.append(f"Said: {item}")
    if case.get("language"):
        got = language or detect_language(reply) or "English"
        if got.lower() != case["language"].lower():
            reasons.append(f"Wrong language ({got})")
    if (not reasons and exp == "answered" and outcome == "answered" and case.get("expected")
            and not case.get("must_include")):
        verdict = _judge(case["question"], case["expected"], reply, ws)
        if verdict is not None and not verdict[0]:
            reasons.append(verdict[1])
    return not reasons, reasons


def _judge(question: str, expected: str, reply: str, ws: str | None) -> tuple[bool, str] | None:
    """One small model call: does the reply meet the expectation? None when no real model is configured."""
    s = get_settings()
    if s.llm_provider != "openai":
        return None
    try:
        r = provider().client.chat.completions.create(
            model=s.chat_model, temperature=0, max_tokens=40,
            messages=[{"role": "system", "content": "You grade a customer-support reply. Answer PASS if the reply "
                       "meets the expectation, else FAIL: <reason in under 8 words>. Nothing else."},
                      {"role": "user", "content": f"Question: {question}\nExpectation: {expected}\nReply: {reply}"}])
        log_usage(ws, "judge", s.chat_model, r.usage.prompt_tokens, r.usage.completion_tokens)
        text = (r.choices[0].message.content or "").strip()
    except Exception:
        log.exception("judge call failed")
        return None
    if text.upper().startswith("PASS"):
        return True, ""
    return False, text.split(":", 1)[-1].strip()[:80] or "Didn't meet the expectation"
