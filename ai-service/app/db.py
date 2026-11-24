"""Postgres access. The Python service owns the `ai` schema; Next.js owns everything else."""
from contextlib import contextmanager

from pgvector.psycopg import register_vector
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import get_settings

_pool: ConnectionPool | None = None
SCHEMA_LOCK_ID = 727_001  # arbitrary constant shared by all UnoCX AI processes

SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS ai;

CREATE TABLE IF NOT EXISTS ai.knowledge_sources (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    type          TEXT NOT NULL CHECK (type IN ('text','markdown','faq','pdf','url')),
    title         TEXT NOT NULL,
    uri           TEXT,
    content       TEXT,
    status        TEXT NOT NULL DEFAULT 'queued',
    item_count    INT  NOT NULL DEFAULT 0,
    error         TEXT,
    last_synced_at TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai.knowledge_chunks (
    id            BIGSERIAL PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    source_id     TEXT NOT NULL REFERENCES ai.knowledge_sources(id) ON DELETE CASCADE,
    title         TEXT,
    url           TEXT,
    text          TEXT NOT NULL,
    embedding     vector({dim}) NOT NULL,
    tsv           tsvector GENERATED ALWAYS AS (
                    to_tsvector('english', coalesce(title,'') || ' ' || text)) STORED,
    metadata      JSONB NOT NULL DEFAULT '{{}}'
);
CREATE INDEX IF NOT EXISTS chunks_ws_idx  ON ai.knowledge_chunks (workspace_id, source_id);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON ai.knowledge_chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_vec_idx ON ai.knowledge_chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS ai.flows (
    id            TEXT PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    name          TEXT NOT NULL,
    keywords      TEXT[] NOT NULL,
    match_type    TEXT NOT NULL DEFAULT 'exact' CHECK (match_type IN ('exact','fuzzy')),
    max_words     INT,
    reply_text    TEXT NOT NULL,
    outcome       TEXT NOT NULL DEFAULT 'answered',
    action        JSONB,
    suggestions   JSONB NOT NULL DEFAULT '[]',
    priority      INT NOT NULL DEFAULT 100,
    enabled       BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ai.answer_cache (
    id            BIGSERIAL PRIMARY KEY,
    workspace_id  TEXT NOT NULL,
    question      TEXT NOT NULL,
    embedding     vector({dim}) NOT NULL,
    answer        TEXT NOT NULL,
    citations     JSONB NOT NULL DEFAULT '[]',
    votes         INT NOT NULL DEFAULT 0,
    disabled      BOOLEAN NOT NULL DEFAULT false,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cache_vec_idx ON ai.answer_cache USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS ai.agent_runs (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    user_id         TEXT,
    question        TEXT,
    outcome         TEXT NOT NULL,
    handover_reason TEXT,
    route           TEXT NOT NULL,
    reply           TEXT,
    citations       JSONB NOT NULL DEFAULT '[]',
    flags           JSONB NOT NULL DEFAULT '[]',
    model           TEXT,
    input_tokens    INT NOT NULL DEFAULT 0,
    output_tokens   INT NOT NULL DEFAULT 0,
    cost_usd        NUMERIC(12,6) NOT NULL DEFAULT 0,
    latency_ms      INT,
    feedback        SMALLINT,
    feedback_comment TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE ai.agent_runs ADD COLUMN IF NOT EXISTS trace JSONB NOT NULL DEFAULT '{{}}';
ALTER TABLE ai.agent_runs ADD COLUMN IF NOT EXISTS confidence REAL;
CREATE INDEX IF NOT EXISTS runs_conv_idx ON ai.agent_runs (workspace_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS runs_user_idx ON ai.agent_runs (workspace_id, user_id, created_at);

-- Embeddings of customer questions, reused for repeated questions (saves an OpenAI round trip).
-- Only a keyed hash (HMAC) of the normalised question is stored, never the text.
CREATE TABLE IF NOT EXISTS ai.embedding_cache (
    provider_key  TEXT NOT NULL,
    text_hash     TEXT NOT NULL,
    embedding     vector({dim}) NOT NULL,
    hits          INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_key, text_hash)
);
-- 1.2.2: entries are scoped per workspace (the hash is keyed with a server secret and the workspace)
ALTER TABLE ai.embedding_cache ADD COLUMN IF NOT EXISTS workspace_id TEXT;
CREATE INDEX IF NOT EXISTS embedding_cache_ws_idx ON ai.embedding_cache (workspace_id);

-- Vectors of the order-intent example questions (app/intent.py), embedded once and loaded at startup.
CREATE TABLE IF NOT EXISTS ai.intent_vectors (
    provider_key  TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('order','policy')),
    text          TEXT NOT NULL,
    embedding     vector({dim}) NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (provider_key, kind, text)
);

-- Complaints raised by the AI for a business's team (e.g. an order marked delivered but not received).
-- The business reads them with GET /v1/complaints, or from the chat reply's action, and handles them.
CREATE TABLE IF NOT EXISTS ai.complaints (
    id              BIGSERIAL PRIMARY KEY,
    reference       TEXT GENERATED ALWAYS AS ('CMP-' || lpad(id::text, 6, '0')) STORED,
    workspace_id    TEXT NOT NULL,
    customer_ref    TEXT,
    order_number    TEXT,
    category        TEXT NOT NULL,
    summary         TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')),
    conversation_id TEXT,
    run_id          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS complaints_reference_idx ON ai.complaints (reference);
CREATE INDEX IF NOT EXISTS complaints_ws_idx ON ai.complaints (workspace_id, status, created_at DESC);

-- Per conversation: has it been handed to a person? While handed over, the AI stays quiet.
CREATE TABLE IF NOT EXISTS ai.conversation_state (
    workspace_id    TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('ai','handed_over')),
    reason          TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, conversation_id)
);

-- Every OpenAI call (chat and embeddings, including ingestion) is recorded here for the budget guard.
CREATE TABLE IF NOT EXISTS ai.usage_log (
    id            BIGSERIAL PRIMARY KEY,
    workspace_id  TEXT,
    kind          TEXT NOT NULL,
    model         TEXT NOT NULL,
    input_tokens  INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    cost_usd      NUMERIC(12,6) NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Dashboard additions (v1.1): draft/live knowledge, channel per run, per-workspace test set.
ALTER TABLE ai.knowledge_sources ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE ai.knowledge_sources ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE ai.agent_runs ADD COLUMN IF NOT EXISTS channel TEXT;
CREATE INDEX IF NOT EXISTS runs_ws_time_idx ON ai.agent_runs (workspace_id, created_at);

CREATE TABLE IF NOT EXISTS ai.test_cases (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT NOT NULL,
    question        TEXT NOT NULL,
    expected        TEXT NOT NULL DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'Policy & FAQ',
    expect_outcome  TEXT NOT NULL DEFAULT 'answered' CHECK (expect_outcome IN ('answered','handover','refuse','any')),
    must_include    JSONB NOT NULL DEFAULT '[]',
    must_not_include JSONB NOT NULL DEFAULT '[]',
    language        TEXT,
    as_user         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS test_cases_ws_idx ON ai.test_cases (workspace_id, created_at);
-- order data a case brings along (uploaded Shopify orders), sent as the chat's commerce context
ALTER TABLE ai.test_cases ADD COLUMN IF NOT EXISTS commerce JSONB;
-- products a shopping check brings along, and where a check came from (written by hand, or generated from
-- the workspace's sample orders / sample products and replaced when those are uploaded again)
ALTER TABLE ai.test_cases ADD COLUMN IF NOT EXISTS catalog JSONB;
ALTER TABLE ai.test_cases ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';

CREATE TABLE IF NOT EXISTS ai.test_runs (
    id               TEXT PRIMARY KEY,
    workspace_id     TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','error')),
    label            TEXT,
    total            INT NOT NULL DEFAULT 0,
    passed           INT NOT NULL DEFAULT 0,
    failed           INT NOT NULL DEFAULT 0,
    handover_total   INT NOT NULL DEFAULT 0,
    handover_correct INT NOT NULL DEFAULT 0,
    results          JSONB NOT NULL DEFAULT '[]',
    error            TEXT,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS test_runs_ws_idx ON ai.test_runs (workspace_id, started_at DESC);

-- Knowledge gaps (v1.4): help questions the agent couldn't answer, or answered with low confidence, grouped by
-- meaning. The business writes the answer (added to a Knowledge FAQ and to the checks); the question is then
-- asked again to confirm the agent now answers it well.
CREATE TABLE IF NOT EXISTS ai.knowledge_gaps (
    id                  TEXT PRIMARY KEY,
    workspace_id        TEXT NOT NULL,
    question_key        TEXT NOT NULL,
    question            TEXT NOT NULL,
    examples            JSONB NOT NULL DEFAULT '[]',
    embedding           vector({dim}),
    reasons             JSONB NOT NULL DEFAULT '[]',
    times               INT NOT NULL DEFAULT 1,
    confidence          REAL,
    min_confidence      REAL,
    last_reply          TEXT,
    last_run_id         TEXT,
    last_channel        TEXT,
    status              TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','ignored')),
    answer              TEXT,
    test_case_id        TEXT,
    knowledge_source_id TEXT,
    resolved_at         TIMESTAMPTZ,
    retest_status       TEXT CHECK (retest_status IN ('pending','done','error')),
    retest_confidence   REAL,
    retest_outcome      TEXT,
    retest_reply        TEXT,
    retest_passed       BOOLEAN,
    retested_at         TIMESTAMPTZ,
    reopened            BOOLEAN NOT NULL DEFAULT false,
    first_asked         TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_asked          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS knowledge_gaps_key_idx ON ai.knowledge_gaps (workspace_id, question_key);
-- v1.5: example-phrase vectors also for off-topic detection and the injection classifier (app/examples.py)
ALTER TABLE ai.intent_vectors DROP CONSTRAINT IF EXISTS intent_vectors_kind_check;
ALTER TABLE ai.intent_vectors ADD CONSTRAINT intent_vectors_kind_check
    CHECK (kind IN ('order','policy','business','off_topic','injection'));
-- passages left out of the index because they carried instructions aimed at the AI (app/ingest.py)
ALTER TABLE ai.knowledge_sources ADD COLUMN IF NOT EXISTS flagged_count INT NOT NULL DEFAULT 0;
-- retention per workspace, remembered from the policy sent with each chat (app/retention.py)
CREATE TABLE IF NOT EXISTS ai.workspace_settings (
    workspace_id    TEXT PRIMARY KEY,
    retention_days  INT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS knowledge_gaps_ws_idx ON ai.knowledge_gaps (workspace_id, status, last_asked DESC);
"""


def _configure(conn):
    register_vector(conn)


def init_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        s = get_settings()
        # Make sure the extension exists before register_vector runs on pooled connections.
        import psycopg

        with psycopg.connect(s.database_url, autocommit=True) as c:
            # Several API workers start at once. "IF NOT EXISTS" is not safe against concurrent
            # creation in Postgres, so serialise schema setup with an advisory lock.
            c.execute("SELECT pg_advisory_lock(%s)", (SCHEMA_LOCK_ID,))
            try:
                c.execute("CREATE EXTENSION IF NOT EXISTS vector")
                c.execute(SCHEMA_SQL.format(dim=s.embed_dim))
            finally:
                c.execute("SELECT pg_advisory_unlock(%s)", (SCHEMA_LOCK_ID,))
        _pool = ConnectionPool(
            s.database_url, min_size=1, max_size=10, configure=_configure,
            kwargs={"row_factory": dict_row, "autocommit": True}, open=True,
        )
    return _pool


def close_pool():
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def conn():
    with init_pool().connection() as c:
        yield c
