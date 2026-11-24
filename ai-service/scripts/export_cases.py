"""Export tests/eval_cases.yaml to docs/test-cases.csv for manual testers (opens in Excel / Google Sheets).

    python -m scripts.export_cases
"""
import csv
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent


def describe(expect: dict) -> tuple[str, str]:
    outcome = expect.get("outcome", "")
    outcome = " or ".join(outcome) if isinstance(outcome, list) else outcome
    parts = []
    if "route" in expect:
        parts.append(f"route = {expect['route']}")
    if "not_route" in expect:
        parts.append(f"route is not {expect['not_route']}")
    if "handover_reason" in expect:
        parts.append(f"reason = {expect['handover_reason']}")
    if "action_form" in expect:
        parts.append("support form shown")
    if expect.get("citation"):
        parts.append("shows a source")
    if "contains_any" in expect:
        parts.append("reply mentions one of: " + " / ".join(expect["contains_any"]))
    if "not_contains" in expect:
        parts.append("reply must NOT say: " + " / ".join(expect["not_contains"]))
    if "not_matches" in expect:
        parts.append(f"reply must not match /{expect['not_matches']}/")
    if "language" in expect:
        parts.append(f"reply in {expect['language']}")
    if "flags_include" in expect:
        parts.append("flags: " + ", ".join(expect["flags_include"]))
    return outcome, "; ".join(parts)


def main():
    cases = yaml.safe_load((ROOT / "tests" / "eval_cases.yaml").read_text(encoding="utf-8"))
    out = ROOT / "docs" / "test-cases.csv"
    with out.open("w", newline="", encoding="utf-8-sig") as f:   # BOM so Excel shows ₹ and Indic text
        w = csv.writer(f)
        w.writerow(["ID", "Category", "Scenario", "Step", "Setup", "Customer message", "Expected outcome",
                    "Expected details", "Article that should be found", "Needs real model", "Result (pass/fail)", "Tester notes"])
        for c in cases:
            setup = []
            if c.get("history"):
                setup.append(f"{len(c['history'])} earlier messages in chat")
            if c.get("settings"):
                setup.append(f"settings {c['settings']}")
            if c.get("user"):
                setup.append(f"user {c['user']}")
            if c.get("page"):
                setup.append(f"page {c['page']['path']}")
            if c.get("repeat"):
                setup.append(f"send {c['repeat']} times within a minute")
            steps = c.get("steps") or [{"message": c.get("message", ""), "expect": c.get("expect", {})}]
            if "message_repeat" in c:
                steps[0]["message"] = f"[{c['message_repeat']['times']}× repeated] {c['message_repeat']['text']}"
            for i, s in enumerate(steps, start=1):
                outcome, details = describe(s.get("expect", {}))
                extra = "; thumbs up after reply" if s.get("feedback") is True else ""
                gold = s.get("gold") or (c.get("gold") if i == len(steps) else None)
                w.writerow([c["id"], c["category"], c["title"], i if len(steps) > 1 else "",
                            "; ".join(setup) + extra, s["message"] or "(empty)", outcome, details,
                            " or ".join(gold or []), "yes" if c.get("llm_only") else "", "", ""])
    print(f"wrote {out} ({len(cases)} cases)")


if __name__ == "__main__":
    main()
