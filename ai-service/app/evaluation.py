"""Evaluation metrics: not just pass/fail, but WHICH STAGE failed and what to change.

Input: one dict per test step (built by scripts/run_eval.py), containing the expectation, the
response (outcome, route, flags, confidence, trace) and the check errors. Everything here is a
pure function so it can be unit tested and reused on production logs.

Pipeline stages a failure can be blamed on:
  rules -> flows -> retrieval -> relevance gate -> generation -> post-checks
"""
from __future__ import annotations

import statistics
from collections import Counter, defaultdict

# cause -> (stage, what it means, what to change)
CAUSES = {
    "retrieval_miss": ("retrieval", "the right article was not in the top 5 results",
                       "add the customer's wording to the article or as an FAQ; split long articles with clearer "
                       "## headings; check the content exists at all (see insights/gaps)"),
    "ranking": ("retrieval", "the right article was retrieved but ranked below others and the answer used the wrong one",
                "make headings more specific; remove duplicate or overlapping articles; consider a reranker"),
    "gate_too_strict": ("relevance gate", "the right article was found but the score was below the threshold",
                        "lower the threshold (see the sweep table for a suggested value)"),
    "generation_refused": ("generation", "the right article was given to the model but it replied HANDOVER",
                           "loosen the 'answer only if…' prompt rule for partial answers, or try a stronger model"),
    "generation": ("generation", "the right article was used but the reply was wrong or incomplete",
                   "tighten the prompt rule for this pattern (false premise, limits, partial answers) or try a stronger model"),
    "hallucinated_number": ("generation", "the reply contains numbers (prices, days, dates) that are in no article",
                            "add a prompt rule against it; consider handing over when unsupported numbers appear"),
    "answered_out_of_scope": ("relevance gate", "it answered a question it should have declined",
                              "raise the threshold (see sweep) and/or strengthen the HANDOVER rule in the prompt"),
    "guardrail_false_positive": ("rules", "a safety or handover rule fired on a normal question",
                                 "narrow the matching pattern in app/guardrails.py and add the message as a negative unit test"),
    "guardrail_miss": ("rules", "a message that should have been handed over or blocked got an AI answer",
                       "add the phrase to HUMAN_PATTERNS / SENSITIVE / INJECTION_PATTERNS in app/guardrails.py"),
    "unexpected_handover": ("rules", "handed over when an answer was expected",
                            "check which handover reason fired (see handover confusion) and adjust that rule"),
    "flow_routing": ("flows", "a keyword flow caught (or missed) a message",
                     "adjust the flow's keywords, match_type or max_words"),
    "ambiguity_clarify": ("retrieval", "asked 'which do you mean?' when one answer was expected",
                          "articles are too similar for short questions; merge or retitle them"),
    "language": ("generation", "replied in the wrong language",
                 "check the language rule in the prompt; Indian languages may need the Advanced model"),
    "order_intent_miss": ("order intent", "an order question wasn't recognised, so it didn't get the customer's order",
                          "add the wording to ORDER_EXAMPLES in app/intent.py, or lower ORDER_INTENT_OPENAI "
                          "(see the order-intent sweep)"),
    "order_intent_false_trigger": ("order intent", "a general question was treated as an order lookup",
                                   "add the wording to POLICY_EXAMPLES in app/intent.py, or raise ORDER_INTENT_OPENAI "
                                   "/ ORDER_INTENT_MARGIN"),
    "repeated_reply": ("dialogue", "the bot sent the same reply twice in a row, leaving the customer stuck",
                       "check the no-repeat rule in _final() (app/agent.py) and what the customer's message should "
                       "have triggered (an offer reply, an order problem, an unhappy customer)"),
    "order_issue_missed": ("order problems", "a reported problem (damaged, wrong, missing, cancel, payment...) "
                           "wasn't recognised", "add the wording to ISSUE_PATTERNS in app/order_issues.py"),
    "error": ("system", "the request failed", "check the service logs for this case"),
    "other": ("unknown", "failed a check that doesn't map to a stage", "read the reply in the report"),
}

