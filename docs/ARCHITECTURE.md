# Architecture

## Components

| Piece | Where | Notes |
|---|---|---|
| Front end | `app/` (React + Vite + Tailwind, Recharts, react-simple-maps, React Flow) | Served by the Worker as static assets. Replay examples bundled in `app/public/examples/`. |
| API | `worker/src/index.ts` | `/api/run`, `/api/runs/:id`, `/api/meta`, `/api/sources`, `/api/search`, `/api/ppi`, `/api/state-laws`, `/api/admin/*` (bearer token). Per-IP and global daily caps on live runs. |
| Pipeline | `worker/src/workflow.ts` (Cloudflare Workflow) driven by `pipeline/steps.ts` | Steps: input → plan → retrieve → passages → cost → sourcing → write (1 step per 3 sections) → verify → report. Each step writes a row to `run_steps` (summary + detail) so the UI can replay it after Workflows' 3-day retention. |
| Retrieval | `worker/src/retrieval.ts` | Vectorize (cosine, 384-d, metadata filters on layer + jurisdiction) and D1 FTS5 (`bm25`), merged with reciprocal rank fusion (k = 60), then boosts: recency for regulation/prices/news, matching material/package tags, primary sources. Max 3 chunks per document. |
| LLM | `worker/src/llm.ts` | Gemini (main + lite, quota-aware), Anthropic optional, Workers AI fallback. Always JSON. |
| Verification | `worker/src/verify.ts` | Code checks (citations exist; numbers appear in cited passage / calculator output / profile) + LLM fact-check per claim. Unsupported claims are removed and listed. |
| Cost | `worker/src/cost/` (TS) mirrors `cost/` (Python) | Pure functions; both tested against `cost/tests/cases.json`. Inputs from `cost/price_inputs.json`, PPI factors from D1. |
| Sourcing | `worker/src/sourcing.ts` | Suppliers table (SEC 10-K quotes) + plant coordinates (Census Gazetteer) + haversine distance to sales-state population centers. |
| Data | D1 `pta-db` | `documents`, `chunks`, `chunks_fts` (FTS5, rowid-linked), `runs`, `run_steps`, `price_inputs`, `epr_fees`, `state_laws`, `ppi_series`, `suppliers`, `supplier_plants`, `rate_limits`, `corpus_changelog`, `meta`. Schema: `worker/migrations/`. |
| Ingestion | `scripts/` (Python) | fetch → parse (PyMuPDF / trafilatura / JATS XML) → chunk (~320–480 tokens, 80 overlap) → tag (keyword rules) → embed (via the Worker's admin endpoint, Workers AI) → load structured tables. |
| Refresh | Worker cron (weekly) + GitHub Actions | Cron: RSS headlines, BLS PPI, page hash checks. Actions: full refresh, eval, self-check, uptime, CI. |

## Request flow

1. `POST /api/run` validates the profile, applies the rate limit, inserts a `runs` row and starts a Workflow instance.
2. **plan**: the LLM writes 1–2 search queries per brief section and picks 2–4 alternatives from the material catalog (template queries are the fallback).
3. **retrieve**: all queries are embedded in one Workers AI call; each runs hybrid search with its section's layer filter and the profile's jurisdiction filter.
4. **passages**: per-section top-k, deduplicated and numbered globally; the cited state-law rows are added to the regulatory section.
5. **cost / sourcing** (when the workflow needs them): deterministic; their cited chunks are appended as numbered passages.
6. **write**: one LLM call per group of up to 3 sections; each section only sees its own passages (plus the calculator output or supplier table).
7. **verify**: code checks, then batched LLM fact-checks; verdicts are applied and status labels set.
8. **report**: summary and research to-do from verified claims only; KPIs; output saved to `runs.output`.

The front end polls `GET /api/runs/:id` and lights up the progress strip and workflow canvas from `run_steps`.

## Data licensing in the UI

Passages from `link_only` sources are used for retrieval and citation but their text is never displayed (the evidence panel shows title, date and link). Public demo passages come from `public_domain` (government, statutes, filings, public records) and `open_access` (CC BY papers, CC BY-SA references) documents only.
