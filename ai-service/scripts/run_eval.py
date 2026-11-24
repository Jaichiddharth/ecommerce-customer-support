"""Run tests/eval_cases.yaml against the chat API and write a report.

    python -m scripts.run_eval                              # in-process (needs DATABASE_URL), provider from .env
    python -m scripts.run_eval --api http://localhost:8000  # against a running server
    python -m scripts.run_eval --only H,X                   # categories by id prefix
    python -m scripts.run_eval --include-llm-only           # force llm_only cases even in fake mode
    python -m scripts.run_eval --repeat 3                   # run each case 3x to measure stability
    python -m scripts.run_eval --baseline eval_results/20261109-101500.json   # compare (default: previous run)

Reports go to eval_results/<timestamp>.md and .json. The report says which pipeline stage caused each
failure and what to change. Re-run after every prompt, model, threshold or content change.
"""
import argparse
import json
import re
import time
import uuid
from datetime import datetime
from pathlib import Path

import yaml

from app import evaluation as ev

ROOT = Path(__file__).resolve().parent.parent


class Client:
    def __init__(self, api: str | None, token: str):
        self.h = {"Authorization": f"Bearer {token}"}
        if api:
            import httpx
            self.c = httpx.Client(base_url=api, timeout=60)
            self._ctx = None
        else:
            from fastapi.testclient import TestClient

            from app.main import app
            self._ctx = TestClient(app)
            self.c = self._ctx.__enter__()

    def post(self, path, body):
        r = self.c.post(path, json=body, headers=self.h)
        if r.status_code >= 400:
            raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
        return r.json()

    def close(self):
        if self._ctx:
            self._ctx.__exit__(None, None, None)


def check(expect: dict, r: dict) -> list[str]:
    errs = []
    reply = (r.get("reply") or "")
    low = reply.lower()

    def allowed(v):
        return v if isinstance(v, list) else [v]

    if "outcome" in expect and r["outcome"] not in allowed(expect["outcome"]):
        errs.append(f"outcome={r['outcome']} expected {expect['outcome']}")
    if "route" in expect and r["route"] not in allowed(expect["route"]):
        errs.append(f"route={r['route']} expected {expect['route']}")
    if "not_route" in expect and r["route"] == expect["not_route"]:
        errs.append(f"route should not be {expect['not_route']}")
    if "handover_reason" in expect and r.get("handover_reason") != expect["handover_reason"]:
        errs.append(f"handover_reason={r.get('handover_reason')} expected {expect['handover_reason']}")
    if "action_type" in expect and (r.get("action") or {}).get("type") != expect["action_type"]:
        errs.append(f"action type {(r.get('action') or {}).get('type')} expected {expect['action_type']}")
    if "action_form" in expect and (r.get("action") or {}).get("form") != expect["action_form"]:
        errs.append(f"action form missing ({expect['action_form']})")
    for f in expect.get("flags_include", []):
        if f not in r.get("flags", []):
            errs.append(f"flag {f} missing (got {r.get('flags')})")
    if expect.get("citation") and not r.get("citations"):
        errs.append("no citation")
    if "contains_any" in expect and not any(s.lower() in low for s in expect["contains_any"]):
        errs.append(f"reply lacks any of {expect['contains_any']}")
    for s in expect.get("contains_all", []):
        if s.lower() not in low:
            errs.append(f"reply lacks {s!r}")
    for s in expect.get("not_contains", []):
        if s.lower() in low:
            errs.append(f"reply contains forbidden {s!r}")
    if "not_matches" in expect and re.search(expect["not_matches"], reply):
        errs.append(f"reply matches forbidden pattern {expect['not_matches']!r}")
    if "language" in expect and (r.get("trace") or {}).get("language") != expect["language"]:
        errs.append(f"reply language={(r.get('trace') or {}).get('language')} expected {expect['language']}")
    if r["outcome"] == "answered" and len(reply) > 900:
        errs.append(f"reply too long ({len(reply)} chars)")
    return errs