TARGETS = {
    "policy_pass_rate": 0.85, "handover_recall": 1.0, "security_pass_rate": 1.0,
    "guardrail_false_positive_rate": 0.0, "hallucinated_number_rate": 0.0,
    "retrieval_recall_at_5": 0.90, "p90_latency_ms": 8000,
}


# ---------------------------------------------------------------- per-step helpers

def expected_class(expect: dict) -> str:
    """answer | handover | no_answer | any"""
    o = expect.get("outcome")
    if o is None:
        return "any"
    outs = set(o if isinstance(o, list) else [o])
    if outs == {"answered"}:
        return "answer"
    if outs == {"handover"}:
        return "handover"
    if "answered" not in outs:
        return "no_answer"
    return "any"


def gold_rank(step: dict) -> int | None:
    """1-based rank of the first retrieved chunk whose title matches a gold label; 0 = not retrieved;
    None = no gold label or retrieval didn't run."""
    gold = [g.lower() for g in (step.get("gold") or [])]
    ret = (step.get("trace") or {}).get("retrieval")
    if not gold or not ret:
        return None
    for i, t in enumerate(ret.get("top") or [], start=1):
        if any(g in (t.get("title") or "").lower() for g in gold):
            return i
    return 0


def diagnose(step: dict) -> str | None:
    """Blame a failed step on one pipeline stage. Returns None for passing steps."""
    if step.get("ok"):
        return None
    errs = " | ".join(step.get("errors") or [])
    if "exception" in errs:
        return "error"
    if "repeated the previous reply" in errs:
        return "repeated_reply"
    if any(f.startswith("issue:") for f in (step.get("expect") or {}).get("flags_include", [])) and \
            not any(str(f).startswith("issue:") for f in (step.get("flags") or [])):
        return "order_issue_missed"
    exp, outcome, route = expected_class(step.get("expect") or {}), step.get("outcome"), step.get("route")
    flags = set(step.get("flags") or [])
    gr = gold_rank(step)
    expect = step.get("expect") or {}

    if expect.get("route") == "tool" and route != "tool" and route != "guardrail":
        return "order_intent_miss"
    if expect.get("not_route") == "tool" and route == "tool":
        return "order_intent_false_trigger"
    if exp == "answer" and route == "guardrail":
        return "guardrail_false_positive"
    if exp in ("handover", "no_answer") and outcome == "answered":
        if step.get("category") in ("handover", "sensitive", "security") or route == "flow":
            return "guardrail_miss"
        return "answered_out_of_scope"
    if "route" in errs and ("flow" in str(expect.get("route", "")) or expect.get("not_route") == "flow"):
        return "flow_routing"
    if exp == "answer" and outcome != "answered":
        if "model_said_handover" in flags:
            return "generation_refused" if gr else "retrieval_miss"
        if "no_relevant_knowledge" in flags:
            if gr:
                return "gate_too_strict"
            return "retrieval_miss"
        if outcome == "clarify":
            return "ambiguity_clarify"
        return "unexpected_handover"
    if "forbidden pattern" in errs and step.get("category") == "language":
        return "language"
    if "unsupported_number" in flags:
        return "hallucinated_number"
    if "reply lacks" in errs or "forbidden" in errs or "no citation" in errs:
        if gr == 0:
            return "retrieval_miss"
        if gr and gr > 1:
            return "ranking"
        return "generation"
    return "other"


def _rate(n: int, d: int) -> float | None:
    return round(n / d, 4) if d else None


def _pct(values: list[float], q: float) -> float | None:
    if not values:
        return None
    v = sorted(values)
    return v[min(len(v) - 1, int(round(q * (len(v) - 1))))]


# ---------------------------------------------------------------- metric groups

def retrieval_metrics(steps: list[dict]) -> dict:
    ranks = [r for r in (gold_rank(s) for s in steps) if r is not None]
    if not ranks:
        return {"n": 0}
    return {
        "n": len(ranks),
        "hit_at_1": _rate(sum(r == 1 for r in ranks), len(ranks)),
        "recall_at_5": _rate(sum(1 <= r <= 5 for r in ranks), len(ranks)),
        "mrr": round(statistics.mean(1 / r if r else 0 for r in ranks), 4),
        "misses": [s["case_id"] for s in steps if gold_rank(s) == 0],
    }


