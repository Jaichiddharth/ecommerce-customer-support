"""Vectors of example phrases, for classifying a message by meaning with the embedding already computed for search
(so no extra model call per message). Used by order intent (app/intent.py), off-topic detection and the advanced
injection classifier (app/topics.py).

Each set is embedded once per embedding model (well under a cent), stored in ai.intent_vectors and kept in memory.
"""
import logging

from .llm import provider

log = logging.getLogger("unocx.examples")

_cache: dict[tuple[str, str], list[list[float]]] = {}


def vectors(kind: str, texts: list[str]) -> list[list[float]]:
    """Normalised vectors of `texts`, from memory, else the database, embedding only the ones not stored yet."""
    from .db import conn
    from .embed_cache import as_list, compact, provider_key

    key = provider_key()
    if (key, kind) in _cache:
        return _cache[(key, kind)]
    stored: dict[str, list[float]] = {}
    try:
        with conn() as c:
            for r in c.execute("SELECT text, embedding FROM ai.intent_vectors WHERE provider_key=%s AND kind=%s",
                               (key, kind)):
                stored[r["text"]] = as_list(r["embedding"])
    except Exception:
        log.exception("could not read stored %s vectors", kind)
    missing = [t for t in texts if t not in stored]
    if missing:
        for t, v in zip(missing, provider().embed(missing, None, "intent")):
            stored[t] = [float(x) for x in v]
        try:
            with conn() as c, c.cursor() as cur:
                cur.executemany("INSERT INTO ai.intent_vectors (provider_key, kind, text, embedding) "
                                "VALUES (%s,%s,%s,%s::vector) ON CONFLICT DO NOTHING",
                                [(key, kind, t, stored[t]) for t in missing])
        except Exception:
            log.exception("could not store %s vectors", kind)
    _cache[(key, kind)] = [compact(stored[t]) for t in texts]
    return _cache[(key, kind)]


def best(qvec: list[float], vecs: list[list[float]]) -> float:
    """Highest cosine similarity between the (normalised) question vector and the examples."""
    return max((sum(x * y for x, y in zip(qvec, v)) for v in vecs), default=0.0)


def reset():
    _cache.clear()
