# Packaging Transition Advisor — project context

RAG research agent (question → cited report) for sustainable-packaging transitions. Spec: the build brief (sections referenced in docs). Independent project: never reference an employer or internship.

## Stack (all free tier, $0/month)
- Cloudflare Worker `packaging-transition-advisor` (account subdomain `pta-worker`): API + static site + Workflow `BriefWorkflow` + weekly cron.
- D1 `pta-db` (id in `worker/wrangler.jsonc`), Vectorize `pta-chunks` (384-d, bge-small), Workers AI embeddings.
- Gemini free tier writes (key must be from an AI Studio project with NO billing); `GEMINI_MODEL` + fallback list in wrangler vars.
- React + Vite front end in `app/` (dark app shell, neutral accent, no blue — shared style for Robbie's RAG tools).

## Commands
- Deploy: `npm run build --prefix app && cd worker && npx wrangler deploy`
- Corpus: `python scripts/fetch.py && python scripts/fetch_special.py all && python scripts/parse.py && python scripts/chunk.py && python scripts/build_price_inputs.py && python scripts/build_suppliers.py && python scripts/embed.py && python scripts/load_structured.py`
- Tests: `python -m pytest cost/tests` and `cd worker && npx vitest run`
- Run end to end: `python scripts/run_brief.py <workflow> --profile eval/profiles/x.json [--url ...]`
- Acceptance: `python scripts/acceptance.py [--live] [--repair]`; eval: `python eval/run_eval.py`
- Secrets: paste into `PASTE_KEY_HERE.txt` then `python scripts/upload_key_file.py GEMINI_API_KEY [--dev]` (terminal paste of hidden input fails on this PC).

## Gotchas
- D1 free tier: 5M rows read/day. Never query FTS by an unindexed column; FTS rows are keyed by chunks.rowid. Avoid COUNT(*) per request (counts cached in `meta`).
- Windows long path: run wrangler/vite from `subst P:` and `--persist-to` a short folder; Vite dev can't load files via subst → use `npm run preview:built`.
- Bash tool mangles `\\` in heredocs → write patch scripts to a file.
- `wrangler dev` reloads on src change and kills in-flight Workflow runs.
- Every price input / fee / supplier tag must quote a corpus chunk; builders fail otherwise.

## Status
See README and docs/ACCEPTANCE.md. Docs: DECISIONS (D1–D27), FIXED_BY_HAND (1–17), EVALUATION, CASE_STUDY.
