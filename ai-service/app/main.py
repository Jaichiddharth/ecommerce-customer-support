"""UnoCX AI service - HTTP API for the Next.js app."""
import json
import logging
import secrets
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel
from typing import Literal

from . import admin, agent
from . import gaps as knowledge_gaps
from .security import auth
from .config import APP_VERSION, get_settings
from .db import close_pool, conn, init_pool
from .embed_cache import embed_query
from .ingest import pdf_to_pages, sync_source
from .llm import budget_ok, spent_usd
from .models import ChatRequest, ChatResponse, FeedbackRequest, FlowCreate, SourceCreate
from .router import cache_vote, invalidate_flows

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
MAX_PDF_BYTES = 20 * 1024 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI):
    problems = get_settings().production_problems()
    if problems:
        raise RuntimeError("Refusing to start in production: " + "; ".join(problems))
    init_pool()
    _warm_up()
    from . import retention
    retention.start()
    yield
    retention.stop()
    close_pool()


def _warm_up():
    """Load the order-intent vectors and tidy the embedding cache before the first customer arrives.
    Failures only log a warning: the service still works and loads the vectors on first use."""
    log = logging.getLogger("unocx.startup")
    try:
        from . import embed_cache, intent, topics
        n = intent.warm() + topics.warm()
        removed = embed_cache.purge_old()
        log.info("warm-up done: %d intent vectors ready, %d stale cached embeddings removed", n, removed)
    except Exception:
        log.warning("warm-up skipped; intent vectors will load on first use", exc_info=True)


app = FastAPI(
    title="UnoCX AI Service", version=APP_VERSION, lifespan=lifespan,
    description="Conversational AI for the UnoCX help section. Internal service: called by the UnoCX "
                "Next.js app with a service token. See docs/HANDOFF.md.",
)
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins.split(","),
                   allow_methods=["*"], allow_headers=["*"])


app.include_router(admin.router)
app.include_router(knowledge_gaps.router)


def _check_last_message(req: ChatRequest):
    if req.messages[-1].role != "user":
        raise HTTPException(422, "the last message must have role 'user'")


# ---------------------------------------------------------------- health / playground

@app.get("/health")
def health():
    s = get_settings()
    with conn() as c:
        c.execute("SELECT 1")
    return {"ok": True, "version": APP_VERSION, "env": s.app_env, "provider": s.llm_provider,
            "spent_usd": round(spent_usd(fresh=True), 4), "budget_usd": s.budget_usd, "budget_ok": budget_ok()}


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse("/playground" if get_settings().playground_enabled else "/docs")


@app.get("/playground", include_in_schema=False)
def playground():
    if not get_settings().playground_enabled:
        raise HTTPException(404, "playground is disabled (ENABLE_PLAYGROUND=false)")
    return FileResponse(Path(__file__).parent / "static" / "playground.html")


# ---------------------------------------------------------------- chat

@app.post("/v1/chat", response_model=ChatResponse, dependencies=[Depends(auth)])
def chat(req: ChatRequest):
    _check_last_message(req)
    return agent.respond(req)


@app.post("/v1/chat/stream", dependencies=[Depends(auth)])
def chat_stream(req: ChatRequest):
    """Server-sent events: `meta`, then `delta` (text pieces), then `done` (the full ChatResponse)."""
    _check_last_message(req)

    def gen():
        for event, data in agent.respond_stream(req):
            yield agent.dumps_sse(event, data)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/v1/feedback", dependencies=[Depends(auth)])
def feedback(fb: FeedbackRequest):
    with conn() as c:
        run = c.execute("SELECT * FROM ai.agent_runs WHERE id=%s AND workspace_id=%s",
                        (fb.run_id, fb.workspace_id)).fetchone()
        if not run:
            raise HTTPException(404, "run not found")
        if run["feedback"] is not None:
            return {"ok": True, "note": "feedback already recorded for this run"}
        c.execute("UPDATE ai.agent_runs SET feedback=%s, feedback_comment=%s WHERE id=%s",
                  (1 if fb.helpful else -1, fb.comment, fb.run_id))
    if run["route"] in ("rag", "cache") and run["outcome"] == "answered" and run["question"]:
        qvec, _ = embed_query(run["question"], fb.workspace_id)
        cache_vote(fb.workspace_id, run["question"], qvec, run["reply"], run["citations"], fb.helpful)
        if not fb.helpful:   # the customer said the answer didn't help: a knowledge gap
            knowledge_gaps.record(fb.workspace_id, run["conversation_id"], run["question"], qvec, reason="thumbs_down",
                        confidence=run["confidence"], reply=run["reply"], run_id=run["id"], channel=run["channel"])
    return {"ok": True}


