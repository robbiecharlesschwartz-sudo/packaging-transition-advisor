# Evaluation

45 hand-written questions (`eval/questions.yaml`): 10 regulatory, 6 end-of-life, 5 claims, 6 cost, 5 alternatives, 3 competitor, 5 sourcing, 5 trick questions the corpus cannot answer.
Scoring is described at the top of `eval/run_eval.py`. Citation precision here is an independent lexical check, not the pipeline's own verifier.

## Latest run (2026-11-18)

| Metric | Result |
|---|---|
| Questions run | 45 |
| Answer correctness: exact | 44/45 (98%) |
| Answer correctness: exact or partial | 44/45 (98%) |
| Citation precision (lexical check) | 73/111 cited claims (66%) |
| Retrieval recall (expected source retrieved) | 29/29 (100%) |
| Gap honesty (trick questions) | 5/5 |
| Cost math (worker = hand-checked calculator) | 6/6 |

| Category | Questions | Exact | Partial |
|---|---:|---:|---:|
| regulatory | 10 | 9 | 0 |
| end_of_life | 6 | 6 | 0 |
| claims | 5 | 5 | 0 |
| alternatives | 5 | 5 | 0 |
| competitor | 3 | 3 | 0 |
| trick | 5 | 5 | 0 |
| cost | 6 | 6 | 0 |
| sourcing | 5 | 5 | 0 |

Per-question results: [`eval/results/2026-11-18.md`](../eval/results/2026-11-18.md). Weaknesses are discussed in [CASE_STUDY.md](CASE_STUDY.md).