def run_case(client, case, tag, ws, run_no=1):
    conv = f"eval-{tag}-{case['id']}-r{run_no}"
    user = dict(case.get("user") or {})
    if user.get("id") and not case.get("keep_user_id"):   # order cases use real store customer ids
        user["id"] = f"{user['id']}-{tag}-r{run_no}"
    base = {"workspace_id": ws, "conversation_id": conv, "user": user, "settings": case.get("settings") or {}}
    if case.get("page"):
        base["page"] = case["page"]
    history = list(case.get("history") or [])
    steps = case.get("steps") or [{"message": _msg(case), "expect": case.get("expect", {}),
                                   "repeat": case.get("repeat", 1)}]
    results = []
    for i, step in enumerate(steps, start=1):
        r = None
        for _ in range(step.get("repeat", 1)):
            msgs = history + [{"role": "user", "content": step["message"]}]
            t = time.time()
            r = client.post("/v1/chat", {**base, "messages": msgs})
            r["_wall_ms"] = int((time.time() - t) * 1000)
        expect = step.get("expect", {})
        errs = check(expect, r)
        # A conversation must never repeat the bot's previous reply (loops leave customers stuck).
        prev_bot = results[-1]["reply"] if results else None
        # Offline, the stand-in model copies article sentences, so a follow-up answered from the same article
        # looks identical; help answers are held to this check when the real model runs.
        offline_article = r["route"] == "rag" and (r.get("usage") or {}).get("model") == "fake-chat"
        if prev_bot and not step.get("allow_repeat") and not offline_article and _repeats(r["reply"], prev_bot):
            errs.append("repeated the previous reply")
        gold = step.get("gold") or (case.get("gold") if i == len(steps) else None)
        results.append({
            "case_id": case["id"], "category": case["category"], "step": i, "multi_step": len(steps) > 1,
            "run": run_no, "message": step["message"][:200], "expect": expect, "gold": gold,
            "ok": not errs, "errors": errs, "outcome": r["outcome"], "route": r["route"],
            "reason": r.get("handover_reason"), "flags": r.get("flags"), "confidence": r.get("confidence"),
            "trace": r.get("trace") or {}, "usage": r.get("usage") or {}, "reply": r["reply"],
            "latency_ms": r["_wall_ms"], "cost_usd": (r.get("usage") or {}).get("cost_usd", 0),
        })
        if "feedback" in step:
            client.post("/v1/feedback", {"workspace_id": ws, "run_id": r["run_id"], "helpful": step["feedback"]})
        history = msgs + [{"role": "assistant", "content": r["reply"]}]
    return results


def _repeats(a: str, b: str) -> bool:
    from app.dialogue import repeats
    return repeats(a, [b])


