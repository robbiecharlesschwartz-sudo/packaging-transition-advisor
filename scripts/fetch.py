"""Download every source in corpus/sources.csv into corpus/raw/.

Usage:
  python scripts/fetch.py               # fetch missing
  python scripts/fetch.py --force       # re-fetch all
  python scripts/fetch.py --only id1,id2
  python scripts/fetch.py --check       # report status without saving

Formats (sources.csv `format` column):
  auto      pdf or html, decided by Content-Type
  fr        Federal Register API document (fetch_url = API json url)
  ecfr      eCFR renderer HTML for a CFR part
  epmc      Europe PMC open-access full text (fetch_url = PMCID)
  sec10k    latest 10-K from SEC EDGAR (fetch_url = CIK); handled by fetch_sec.py
  generated text produced by another script (pull_ppi.py, pull_trade_prices.py, ...)
  link_only only the page's own title/description are kept
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor

from common import RAW, http_get, load_sources, read_json, sha256_bytes, today, write_json

EXT_BY_CT = {"application/pdf": "pdf", "text/html": "html", "application/xhtml+xml": "html",
             "text/plain": "txt", "application/xml": "xml", "text/xml": "xml", "application/json": "json"}


def guess_ext(ct: str, url: str, body: bytes) -> str:
    ct = (ct or "").split(";")[0].strip().lower()
    if body[:5] == b"%PDF-":
        return "pdf"
    if ct in EXT_BY_CT:
        return EXT_BY_CT[ct]
    if url.lower().endswith(".pdf"):
        return "pdf"
    return "html"


def fetch_one(src: dict, force: bool, check: bool) -> dict:
    res = _fetch_one(src, force, check)
    if res["status"] == "error" and (src.get("format") == "link_only") and not check:
        write_json(RAW / f"{src['doc_id']}.meta.json",
                   {"doc_id": src["doc_id"], "status": "link_only_unfetched", "fetched_date": today(),
                    "reason": res.get("reason") or res.get("http")})
        return {"doc_id": src["doc_id"], "status": "ok", "ext": "-", "bytes": 0, "reason": "link_only: metadata only"}
    return res


def _fetch_one(src: dict, force: bool, check: bool) -> dict:
    doc_id = src["doc_id"]
    fmt = src.get("format") or "auto"
    meta_path = RAW / f"{doc_id}.meta.json"
    if fmt in ("generated", "sec10k"):
        return {"doc_id": doc_id, "status": "skipped", "reason": f"format={fmt} (other script)"}
    if meta_path.exists() and not force and not check:
        return {"doc_id": doc_id, "status": "cached"}

    url = src.get("fetch_url") or src["source_url"]
    try:
        if fmt == "fr":
            j = http_get(url).json()
            body_url = j.get("body_html_url") or j.get("raw_text_url")
            r = http_get(body_url)
            body, ext = r.content, "html"
            extra = {"publication_date": j.get("publication_date"), "fr_title": j.get("title")}
        elif fmt == "ecfr":
            r = http_get(url)
            body, ext, extra = r.content, "html", {}
        elif fmt == "epmc":
            pmcid = url
            r = http_get(f"https://www.ebi.ac.uk/europepmc/webservices/rest/{pmcid}/fullTextXML")
            body, ext, extra = r.content, "xml", {}
        else:
            ua = os.environ.get("SEC_USER_AGENT", "packaging-transition-advisor research-script admin@example.org") if "sec.gov" in url else None
            r = http_get(url, ua=ua)
            body = r.content
            ext = guess_ext(r.headers.get("Content-Type", ""), r.url, body)
            extra = {}
        if r.status_code >= 400 and fmt == "link_only":
            write_json(meta_path, {"doc_id": doc_id, "status": "link_only_unfetched", "http": r.status_code, "fetched_date": today()})
            return {"doc_id": doc_id, "status": "ok", "ext": "-", "bytes": 0, "reason": "link_only: metadata only"}
        if r.status_code >= 400:
            return {"doc_id": doc_id, "status": "error", "http": r.status_code, "url": url}
        if len(body) < 800:
            return {"doc_id": doc_id, "status": "error", "reason": f"tiny body {len(body)}B", "url": url}
        if ext == "html" and re.search(rb"(captcha|access denied|are you a robot|enable javascript)", body[:4000], re.I) and len(body) < 20000:
            return {"doc_id": doc_id, "status": "error", "reason": "bot wall", "url": url}
    except Exception as e:  # noqa: BLE001
        return {"doc_id": doc_id, "status": "error", "reason": str(e)[:200], "url": url}

    info = {"doc_id": doc_id, "status": "ok", "ext": ext, "bytes": len(body), "final_url": r.url,
            "content_type": r.headers.get("Content-Type", ""), "fetched_date": today(),
            "sha256": sha256_bytes(body), **extra}
    if not check:
        prev = read_json(meta_path, {})
        info["changed"] = prev.get("sha256") != info["sha256"]
        (RAW / f"{doc_id}.{ext}").write_bytes(body)
        write_json(meta_path, info)
    return info


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    sources = load_sources()
    if a.only:
        keep = set(a.only.split(","))
        sources = [s for s in sources if s["doc_id"] in keep]
    with ThreadPoolExecutor(max_workers=6) as ex:
        results = list(ex.map(lambda s: fetch_one(s, a.force, a.check), sources))
    bad = [r for r in results if r["status"] == "error"]
    for r in results:
        if r["status"] in ("ok", "error"):
            print(f"{r['status']:6} {r['doc_id']:38} {r.get('ext',''):4} {r.get('bytes','')!s:>9} {r.get('reason') or r.get('http') or ''}")
    print(f"\n{len(results)} sources: {sum(r['status']=='ok' for r in results)} fetched, "
          f"{sum(r['status']=='cached' for r in results)} cached, "
          f"{sum(r['status']=='skipped' for r in results)} skipped, {len(bad)} errors")
    write_json(RAW / "_fetch_errors.json", bad)
    return 0


if __name__ == "__main__":
    sys.exit(main())
