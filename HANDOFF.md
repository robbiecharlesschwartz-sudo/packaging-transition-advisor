# Handoff: picking this up on another machine

Status as of 2026-11-18 (end of the Windows session). Give this file to Claude Code first: "Read CLAUDE.md and HANDOFF.md, then continue the remaining steps."

## What is done and pushed
- Backend on Cloudflare (Worker `packaging-transition-advisor`, D1 `pta-db`, Vectorize `pta-chunks`, Workflow, weekly cron), all 10 workflows, cited generation + two-layer verification, cost calculator (Python + TS, tested), sourcing search, quota-aware Gemini routing.
- Corpus: 122 sources (109 non-news), 3,882 chunks, all embedded in Vectorize. `corpus/processed/` (chunks, documents, local seed SQL) and the public-domain/open-access raw files are committed; link-only pages are not (copyright) and re-fetch with `python scripts/fetch.py`.
- Front end (React + Vite, dark app shell, neutral accent), workflow canvas, product & current-packaging section, exports, replay mode, embed route.
- Acceptance suite + self-check, eval harness (45 questions), CI / refresh / uptime / eval / selfcheck GitHub Actions, docs.

## Done since the first handoff (local, before the D1 reset)
- 3 replay examples regenerated with the product section (all sections Grounded/Partial).
- 45-question eval: 44/45 exact, recall 100%, gap honesty 5/5, cost math 6/6, citation precision 66% (`docs/EVALUATION.md`).
- No-retrieval baseline + `docs/CASE_STUDY.md`; final screenshots; static acceptance 26/26.

## Remaining (needs the D1 read limit reset at 00:00 UTC = 7:00 PM ET)
1. `cd worker && npx wrangler d1 migrations apply pta-db --remote` (applies `0002_fts_rowid.sql`)
2. `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $WORKER_URL/api/admin/recount`
3. `npm run build --prefix ../app && npx wrangler deploy`
4. `python scripts/acceptance.py --live --repair` and fix anything that fails.
5. GitHub repo secrets `WORKER_URL` and `ADMIN_TOKEN` (Settings → Secrets and variables → Actions).

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
