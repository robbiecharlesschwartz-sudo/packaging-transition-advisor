"""Acceptance suite: checks the build against the brief's "Definition of done" (section 14) and core rules.

  python scripts/acceptance.py                       static + deployed checks (no LLM quota used)
  python scripts/acceptance.py --live                also runs the core agent and all 10 workflows end to end
  python scripts/acceptance.py --repair              apply safe automatic repairs, then re-check

Writes docs/ACCEPTANCE.md and exits 1 if any required check fails (the weekly self-check workflow then opens an issue).
Safe repairs: recount corpus counters, reload empty structured tables, re-embed documents whose content hash drifted.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import date

import requests

from common import PROCESSED, ROOT, load_env, read_json

CHECKS: list[dict] = []


def check(name: str, ok: bool, detail: str = "", required: bool = True) -> bool:
    CHECKS.append({"name": name, "ok": bool(ok), "detail": detail, "required": required})
    print(f"{'PASS' if ok else ('FAIL' if required else 'WARN')}  {name}  {detail}")
    return ok


def get(url: str, **kw):
    try:
        return requests.get(url, timeout=60, **kw)
    except Exception as e:  # noqa: BLE001
        class R:  # minimal stand-in so checks can report the failure
            status_code, text = 0, str(e)
            def json(self):
                return {}
        return R()


def static_checks() -> None:
    dec = (ROOT / "docs" / "DECISIONS.md").read_text(encoding="utf-8")
    check("$0/month running cost recorded in DECISIONS.md", "$0/month" in dec)
    fixed = (ROOT / "docs" / "FIXED_BY_HAND.md").read_text(encoding="utf-8")
    n_fixed = len(re.findall(r"^\| \d+ \|", fixed, re.M))
    check("FIXED_BY_HAND.md has real entries", n_fixed >= 5, f"{n_fixed} entries")
    cat = json.loads((ROOT / "cost" / "price_inputs.json").read_text(encoding="utf-8"))
    uncited = [i["id"] for i in cat["inputs"] + cat["epr_fees"] if not i.get("chunk_id")]
    check("every cost input and fee is cited to a corpus chunk", not uncited, f"{len(cat['inputs'])} inputs, {len(cat['epr_fees'])} fees")
    r = subprocess.run([sys.executable, "-m", "pytest", "-q", "cost/tests"], cwd=ROOT, capture_output=True, text=True)
    check("cost calculator unit tests pass", r.returncode == 0, (r.stdout.strip().splitlines() or [""])[-1])
    wf = list((ROOT / "workflows").glob("*.yaml"))
    wf = [w for w in wf if not w.name.startswith("_")]
    check("10 workflow definitions present", len(wf) == 10, f"{len(wf)} found")
    for w in wf:
        t = w.read_text(encoding="utf-8")
        missing = [k for k in ("id:", "name:", "description:", "filters:", "top_k:", "system_prompt:", "output_schema:", "sections:") if k not in t]
        if missing:
            check(f"workflow {w.stem} has all required keys", False, f"missing {missing}")
    sources = (ROOT / "corpus" / "sources.csv").read_text(encoding="utf-8")
    check("no employer or internship references in corpus list", not re.search(r"internship|employer", sources, re.I))
    secrets = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True).stdout.split()
    leaked = [f for f in secrets if f in (".env", "worker/.dev.vars", "PASTE_KEY_HERE.txt")]
    check("no secret files tracked by git", not leaked, ", ".join(leaked))
    wr = (ROOT / "worker" / "wrangler.jsonc").read_text(encoding="utf-8")
    check("weekly refresh: Cron Trigger configured", '"crons"' in wr)
    check("weekly refresh: GitHub Actions workflow present", (ROOT / ".github" / "workflows" / "refresh.yml").exists())
    shots = list((ROOT / "docs" / "screenshots").glob("*.png"))
    check("screenshots saved (desktop + mobile)", any("desktop" in s.name for s in shots) and any("mobile" in s.name for s in shots), f"{len(shots)} files")
    ev = (ROOT / "docs" / "EVALUATION.md")
    check("evaluation run completed and published", ev.exists() and "Latest run" in ev.read_text(encoding="utf-8"))
    for slug in ("snack-pouch", "cosmetics-bottle", "ecommerce-mailer"):
        p = ROOT / "app" / "public" / "examples" / f"{slug}.json"
        j = read_json(p, {})
        out = j.get("output") or {}
        secs = {s["kind"]: s for s in out.get("sections", [])}
        check(f"replay example {slug} is a complete run", j.get("status") == "done" and len(secs) >= 9, f"{len(secs)} section kinds")
        cost = (secs.get("cost") or {}).get("data") or {}
        check(f"{slug}: cost table with cited ranges", bool(cost.get("available") and any(o.get("total_per_unit") for o in cost.get("options", []))
                                                          and all(i.get("chunk_id") for i in cost.get("inputs", []))))
        src = (secs.get("sourcing") or {}).get("data") or {}
        rows = [r for rs in (src.get("by_alternative") or {}).values() for r in rs]
        check(f"{slug}: sourcing shortlist + map points", bool(rows) and bool(src.get("plants")), f"{len(rows)} suppliers, {len(src.get('plants', []))} plants",
              required=False)
        labeled = all(s.get("status") in ("Grounded", "Partial", "Evidence Gap") for s in out.get("sections", []))
        check(f"{slug}: every section has a status label", labeled)
        claims = [c for s in out.get("sections", []) for c in s.get("claims", [])]
        check(f"{slug}: every claim carries citations", all(c.get("cites") for c in claims), f"{len(claims)} claims")


def deployed_checks(url: str, token: str) -> None:
    r = get(f"{url}/api/health")
    check("deployed worker responds", r.status_code == 200, url)
    page = get(url)
    check("site serves the front end", page.status_code == 200 and "Packaging Transition Advisor" in page.text)
    ex = get(f"{url}/examples/snack-pouch.json")
    check("replay works without any API key (static example served)", ex.status_code == 200 and '"status": "done"' in ex.text[:2000] or '"status":"done"' in ex.text[:2000])
    m = get(f"{url}/api/meta").json() or {}
    check("60+ documents ingested (excluding news)", (m.get("documents_excluding_news") or 0) >= 60, f"{m.get('documents_excluding_news')} docs, {m.get('chunks')} chunks")
    src = get(f"{url}/api/sources").json() or []
    bad = [s["id"] for s in src if not all(s.get(k) for k in ("layer", "jurisdiction", "license", "reliability"))]
    check("every document has layer / jurisdiction / license / reliability", src and not bad, f"{len(src)} docs, {len(bad)} incomplete")
    lic = {s.get("license") for s in src}
    check("license tags limited to public_domain / open_access / link_only", lic <= {"public_domain", "open_access", "link_only"}, str(sorted(lic)))
    gh = get("https://api.github.com/repos/robbiecharlesschwartz-sudo/packaging-transition-advisor").json() or {}
    check("public GitHub repo exists", gh.get("private") is False, gh.get("html_url", ""))


def live_checks(url: str, token: str) -> None:
    sys.path.insert(0, str(ROOT / "scripts"))
    from run_brief import run
    j = run(url, token, "free_question", "Which states have packaging EPR laws in force, and when do fees start?", None, quiet=True)
    out = j.get("output") or {}
    ans = next((s for s in out.get("sections", []) if s["id"] == "answer"), {})
    check("core research agent: question -> cited report", j.get("status") == "done" and any(c.get("cites") for c in ans.get("claims", [])),
          f"{len(ans.get('claims', []))} claims, status {ans.get('status')}")
    prof = json.loads((ROOT / "eval" / "profiles" / "ecommerce_mailer.json").read_text(encoding="utf-8"))
    for wf in ("regulatory_scan", "alternatives_fit", "end_of_life_check", "claims_check", "cost_estimate", "competitor_scan",
               "sourcing_search", "market_entry_overview", "full_transition_brief"):
        j = run(url, token, wf, None, prof, quiet=True, timeout_s=1200)
        out = j.get("output") or {}
        ok = j.get("status") == "done" and all(s.get("status") for s in out.get("sections", []))
        check(f"workflow {wf} returns labeled output", ok, j.get("error") or f"{len(out.get('sections', []))} sections")


def repair(url: str, token: str) -> None:
    h = {"Authorization": f"Bearer {token}"}
    print("repair: recount corpus counters")
    requests.post(f"{url}/api/admin/recount", headers=h, timeout=60)
    m = get(f"{url}/api/meta").json() or {}
    if not m.get("chunks"):
        print("repair: corpus empty -> re-embed all documents")
        subprocess.run([sys.executable, "scripts/embed.py", "--all"], cwd=ROOT)
    else:
        print("repair: re-embed documents whose content hash drifted")
        subprocess.run([sys.executable, "scripts/embed.py", "--prune"], cwd=ROOT)
    print("repair: reload structured tables")
    subprocess.run([sys.executable, "scripts/load_structured.py"], cwd=ROOT)


def write_report() -> int:
    req_fail = [c for c in CHECKS if c["required"] and not c["ok"]]
    lines = [f"# Acceptance report ({date.today().isoformat()})", "",
             f"**{sum(c['ok'] for c in CHECKS)}/{len(CHECKS)} checks pass** · required failures: {len(req_fail)}", "",
             "Generated by `scripts/acceptance.py` against the brief's Definition of done (section 14).", "",
             "| Check | Result | Detail |", "|---|---|---|"]
    lines += [f"| {c['name']} | {'pass' if c['ok'] else ('FAIL' if c['required'] else 'warn')} | {c['detail']} |" for c in CHECKS]
    (ROOT / "docs" / "ACCEPTANCE.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return 1 if req_fail else 0


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("WORKER_URL", "https://packaging-transition-advisor.pta-worker.workers.dev"))
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--repair", action="store_true")
    ap.add_argument("--static-only", action="store_true")
    a = ap.parse_args()
    url, token = a.url.rstrip("/"), os.environ.get("ADMIN_TOKEN", "")
    if a.repair and token:
        repair(url, token)
    static_checks()
    if not a.static_only:
        deployed_checks(url, token)
    if a.live:
        live_checks(url, token)
    return write_report()


if __name__ == "__main__":
    sys.exit(main())
