# UnoCX AI – Evaluation metrics and improvement guide

A pass/fail score tells you *that* the assistant is wrong. These metrics tell you **which part of
the pipeline is wrong and what to change**, so every improvement is targeted and measurable.

There are two sources of metrics:

| | Before release | After release |
|---|---|---|
| Data | the labelled test set (`tests/eval_cases.yaml`) | real conversations (`ai.agent_runs`) |
| Tool | `python -m scripts.run_eval` → `eval_results/<time>.md` | `GET /v1/insights/quality` |
| Knows the right answer? | yes, so it can blame a stage | no, so it uses signals (misses, thumbs-down, low confidence) |
| Use it to | accept or reject a change | find what to add to the test set next |

## 1. What is measured at each stage

Every reply now carries a `trace` (timings per stage, the top-5 retrieved chunks with scores,
whether the relevance gate passed, unsupported numbers) and a `confidence` from 0 to 1.

```
 message ─▶ rules ─▶ flows ─▶ embed ─▶ cache ─▶ retrieval ─▶ gate ─▶ LLM ─▶ post-checks ─▶ reply
            │          │                          │           │       │          │
   guardrail FP/miss  flow routing        Hit@1, Recall@5   sweep  generation  unsupported
   handover P/R                           MRR, ranking            refusals     numbers
```

| Stage | Metrics | Bad sign |
|---|---|---|
| Rules (safety, handover) | handover precision / recall, guardrail false-positive rate, security pass rate | normal questions blocked; "talk to someone" not handed over |
| Flows | flow-routing failures | a greeting flow catching real questions |
| Retrieval | **Hit@1** (right article ranked first), **Recall@5** (right article anywhere in the 5 sent to the model), **MRR** | Recall@5 low means missing or badly written content; Hit@1 low with Recall@5 high means a ranking problem |
| Relevance gate | threshold sweep, gate_too_strict / answered_out_of_scope counts | right article found but rejected, or off-topic questions answered |
| Generation | generation / generation_refused counts, hallucinated-number rate, language failures | right article given, wrong reply |
| Whole system | pass rate by category, p50/p90 latency per stage, cost per answer, free-reply share, stability across repeats | |

## 2. Running an evaluation

```bash
python -m scripts.run_eval                      # full set; compares with the previous run automatically
python -m scripts.run_eval --only P,F,T         # a subset by id prefix
python -m scripts.run_eval --repeat 3           # each case 3x: measures answer stability (real model)
python -m scripts.run_eval --baseline eval_results/20261109-101500.json
```

The console prints the scorecard, regressions and top actions. The report
(`eval_results/<time>.md`) has these sections, in the order you should read them:

1. **Scorecard**: the go/no-go metrics against targets.
2. **Change vs previous run**: regressions (passed before, fail now) and fixes. A change that fixes
   3 cases and breaks 1 needs a look at that 1 before you ship.
3. **What to fix first**: ranked actions, each tied to a stage, a fix and the affected cases.
4. **Where failures come from**: every failure blamed on one stage (table below).
5. Detail sections: retrieval, handover confusion matrices, safety signals, threshold sweep,
   confidence calibration, latency by stage, routing and cost, stability, then every reply.

## 3. Scorecard targets

| Metric | Definition | Target |
|---|---|---|
| Policy & FAQ pass rate | P cases passed / P cases run | ≥ 85% |
| Handover recall | of steps that should hand over, how many did | 100% |
| Security pass rate | I cases passed / run | 100% |
| Guardrail false-positive rate | answerable questions answered by a rule (blocked or handed over) | 0% |
| Hallucinated-number rate | AI answers containing a number found in no retrieved article and not in the question | 0% |
| Retrieval Recall@5 | cases where a gold article is in the top 5 | ≥ 90% |
| p90 latency | 90th percentile of total server time | < 8,000 ms |

Change the targets in `TARGETS` in `app/evaluation.py`.

## 4. Failure causes and what to change

Each failed step is blamed on exactly one cause. The rules are in `diagnose()` in
`app/evaluation.py`; they rely on the **gold article** labels (`gold:` in the YAML) to tell a
retrieval problem from a generation problem.