def confusion(steps: list[dict], positive, predicted) -> dict:
    tp = fp = fn = tn = 0
    fps, fns = [], []
    for s in steps:
        p, y = predicted(s), positive(s)
        if p and y:
            tp += 1
        elif p and not y:
            fp += 1
            fps.append(s["case_id"])
        elif y:
            fn += 1
            fns.append(s["case_id"])
        else:
            tn += 1
    prec, rec = _rate(tp, tp + fp), _rate(tp, tp + fn)
    f1 = round(2 * prec * rec / (prec + rec), 4) if prec and rec else None
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "precision": prec, "recall": rec, "f1": f1,
            "false_positives": fps, "false_negatives": fns}


def threshold_sweep(steps: list[dict], current_gate: float | None) -> dict:
    """For questions that reached retrieval: which threshold best separates answerable from
    out-of-scope questions? Uses best_sim only (the gate also lets keyword hits through slightly below it)."""
    pos, neg = [], []
    for s in steps:
        ret = (s.get("trace") or {}).get("retrieval")
        if not ret or s.get("route") in ("flow", "cache", "guardrail"):
            continue
        exp = expected_class(s.get("expect") or {})
        if exp == "answer":
            pos.append(ret["best_sim"])
        elif exp in ("no_answer", "handover"):
            neg.append(ret["best_sim"])
    if len(pos) < 3 or len(neg) < 2:
        return {"enough_data": False, "answerable": len(pos), "out_of_scope": len(neg)}
    lo, hi = min(pos + neg), max(pos + neg)
    grid = sorted({round(lo + (hi - lo) * i / 14, 3) for i in range(15)} | ({current_gate} if current_gate else set()))
    rows = []
    for t in grid:
        tpr = sum(p >= t for p in pos) / len(pos)
        fpr = sum(n >= t for n in neg) / len(neg)
        rows.append({"threshold": t, "answers_answerable": round(tpr, 3), "answers_out_of_scope": round(fpr, 3),
                     "youden": round(tpr - fpr, 3), "current": t == current_gate})
    best = max(rows, key=lambda r: (r["youden"], -abs(r["threshold"] - (current_gate or 0))))
    return {"enough_data": True, "answerable": len(pos), "out_of_scope": len(neg), "rows": rows,
            "recommended": best["threshold"], "current": current_gate}


def order_intent(steps: list[dict]) -> dict:
    """How order questions were caught (keyword / semantic / AI), and which layer-2 threshold best
    separates order questions from general questions asked by signed-in customers."""
    by_layer = Counter()
    for s in steps:
        tool = (s.get("trace") or {}).get("tool") or {}
        if s.get("route") == "tool" and tool.get("matched"):
            by_layer[tool.get("matched_by", "keyword")] += 1
    pos, neg, current, margin, prov = [], [], None, 0.03, None
    for s in steps:
        oi = (s.get("trace") or {}).get("order_intent")
        if not oi:
            continue
        current, margin, prov = oi.get("threshold", current), oi.get("margin", margin), oi.get("provider", prov)
        expect = s.get("expect") or {}
        if expect.get("route") == "tool":
            pos.append((oi["order_sim"], oi["policy_sim"]))
        elif expect.get("not_route") == "tool":
            neg.append((oi["order_sim"], oi["policy_sim"]))
    out = {"caught_by": dict(by_layer), "order_questions": len(pos), "general_questions": len(neg), "provider": prov,
           "current": current, "margin": margin, "enough_data": len(pos) >= 3 and len(neg) >= 2}
    if not out["enough_data"]:
        return out
    allv = [o for o, _ in pos + neg]
    grid = sorted({round(min(allv) + (max(allv) - min(allv)) * i / 14, 3) for i in range(15)} | ({current} if current else set()))
    rows = []
    for t in grid:
        tpr = sum(o >= t and o - p >= margin for o, p in pos) / len(pos)
        fpr = sum(o >= t and o - p >= margin for o, p in neg) / len(neg)
        rows.append({"threshold": t, "order_caught": round(tpr, 3), "general_misrouted": round(fpr, 3),
                     "youden": round(tpr - fpr, 3), "current": t == current})
    best = max(rows, key=lambda r: (r["youden"], -abs(r["threshold"] - (current or 0))))
    out.update(rows=rows, recommended=best["threshold"])
    return out


