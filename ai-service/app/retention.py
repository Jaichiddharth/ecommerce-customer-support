"""Data retention (platform rule): conversation text is deleted once it is older than the workspace's retention.

Each chat request carries the workspace's retention_days; `remember` stores it (only when it changes) in
ai.workspace_settings. An hourly sweep in a background thread then deletes, per workspace:
  - agent runs (questions, replies, traces) and handover state;
  - knowledge gaps not asked within the period (their wordings and the agent's replies);
  - test runs (their results hold replies);
  - complaints that are resolved (open ones are still being handled by the team).
Workspaces that never sent a value use RETENTION_DEFAULT_DAYS. One process sweeps at a time (advisory lock).
Embedding-cache rows hold only keyed hashes and vectors, and usage rows hold no text, so they are not touched here.
"""
import logging
import threading

from .config import get_settings
from .db import conn

log = logging.getLogger("unocx.retention")
SWEEP_LOCK_ID = 727_002

# (table, timestamp column, extra condition)
TABLES = [
    ("agent_runs", "created_at", ""),
    ("conversation_state", "updated_at", ""),
    ("knowledge_gaps", "last_asked", ""),
    ("test_runs", "started_at", " AND status <> 'running'"),
    ("complaints", "created_at", " AND status = 'resolved'"),
]

_known: dict[str, int | None] = {}
_stop = threading.Event()


def remember(workspace_id: str, days: int | None) -> None:
    """Records the workspace's retention when it differs from what this process last saw. Never raises."""
    if _known.get(workspace_id, -1) == days:
        return
    try:
        with conn() as c:
            c.execute("INSERT INTO ai.workspace_settings (workspace_id, retention_days) VALUES (%s,%s)"
                      " ON CONFLICT (workspace_id) DO UPDATE SET retention_days=EXCLUDED.retention_days, updated_at=now()",
                      (workspace_id, days))
        _known[workspace_id] = days
    except Exception:
        log.exception("could not record the retention setting")


def sweep() -> dict[str, int]:
    """Deletes expired rows in every table for every workspace. Returns rows deleted per table."""
    default = get_settings().retention_default_days
    deleted: dict[str, int] = {}
    with conn() as c:
        got = c.execute("SELECT pg_try_advisory_lock(%s) AS ok", (SWEEP_LOCK_ID,)).fetchone()["ok"]
        if not got:
            return deleted          # another process is sweeping
        try:
            for table, col, extra in TABLES:
                # each workspace's own retention, or the default for workspaces without one
                n = c.execute(
                    f"DELETE FROM ai.{table} t USING (SELECT DISTINCT workspace_id FROM ai.{table}) w"
                    f" LEFT JOIN ai.workspace_settings s ON s.workspace_id = w.workspace_id"
                    f" WHERE t.workspace_id = w.workspace_id"
                    f" AND t.{col} < now() - make_interval(days => coalesce(s.retention_days, %s)){extra}",
                    (default,)).rowcount
                if n:
                    deleted[table] = n
        finally:
            c.execute("SELECT pg_advisory_unlock(%s)", (SWEEP_LOCK_ID,))
    if deleted:
        log.info("retention sweep deleted %s", deleted)
    return deleted


def _loop(interval: int):
    delay = 30                       # first sweep shortly after startup, off the startup path
    while not _stop.wait(timeout=delay):
        try:
            sweep()
        except Exception:
            log.exception("retention sweep failed")
        delay = interval


def start() -> threading.Thread | None:
    s = get_settings()
    if not s.retention_sweep:
        return None
    _stop.clear()
    t = threading.Thread(target=_loop, args=(s.retention_sweep_interval_s,), name="retention-sweep", daemon=True)
    t.start()
    return t


def stop():
    _stop.set()
