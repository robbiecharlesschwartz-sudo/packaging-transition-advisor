"""Weekly corpus refresh (GitHub Actions: .github/workflows/refresh.yml).

1. Re-fetch every source; record which changed (content hash).
2. Pull new RSS items, latest BLS PPI values, US import unit values, latest 10-K filings.
3. Re-parse and re-chunk; rebuild cited price inputs and suppliers (fails loudly if a citation quote vanished).
4. Re-embed only changed documents; reload structured tables.
5. Append what changed to corpus/CHANGELOG.md (reg_status changes are called out).

The worker's own Cron Trigger (worker/src/refresh.ts) runs the light parts (RSS, PPI, page-hash checks)
every week even if this job is not configured.
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date

from common import CORPUS, RAW, load_sources, read_json

PY = sys.executable


def step(*args: str, allow_fail: bool = False) -> int:
    print(f"\n$ python scripts/{' '.join(args)}", flush=True)
    r = subprocess.run([PY, f"scripts/{args[0]}", *args[1:]], cwd=CORPUS.parent)
    if r.returncode and not allow_fail:
        raise SystemExit(f"{args[0]} failed ({r.returncode})")
    return r.returncode


def main() -> int:
    before = {s["doc_id"]: (read_json(RAW / f"{s['doc_id']}.meta.json", {}).get("sha256"), s.get("reg_status")) for s in load_sources()}
    step("fetch.py", "--force", allow_fail=True)
    for sub in ("rss", "ppi", "trade", "sec", "mn"):
        step("fetch_special.py", sub, allow_fail=True)
    step("parse.py", allow_fail=True)
    step("chunk.py")
    step("build_price_inputs.py")
    step("build_suppliers.py")
    step("embed.py", "--prune")
    step("load_structured.py")

    after = {s["doc_id"]: (read_json(RAW / f"{s['doc_id']}.meta.json", {}).get("sha256"), s.get("reg_status")) for s in load_sources()}
    changed = [d for d in after if d in before and after[d][0] != before[d][0]]
    added = [d for d in after if d not in before]
    status = [f"{d}: {before[d][1]} -> {after[d][1]}" for d in after if d in before and after[d][1] != before[d][1]]
    lines = [f"\n## {date.today().isoformat()}", f"- documents: {len(after)} ({len(added)} new, {len(changed)} changed)"]
    lines += [f"- new: {d}" for d in added[:40]]
    lines += [f"- changed: {d}" for d in changed[:40]]
    lines += [f"- **reg_status change** {s}" for s in status]
    log = CORPUS / "CHANGELOG.md"
    if not log.exists():
        log.write_text("# Corpus changelog\n\nWritten by `scripts/refresh.py` after each refresh.\n", encoding="utf-8")
    with open(log, "a", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(json.dumps({"new": len(added), "changed": len(changed), "status_changes": status}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