# ---------------------------------------------------------------- knowledge

def _new_source(ws, type_, title, uri, content):
    sid = "ks_" + uuid.uuid4().hex[:12]
    with conn() as c:
        c.execute("INSERT INTO ai.knowledge_sources (id, workspace_id, type, title, uri, content)"
                  " VALUES (%s,%s,%s,%s,%s,%s)", (sid, ws, type_, title, uri, content))
    return sid


@app.post("/v1/knowledge/sources", dependencies=[Depends(auth)], status_code=202)
def add_source(src: SourceCreate, bg: BackgroundTasks):
    if src.type == "url" and not (src.uri or "").startswith(("http://", "https://")):
        raise HTTPException(422, "url sources need an http(s) uri")
    if src.type != "url" and not (src.content or "").strip():
        raise HTTPException(422, "content is required")
    sid = _new_source(src.workspace_id, src.type, src.title, src.uri, src.content)
    bg.add_task(sync_source, sid)
    return {"id": sid, "status": "queued"}


@app.post("/v1/knowledge/upload", dependencies=[Depends(auth)], status_code=202)
async def upload_pdf(bg: BackgroundTasks, workspace_id: str = Form(...), title: str = Form(...),
                     uri: str | None = Form(None), file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF larger than 20 MB")
    if not data.startswith(b"%PDF"):
        raise HTTPException(422, "file is not a PDF")
    try:
        pages, scanned = pdf_to_pages(data)
    except Exception as e:
        raise HTTPException(422, f"could not read PDF: {e}") from e
    sid = _new_source(workspace_id, "pdf", title, uri, json.dumps({"pages": pages, "scanned": scanned}))
    bg.add_task(sync_source, sid)
    return {"id": sid, "status": "queued", "pages": len(pages), "scanned_pages": scanned}


@app.get("/v1/knowledge/sources", dependencies=[Depends(auth)])
def list_sources(workspace_id: str):
    with conn() as c:
        return c.execute("SELECT id, type, title, uri, status, enabled, item_count, flagged_count, error, last_synced_at,"
                         " created_at, updated_at FROM ai.knowledge_sources WHERE workspace_id=%s ORDER BY created_at",
                         (workspace_id,)).fetchall()


@app.get("/v1/knowledge/sources/{sid}", dependencies=[Depends(auth)])
def get_source(sid: str, workspace_id: str):
    with conn() as c:
        row = c.execute("SELECT id, type, title, uri, status, item_count, error, last_synced_at, created_at"
                        " FROM ai.knowledge_sources WHERE id=%s AND workspace_id=%s", (sid, workspace_id)).fetchone()
    if not row:
        raise HTTPException(404, "source not found")
    return row


@app.post("/v1/knowledge/sources/{sid}/sync", dependencies=[Depends(auth)], status_code=202)
def resync(sid: str, workspace_id: str, bg: BackgroundTasks):
    get_source(sid, workspace_id)
    bg.add_task(sync_source, sid)
    return {"id": sid, "status": "queued"}


@app.delete("/v1/knowledge/sources/{sid}", dependencies=[Depends(auth)])
def delete_source(sid: str, workspace_id: str):
    with conn() as c:
        n = c.execute("DELETE FROM ai.knowledge_sources WHERE id=%s AND workspace_id=%s",
                      (sid, workspace_id)).rowcount
    if not n:
        raise HTTPException(404, "source not found")
    return {"deleted": sid}


# ---------------------------------------------------------------- keyword flows

@app.get("/v1/flows", dependencies=[Depends(auth)])
def list_flows(workspace_id: str):
    with conn() as c:
        return c.execute("SELECT * FROM ai.flows WHERE workspace_id=%s ORDER BY priority, created_at",
                         (workspace_id,)).fetchall()


@app.post("/v1/flows", dependencies=[Depends(auth)], status_code=201)
def create_flow(f: FlowCreate):
    fid = "fl_" + uuid.uuid4().hex[:12]
    with conn() as c:
        c.execute("INSERT INTO ai.flows (id, workspace_id, name, keywords, match_type, max_words, reply_text,"
                  " outcome, action, suggestions, priority, enabled) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                  (fid, f.workspace_id, f.name, f.keywords, f.match_type, f.max_words, f.reply_text, f.outcome,
                   Jsonb(f.action) if f.action else None, Jsonb(f.suggestions), f.priority, f.enabled))
    invalidate_flows(f.workspace_id)
    return {"id": fid}


