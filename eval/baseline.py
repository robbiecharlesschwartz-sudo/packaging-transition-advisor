"""Baseline: the same model answers the 3 example profiles with NO retrieval (brief section 12).

Writes eval/results/baseline/<slug>.md. docs/CASE_STUDY.md compares these with the cited briefs.
Usage: python eval/baseline.py [--url http://127.0.0.1:8787]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from common import load_env  # noqa: E402

PROFILES = {"snack-pouch": "snack_pouch", "cosmetics-bottle": "cosmetics_bottle", "ecommerce-mailer": "ecommerce_mailer"}


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("EVAL_URL", "http://127.0.0.1:8787"))
    a = ap.parse_args()
    out_dir = ROOT / "eval" / "results" / "baseline"
    out_dir.mkdir(parents=True, exist_ok=True)
    for slug, prof in PROFILES.items():
        if (out_dir / f"{slug}.md").exists():
            print(f"{slug}: already done")
            continue
        profile = json.loads((ROOT / "eval" / "profiles" / f"{prof}.json").read_text(encoding="utf-8"))
        r = requests.post(f"{a.url.rstrip('/')}/api/admin/baseline", json={"profile": profile},
                          headers={"Authorization": f"Bearer {os.environ['ADMIN_TOKEN']}"}, timeout=1500)
        r.raise_for_status()
        j = r.json()
        lines = [f"# Baseline (no retrieval): {slug}", "", f"_Model: {j.get('model')} · same profile as the cited example · no documents, no citations, no verification_", ""]
        for s in j["data"].get("sections", []):
            lines += [f"## {s.get('title')}", "", str(s.get("text", "")).strip(), ""]
        (out_dir / f"{slug}.md").write_text("\n".join(lines), encoding="utf-8")
        print(f"{slug}: {len(j['data'].get('sections', []))} sections ({j.get('model')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
