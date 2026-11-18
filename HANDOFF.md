# Handoff: picking this up on another machine

Status as of 2026-11-18 (end of the Windows session). Give this file to Claude Code first: "Read CLAUDE.md and HANDOFF.md, then continue the remaining steps."

## What is done and pushed
- Backend on Cloudflare (Worker `packaging-transition-advisor`, D1 `pta-db`, Vectorize `pta-chunks`, Workflow, weekly cron), all 10 workflows, cited generation + two-layer verification, cost calculator (Python + TS, tested), sourcing search, quota-aware Gemini routing.
- Corpus: 122 sources (109 non-news), 3,882 chunks, all embedded in Vectorize. `corpus/processed/` (chunks, documents, local seed SQL) and the public-domain/open-access raw files are committed; link-only pages are not (copyright) and re-fetch with `python scripts/fetch.py`.
- Front end (React + Vite, dark app shell, neutral accent), workflow canvas, product & current-packaging section, exports, replay mode, embed route.
- Acceptance suite + self-check, eval harness (45 questions), CI / refresh / uptime / eval / selfcheck GitHub Actions, docs.

## Not done yet (in order)
1. **Remote D1 migration + deploy.** D1's free read limit was exhausted on 2026-11-18 and resets at 00:00 UTC. Then:
   `cd worker && npx wrangler d1 migrations apply pta-db --remote` (applies `0002_fts_rowid.sql`), then
   `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $WORKER_URL/api/admin/recount`, then
   `npm run build --prefix ../app && npx wrangler deploy`.
2. **Regenerate the 3 replay examples** (they predate the product section; only `snack-pouch.json` exists):
   `for x in snack-pouch:snack_pouch cosmetics-bottle:cosmetics_bottle ecommerce-mailer:ecommerce_mailer; do python scripts/run_brief.py full_transition_brief --url $WORKER_URL --profile eval/profiles/${x#*:}.json --save app/public/examples/${x%%:*}.json; done`
   Optionally mark them in D1: `POST /api/admin/mark-example {"run_id": "...", "slug": "..."}`.
3. **Eval**: `python eval/run_eval.py --url $WORKER_URL --sleep 4` (writes `eval/results/<date>.md` and `docs/EVALUATION.md`).
4. **Baseline comparison + case study**: add an admin endpoint that asks the LLM the 3 example profiles with no retrieval; put both outputs side by side in `docs/CASE_STUDY.md` (brief section 16 outline).
5. **Screenshots**: `npm run preview:built --prefix app` then `node app/scripts/screenshots.mjs`; review desktop + mobile; fix anything off.
6. **Acceptance**: `python scripts/acceptance.py --live --repair`; fix failures until it passes; commit `docs/ACCEPTANCE.md`.
7. **GitHub repo secrets** (Settings → Secrets and variables → Actions): `WORKER_URL` = `https://packaging-transition-advisor.pta-worker.workers.dev`, `ADMIN_TOKEN` = the admin token (below).

## Secrets on the new machine (never committed)
- `cd worker && npx wrangler login` (Cloudflare OAuth in the browser).
- `ADMIN_TOKEN` lives only in the Windows `.env` and as a Worker secret. Easiest: make a new one and set it in both places:
  `python -c "import secrets;print(secrets.token_urlsafe(32))"` → put it in `.env` as `ADMIN_TOKEN=...`, then `python scripts/set_secret.py ADMIN_TOKEN --worker` (or paste into `PASTE_KEY_HERE.txt` and `python scripts/upload_key_file.py ADMIN_TOKEN`).
- `GEMINI_API_KEY` is already stored on the Worker (free-tier key, project with no billing). Only needed locally for `wrangler dev`: `python scripts/upload_key_file.py GEMINI_API_KEY --dev`.
- `.env`: copy `.env.example`, set `WORKER_URL` and `ADMIN_TOKEN`.

## Mac setup
```bash
git clone https://github.com/robbiecharlesschwartz-sudo/packaging-transition-advisor && cd packaging-transition-advisor
pip install -r requirements.txt
(cd worker && npm ci) && (cd app && npm ci)
```
The Windows-only workarounds (subst drive, short `--persist-to` path) are not needed on macOS.
