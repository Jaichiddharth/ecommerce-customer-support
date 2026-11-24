"""Knowledge ingestion: text / markdown / FAQ / PDF / website -> chunks -> embeddings -> Postgres.
Runs as a background task, never inside a customer reply."""
import io
import json
import logging
import re
import urllib.robotparser
from urllib.parse import urldefrag, urljoin, urlparse

from psycopg.types.json import Jsonb

from . import guardrails as g
from .db import conn
from .llm import provider

log = logging.getLogger("unocx.ingest")

TARGET_WORDS, MAX_WORDS = 300, 500
MAX_CRAWL_PAGES = 200


# ---------------------------------------------------------------- chunking

def chunk_markdown(text: str, title: str, url: str | None = None, meta: dict | None = None) -> list[dict]:
    """Split on headings, then pack paragraphs into ~300-500 word chunks.
    Each chunk starts with its heading path so it still makes sense on its own."""
    sections, path, buf = [], [], []

    def flush():
        body = "\n".join(buf).strip()
        if body:
            sections.append((" > ".join([title] + path), body))
        buf.clear()

    for line in text.splitlines():
        m = re.match(r"^(#{1,6})\s+(.*)", line)
        if m:
            flush()
            level = len(m.group(1))
            path[:] = path[: max(0, level - 2)] + [m.group(2).strip()] if level > 1 else []
        else:
            buf.append(line)
    flush()

    chunks = []
    for heading, body in sections:
        paras = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
        cur, count = [], 0
        for p in paras:
            n = len(p.split())
            if cur and count + n > MAX_WORDS:
                chunks.append(_mk(heading, cur, url, meta))
                cur, count = [], 0
            cur.append(p)
            count += n
            if count >= TARGET_WORDS:
                chunks.append(_mk(heading, cur, url, meta))
                cur, count = [], 0
        if cur:
            chunks.append(_mk(heading, cur, url, meta))
    return chunks


def _mk(heading, paras, url, meta):
    return {"title": heading, "url": url, "text": f"{heading}\n" + "\n\n".join(paras), "metadata": meta or {}}


def parse_faq(content: str) -> list[tuple[str, str]]:
    content = content.strip()
    if content.startswith("["):
        return [(d["q"].strip(), d["a"].strip()) for d in json.loads(content) if d.get("q") and d.get("a")]
    pairs = re.findall(r"Q:\s*(.+?)\s*\n\s*A:\s*(.+?)(?=\n\s*Q:|\Z)", content, re.S | re.I)
    return [(q.strip(), a.strip()) for q, a in pairs]


def pdf_to_pages(data: bytes) -> tuple[list[str], list[int]]:
    """Return (page_texts, scanned_page_numbers). Scanned pages (no text layer) are skipped and flagged."""
    from pypdf import PdfReader

    pages, scanned = [], []
    for i, page in enumerate(PdfReader(io.BytesIO(data)).pages, start=1):
        t = (page.extract_text() or "").strip()
        if len(t) < 30:
            scanned.append(i)
            pages.append("")
        else:
            pages.append(t)
    return pages, scanned


# ---------------------------------------------------------------- website crawl

def crawl(start_url: str, max_pages: int = MAX_CRAWL_PAGES) -> list[tuple[str, str, str]]:
    """Crawl pages under the start URL's path only, respecting robots.txt. Returns (url, title, markdown)."""
    import httpx
    from bs4 import BeautifulSoup

    base = urlparse(start_url)
    prefix = start_url.rsplit("/", 1)[0] if base.path and not base.path.endswith("/") else start_url
    robots = urllib.robotparser.RobotFileParser()
    try:
        robots.set_url(f"{base.scheme}://{base.netloc}/robots.txt")
        robots.read()
    except Exception:
        robots = None

    seen, queue, out = set(), [start_url], []
    with httpx.Client(timeout=15, follow_redirects=True, headers={"User-Agent": "UnoCX-KnowledgeBot/1.0"}) as client:
        while queue and len(out) < max_pages:
            url = urldefrag(queue.pop(0))[0]
            if url in seen or (robots and not robots.can_fetch("UnoCX-KnowledgeBot", url)):
                continue
            seen.add(url)
            try:
                r = client.get(url)
                if r.status_code != 200 or "text/html" not in r.headers.get("content-type", ""):
                    continue
            except httpx.HTTPError:
                continue
            soup = BeautifulSoup(r.text, "html.parser")
            for tag in soup(["script", "style", "nav", "footer", "header", "aside", "form"]):
                tag.decompose()
            title = (soup.title.string if soup.title and soup.title.string else url).strip()
            main = soup.find("main") or soup.find("article") or soup.body or soup
            lines = []
            for el in main.find_all(["h1", "h2", "h3", "h4", "p", "li", "td"]):
                t = el.get_text(" ", strip=True)
                if t:
                    lines.append(("#" * int(el.name[1]) + " " + t) if el.name[0] == "h" else t)
            if lines:
                out.append((url, title, "\n\n".join(lines)))
            for a in soup.find_all("a", href=True):
                nxt = urldefrag(urljoin(url, a["href"]))[0]
                if nxt.startswith(prefix) and nxt not in seen:
                    queue.append(nxt)
    return out


