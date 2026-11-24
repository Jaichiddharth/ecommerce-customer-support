"""Cheap-first routing: exact keyword -> fuzzy keyword -> semantic cache.
Only messages that pass through all three reach the LLM, which saves money and time."""
import re
import time

from psycopg.types.json import Jsonb
from rapidfuzz import fuzz

from .config import get_settings
from .db import conn

FUZZY_THRESHOLD = 85
_flow_cache: dict[str, tuple[float, list[dict]]] = {}
FLOW_TTL_S = 30


def norm(text: str) -> str:
    text = re.sub(r"[^\w\s\u0900-\u097F\u0B80-\u0BFF']", " ", text.lower())
    return re.sub(r"\s+", " ", text).strip()


def load_flows(workspace_id: str) -> list[dict]:
    hit = _flow_cache.get(workspace_id)
    if hit and time.time() - hit[0] < FLOW_TTL_S:
        return hit[1]
    with conn() as c:
        flows = c.execute(
            "SELECT * FROM ai.flows WHERE workspace_id=%s AND enabled ORDER BY priority, created_at",
            (workspace_id,)).fetchall()
    _flow_cache[workspace_id] = (time.time(), flows)
    return flows


def invalidate_flows(workspace_id: str):
    _flow_cache.pop(workspace_id, None)


def keyword_hit(message: str, keyword: str, fuzzy: bool) -> bool:
    msg, kw = norm(message), norm(keyword)
    if not kw:
        return False
    if re.search(rf"(?<!\w){re.escape(kw)}(?!\w)", msg):
        return True
    if not fuzzy or len(kw) < 4:          # short keywords ("hi") are exact-only: avoids "hi" ~ "his"
        return False
    toks, n = msg.split(), len(kw.split())
    for size in {max(1, n - 1), n, n + 1}:
        for i in range(0, max(1, len(toks) - size + 1)):
            if fuzz.ratio(" ".join(toks[i:i + size]), kw) >= FUZZY_THRESHOLD:
                return True
    return False


def match_flow(workspace_id: str, message: str, flows: list[dict] | None = None) -> dict | None:
    words = norm(message).split()
    for f in flows if flows is not None else load_flows(workspace_id):
        if f.get("max_words") and len(words) > f["max_words"]:
            continue
        if any(keyword_hit(message, k, f["match_type"] == "fuzzy") for k in f["keywords"]):
            return f
    return None


# ---------------------------------------------------------------- semantic answer cache

def cache_lookup(workspace_id: str, qvec: list[float]) -> dict | None:
    s = get_settings()
    with conn() as c:
        row = c.execute(
            "SELECT id, answer, citations, 1 - (embedding <=> %s::vector) AS sim FROM ai.answer_cache"
            " WHERE workspace_id=%s AND NOT disabled AND votes >= %s"
            " ORDER BY embedding <=> %s::vector LIMIT 1",
            (qvec, workspace_id, s.cache_min_votes, qvec)).fetchone()
    return row if row and row["sim"] >= s.cache_similarity else None


def cache_vote(workspace_id: str, question: str, qvec: list[float], answer: str, citations: list, helpful: bool):
    """Thumbs up adds a vote (served from cache once votes >= CACHE_MIN_VOTES).
    Thumbs down removes a vote and disables the entry after two net downvotes."""
    with conn() as c:
        row = c.execute(
            "SELECT id, votes FROM ai.answer_cache WHERE workspace_id=%s AND answer=%s"
            " ORDER BY embedding <=> %s::vector LIMIT 1", (workspace_id, answer, qvec)).fetchone()
        if row:
            votes = row["votes"] + (1 if helpful else -1)
            c.execute("UPDATE ai.answer_cache SET votes=%s, disabled=%s WHERE id=%s",
                      (votes, votes <= -2, row["id"]))
        elif helpful:
            c.execute(
                "INSERT INTO ai.answer_cache (workspace_id, question, embedding, answer, citations, votes)"
                " VALUES (%s,%s,%s::vector,%s,%s,1)", (workspace_id, question, qvec, answer, Jsonb(citations)))
