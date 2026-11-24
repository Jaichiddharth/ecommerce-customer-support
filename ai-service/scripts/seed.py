"""Load the sample UnoCX knowledge base and keyword flows into a workspace.

    python -m scripts.seed                 # workspace ws_unocx
    python -m scripts.seed --reset         # wipe the workspace first
    python -m scripts.seed --workspace ws_mine --dir path/to/your/help/files

Files: *.md -> markdown source, *.txt -> text, *.json -> FAQ [{"q","a"}], *.pdf -> PDF.
Runs ingestion synchronously (no server needed). In openai mode this spends a few cents on embeddings.
"""
import argparse
import json
import uuid
from pathlib import Path

from psycopg.types.json import Jsonb

from app.db import conn, init_pool
from app.ingest import pdf_to_pages, sync_source

ROOT = Path(__file__).resolve().parent.parent
START = ["Return an item", "Shipping times", "Payment options", "Talk to support"]

FLOWS = [
    dict(name="Greeting", priority=10, match_type="exact", max_words=3,
         keywords=["hi", "hii", "hello", "hey", "hlo", "namaste", "vanakkam", "good morning", "good evening"],
         reply_text="Hi {name}! I'm the UnoCX help assistant. What can I help you with today?",
         suggestions=START),
    dict(name="Thanks", priority=20, match_type="exact", max_words=5,
         keywords=["thanks", "thank you", "thx", "ty", "dhanyavaad", "shukriya", "nandri", "ok thanks"],
         reply_text="You're welcome! Is there anything else I can help with?", suggestions=[]),
    dict(name="Goodbye", priority=30, match_type="exact", max_words=4,
         keywords=["bye", "goodbye", "that's all", "thats all"],
         reply_text="Thanks for chatting with UnoCX. Have a lovely day!", suggestions=[]),
    dict(name="Track order", priority=40, match_type="fuzzy", max_words=10,
         keywords=["track my order", "where is my order", "order status", "track order", "mera order kahan hai"],
         reply_text="You can track your order from My Orders > Track, or with the tracking link we send by SMS "
                    "and email after dispatch. Tracking can take up to 24 hours to show the first update. If it "
                    "hasn't moved for more than 3 days, I can connect you with our support team.",
         suggestions=["Talk to support", "Delivery timelines"]),
    dict(name="Raise a ticket", priority=50, match_type="exact", max_words=None,
         keywords=["raise a ticket", "raise ticket", "create a ticket", "complaint form", "contact form"],
         reply_text="Sure. Fill in the form below and our support team will reply during support hours "
                    "(Monday to Saturday, 10 AM to 7 PM IST).",
         action={"type": "form", "form": "contact_support", "fields": ["name", "email", "message"]},
         suggestions=[]),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace", default="ws_unocx")
    ap.add_argument("--dir", default=str(ROOT / "knowledge"))
    ap.add_argument("--reset", action="store_true")
    ap.add_argument("--no-flows", action="store_true")
    a = ap.parse_args()
    init_pool()
    ws = a.workspace

    with conn() as c:
        if a.reset:
            for t in ("knowledge_sources", "flows", "answer_cache", "agent_runs"):
                c.execute(f"DELETE FROM ai.{t} WHERE workspace_id=%s", (ws,))
            print(f"reset workspace {ws}")

    for path in sorted(Path(a.dir).iterdir()):
        ext = path.suffix.lower()
        title = path.stem.replace("-", " ").replace("_", " ").title()
        if ext == ".md":
            typ, content = "markdown", path.read_text(encoding="utf-8")
        elif ext == ".txt":
            typ, content = "text", path.read_text(encoding="utf-8")
        elif ext == ".json":
            typ, content, title = "faq", path.read_text(encoding="utf-8"), "FAQ"
        elif ext == ".pdf":
            pages, scanned = pdf_to_pages(path.read_bytes())
            typ, content = "pdf", json.dumps({"pages": pages, "scanned": scanned})
        else:
            continue
        sid = "ks_" + uuid.uuid4().hex[:12]
        uri = f"/help/{path.stem}"
        with conn() as c:
            c.execute("INSERT INTO ai.knowledge_sources (id, workspace_id, type, title, uri, content)"
                      " VALUES (%s,%s,%s,%s,%s,%s)", (sid, ws, typ, title, uri, content))
        sync_source(sid)
        with conn() as c:
            row = c.execute("SELECT status, item_count, error FROM ai.knowledge_sources WHERE id=%s",
                            (sid,)).fetchone()
        print(f"{path.name:32} {typ:9} {row['status']:6} {row['item_count']:3} chunks"
              + (f"  ({row['error']})" if row["error"] else ""))

    if not a.no_flows:
        with conn() as c:
            for f in FLOWS:
                c.execute("INSERT INTO ai.flows (id, workspace_id, name, keywords, match_type, max_words, reply_text,"
                          " action, suggestions, priority) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                          ("fl_" + uuid.uuid4().hex[:12], ws, f["name"], f["keywords"], f["match_type"],
                           f["max_words"], f["reply_text"], Jsonb(f.get("action")) if f.get("action") else None,
                           Jsonb(f["suggestions"]), f["priority"]))
        print(f"added {len(FLOWS)} keyword flows")


if __name__ == "__main__":
    main()