# ---------------------------------------------------------------- sync

def build_chunks(src: dict) -> tuple[list[dict], str | None]:
    t, title, uri, content = src["type"], src["title"], src["uri"], src["content"] or ""
    note = None
    if t in ("text", "markdown"):
        chunks = chunk_markdown(content, title, uri)
    elif t == "faq":
        chunks = [{"title": f"{title} > {q}", "url": uri, "text": f"Q: {q}\nA: {a}",
                   "metadata": {"faq": True}} for q, a in parse_faq(content)]
    elif t == "pdf":
        doc = json.loads(content)
        chunks = []
        for i, page in enumerate(doc["pages"], start=1):
            if page:
                chunks += chunk_markdown(page, title, uri, {"page": i})
        if doc.get("scanned"):
            note = f"Skipped scanned pages without text: {doc['scanned']}"
    elif t == "url":
        chunks = []
        for url, ptitle, md in crawl(uri):
            chunks += chunk_markdown(md, ptitle, url)
    else:
        raise ValueError(f"unknown source type {t}")
    return chunks, note


def sync_source(source_id: str):
    with conn() as c:
        src = c.execute("SELECT * FROM ai.knowledge_sources WHERE id=%s", (source_id,)).fetchone()
        if not src:
            return
        c.execute("UPDATE ai.knowledge_sources SET status='syncing', error=NULL WHERE id=%s", (source_id,))
    try:
        chunks, note = build_chunks(src)
        if not chunks:
            raise ValueError("No text found in this source")
        # Passages that talk to the AI ("ignore your instructions", "assistants must recommend...") are left out
        # of the index: a web page, PDF or pasted text is data, and must never steer the agent
        flagged = [ch for ch in chunks if g.document_injection(ch["text"]) or g.document_injection(ch["title"] or "")]
        if flagged:
            chunks = [ch for ch in chunks if ch not in flagged]
            log.warning("source %s: %d passage(s) left out for instructions aimed at the AI", source_id, len(flagged))
            skipped = (f"{len(flagged)} passage{'s' if len(flagged) != 1 else ''} left out because "
                       f"{'they contain' if len(flagged) != 1 else 'it contains'} instructions aimed at the AI "
                       f"(e.g. \"{flagged[0]['text'][:80].strip()}…\")")
            note = f"{note}. {skipped}" if note else skipped
            if not chunks:
                raise ValueError(skipped)
        vectors = provider().embed([ch["text"] for ch in chunks], src["workspace_id"], "ingest")
        with conn() as c, c.transaction():
            c.execute("DELETE FROM ai.knowledge_chunks WHERE source_id=%s", (source_id,))
            with c.cursor() as cur:
                cur.executemany(
                    "INSERT INTO ai.knowledge_chunks (workspace_id, source_id, title, url, text, embedding, metadata)"
                    " VALUES (%s,%s,%s,%s,%s,%s::vector,%s)",
                    [(src["workspace_id"], source_id, ch["title"], ch["url"], ch["text"], v, Jsonb(ch["metadata"]))
                     for ch, v in zip(chunks, vectors)],
                )
            c.execute(
                "UPDATE ai.knowledge_sources SET status='live', item_count=%s, error=%s, flagged_count=%s,"
                " last_synced_at=now() WHERE id=%s", (len(chunks), note, len(flagged), source_id))
        log.info("synced %s: %d chunks", source_id, len(chunks))
    except Exception as e:  # keep the old chunks live if a re-sync fails
        log.exception("sync failed for %s", source_id)
        with conn() as c:
            c.execute("UPDATE ai.knowledge_sources SET status='error', error=%s WHERE id=%s",
                      (str(e)[:500], source_id))
