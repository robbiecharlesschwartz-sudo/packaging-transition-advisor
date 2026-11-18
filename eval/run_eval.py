"""Run the 45-question evaluation against a worker and write eval/results/<date>.md + docs/EVALUATION.md.

Scores (brief section 12):
  answer correctness   exact / partial / wrong, from the expected answer patterns in questions.yaml
  citation precision   share of cited claims whose cited passage independently contains most of the claim's
                       content words (lexical check, separate from the pipeline's own LLM verifier)
  retrieval recall     an expected source document was among the retrieved passages
  gap honesty          trick questions answered with an Evidence Gap and no invented figures
  cost math            worker calculator output equals the hand-checked Python calculator on the same inputs

Usage: python eval/run_eval.py [--url http://127.0.0.1:8787] [--only R1,C3] [--sleep 2]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import date
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
sys.path.insert(0, str(ROOT / "cost"))
from common import load_env  # noqa: E402
from run_brief import run  # noqa: E402

from calculator import estimate  # noqa: E402

STOP = set("the a an and or of to in for on with by is are was were be been that this these those from as at it its into than "
           "under over per can may must not no which who what when where how their there they such also more most other".split())
MONEY = re.compile(r"[$¢]\s?\d|\d+(\.\d+)?\s?(cents|¢)")


def words(t: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9][a-z0-9.%-]*", t.lower()) if len(w) > 3 and w not in STOP}


def all_claims(out: dict) -> list[dict]:
    cl = []
    for s in out.get("sections", []):
        cl += [c for c in s.get("claims", []) if c.get("cites")]
    return cl


def citation_precision(out: dict) -> tuple[int, int]:
    byn = {p["n"]: p for p in out.get("passages", [])}
    ok = total = 0
    for c in all_claims(out):
        texts = [byn[n]["content"] for n in c["cites"] if n in byn and byn[n].get("content")]
        if not texts:
            continue  # link-only passages are not shown, so they cannot be checked here
        cw = words(c["text"])
        if not cw:
            continue
        total += 1
        pw = words(" ".join(texts))
        if len(cw & pw) / len(cw) >= 0.5:
            ok += 1
    return ok, total


def answer_text(out: dict) -> str:
    parts = []
    for s in out.get("sections", []):
        if s["kind"] == "gaps":
            continue
        parts.append(s.get("takeaway", ""))
        parts += [c["text"] for c in s.get("claims", [])]
    return " ".join(parts)


def score_qa(q: dict, out: dict) -> dict:
    exp = q["expect"]
    text = answer_text(out)
    docs = {p["document_id"] for p in out.get("passages", [])}
    res = {"id": q["id"], "q": q["q"]}
    sec = next((s for s in out.get("sections", []) if s["id"] == "answer"), {})
    res["status"] = sec.get("status")
    if exp.get("gap"):
        invented = any(MONEY.search(c["text"]) for c in sec.get("claims", []))
        honest = (not invented) and (sec.get("status") in ("Evidence Gap", "Partial") or not sec.get("claims")) and bool(
            sec.get("gaps") or sec.get("status") == "Evidence Gap" or re.search(r"not (contain|include|cover|provide|state|available)|no (information|data|passage)|does not", text, re.I))
        res.update(correct="exact" if honest else "wrong", gap_honest=honest, recall=None)
    else:
        groups = exp.get("all", [])
        hit = sum(1 for g in groups if re.search(g, text, re.I))
        res["correct"] = "exact" if hit == len(groups) else "partial" if hit >= max(1, len(groups) / 2) else "wrong"
        res["matched"] = f"{hit}/{len(groups)}"
        res["recall"] = bool(docs & set(exp.get("docs", [])))
    ok, tot = citation_precision(out)
    res["cite_ok"], res["cite_total"] = ok, tot
    return res


def score_cost(q: dict, out: dict, profile: dict) -> dict:
    sec = next((s for s in out.get("sections", []) if s["kind"] == "cost"), {})
    d = sec.get("data") or {}
    res = {"id": q["id"], "q": q.get("note", ""), "status": sec.get("status")}
    if not d.get("available"):
        res.update(correct="wrong", math="calculator not run")
        return res
    cat = json.loads((ROOT / "cost" / "price_inputs.json").read_text(encoding="utf-8"))
    laws = json.loads((ROOT / "corpus" / "structured" / "state_laws.json").read_text(encoding="utf-8"))
    ppi = {k: v["factor"] for k, v in (d.get("ppi") or {}).items()}
    opts = [{"key": o["key"], "label": o["label"], "is_current": o["is_current"]} for o in d["options"]]
    ref = estimate(profile, opts, cat, laws, ppi)
    mism = []
    for a, b in zip(d["options"], ref["options"]):
        for k in ("material_cost", "total_per_unit", "annual"):
            x, y = a.get(k), b.get(k)
            if (x is None) != (y is None) or (x and (abs(x["low"] - y["low"]) > 1e-6 * max(1, abs(y["low"])) or abs(x["high"] - y["high"]) > 1e-6 * max(1, abs(y["high"])))):
                mism.append(f"{a['key']}.{k}")
    ok = not mism
    extra = ""
    if q["id"] == "K4":
        fee = d["options"][0]["epr"].get("OR", {})
        ok = ok and abs(fee.get("low", 0) - 0.028 * 0.12 * 2.20462262) < 1e-4
        extra = f"OR fee/unit {fee.get('low', 0):.4f} (expected 0.0074)"
    if q["id"] == "K5":
        ok = ok and d["options"][0]["weight_g"]["low"] is None
        extra = "current weight correctly reported as a gap" if d["options"][0]["weight_g"]["low"] is None else "weight invented"
    res.update(correct="exact" if ok else "wrong", math="match" if not mism else "mismatch: " + ", ".join(mism), note=extra, confidence=d.get("confidence"))
    ok_c, tot_c = citation_precision(out)
    res["cite_ok"], res["cite_total"] = ok_c, tot_c
    return res


def score_sourcing(q: dict, out: dict) -> dict:
    sec = next((s for s in out.get("sections", []) if s["kind"] == "sourcing"), {})
    rows = [r for rs in ((sec.get("data") or {}).get("by_alternative") or {}).values() for r in rs]
    names = {r["company_name"] for r in rows}
    want = q["expect"]["suppliers"]
    if not want:
        ok = not rows
    else:
        ok = all(any(w.lower() in n.lower() for n in names) for w in want)
    cited = all(r.get("cites") for r in rows)
    return {"id": q["id"], "q": f"expect {want or 'no suppliers (gap)'}", "status": sec.get("status"),
            "correct": "exact" if ok and cited else "partial" if ok else "wrong", "found": sorted(names), "all_rows_cited": cited}


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.environ.get("EVAL_URL", "http://127.0.0.1:8787"))
    ap.add_argument("--only", default="")
    ap.add_argument("--sleep", type=float, default=2.0)
    a = ap.parse_args()
    token = os.environ.get("ADMIN_TOKEN", "")
    qs = yaml.safe_load((ROOT / "eval" / "questions.yaml").read_text(encoding="utf-8"))
    only = set(a.only.split(",")) if a.only else None
    raw_dir = ROOT / "eval" / "results" / "raw" / date.today().isoformat()
    raw_dir.mkdir(parents=True, exist_ok=True)
    results: dict[str, list] = {}

    def go(cat, q, workflow, question, profile):
        if only and q["id"] not in only:
            return None
        print(f"[{cat}] {q['id']} ...", flush=True)
        for attempt in range(2):
            try:
                j = run(a.url, token, workflow, question, profile, quiet=True, timeout_s=900)
                (raw_dir / f"{q['id']}.json").write_text(json.dumps(j, ensure_ascii=False), encoding="utf-8")
                time.sleep(a.sleep)
                if j.get("status") == "done":
                    return j["output"]
                print(f"   run error: {j.get('error')}")
            except Exception as e:  # noqa: BLE001
                print(f"   failed: {e}")
        return None

    for cat in ("regulatory", "end_of_life", "claims", "alternatives", "competitor", "trick"):
        for q in qs[cat]:
            prof = None
            if q.get("states") or q.get("markets"):
                prof = {"sales_states": q.get("states", []), "other_markets": q.get("markets", [])}
            out = go(cat, q, "free_question", q["q"], prof)
            if out is None and not (only and q["id"] not in only):
                results.setdefault(cat, []).append({"id": q["id"], "q": q["q"], "correct": "wrong", "error": "run failed"})
            elif out is not None:
                results.setdefault(cat, []).append(score_qa(q, out))
    for q in qs["cost"]:
        prof = q.get("profile_inline") or json.loads((ROOT / "eval" / "profiles" / f"{q['profile']}.json").read_text(encoding="utf-8"))
        out = go("cost", q, "cost_estimate", None, prof)
        if out is not None:
            results.setdefault("cost", []).append(score_cost(q, out, out.get("profile") or prof))
        elif not (only and q["id"] not in only):
            results.setdefault("cost", []).append({"id": q["id"], "q": q.get("note"), "correct": "wrong", "error": "run failed"})
    for q in qs["sourcing"]:
        out = go("sourcing", q, "sourcing_search", None, q["profile_inline"])
        if out is not None:
            results.setdefault("sourcing", []).append(score_sourcing(q, out))
        elif not (only and q["id"] not in only):
            results.setdefault("sourcing", []).append({"id": q["id"], "q": "", "correct": "wrong", "error": "run failed"})

    write_report(results)
    return 0


def pct(n, d):
    return f"{100 * n / d:.0f}%" if d else "n/a"


def write_report(results: dict) -> None:
    flat = [r for rs in results.values() for r in rs]
    exact = sum(r["correct"] == "exact" for r in flat)
    partial = sum(r["correct"] == "partial" for r in flat)
    rec = [r["recall"] for r in flat if r.get("recall") is not None]
    cite_ok = sum(r.get("cite_ok", 0) for r in flat)
    cite_tot = sum(r.get("cite_total", 0) for r in flat)
    trick = results.get("trick", [])
    cost = results.get("cost", [])
    rows = [
        ("Questions run", f"{len(flat)}"),
        ("Answer correctness: exact", f"{exact}/{len(flat)} ({pct(exact, len(flat))})"),
        ("Answer correctness: exact or partial", f"{exact + partial}/{len(flat)} ({pct(exact + partial, len(flat))})"),
        ("Citation precision (lexical check)", f"{cite_ok}/{cite_tot} cited claims ({pct(cite_ok, cite_tot)})"),
        ("Retrieval recall (expected source retrieved)", f"{sum(rec)}/{len(rec)} ({pct(sum(rec), len(rec))})"),
        ("Gap honesty (trick questions)", f"{sum(bool(r.get('gap_honest')) for r in trick)}/{len(trick)}"),
        ("Cost math (worker = hand-checked calculator)", f"{sum(r['correct'] == 'exact' for r in cost)}/{len(cost)}"),
    ]
    by_cat = [(c, len(rs), sum(r["correct"] == "exact" for r in rs), sum(r["correct"] == "partial" for r in rs)) for c, rs in results.items()]
    d = date.today().isoformat()
    lines = [f"# Evaluation run {d}", "", "| Metric | Result |", "|---|---|", *[f"| {a} | {b} |" for a, b in rows], "",
             "| Category | Questions | Exact | Partial |", "|---|---:|---:|---:|", *[f"| {c} | {n} | {e} | {p} |" for c, n, e, p in by_cat], ""]
    for c, rs in results.items():
        lines += [f"## {c}", "", "| ID | Question | Result | Detail |", "|---|---|---|---|"]
        for r in rs:
            det = r.get("error") or r.get("matched") or r.get("math") or (", ".join(r.get("found", [])) if "found" in r else "")
            if r.get("recall") is not None:
                det += f"; recall {'yes' if r['recall'] else 'no'}"
            if r.get("cite_total"):
                det += f"; cites {r['cite_ok']}/{r['cite_total']}"
            if r.get("note"):
                det += f"; {r['note']}"
            lines.append(f"| {r['id']} | {str(r.get('q', ''))[:90]} | {r['correct']} | {det} |")
        lines.append("")
    out = ROOT / "eval" / "results" / f"{d}.md"
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    (ROOT / "eval" / "results" / "latest.json").write_text(json.dumps({"date": d, "summary": dict(rows), "results": results}, indent=1), encoding="utf-8")
    ev = ROOT / "docs" / "EVALUATION.md"
    ev.write_text("\n".join([
        "# Evaluation", "",
        "45 hand-written questions (`eval/questions.yaml`): 10 regulatory, 6 end-of-life, 5 claims, 6 cost, 5 alternatives, 3 competitor, 5 sourcing, 5 trick questions the corpus cannot answer.",
        "Scoring is described at the top of `eval/run_eval.py`. Citation precision here is an independent lexical check, not the pipeline's own verifier.", "",
        f"## Latest run ({d})", "", "| Metric | Result |", "|---|---|", *[f"| {a} | {b} |" for a, b in rows], "",
        "| Category | Questions | Exact | Partial |", "|---|---:|---:|---:|", *[f"| {c} | {n} | {e} | {p} |" for c, n, e, p in by_cat], "",
        f"Per-question results: [`eval/results/{d}.md`](../eval/results/{d}.md). Weaknesses are discussed in [CASE_STUDY.md](CASE_STUDY.md).", "",
    ]) + "\n", encoding="utf-8")
    print("\n".join(f"{a}: {b}" for a, b in rows))


if __name__ == "__main__":
    sys.exit(main())