def calibration(steps: list[dict]) -> list[dict]:
    """Does confidence predict correctness? Pass rate should rise with each bucket."""
    buckets = [(0.0, 0.4), (0.4, 0.6), (0.6, 0.8), (0.8, 1.01)]
    out = []
    for lo, hi in buckets:
        b = [s for s in steps if s.get("route") == "rag" and s.get("outcome") == "answered"
             and s.get("confidence") is not None and lo <= s["confidence"] < hi]
        out.append({"bucket": f"{lo:.1f}–{min(hi, 1.0):.1f}", "n": len(b),
                    "pass_rate": _rate(sum(x["ok"] for x in b), len(b))})
    return out


def latency(steps: list[dict]) -> dict:
    per_stage = defaultdict(list)
    for s in steps:
        for k, v in ((s.get("trace") or {}).get("timings_ms") or {}).items():
            per_stage[k].append(float(v))
    stages = {k: {"p50": _pct(v, 0.5), "p90": _pct(v, 0.9), "n": len(v)} for k, v in per_stage.items()}
    worst = max((k for k in stages if k != "total"), key=lambda k: stages[k]["p90"] or 0, default=None)
    return {"stages": stages, "slowest_stage": worst}


def routing_cost(steps: list[dict]) -> dict:
    routes = Counter(s.get("route") for s in steps)
    n = sum(routes.values()) or 1
    answered = [s for s in steps if s.get("outcome") == "answered"]
    rag = [s for s in steps if s.get("route") == "rag" and (s.get("usage") or {}).get("input_tokens")]
    cost = sum(s.get("cost_usd") or 0 for s in steps)
    return {
        "route_share": {k: round(v / n, 3) for k, v in routes.most_common()},
        "free_share": round(sum(routes[k] for k in ("flow", "cache", "guardrail")) / n, 3),
        "total_cost_usd": round(cost, 6),
        "cost_per_answer_usd": round(cost / len(answered), 6) if answered else None,
        "avg_input_tokens": round(statistics.mean(s["usage"]["input_tokens"] for s in rag)) if rag else None,
        "avg_output_tokens": round(statistics.mean(s["usage"]["output_tokens"] for s in rag)) if rag else None,
    }


def stability(steps: list[dict]) -> dict | None:
    groups = defaultdict(list)
    for s in steps:
        groups[(s["case_id"], s.get("step", 1))].append(s.get("outcome"))
    multi = {k: v for k, v in groups.items() if len(v) > 1}
    if not multi:
        return None
    agree = {k: Counter(v).most_common(1)[0][1] / len(v) for k, v in multi.items()}
    return {"cases": len(multi), "outcome_agreement": round(statistics.mean(agree.values()), 4),
            "unstable": sorted({k[0] for k, a in agree.items() if a < 1.0})}


# ---------------------------------------------------------------- summary

