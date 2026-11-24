"""Reuse embeddings of repeated customer questions.

Customers ask the same things in the same words ("where is my order", "refund status"). Each
question needs an embedding (for search and order-intent matching), and getting one from OpenAI is a
network round trip of roughly 0.3–2 s. This cache returns a stored embedding instead:

  memory (this worker, most recent questions)  ->  database (shared by all workers)  ->  OpenAI

Memory: vectors are kept as compact float32 arrays (about 6 KB each for 1536 dimensions), at most
MEMORY_MAX per worker, least recently used dropped first.

Privacy: entries are scoped per workspace, and the database stores an HMAC of the normalised
question (keyed with a server secret and the workspace id) plus its vector. The question text is
never stored, and without the secret a guessed question can't be checked against the table.
"""
import hashlib
import hmac
import logging
import re
import threading
from array import array
from collections import OrderedDict

from .config import get_settings
from .db import conn
from .llm import provider

log = logging.getLogger("unocx.embed_cache")

MEMORY_MAX = 5000
RETENTION_DAYS = 60
_mem: "OrderedDict[str, array]" = OrderedDict()
_lock = threading.Lock()


def as_list(v) -> list[float]:
    """pgvector returns a Vector object (or a numpy array, depending on the install); make it a list."""
    if hasattr(v, "to_list"):
        return [float(x) for x in v.to_list()]
    if hasattr(v, "tolist"):
        return [float(x) for x in v.tolist()]
    return [float(x) for x in v]


def compact(v) -> array:
    """float32 array: ~4 bytes per number instead of ~32 for a Python list of floats."""
    return array("f", v)


def provider_key() -> str:
    p = provider()
    return f"{type(p).__name__}:{getattr(p, 'embed_model', '')}:{get_settings().embed_dim}"


def normalize(text: str) -> str:
    """'  Where is my ORDER?? ' and 'where is my order' share one cache entry."""
    t = re.sub(r"\s+", " ", (text or "").lower()).strip()
    return re.sub(r"[\s.!?,;:]+$", "", t)


def _secret() -> bytes:
    s = get_settings()
    base = s.cache_hash_secret or ("unocx-embedding-cache|" + s.service_token)
    return hashlib.sha256(base.encode()).digest()


def cache_hash(workspace_id: str | None, text: str) -> str:
    msg = f"{provider_key()}|{workspace_id or ''}|{normalize(text)}".encode()
    return hmac.new(_secret(), msg, hashlib.sha256).hexdigest()


def _remember(h: str, vec: array):
    with _lock:
        _mem[h] = vec
        _mem.move_to_end(h)
        while len(_mem) > MEMORY_MAX:
            _mem.popitem(last=False)


def embed_query(text: str, workspace_id: str | None = None) -> tuple[list[float], str]:
    """Embedding for a customer question, and where it came from: 'memory', 'db' or 'api'."""
    key, h = provider_key(), cache_hash(workspace_id, text)
    with _lock:
        vec = _mem.get(h)
        if vec is not None:
            _mem.move_to_end(h)
    if vec is not None:
        return vec.tolist(), "memory"
    try:
        with conn() as c:
            row = c.execute("SELECT embedding FROM ai.embedding_cache WHERE provider_key=%s AND text_hash=%s",
                            (key, h)).fetchone()
            if row:
                c.execute("UPDATE ai.embedding_cache SET hits = hits + 1, last_used_at = now() "
                          "WHERE provider_key=%s AND text_hash=%s", (key, h))
                vec = compact(as_list(row["embedding"]))
                _remember(h, vec)
                return vec.tolist(), "db"
    except Exception:
        log.exception("embedding cache read failed; calling the provider")
    vec = compact(provider().embed([text], workspace_id, "query")[0])
    _remember(h, vec)
    try:
        with conn() as c:
            c.execute("INSERT INTO ai.embedding_cache (provider_key, text_hash, workspace_id, embedding) "
                      "VALUES (%s,%s,%s,%s::vector) ON CONFLICT DO NOTHING", (key, h, workspace_id, vec.tolist()))
    except Exception:
        log.exception("embedding cache write failed")
    return vec.tolist(), "api"


def purge_old() -> int:
    """Startup clean-up: entries unused for RETENTION_DAYS, and pre-1.2.2 entries (unscoped, unreachable)."""
    with conn() as c:
        return c.execute("DELETE FROM ai.embedding_cache WHERE workspace_id IS NULL "
                         "OR last_used_at < now() - make_interval(days => %s)", (RETENTION_DAYS,)).rowcount


def forget_workspace(workspace_id: str) -> int:
    """Remove one workspace's cached embeddings (e.g. when a business leaves)."""
    with _lock:
        _mem.clear()  # memory keys are hashes, so clear it all; it refills from the database
    with conn() as c:
        return c.execute("DELETE FROM ai.embedding_cache WHERE workspace_id=%s", (workspace_id,)).rowcount


def memory_entries() -> int:
    return len(_mem)


def clear_memory():
    with _lock:
        _mem.clear()