@app.delete("/v1/flows/{fid}", dependencies=[Depends(auth)])
def delete_flow(fid: str, workspace_id: str):
    with conn() as c:
        n = c.execute("DELETE FROM ai.flows WHERE id=%s AND workspace_id=%s", (fid, workspace_id)).rowcount
    invalidate_flows(workspace_id)
    if not n:
        raise HTTPException(404, "flow not found")
    return {"deleted": fid}


# ---------------------------------------------------------------- insights

@app.get("/v1/insights/gaps", dependencies=[Depends(auth)])
def gaps(workspace_id: str, days: int = Query(30, ge=1, le=365)):
    """Questions the assistant couldn't answer or that got a thumbs-down: what to write next."""
    with conn() as c:
        return c.execute(
            "SELECT lower(question) AS question, count(*) AS times, max(created_at) AS last_asked,"
            " array_agg(DISTINCT coalesce(handover_reason, 'thumbs_down')) AS reasons"
            " FROM ai.agent_runs WHERE workspace_id=%s AND created_at > now() - make_interval(days => %s)"
            " AND (flags ? 'no_relevant_knowledge' OR feedback = -1)"
            " GROUP BY lower(question) ORDER BY times DESC, last_asked DESC LIMIT 100",
            (workspace_id, days)).fetchall()


@app.get("/v1/insights/summary", dependencies=[Depends(auth)])
def summary(workspace_id: str, days: int = Query(7, ge=1, le=365)):
    with conn() as c:
        return c.execute(
            "SELECT count(*) AS runs,"
            " count(*) FILTER (WHERE outcome='answered') AS answered,"
            " count(*) FILTER (WHERE outcome='handover') AS handovers,"
            " count(*) FILTER (WHERE route IN ('flow','cache')) AS free_answers,"
            " count(*) FILTER (WHERE feedback=1) AS thumbs_up, count(*) FILTER (WHERE feedback=-1) AS thumbs_down,"
            " coalesce(sum(cost_usd),0) AS cost_usd,"
            " percentile_cont(0.9) WITHIN GROUP (ORDER BY latency_ms) AS p90_latency_ms"
            " FROM ai.agent_runs WHERE workspace_id=%s AND created_at > now() - make_interval(days => %s)",
            (workspace_id, days)).fetchone()