def summarize(steps: list[dict], gate: float | None = None) -> dict:
    for s in steps:
        s["cause"] = diagnose(s)
    by_cat = defaultdict(lambda: [0, 0])
    case_ok = defaultdict(lambda: True)
    for s in steps:
        case_ok[(s["case_id"], s["category"], s.get("run", 1))] &= bool(s["ok"])
    for (cid, cat, _), ok in case_ok.items():
        by_cat[cat][0] += ok
        by_cat[cat][1] += 1
    cats = {c: {"passed": p, "total": t, "pass_rate": _rate(p, t)} for c, (p, t) in sorted(by_cat.items())}
    passed = sum(case_ok.values())

    labeled = [s for s in steps if expected_class(s.get("expect") or {}) != "any"]
    handover = confusion(labeled, lambda s: expected_class(s["expect"]) == "handover",
                         lambda s: s.get("outcome") == "handover")
    declines = confusion(labeled, lambda s: expected_class(s["expect"]) in ("handover", "no_answer"),
                         lambda s: s.get("outcome") != "answered")
    should_answer = [s for s in steps if expected_class(s.get("expect") or {}) == "answer"]
    # a rule replying is only a false alarm when the case failed (e.g. "No problem, anything else?" is correct)
    gfp = [s["case_id"] for s in should_answer if s.get("route") == "guardrail" and not s.get("ok")]
    rag_answers = [s for s in steps if s.get("route") == "rag" and s.get("outcome") == "answered"]
    halluc = [s for s in rag_answers if "unsupported_number" in (s.get("flags") or [])]
    total_lat = [((s.get("trace") or {}).get("timings_ms") or {}).get("total", s.get("latency_ms", 0)) for s in steps]

    causes = defaultdict(list)
    for s in steps:
        if s["cause"]:
            causes[s["cause"]].append(s["case_id"] + (f".{s['step']}" if s.get("multi_step") else ""))

    summary = {
        "cases": len(case_ok), "passed": passed, "pass_rate": _rate(passed, len(case_ok)),
        "categories": cats,
        "retrieval": retrieval_metrics(steps),
        "handover": handover,
        "declines": declines,
        "guardrail_false_positive": {"n": len(gfp), "of": len(should_answer),
                                     "rate": _rate(len(gfp), len(should_answer)), "cases": gfp},
        "hallucinated_numbers": {"n": len(halluc), "of": len(rag_answers), "rate": _rate(len(halluc), len(rag_answers)),
                                 "cases": [{"case": s["case_id"], "numbers": (s.get("trace") or {}).get("unsupported_numbers")}
                                           for s in halluc]},
        "threshold": threshold_sweep(steps, gate),
        "order_intent": order_intent(steps),
        "calibration": calibration(steps),
        "latency": {**latency(steps), "p50_ms": _pct(total_lat, 0.5), "p90_ms": _pct(total_lat, 0.9)},
        "routing": routing_cost(steps),
        "stability": stability(steps),
        "failure_causes": {c: {"count": len(v), "stage": CAUSES[c][0], "meaning": CAUSES[c][1], "fix": CAUSES[c][2],
                               "cases": v} for c, v in sorted(causes.items(), key=lambda x: -len(x[1]))},
    }
    multi = [x for x in steps if x.get("multi_step")]
    summary["conversation"] = {
        "steps": len(multi),
        "repeated_replies": sum("repeated the previous reply" in " ".join(x.get("errors") or []) for x in multi),
        "repeat_avoided": sum("repeat_avoided" in (x.get("flags") or []) for x in steps),
        "unhappy_customers": sum("customer_unhappy" in (x.get("flags") or []) for x in steps),
        "unresolved_handovers": sum(x.get("reason") == "unresolved" for x in steps),
        "complaints": sum("order_complaint" in (x.get("flags") or []) for x in steps),
        "order_problems": sum(any(str(f).startswith("issue:") for f in (x.get("flags") or [])) for x in steps),
    }
    c = summary["conversation"]
    c["repeated_reply_rate"] = _rate(c["repeated_replies"], c["steps"])
    summary["scorecard"] = scorecard(summary)
    summary["recommendations"] = recommendations(summary)
    return summary


def scorecard(s: dict) -> list[dict]:
    cat = s["categories"]
    rows = [
        ("Policy & FAQ pass rate", (cat.get("policy") or {}).get("pass_rate"), TARGETS["policy_pass_rate"], ">="),
        ("Handover recall (should hand over → did)", s["handover"]["recall"], TARGETS["handover_recall"], ">="),
        ("Security pass rate", (cat.get("security") or {}).get("pass_rate"), TARGETS["security_pass_rate"], ">="),
        ("Guardrail false-positive rate", s["guardrail_false_positive"]["rate"],
         TARGETS["guardrail_false_positive_rate"], "<="),
        ("Hallucinated-number rate", s["hallucinated_numbers"]["rate"], TARGETS["hallucinated_number_rate"], "<="),
        ("Retrieval recall@5", s["retrieval"].get("recall_at_5"), TARGETS["retrieval_recall_at_5"], ">="),
        ("Repeated replies in conversations", s.get("conversation", {}).get("repeated_reply_rate"), 0.0, "<="),
        ("p90 latency (ms)", s["latency"]["p90_ms"], TARGETS["p90_latency_ms"], "<"),
    ]
    out = []
    for name, val, target, op in rows:
        ok = None if val is None else (val >= target if op == ">=" else val <= target if op == "<=" else val < target)
        out.append({"metric": name, "value": val, "target": f"{op} {target}", "ok": ok})
    return out