| Cause | Stage | How it's detected | What to change |
|---|---|---|---|
| `retrieval_miss` | retrieval | gold article not in the top 5 | add the customer's wording to the article or as an FAQ; split long articles with clearer `##` headings; check the content exists (`/v1/insights/gaps`) |
| `ranking` | retrieval | gold article in the top 5 but not first, and the reply was wrong | make headings more specific; remove overlapping articles |
| `gate_too_strict` | relevance gate | gold article retrieved, but "no relevant knowledge" | lower the threshold to the value suggested by the sweep |
| `answered_out_of_scope` | relevance gate | answered a question that should have been declined | raise the threshold; strengthen the HANDOVER rule in the prompt |
| `generation_refused` | generation | gold article was in the prompt but the model said HANDOVER | relax the "answer only from articles" rule for partial answers, or try a stronger model |
| `generation` | generation | gold article ranked first, but the reply was wrong | add a prompt rule for this pattern (false premise, limits, partial answers) or try a stronger model |
| `hallucinated_number` | generation | reply has an unsupported number | prompt rule; consider handing over when this flag appears |
| `order_intent_miss` | order intent | an order question (expected route `tool`) wasn't recognised | add the wording to `ORDER_EXAMPLES` in `app/intent.py`, or lower `ORDER_INTENT_OPENAI` (see the sweep) |
| `order_intent_false_trigger` | order intent | a general question was answered as an order lookup | add the wording to `POLICY_EXAMPLES`, or raise `ORDER_INTENT_OPENAI` / `ORDER_INTENT_MARGIN` |
| `language` | generation | reply in the wrong script or language | language rule in the prompt; stronger model for Indian languages |
| `guardrail_false_positive` | rules | a rule replied to an answerable question | narrow the pattern in `app/guardrails.py`; add a negative unit test |
| `guardrail_miss` | rules | should have handed over or blocked, but answered | add the phrase to `HUMAN_PATTERNS`, `SENSITIVE` or `INJECTION_PATTERNS` |
| `unexpected_handover` | rules | handed over when an answer was expected | see the handover confusion matrix for the reason that fired |
| `flow_routing` | flows | a keyword flow caught or missed a message | adjust keywords, `match_type` or `max_words` |
| `ambiguity_clarify` | retrieval | asked "which do you mean?" when one answer was expected | merge or retitle near-duplicate articles |

### Worked examples (both verified on this codebase)

**Threshold set too high.** With the gate raised from 0.12 to 0.33 (fake mode), the report
showed: 1 regression (P20), cause `gate_too_strict` (the right article was ranked first but
rejected), and the sweep recommended lowering the threshold to about 0.24. Retrieval metrics stayed
at 100%, correctly showing retrieval wasn't the problem.

**Missing content.** With the shipping article removed, Recall@5 dropped to 73% on the scorecard
and 7 failures were blamed on `retrieval_miss` (P03, P09, F01, F05, O06, O07). The fix is content,
not prompts or thresholds.

## 5. The threshold sweep

The relevance gate decides whether the assistant answers or says "I couldn't find that". The sweep
takes every question that reached retrieval, splits them into *answerable* (expected answered) and
*out of scope* (expected clarify or handover), and shows for each threshold how many of each would
get an answer. The recommended value maximises **Youden's J** = answerable answered − out-of-scope
answered; ties go to the value closest to the current one.

Notes: the sweep uses only the best similarity score. The live gate also accepts a keyword match
slightly below the threshold, so real behaviour is a little more permissive than the table. The
sweep needs at least 3 answerable and 2 out-of-scope cases; most out-of-scope cases are `llm_only`,
so run it with the real model. Re-run the full set after changing `MIN_SIMILARITY_OPENAI`.

## 5b. Order-intent sweep

Order questions are recognised in three layers: fixed phrases (keyword), similarity of meaning to
example order questions versus example policy questions (layer 2), and the AI itself for unsure cases
(layer 3). The report shows how many were caught by each layer and sweeps the layer-2 threshold over
the W cases: order questions caught versus general questions wrongly sent to the order lookup. The
`ORDER_INTENT_OPENAI` default (0.50) is a starting point, not a measured value: set it from the first
run with `LLM_PROVIDER=openai`. Sweeps from fake mode reflect word overlap only and are labelled so.