def _msg(case):
    if "message_repeat" in case:
        return case["message_repeat"]["text"] * case["message_repeat"]["times"]
    return case.get("message", "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api")
    ap.add_argument("--token")
    ap.add_argument("--workspace", default="ws_unocx")
    ap.add_argument("--cases", default=str(ROOT / "tests" / "eval_cases.yaml"))
    ap.add_argument("--only", help="comma-separated id prefixes, e.g. P,H,X")
    ap.add_argument("--include-llm-only", action="store_true")
    ap.add_argument("--repeat", type=int, default=1, help="run every case N times (stability)")
    ap.add_argument("--baseline", help="eval_results/*.json to compare with (default: the previous run)")
    a = ap.parse_args()

    from app.config import get_settings
    s = get_settings()
    provider_name = s.llm_provider
    if a.api:
        import httpx
        provider_name = httpx.get(a.api.rstrip("/") + "/health", timeout=10).json().get("provider", "unknown")
    fake = provider_name != "openai"
    cases = yaml.safe_load(Path(a.cases).read_text(encoding="utf-8"))
    if a.only:
        prefixes = tuple(p.strip() for p in a.only.split(","))
        cases = [c for c in cases if c["id"].startswith(prefixes)]

    client = Client(a.api, a.token or s.service_token)
    tag = datetime.now().strftime("%H%M%S") + uuid.uuid4().hex[:4]
    rows, all_steps = [], []
    try:
        for case in cases:
            if case.get("llm_only") and fake and not a.include_llm_only:
                rows.append({"case": case, "status": "skipped", "steps": []})
                continue
            case_steps, status = [], "pass"
            for run_no in range(1, a.repeat + 1):
                try:
                    st = run_case(client, case, tag, a.workspace, run_no)
                except Exception as e:
                    st = [{"case_id": case["id"], "category": case["category"], "step": 1, "run": run_no,
                           "ok": False, "errors": [f"exception: {e}"], "message": "", "reply": "", "expect": {}}]
                case_steps += st
                if not all(x["ok"] for x in st):
                    status = "error" if any("exception" in " ".join(x["errors"]) for x in st) else "fail"
            all_steps += case_steps
            rows.append({"case": case, "status": status, "steps": case_steps})
            mark = {"pass": "PASS", "fail": "FAIL", "error": "ERR "}[status]
            print(f"{mark} {case['id']:4} {case['title'][:70]}")
            for x in case_steps:
                for e in x["errors"]:
                    print(f"       step {x.get('step', 1)} run {x.get('run', 1)}: {e}")
    finally:
        client.close()

    gate = None
    if not a.api:
        gate = s.min_similarity
    else:
        gate = next((x["trace"]["retrieval"]["gate"] for x in all_steps
                     if (x.get("trace") or {}).get("retrieval")), None)
    summary = ev.summarize(all_steps, gate)
    skipped = sum(r["status"] == "skipped" for r in rows)

    out = ROOT / "eval_results"
    out.mkdir(exist_ok=True)
    baseline_path = Path(a.baseline) if a.baseline else _latest(out)
    comparison = None
    if baseline_path and baseline_path.exists():
        data = json.loads(baseline_path.read_text(encoding="utf-8"))
        comparison = ev.compare(rows, data["rows"] if isinstance(data, dict) else data)
        comparison["baseline"] = baseline_path.name
        comparison["baseline_pass_rate"] = (data.get("summary") or {}).get("pass_rate") if isinstance(data, dict) else None

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    meta = {"provider": provider_name, "api": a.api, "repeat": a.repeat, "skipped": skipped, "stamp": stamp}
    (out / f"{stamp}.json").write_text(json.dumps({"meta": meta, "summary": summary, "comparison": comparison,
                                                   "rows": rows}, ensure_ascii=False, indent=2, default=str),
                                       encoding="utf-8")
    (out / f"{stamp}.md").write_text(render_report(meta, summary, comparison, rows), encoding="utf-8")

    print(f"\n{summary['passed']}/{summary['cases']} passed, {skipped} skipped (llm_only in fake mode), "
          f"p90 latency {summary['latency']['p90_ms']} ms, cost ${summary['routing']['total_cost_usd']:.4f}, "
          f"provider={provider_name}")
    for r in summary["scorecard"]:
        mark = "  -" if r["ok"] is None else (" ok" if r["ok"] else " !!")
        print(f"{mark} {r['metric']}: {r['value']} (target {r['target']})")
    if comparison:
        print(f"vs {comparison['baseline']}: {len(comparison['regressions'])} regressions "
              f"{comparison['regressions'][:10]}, {len(comparison['fixed'])} fixed")
    print("top actions:")
    for rec in summary["recommendations"][:5]:
        print("  - " + rec)
    print(f"report: eval_results/{stamp}.md")


def _latest(folder: Path) -> Path | None:
    files = sorted(folder.glob("*.json"))
    return files[-1] if files else None


def _fmt(v):
    if v is None:
        return "–"
    if isinstance(v, float) and v <= 1:
        return f"{v:.0%}"
    return str(v)