@app.get("/v1/insights/quality", dependencies=[Depends(auth)])
def quality(workspace_id: str, days: int = Query(7, ge=1, le=365), low_confidence: float = Query(0.5, ge=0, le=1)):
    """Live quality metrics from real conversations (no expected answers needed).
    Shows where the assistant is weak: misses, escalations, low confidence, unsupported numbers,
    articles that collect thumbs-down, and the slowest pipeline stage."""
    p = {"ws": workspace_id, "days": days, "low": low_confidence}
    win = "workspace_id = %(ws)s AND created_at > now() - make_interval(days => %(days)s)"
    with conn() as c:
        totals = c.execute(f"""
            SELECT count(*) AS runs, count(DISTINCT conversation_id) AS conversations,
              count(*) FILTER (WHERE outcome='answered') AS answered,
              count(*) FILTER (WHERE outcome='clarify') AS clarify,
              count(*) FILTER (WHERE outcome='handover') AS handover,
              count(*) FILTER (WHERE outcome='blocked') AS blocked,
              count(*) FILTER (WHERE flags ? 'no_relevant_knowledge') AS knowledge_misses,
              count(*) FILTER (WHERE flags ? 'model_said_handover') AS model_declined,
              count(*) FILTER (WHERE flags ? 'unsupported_number') AS unsupported_numbers,
              count(*) FILTER (WHERE route='rag' AND outcome='answered' AND confidence < %(low)s) AS low_confidence_answers,
              round(avg(confidence) FILTER (WHERE route='rag' AND outcome='answered')::numeric, 3) AS avg_rag_confidence,
              count(*) FILTER (WHERE feedback IS NOT NULL) AS rated,
              count(*) FILTER (WHERE feedback = 1) AS thumbs_up, count(*) FILTER (WHERE feedback = -1) AS thumbs_down,
              coalesce(sum(cost_usd), 0) AS cost_usd,
              count(*) FILTER (WHERE route IN ('flow','cache','guardrail')) AS free_replies,
              count(*) FILTER (WHERE flags ? 'repeat_avoided') AS repeats_avoided,
              count(*) FILTER (WHERE flags ? 'customer_unhappy') AS unhappy_customers,
              count(*) FILTER (WHERE handover_reason = 'unresolved') AS unresolved_handovers,
              count(*) FILTER (WHERE flags ? 'complaint_created') AS complaints_raised,
              count(*) FILTER (WHERE flags ? 'order_issue') AS order_problems
            FROM ai.agent_runs WHERE {win}""", p).fetchone()
        routes = c.execute(f"SELECT route, count(*) AS n FROM ai.agent_runs WHERE {win} GROUP BY route ORDER BY n DESC", p).fetchall()
        reasons = c.execute(f"SELECT handover_reason AS reason, count(*) AS n FROM ai.agent_runs WHERE {win}"
                            " AND outcome='handover' GROUP BY 1 ORDER BY n DESC", p).fetchall()
        convs = c.execute(f"""
            WITH conv AS (
              SELECT conversation_id,
                bool_or(outcome='handover') AS handed_over,
                coalesce(bool_or(feedback = -1), false) AS disliked,
                (array_agg(outcome ORDER BY created_at DESC))[1] AS last_outcome,
                bool_or(outcome='clarify') AS had_clarify,
                count(*) AS turns
              FROM ai.agent_runs WHERE {win} GROUP BY conversation_id)
            SELECT count(*) AS conversations,
              count(*) FILTER (WHERE NOT handed_over AND NOT disliked AND last_outcome='answered') AS likely_resolved,
              count(*) FILTER (WHERE had_clarify AND handed_over) AS clarify_then_handover,
              round(avg(turns)::numeric, 2) AS avg_turns
            FROM conv""", p).fetchone()
        articles = c.execute(f"""
            SELECT cit->>'title' AS article, count(*) AS answers,
              count(*) FILTER (WHERE r.feedback = 1) AS thumbs_up, count(*) FILTER (WHERE r.feedback = -1) AS thumbs_down,
              round(avg(r.confidence)::numeric, 3) AS avg_confidence,
              count(*) FILTER (WHERE r.flags ? 'unsupported_number') AS unsupported_numbers
            FROM ai.agent_runs r, jsonb_array_elements(r.citations) cit
            WHERE r.{win.replace('created_at', 'r.created_at')} AND r.route IN ('rag','cache')
            GROUP BY 1 ORDER BY thumbs_down DESC, avg_confidence ASC NULLS LAST, answers DESC LIMIT 20""", p).fetchall()
        stages = c.execute(f"""
            SELECT t.key AS stage, count(*) AS n,
              round(percentile_cont(0.5) WITHIN GROUP (ORDER BY t.value::float)::numeric, 1) AS p50_ms,
              round(percentile_cont(0.9) WITHIN GROUP (ORDER BY t.value::float)::numeric, 1) AS p90_ms
            FROM ai.agent_runs r, jsonb_each_text(r.trace->'timings_ms') t
            WHERE r.{win.replace('created_at', 'r.created_at')} GROUP BY 1 ORDER BY p90_ms DESC""", p).fetchall()
        problems = c.execute(f"""
            SELECT trace->'tool'->>'issue' AS problem, count(*) AS n FROM ai.agent_runs
            WHERE {win} AND flags ? 'order_issue' GROUP BY 1 ORDER BY n DESC""", p).fetchall()
        low = c.execute(f"""
            SELECT id AS run_id, conversation_id, question, reply, confidence, flags, created_at FROM ai.agent_runs
            WHERE {win} AND (
                  (route='rag' AND outcome='answered'
                   AND (confidence < %(low)s OR flags ? 'unsupported_number' OR feedback = -1))
               OR flags ? 'repeat_avoided' OR flags ? 'customer_unhappy' OR handover_reason = 'unresolved')
            ORDER BY created_at DESC LIMIT 20""", p).fetchall()

    n, a = totals["runs"] or 0, totals["answered"] or 0

    def rate(x, d):
        return round(x / d, 4) if d else None
    return {
        "window_days": days,
        "rates": {
            "answer_rate": rate(a, n), "handover_rate": rate(totals["handover"], n),
            "knowledge_miss_rate": rate(totals["knowledge_misses"], n),
            "free_reply_share": rate(totals["free_replies"], n),
            "likely_resolution_rate": rate(convs["likely_resolved"], convs["conversations"]),
            "clarify_then_handover_rate": rate(convs["clarify_then_handover"], convs["conversations"]),
            "thumbs_down_rate": rate(totals["thumbs_down"], totals["rated"]),
            "low_confidence_answer_rate": rate(totals["low_confidence_answers"], a),
            "unsupported_number_rate": rate(totals["unsupported_numbers"], a),
            "cost_per_answer_usd": round(float(totals["cost_usd"]) / a, 6) if a else None,
            "repeat_avoided_rate": rate(totals["repeats_avoided"], n),
            "unhappy_customer_rate": rate(totals["unhappy_customers"], n),
            "unresolved_handover_rate": rate(totals["unresolved_handovers"], n),
        },
        "totals": totals, "conversations": convs, "routes": routes, "handover_reasons": reasons,
        "articles": articles, "latency_by_stage": stages, "order_problems": problems, "review_queue": low,
    }


