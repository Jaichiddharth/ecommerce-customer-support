"""Hybrid search: pgvector similarity + Postgres full-text, merged with reciprocal rank fusion.
Full text catches exact terms (policy names, product names, numbers) that vectors can miss."""
from .db import conn

RRF_K = 60

_VEC_SQL = """
SELECT id, source_id, title, url, text, 1 - (embedding <=> %(qv)s::vector) AS sim
FROM ai.knowledge_chunks
WHERE workspace_id = %(ws)s {src}
ORDER BY embedding <=> %(qv)s::vector
LIMIT %(n)s
"""

_FTS_SQL = """
WITH q AS (
  SELECT to_tsquery('english', string_agg(quote_literal(lexeme), ' | ')) AS tq
  FROM unnest(to_tsvector('english', %(q)s))
)
SELECT c.id, c.source_id, c.title, c.url, c.text,
       1 - (c.embedding <=> %(qv)s::vector) AS sim, ts_rank_cd(c.tsv, q.tq) AS rank
FROM ai.knowledge_chunks c, q
WHERE q.tq IS NOT NULL AND c.workspace_id = %(ws)s {src} AND c.tsv @@ q.tq
ORDER BY rank DESC
LIMIT %(n)s
"""


def search(workspace_id: str, query: str, query_vec: list[float], source_ids: list[str] | None = None,
           page_path: str | None = None, top_k: int = 5, pool: int = 20) -> list[dict]:
    # Sources switched off in the dashboard (drafts) are never used for answers.
    src = ("AND source_id IN (SELECT id FROM ai.knowledge_sources WHERE workspace_id = %(ws)s AND enabled)"
           + (" AND source_id = ANY(%(src)s)" if source_ids else ""))
    params = {"ws": workspace_id, "q": query, "qv": query_vec, "n": pool, "src": source_ids}
    with conn() as c:
        vec = c.execute(_VEC_SQL.format(src=src), params).fetchall()
        fts = c.execute(_FTS_SQL.format(src=src.replace("source_id", "c.source_id")), params).fetchall()

    merged: dict[int, dict] = {}
    for ranked, key in ((vec, "vec_rank"), (fts, "fts_rank")):
        for i, row in enumerate(ranked):
            item = merged.setdefault(row["id"], {**row, "score": 0.0, "vec_rank": None, "fts_rank": None})
            item[key] = i + 1
            item["score"] += 1.0 / (RRF_K + i + 1)

    # Small boost for chunks related to the page the user is on (e.g. /help/returns).
    segs = [s for s in (page_path or "").lower().strip("/").split("/") if len(s) > 3]
    for item in merged.values():
        hay = f"{item['title']} {item['url'] or ''}".lower()
        if any(s in hay for s in segs):
            item["score"] += 0.004

    results = sorted(merged.values(), key=lambda r: -r["score"])[:top_k]
    for r in results:
        r["sim"] = float(r["sim"])
        r.pop("rank", None)
    return results