def render_report(meta, s, comparison, rows) -> str:
    L = [f"# UnoCX AI eval report {meta['stamp']}", "",
         f"Provider **{meta['provider']}**{' via ' + meta['api'] if meta['api'] else ''} · "
         f"**{s['passed']}/{s['cases']} cases passed ({_fmt(s['pass_rate'])})** · {meta['skipped']} skipped · "
         f"repeat ×{meta['repeat']} · cost ${s['routing']['total_cost_usd']:.4f}", ""]

    L += ["## Scorecard", "", "| Metric | Value | Target | |", "|---|---|---|---|"]
    for r in s["scorecard"]:
        v = r["value"]
        shown = "–" if v is None else (f"{v:.0f}" if "latency" in r["metric"] else f"{v:.0%}")
        L.append(f"| {r['metric']} | {shown} | {r['target']} | {'–' if r['ok'] is None else ('✅' if r['ok'] else '❌')} |")

    if comparison:
        L += ["", f"## Change vs previous run ({comparison['baseline']})", "",
              f"Regressions: {', '.join(comparison['regressions']) or 'none'}  ",
              f"Fixed: {', '.join(comparison['fixed']) or 'none'}  ",
              f"New cases: {len(comparison['new_cases'])}"]

    L += ["", "## What to fix first", ""] + [f"{i}. {r}" for i, r in enumerate(s["recommendations"], 1)]

    L += ["", "## Where failures come from", ""]
    if s["failure_causes"]:
        L += ["| Cause | Stage | Count | Meaning | Cases |", "|---|---|---|---|---|"]
        for c, info in s["failure_causes"].items():
            L.append(f"| {c} | {info['stage']} | {info['count']} | {info['meaning']} | {', '.join(info['cases'][:10])} |")
    else:
        L.append("No failures.")

    L += ["", "## Pass rate by category", "", "| Category | Passed | Rate |", "|---|---|---|"]
    for c, v in s["categories"].items():
        L.append(f"| {c} | {v['passed']}/{v['total']} | {_fmt(v['pass_rate'])} |")

    r = s["retrieval"]
    L += ["", "## Retrieval (cases with a gold article)", ""]
    if r.get("n"):
        L += [f"Hit@1 **{_fmt(r['hit_at_1'])}** · Recall@5 **{_fmt(r['recall_at_5'])}** · MRR **{r['mrr']}** · "
              f"n={r['n']}  ", f"Gold article not retrieved: {', '.join(r['misses']) or 'none'}"]
    else:
        L.append("No cases with gold labels ran.")

    for title, key, note in (("Handover decisions", "handover", "positive = should hand over"),
                             ("Declining (handover, clarify or block instead of answering)", "declines",
                              "positive = should not answer")):
        h = s[key]
        L += ["", f"## {title}", "", f"_{note}_", "",
              "| | Did | Didn't |", "|---|---|---|",
              f"| **Should** | {h['tp']} | {h['fn']} (missed: {', '.join(h['false_negatives']) or '–'}) |",
              f"| **Shouldn't** | {h['fp']} (over-escalated: {', '.join(h['false_positives']) or '–'}) | {h['tn']} |",
              "", f"Precision {_fmt(h['precision'])} · Recall {_fmt(h['recall'])} · F1 {h['f1'] if h['f1'] is not None else '–'}"]

    g, hn = s["guardrail_false_positive"], s["hallucinated_numbers"]
    L += ["", "## Safety signals", "",
          f"Guardrail false positives: {g['n']}/{g['of']} answerable questions ({', '.join(g['cases']) or 'none'})  ",
          f"Hallucinated numbers: {hn['n']}/{hn['of']} AI answers" +
          (" — " + "; ".join(f"{x['case']}: {', '.join(x['numbers'])}" for x in hn["cases"]) if hn["cases"] else "")]

    th = s["threshold"]
    L += ["", "## Relevance threshold sweep", ""]
    if th.get("enough_data"):
        L += [f"{th['answerable']} answerable vs {th['out_of_scope']} out-of-scope questions reached retrieval. "
              f"Current **{th['current']}**, best separation at **{th['recommended']}**.", "",
              "| Threshold | Answerable answered | Out-of-scope answered | Youden J |", "|---|---|---|---|"]
        for row in th["rows"]:
            mark = " ← current" if row["current"] else (" ← best" if row["threshold"] == th["recommended"] else "")
            L.append(f"| {row['threshold']}{mark} | {row['answers_answerable']:.0%} | {row['answers_out_of_scope']:.0%} | {row['youden']} |")
    else:
        L.append(f"Not enough data ({th['answerable']} answerable, {th['out_of_scope']} out-of-scope reached "
                 "retrieval; need 3 and 2). Run with the real model so the O cases are included.")

    cv = s["conversation"]
    L += ["", "## Conversation quality", "",
          "Resolution comes first: a conversation should never loop, and an unhappy customer should get a change "
          "of approach, then a person.", "",
          "| Signal | Count |", "|---|---|",
          f"| Repeated replies (must be 0) | {cv['repeated_replies']} of {cv['steps']} conversation steps |",
          f"| Repeats avoided by changing approach | {cv['repeat_avoided']} |",
          f"| Unhappy customers detected | {cv['unhappy_customers']} |",
          f"| Handed over as unresolved | {cv['unresolved_handovers']} |",
          f"| Order problems recognised | {cv['order_problems']} |",
          f"| Complaints raised or reused | {cv['complaints']} |"]

    oi = s["order_intent"]
    L += ["", "## Order questions (WISMO)", "",
          "How order questions were recognised: " + (", ".join(f"{k} {v}" for k, v in oi["caught_by"].items()) or "none")
          + " (keyword = fixed phrases, semantic = layer 2, llm = layer 3)", ""]
    if oi.get("enough_data"):
        L += [f"Layer-2 threshold sweep: {oi['order_questions']} order questions vs {oi['general_questions']} general "
              f"questions from signed-in customers (margin {oi['margin']}). Current **{oi['current']}**, best "
              f"**{oi['recommended']}**.", "",
              "| Threshold | Order questions caught | General questions misrouted | Youden J |", "|---|---|---|---|"]
        for row in oi["rows"]:
            mark = " ← current" if row["current"] else (" ← best" if row["threshold"] == oi["recommended"] else "")
            L.append(f"| {row['threshold']}{mark} | {row['order_caught']:.0%} | {row['general_misrouted']:.0%} | {row['youden']} |")
    else:
        L.append("Not enough layer-2 data for a threshold sweep (needs the W17–W41 cases, which run with the real model).")

    L += ["", "## Confidence calibration (AI answers)", "",
          "Pass rate should rise from top to bottom. If it doesn't, confidence can't be trusted for decisions.", "",
          "| Confidence | Answers | Pass rate |", "|---|---|---|"]
    for b in s["calibration"]:
        L.append(f"| {b['bucket']} | {b['n']} | {_fmt(b['pass_rate'])} |")

    lat = s["latency"]
    L += ["", "## Latency by stage (ms)", "", f"Total p50 {lat['p50_ms']} · p90 {lat['p90_ms']} · "
          f"slowest stage: **{lat['slowest_stage']}**", "", "| Stage | p50 | p90 | n |", "|---|---|---|---|"]
    order = ["rules", "embed", "cache", "retrieval", "llm", "post", "total"]
    for k in sorted(lat["stages"], key=lambda x: order.index(x) if x in order else 99):
        v = lat["stages"][k]
        L.append(f"| {k} | {v['p50']} | {v['p90']} | {v['n']} |")

    rt = s["routing"]
    L += ["", "## Routing and cost", "",
          f"Free replies (flow + cache + guardrail): **{rt['free_share']:.0%}** · cost per answer "
          f"${rt['cost_per_answer_usd'] or 0:.5f} · avg tokens in/out {rt['avg_input_tokens']}/{rt['avg_output_tokens']}  ",
          "Route share: " + ", ".join(f"{k} {v:.0%}" for k, v in rt["route_share"].items())]
    if s.get("stability"):
        st = s["stability"]
        L += ["", "## Stability", "", f"Outcome agreement across repeats: **{st['outcome_agreement']:.0%}** "
              f"over {st['cases']} steps. Unstable: {', '.join(st['unstable']) or 'none'}"]

    L += ["", "## All cases", "", "| Case | Category | Title | Result | Cause | Notes |", "|---|---|---|---|---|---|"]
    for row in rows:
        causes = sorted({x.get("cause") for x in row["steps"] if x.get("cause")})
        notes = "; ".join(e for x in row["steps"] for e in x["errors"])[:160].replace("|", "/")
        L.append(f"| {row['case']['id']} | {row['case']['category']} | {row['case']['title']} | {row['status']} | "
                 f"{', '.join(causes)} | {notes} |")
    L += ["", "## Replies", ""]
    for row in rows:
        for x in row["steps"]:
            if x.get("run", 1) != 1:
                continue
            L.append(f"**{row['case']['id']} step {x.get('step', 1)}** _{x['message'][:120]}_  ")
            L.append(f"→ `{x.get('outcome')}/{x.get('route')}` conf {x.get('confidence')} · {x.get('reply', '')[:400]}\n")
    return "\n".join(L)


if __name__ == "__main__":
    main()