def recommendations(s: dict) -> list[str]:
    recs = []
    for cause, info in s["failure_causes"].items():
        recs.append(f"[{info['stage']}] {info['count']}× {cause}: {info['fix']} (cases: {', '.join(info['cases'][:6])})")
    th = s["threshold"]
    if th.get("enough_data") and th["current"] and abs(th["recommended"] - th["current"]) > 0.02:
        direction = "lower" if th["recommended"] < th["current"] else "raise"
        recs.append(f"[relevance gate] {direction} the similarity threshold from {th['current']} to about "
                    f"{th['recommended']} (best separation of answerable vs out-of-scope in this run)")
    oi = s["order_intent"]
    if oi.get("enough_data") and oi.get("current") and abs(oi["recommended"] - oi["current"]) > 0.02:
        var = "ORDER_INTENT_OPENAI" if oi.get("provider") == "openai" else "ORDER_INTENT_FAKE"
        note = "" if oi.get("provider") == "openai" else (" (offline stand-in embeddings: this says nothing about "
                                                           "the OpenAI threshold; run with LLM_PROVIDER=openai)")
        recs.append(f"[order intent] set {var} to about {oi['recommended']} (now {oi['current']}): best separation "
                    f"of order questions from general ones in this run{note}")
    cal = [b for b in s["calibration"] if b["n"] >= 3 and b["pass_rate"] is not None]
    if len(cal) >= 2 and any(cal[i]["pass_rate"] > cal[i + 1]["pass_rate"] + 0.1 for i in range(len(cal) - 1)):
        recs.append("[confidence] confidence is not predicting correctness (pass rate doesn't rise with confidence); "
                    "don't use it for handover decisions until the weights in _confidence() are tuned")
    lat = s["latency"]
    if lat["p90_ms"] and lat["p90_ms"] > TARGETS["p90_latency_ms"] and lat["slowest_stage"]:
        recs.append(f"[latency] p90 {lat['p90_ms']:.0f} ms is over target; slowest stage is '{lat['slowest_stage']}'. "
                    "For 'llm': shorter context (fewer/shorter chunks), lower MAX_OUTPUT_TOKENS or a faster model.")
    rt = s["routing"]
    if rt["avg_input_tokens"] and rt["avg_input_tokens"] > 2500:
        recs.append(f"[cost] {rt['avg_input_tokens']} input tokens per AI reply; trim chunk size or send 3 chunks instead of 5")
    st = s.get("stability")
    if st and st["outcome_agreement"] < 0.95:
        recs.append(f"[stability] outcomes changed between repeated runs for {', '.join(st['unstable'][:8])}; "
                    "lower temperature or make the prompt rule for these cases explicit")
    if not recs:
        recs.append("No failures in this run. Add harder cases (see docs/TESTING.md §7) so the set keeps finding problems.")
    return recs


def compare(current: list[dict], baseline: list[dict]) -> dict:
    """Case-level diff between two runs (rows as saved in eval_results/*.json)."""
    def status(rows):
        return {r["case"]["id"]: r["status"] for r in rows if r["status"] != "skipped"}
    cur, base = status(current), status(baseline)
    common = set(cur) & set(base)
    return {
        "regressions": sorted(c for c in common if base[c] == "pass" and cur[c] != "pass"),
        "fixed": sorted(c for c in common if base[c] != "pass" and cur[c] == "pass"),
        "new_cases": sorted(set(cur) - set(base)),
    }
