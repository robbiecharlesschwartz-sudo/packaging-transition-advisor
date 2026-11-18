"""Shared paths, source-list loading and HTTP helpers for the ingestion scripts."""
from __future__ import annotations

import csv
import hashlib
import json
import os
import time
from datetime import date
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "corpus"
RAW = CORPUS / "raw"
PROCESSED = CORPUS / "processed"
STRUCTURED = CORPUS / "structured"
SOURCES_CSV = CORPUS / "sources.csv"

RAW.mkdir(parents=True, exist_ok=True)
PROCESSED.mkdir(parents=True, exist_ok=True)

LAYERS = {
    "regulation", "claims_rules", "infrastructure", "materials", "prices",
    "demand", "competitor", "news", "suppliers",
}
LICENSES = {"public_domain", "open_access", "link_only"}
RELIABILITY = {"primary", "secondary", "press"}

SOURCE_FIELDS = [
    "doc_id", "title", "publisher", "source_url", "fetch_url", "format", "layer",
    "jurisdiction", "doc_date", "reg_status", "reliability", "license",
    "material_tags", "package_tags", "notes",
]

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)


def load_env() -> None:
    try:
        from dotenv import load_dotenv
        load_dotenv(ROOT / ".env")
    except ImportError:
        pass


def today() -> str:
    return date.today().isoformat()


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def load_sources() -> list[dict]:
    with open(SOURCES_CSV, newline="", encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r.get("doc_id") and not r["doc_id"].startswith("#")]
    seen = set()
    for r in rows:
        if r["doc_id"] in seen:
            raise ValueError(f"duplicate doc_id {r['doc_id']}")
        seen.add(r["doc_id"])
        if r["layer"] not in LAYERS:
            raise ValueError(f"{r['doc_id']}: bad layer {r['layer']}")
        if r["license"] not in LICENSES:
            raise ValueError(f"{r['doc_id']}: bad license {r['license']}")
        if r["reliability"] not in RELIABILITY:
            raise ValueError(f"{r['doc_id']}: bad reliability {r['reliability']}")
    return rows


def write_sources(rows: list[dict]) -> None:
    with open(SOURCES_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=SOURCE_FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def split_tags(s: str) -> list[str]:
    return [t.strip() for t in (s or "").split("|") if t.strip()]


def http_get(url: str, *, ua: str | None = None, timeout: int = 60, retries: int = 3, **kw) -> requests.Response:
    headers = {"User-Agent": ua or BROWSER_UA, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9"}
    headers.update(kw.pop("headers", {}))
    last: Exception | None = None
    for attempt in range(retries):
        try:
            r = requests.get(url, headers=headers, timeout=timeout, **kw)
            if r.status_code in (429, 502, 503, 504):
                raise requests.HTTPError(f"HTTP {r.status_code}")
            return r
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed: {last}")


def read_json(p: Path, default=None):
    if not p.exists():
        return default
    return json.loads(p.read_text(encoding="utf-8"))


def write_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2, ensure_ascii=False), encoding="utf-8")
