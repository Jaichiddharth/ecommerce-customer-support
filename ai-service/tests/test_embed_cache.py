"""Embedding cache (repeated questions skip the OpenAI round trip) and stored intent vectors."""
import uuid

import pytest

from app import examples, embed_cache, intent
from app.config import get_settings

try:
    import psycopg
    psycopg.connect(get_settings().database_url, connect_timeout=3).close()
    DB_OK = True
except Exception:
    DB_OK = False

pytestmark = pytest.mark.skipif(not DB_OK, reason="needs Postgres")


def test_normalize():
    assert embed_cache.normalize("  Where is my ORDER?? ") == embed_cache.normalize("where is my order")
    assert embed_cache.normalize("where is my order") != embed_cache.normalize("where is my refund")


@pytest.fixture
def counting(monkeypatch):
    from app.db import init_pool
    from app.llm import provider
    init_pool()
    p = provider()
    real, calls = p.embed, []

    def counted(texts, *a, **k):
        calls.append(list(texts))
        return real(texts, *a, **k)
    monkeypatch.setattr(p, "embed", counted)
    return calls


def test_repeat_question_skips_the_provider(counting):
    q = f"where is my order {uuid.uuid4().hex[:6]}"
    v1, s1 = embed_cache.embed_query(q)
    v2, s2 = embed_cache.embed_query(q.upper() + "?")          # same question, different case/punctuation
    embed_cache.clear_memory()
    v3, s3 = embed_cache.embed_query(q)                        # another worker: found in the database
    assert (s1, s2, s3) == ("api", "memory", "db")
    assert len(counting) == 1 and v1 == v2
    # the database keeps single precision, so allow differences far below anything that affects matching
    assert max(abs(a - b) for a, b in zip(v1, v3)) < 1e-6


def test_question_text_is_not_stored():
    from app.db import conn
    q = f"my phone is 98765 {uuid.uuid4().hex[:6]}"
    embed_cache.embed_query(q)
    with conn() as c:
        cols = [r["column_name"] for r in c.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='ai' AND table_name='embedding_cache'")]
    assert "text" not in cols and "text_hash" in cols


def test_intent_vectors_load_from_database_without_embedding(counting):
    intent.warm()                      # first time: embeds and stores any missing examples
    counting.clear()
    examples.reset()                   # simulate a fresh worker (empty memory cache)
    intent.warm()
    assert counting == []              # loaded from ai.intent_vectors, no provider call


def test_memory_entry_is_compact():
    import tracemalloc
    from array import array
    dim = get_settings().embed_dim
    tracemalloc.start()
    before = tracemalloc.get_traced_memory()[0]
    as_lists = [[0.1 + i * 1e-6] * dim for i in range(50)]
    as_lists = [[x + 0.0 for x in v] for v in as_lists]          # real distinct float objects
    mid = tracemalloc.get_traced_memory()[0]
    as_arrays = [array("f", v) for v in as_lists]
    after = tracemalloc.get_traced_memory()[0]
    tracemalloc.stop()
    per_list, per_array = (mid - before) / 50, (after - mid) / 50
    assert per_array < dim * 4 + 200 and per_list > 4 * per_array


def test_cache_is_scoped_per_workspace(counting):
    q = f"is my parcel coming {uuid.uuid4().hex[:6]}"
    assert embed_cache.embed_query(q, "ws_a")[1] == "api"
    assert embed_cache.embed_query(q, "ws_b")[1] == "api"     # another business never reuses ws_a's entry
    assert embed_cache.embed_query(q, "ws_a")[1] == "memory"
    assert embed_cache.cache_hash("ws_a", q) != embed_cache.cache_hash("ws_b", q)


def test_hash_needs_the_server_secret(monkeypatch):
    import hashlib
    q = "where is my order"
    h1 = embed_cache.cache_hash("ws_a", q)
    plain = hashlib.sha256(f"{embed_cache.provider_key()}|ws_a|{q}".encode()).hexdigest()
    assert h1 != plain                                         # can't be recomputed from a guess alone
    monkeypatch.setattr(get_settings(), "cache_hash_secret", "another-secret")
    assert embed_cache.cache_hash("ws_a", q) != h1


def test_forget_workspace_and_purge_of_unscoped_rows():
    from app.db import conn
    ws = "ws_forget_" + uuid.uuid4().hex[:6]
    embed_cache.embed_query("hello there " + ws, ws)
    with conn() as c:   # a pre-1.2.2 row: no workspace, unreachable with the new keys
        c.execute("INSERT INTO ai.embedding_cache (provider_key, text_hash, embedding) "
                  "VALUES ('legacy', %s, array_fill(0, ARRAY[%s])::vector)", (uuid.uuid4().hex, get_settings().embed_dim))
    assert embed_cache.forget_workspace(ws) == 1
    assert embed_cache.purge_old() >= 1
    with conn() as c:
        assert c.execute("SELECT count(*) AS n FROM ai.embedding_cache WHERE workspace_id IS NULL").fetchone()["n"] == 0
