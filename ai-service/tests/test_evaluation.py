"""Unit tests for the evaluation metrics (pure functions, no database)."""
from app import evaluation as ev
from app.guardrails import unsupported_numbers


def step(cid="P01", cat="policy", ok=True, outcome="answered", route="rag", expect=None, gold=None,
         top=None, flags=None, errors=None, conf=0.8, sim=0.5, timings=None):
    top = top if top is not None else ["Returns > Return window", "Returns > Refund timelines"]
    return {"case_id": cid, "category": cat, "step": 1, "run": 1, "ok": ok, "outcome": outcome, "route": route,
            "expect": expect or {"outcome": "answered"}, "gold": gold, "flags": flags or [], "errors": errors or [],
            "confidence": conf, "usage": {"input_tokens": 1000, "output_tokens": 50}, "cost_usd": 0.0002,
            "trace": {"retrieval": {"best_sim": sim, "gate": 0.3, "fts_hit": True, "passed_gate": True,
                                    "top": [{"title": t} for t in top]},
                      "timings_ms": timings or {"rules": 2, "llm": 900, "total": 1000}}}


def test_gold_rank():
    assert ev.gold_rank(step(gold=["Return window"])) == 1
    assert ev.gold_rank(step(gold=["refund"])) == 2
    assert ev.gold_rank(step(gold=["Shipping"])) == 0
    assert ev.gold_rank(step(gold=None)) is None


def test_diagnose_each_stage():
    assert ev.diagnose(step()) is None
    # right article found, gate rejected it
    assert ev.diagnose(step(ok=False, outcome="clarify", flags=["no_relevant_knowledge"], gold=["Return window"])) == "gate_too_strict"
    # article not found at all
    assert ev.diagnose(step(ok=False, outcome="clarify", flags=["no_relevant_knowledge"], gold=["Shipping"])) == "retrieval_miss"
    # article given to the model, model refused
    assert ev.diagnose(step(ok=False, outcome="clarify", flags=["model_said_handover"], gold=["Return window"])) == "generation_refused"
    # wrong content, right article at rank 1
    assert ev.diagnose(step(ok=False, errors=["reply lacks any of ['7 days']"], gold=["Return window"])) == "generation"
    # wrong content, right article only at rank 2
    assert ev.diagnose(step(ok=False, errors=["reply lacks any of ['5-7']"], gold=["Refund"])) == "ranking"
    # safety rule fired on a normal question
    assert ev.diagnose(step(ok=False, outcome="blocked", route="guardrail")) == "guardrail_false_positive"
    # should hand over, answered instead
    assert ev.diagnose(step(cat="handover", ok=False, expect={"outcome": "handover"})) == "guardrail_miss"
    assert ev.diagnose(step(cat="out_of_scope", ok=False, expect={"outcome": ["clarify", "handover"]})) == "answered_out_of_scope"
    assert ev.diagnose(step(ok=False, flags=["unsupported_number"], errors=["reply contains forbidden 'x'"])) == "hallucinated_number"


def test_confusion_and_summary():
    steps = [
        step("H01", "handover", outcome="handover", route="guardrail", expect={"outcome": "handover"}),
        step("H02", "handover", ok=False, outcome="answered", expect={"outcome": "handover"}),     # missed
        step("P01", gold=["Return window"]),
        step("P02", ok=False, outcome="handover", route="guardrail", expect={"outcome": "answered"}),  # over-escalated
    ]
    s = ev.summarize(steps, gate=0.3)
    h = s["handover"]
    assert (h["tp"], h["fn"], h["fp"]) == (1, 1, 1) and h["recall"] == 0.5
    assert s["guardrail_false_positive"]["cases"] == ["P02"]
    assert set(s["failure_causes"]) == {"guardrail_miss", "guardrail_false_positive"}
    assert any("guardrail" in r for r in s["recommendations"])
    assert s["latency"]["slowest_stage"] == "llm"


def test_threshold_sweep_recommends_separating_value():
    steps = [step(f"P{i}", sim=v) for i, v in enumerate([0.55, 0.6, 0.5, 0.45])]
    steps += [step(f"O{i}", cat="out_of_scope", outcome="clarify", sim=v, expect={"outcome": ["clarify", "handover"]})
              for i, v in enumerate([0.2, 0.25, 0.3])]
    sw = ev.threshold_sweep(steps, current_gate=0.6)
    assert sw["enough_data"] and 0.3 < sw["recommended"] <= 0.45


def test_calibration_buckets():
    steps = [step(conf=0.9), step(conf=0.85), step(conf=0.3, ok=False, errors=["x"])]
    cal = {b["bucket"]: b for b in ev.calibration(steps)}
    assert cal["0.8–1.0"]["pass_rate"] == 1.0 and cal["0.0–0.4"]["pass_rate"] == 0.0


def test_stability():
    a, b = step("P01"), step("P01", outcome="clarify")
    b["run"] = 2
    st = ev.stability([a, b])
    assert st["outcome_agreement"] == 0.5 and st["unstable"] == ["P01"]


def test_compare_runs():
    cur = [{"case": {"id": "A"}, "status": "fail"}, {"case": {"id": "B"}, "status": "pass"}]
    base = [{"case": {"id": "A"}, "status": "pass"}, {"case": {"id": "B"}, "status": "fail"}]
    assert ev.compare(cur, base) == {"regressions": ["A"], "fixed": ["B"], "new_cases": []}


def test_unsupported_numbers():
    ctx = "Refunds take 5–7 business days. COD up to ₹5,000."
    assert unsupported_numbers("Refunds take 5-7 days.", ctx) == []
    assert unsupported_numbers("COD up to ₹5000, delivered by 22 Nov.", ctx) == ["22"]
    assert unsupported_numbers("You said 3 weeks ago; returns are 7 days.", "within 7 days", "3 weeks ago") == []
