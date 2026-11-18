# Decisions

Every non-obvious choice, with the reason. Newest decisions are appended at the bottom of each section.

## Platform and cost ($0/month)

**D1. Cloudflare free tier is the platform (brief 8.3a, not the Option B fallback).**
Checked 2026-11-18 against Cloudflare's docs:

| Service | Free-tier limit (checked 2026-11-18) | Our use |
|---|---|---|
| Workers | 100k requests/day, 10 ms CPU per invocation | API + static site; CPU work is kept small (I/O waits do not count) |
| Workflows | 1,024 steps/workflow, 100 concurrent instances, 10 ms CPU/step, 1 MiB per step result, state kept 3 days | 9 named steps per run |
| Vectorize | 5M stored dimensions, 30M queried dimensions/month, topK 50 with metadata, 10 metadata indexes | 384-dim vectors → room for ~13,000 chunks; each query = 384 dims |
| D1 | 5 GB storage, 5M rows read/day | documents, chunks, FTS5 index, runs, structured tables |
| Workers AI | 10,000 neurons/day; bge-small-en-v1.5 = 1,841 neurons per million tokens | embeddings only (see D2) |
| Cron Triggers | included | weekly refresh |

No paid plan, no payment method, no server. Result: **$0/month**.

**D2. Gemini (free tier) writes the reports; Workers AI only embeds.** (Owner's direction.) Llama-class models on Workers AI cost ~25k–75k neurons per million tokens, so a single full brief could use a large part of the 10k/day neuron budget. Gemini's free tier has far more headroom for generation. `worker/src/llm.ts` abstracts the provider: `gemini` (default), `anthropic` (swap in with `LLM_PROVIDER=anthropic` + `ANTHROPIC_API_KEY`), and `workers-ai` (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) used only as an automatic fallback when no Gemini key is set or Gemini is rate-limited. The model id is a config var (`GEMINI_MODEL`) with a fallback list, because Google renames models often; Gemini's rate-limit page no longer lists per-model free limits publicly (it points to the per-project page in AI Studio), so the worker treats HTTP 429 as "try the next model, then the fallback provider".

**D3. React + Vite front end instead of Next.js.** (Owner's direction.) `@cloudflare/next-on-pages` adds build complexity and edge-runtime constraints for no benefit here: the app is a single-page client that calls one API.

**D4. Workers Static Assets instead of Cloudflare Pages.** The built React app (`app/dist`) is served by the same Worker that serves `/api/*`. One deploy, one URL, one free tier, and it is Cloudflare's current recommended way to host a front end with an API. Pages would also be free; this simply removes a second project to keep in sync.

**D5. R2 is not used.** Enabling R2 requires adding a payment method to the account, which the brief rules out. Raw downloads live in `corpus/raw/` (gitignored) and can always be re-created from `corpus/sources.csv` with `scripts/fetch.py`. Parsed text and chunks are stored in D1.

**D6. Embedding model: `@cf/baai/bge-small-en-v1.5` (384 dims).** The same model runs at ingest (through the worker's admin endpoint, so Python never needs a Cloudflare API token) and at query time. bge-base (768 dims) would halve the chunk capacity under the 5M stored-dimension limit and costs 3.3x more neurons.

**D7. No `supabase/` folder.** The brief's schema (8.4) is implemented as D1 SQL in `worker/migrations/`. Postgres arrays become JSON text columns; vectors live in Vectorize; `tsvector` becomes an FTS5 virtual table (`chunks_fts`).

**D8. Step logs are copied into D1 (`run_steps`).** Workflows keeps instance state for only 3 days on the free plan, but the replay mode and the node-graph view need step inputs/outputs indefinitely. Each step writes its own summary and detail row as it finishes; the UI reads those rows, never a canned animation.

**D9. Python 3.12** is what is installed; nothing in the scripts depends on 3.11 specifically.