## 5c. Conversation quality

Resolving the customer's issue comes before speed. The report's "Conversation quality" section counts,
across all multi-step cases: repeated replies (must be 0; every case fails automatically on one),
repeats avoided by changing approach, unhappy customers detected, unresolved handovers, order problems
recognised and complaints raised. Failure causes `repeated_reply` and `order_issue_missed` point to the
fix. After release, the same signals are in `GET /v1/insights/quality` (`repeat_avoided_rate`,
`unhappy_customer_rate`, `unresolved_handover_rate`, `order_problems`), and those conversations are in
its review queue.

## 6. Confidence and calibration

`confidence` (0–1) is returned with every reply and stored in `ai.agent_runs`:

| Route | Confidence |
|---|---|
| flow, guardrail | 1.0 (deterministic) |
| cache | 0.95 (answer rated helpful at least twice) |
| rag | up to 0.7 from retrieval strength (best similarity relative to the gate), +0.1 if keyword search agreed, +0.15 if the top article was cited, +0.05 if the top results come from the same source; −0.3 if the reply has unsupported numbers; capped at 0.2 if the gate failed or the model declined |
| fallback | none |

**Calibration** checks whether this score means anything: the report shows the pass rate for
each confidence bucket, and it should rise from low to high. Until it does with the real model,
don't use confidence to make handover decisions; use it to sort the review queue. Tune the weights
in `_confidence()` in `app/agent.py`, then re-run and compare.

## 7. Hallucinated numbers

Most harmful support errors involve numbers: a wrong price, day count, date or limit. After every
AI answer, `unsupported_numbers()` lists numbers in the reply that appear neither in the retrieved
articles nor in the customer's message. They are returned in `trace.unsupported_numbers`, flagged
`unsupported_number`, lower the confidence, and are counted in both the eval and production
metrics. It is cheap and model-free; it does not catch wrong statements without numbers, which
the content checks and the weekly review cover.

## 8. Production metrics: `GET /v1/insights/quality`

`?workspace_id=ws_unocx&days=7&low_confidence=0.5`

| Field | What it tells you |
|---|---|
| `rates.likely_resolution_rate` | conversations ending in an answer, with no handover and no thumbs-down |
| `rates.knowledge_miss_rate` | messages with no relevant article: content gaps (details in `/v1/insights/gaps`) |
| `rates.handover_rate` + `handover_reasons` | why people are passed to the team |
| `rates.clarify_then_handover_rate` | asked to rephrase, still failed: the article is probably missing |
| `rates.thumbs_down_rate` | share of rated answers marked unhelpful |
| `rates.low_confidence_answer_rate`, `rates.unsupported_number_rate` | risky answers that went out |
| `rates.free_reply_share`, `rates.cost_per_answer_usd` | efficiency: flows and cache vs paid AI calls |
| `articles` | per cited article: answers, thumbs up/down, average confidence, unsupported numbers. **Articles at the top produce the worst answers: rewrite them first** |
| `latency_by_stage` | p50/p90 per stage; the top row (after `total`) is the bottleneck |
| `review_queue` | the 20 latest risky answers (low confidence, unsupported number, or thumbs-down) to read |

## 9. The improvement loop

Once a week:

1. Open `/v1/insights/quality` for the last 7 days. Read the `review_queue` and the top 3 `articles`.
2. Turn every real failure into a test case in `tests/eval_cases.yaml`, with a `gold` article.
3. Run `python -m scripts.run_eval`. The new cases should fail and be blamed on a stage.
4. Make **one** change for the top cause in "What to fix first" (content, threshold, prompt rule,
   guardrail pattern or model).
5. Re-run. Ship only if the target cases are fixed, there are no regressions, and the scorecard
   is green.
6. Keep the report JSON. Each run compares with the previous one automatically.

Changing several things at once makes the comparison meaningless. One change per run.

## 10. Limits

- In fake mode the metrics test plumbing, rules and retrieval only; answer quality, languages and
  calibration need `LLM_PROVIDER=openai`.
- Gold labels match on article titles. If you rename headings, update the `gold` values.
- `likely_resolution_rate` is a proxy: a customer who leaves without rating after a wrong answer
  still counts as resolved. Read it together with thumbs-down and the review queue.