# ---------------------------------------------------------------- complaints

class ComplaintUpdate(BaseModel):
    workspace_id: str
    status: Literal["open", "in_progress", "resolved"]


@app.get("/v1/complaints", dependencies=[Depends(auth)])
def list_complaints(workspace_id: str, status: str | None = Query(None, pattern="^(open|in_progress|resolved)$"),
                    limit: int = Query(50, ge=1, le=500)):
    """Complaints the AI raised for this business's team, newest first."""
    sql = ("SELECT reference, customer_ref, order_number, category, summary, status, conversation_id, run_id, "
           "created_at, updated_at FROM ai.complaints WHERE workspace_id=%s")
    params: list = [workspace_id]
    if status:
        sql += " AND status=%s"
        params.append(status)
    with conn() as c:
        return c.execute(sql + " ORDER BY id DESC LIMIT %s", (*params, limit)).fetchall()


@app.patch("/v1/complaints/{reference}", dependencies=[Depends(auth)])
def update_complaint(reference: str, body: ComplaintUpdate):
    with conn() as c:
        row = c.execute("UPDATE ai.complaints SET status=%s, updated_at=now() WHERE reference=%s AND workspace_id=%s "
                        "RETURNING reference, status", (body.status, reference, body.workspace_id)).fetchone()
    if not row:
        raise HTTPException(404, "complaint not found")
    return row


class ResumeRequest(BaseModel):
    workspace_id: str
    conversation_id: str


@app.post("/v1/conversations/resume", dependencies=[Depends(auth)])
def resume_conversation(body: ResumeRequest):
    """Let the AI reply again in a conversation that was handed to a person."""
    from .dialogue import set_state
    set_state(body.workspace_id, body.conversation_id, "ai", None)
    return {"ok": True}
