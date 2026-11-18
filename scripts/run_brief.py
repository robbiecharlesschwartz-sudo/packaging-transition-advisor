"""Start a workflow run on the worker, follow its steps, and print the cited report.

  python scripts/run_brief.py free_question --question "Is PLA compostable in New York City's program?"
  python scripts/run_brief.py full_transition_brief --profile eval/profiles/snack_pouch.json
  python scripts/run_brief.py regulatory_scan --profile p.json --save out.json --url http://127.0.0.1:8787
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import requests

from common import load_env


def run(url: str, token: str, workflow: str, question: str | None, profile: dict | None, slug: str | None = None,
        timeout_s: int = 900, quiet: bool = False) -> dict:
    body = {"workflow_id": workflow, "question": question, "profile": profile}
    if slug:
        body["example_slug"] = slug
    r = requests.post(f"{url}/api/run", json=body, headers={"Authorization": f"Bearer {token}"}, timeout=120)
    r.raise_for_status()
    rid = r.json()["run_id"]
    seen, t0 = set(), time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(4)
        j = requests.get(f"{url}/api/runs/{rid}", timeout=60).json()
        for s in j.get("steps", []):
            k = (s["step_id"], s["status"])
            if k not in seen and not quiet:
                seen.add(k)
                print(f"  [{time.time() - t0:5.0f}s] {s['step_id']:10} {s['status']:7} {json.dumps(s['summary'])[:150]}")
        if j.get("status") in ("done", "error"):
            return j
    raise TimeoutError(f"run {rid} did not finish in {timeout_s}s")


def show(j: dict) -> None:
    print(f"\nstatus={j['status']} model={j.get('model')} error={j.get('error')}")
    out = j.get("output") or {}
    for s in out.get("sections", []):
        print(f"\n## {s['title']}  [{s.get('status')}]\n   ** {s['takeaway']}")
        for c in s["claims"]:
            print(f"   - {c['text']} {c['cites']} ({c.get('verdict')})")
        for c in s.get("removed") or []:
            print(f"   x REMOVED: {c['text'][:140]} -- {c.get('note')}")
        for g in s.get("gaps", [])[:8]:
            print(f"   ? {g}")
    if out.get("kpis"):
        print("\nKPIs:", json.dumps(out["kpis"]))
        print("Stats:", json.dumps(out["stats"]))


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("workflow")
    ap.add_argument("--question")
    ap.add_argument("--profile")
    ap.add_argument("--url", default=os.environ.get("WORKER_URL", "http://127.0.0.1:8787"))
    ap.add_argument("--save")
    ap.add_argument("--slug")
    a = ap.parse_args()
    prof = json.load(open(a.profile, encoding="utf-8")) if a.profile else None
    j = run(a.url.rstrip("/"), os.environ.get("ADMIN_TOKEN", ""), a.workflow, a.question, prof, a.slug)
    show(j)
    if a.save:
        json.dump(j, open(a.save, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    return 0 if j["status"] == "done" else 1


if __name__ == "__main__":
    sys.exit(main())
