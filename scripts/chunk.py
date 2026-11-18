"""Split processed documents into ~320-480 token chunks (80-token overlap), respecting sections.

Writes corpus/processed/chunks.jsonl, corpus/processed/documents.json and corpus/ingest_report.md.
Token counts are approximated as words x 1.33 (no tokenizer download needed).
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter, defaultdict

from common import CORPUS, PROCESSED, RAW, load_sources, read_json, split_tags, today, write_json
from tag import doc_tags, tag_text

TOKENS_PER_WORD = 1.33
# bge-small-en-v1.5 truncates input at 512 tokens, so chunks stay under that (see DECISIONS D10)
MAX_WORDS = int(480 / TOKENS_PER_WORD)      # ~480 tokens
MIN_WORDS = int(320 / TOKENS_PER_WORD)      # merge small blocks up to ~320 tokens
OVERLAP_WORDS = int(80 / TOKENS_PER_WORD)   # ~80 tokens
MIN_CHUNK_WORDS = 30

BOILERPLATE = re.compile(
    r"(An official website of the United States government|Here's how you know|"
    r"Secure \.gov websites use HTTPS|Official websites use \.gov|Skip to main content|"
    r"Share sensitive information only on official|Was this page helpful)", re.I)


def strip_boilerplate(text: str) -> str:
    lines = [ln for ln in text.splitlines() if not BOILERPLATE.search(ln)]
    return "\n".join(lines).strip()


def split_words(text: str) -> list[str]:
    return text.split()


def chunk_blocks(blocks: list[dict]) -> list[dict]:
    """Merge consecutive blocks within the same section, then window long text with overlap."""
    merged: list[dict] = []
    for b in blocks:
        t = strip_boilerplate(b["text"])
        if not t:
            continue
        if merged and merged[-1]["section"] == b["section"] and \
                len(merged[-1]["text"].split()) + len(t.split()) <= MAX_WORDS and \
                len(merged[-1]["text"].split()) < MIN_WORDS:
            merged[-1]["text"] += "\n\n" + t
        else:
            merged.append({"page": b.get("page"), "section": b.get("section"), "text": t})

    out: list[dict] = []
    for m in merged:
        words = split_words(m["text"])
        if len(words) <= MAX_WORDS:
            out.append(m)
            continue
        step = MAX_WORDS - OVERLAP_WORDS
        for start in range(0, len(words), step):
            piece = words[start:start + MAX_WORDS]
            if len(piece) < MIN_CHUNK_WORDS and out:
                break
            out.append({"page": m["page"], "section": m["section"], "text": " ".join(piece)})
            if start + MAX_WORDS >= len(words):
                break
    return out


def year_of(d: str | None) -> int | None:
    m = re.search(r"(19|20)\d{2}", d or "")
    return int(m[0]) if m else None


def main() -> int:
    sources = load_sources()
    docs_out, all_chunks = [], []
    seen_hashes: set[str] = set()
    report_failures, dup_count = [], 0
    for s in sources:
        p = read_json(PROCESSED / f"{s['doc_id']}.json")
        if p is None:
            report_failures.append(f"{s['doc_id']}: not parsed")
            continue
        pieces = chunk_blocks(p["blocks"])
        if s["license"] != "link_only":
            pieces = [c for c in pieces if len(c["text"].split()) >= MIN_CHUNK_WORDS]
        doc_chunks = []
        for c in pieces:
            h = hashlib.sha1(c["text"].lower().encode()).hexdigest()
            if h in seen_hashes:
                dup_count += 1
                continue
            seen_hashes.add(h)
            mats, pkgs = tag_text(c["text"])
            doc_chunks.append({**c, "material_tags": mats, "package_tags": pkgs})
        if not doc_chunks:
            report_failures.append(f"{s['doc_id']}: 0 chunks after cleaning")
            continue

        fmeta = read_json(RAW / f"{s['doc_id']}.meta.json", {})
        doc_date = s.get("doc_date") or fmeta.get("publication_date") or (p.get("meta") or {}).get("date") or ""
        dmats = doc_tags([c["material_tags"] for c in doc_chunks], split_tags(s.get("material_tags")))
        dpkgs = doc_tags([c["package_tags"] for c in doc_chunks], split_tags(s.get("package_tags")))
        content_hash = hashlib.sha256("".join(c["text"] for c in doc_chunks).encode()).hexdigest()
        doc = {
            "id": s["doc_id"], "title": s["title"], "publisher": s["publisher"],
            "source_url": s["source_url"], "layer": s["layer"], "jurisdiction": s["jurisdiction"],
            "doc_date": doc_date, "fetched_date": fmeta.get("fetched_date") or today(),
            "reg_status": s.get("reg_status") or "n/a", "reliability": s["reliability"],
            "license": s["license"], "content_hash": content_hash,
            "material_tags": dmats, "package_tags": dpkgs,
            "summary": (p.get("meta") or {}).get("description"),
            "chunk_count": len(doc_chunks),
        }
        docs_out.append(doc)
        for i, c in enumerate(doc_chunks):
            all_chunks.append({
                "id": f"{s['doc_id']}::{i:04d}", "document_id": s["doc_id"], "chunk_index": i,
                "content": c["text"], "page": c.get("page"), "section": c.get("section"),
                "layer": s["layer"], "jurisdiction": s["jurisdiction"], "doc_date": doc_date,
                "year": year_of(doc_date), "license": s["license"], "reliability": s["reliability"],
                "title": s["title"],
                "material_tags": c["material_tags"] or dmats[:6],
                "package_tags": c["package_tags"] or dpkgs[:6],
            })

    with open(PROCESSED / "chunks.jsonl", "w", encoding="utf-8") as f:
        for c in all_chunks:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    write_json(PROCESSED / "documents.json", docs_out)
    write_report(docs_out, all_chunks, report_failures, dup_count)
    print(f"{len(docs_out)} documents, {len(all_chunks)} chunks, {dup_count} duplicate chunks dropped, "
          f"{len(report_failures)} problems")
    for f_ in report_failures:
        print("  !", f_)
    return 0


def write_report(docs, chunks, failures, dups) -> None:
    by_layer = Counter(d["layer"] for d in docs)
    by_j = Counter(d["jurisdiction"] for d in docs)
    by_lic = Counter(d["license"] for d in docs)
    by_rel = Counter(d["reliability"] for d in docs)
    ch_layer = Counter(c["layer"] for c in chunks)
    tokens = int(sum(len(c["content"].split()) for c in chunks) * TOKENS_PER_WORD)
    biggest = sorted(docs, key=lambda d: -d["chunk_count"])[:8]
    lines = [
        "# Ingest report", "",
        f"Generated {today()} by `scripts/chunk.py`.", "",
        f"- Documents: **{len(docs)}**", f"- Chunks: **{len(chunks)}** (~{tokens:,} tokens)",
        f"- Duplicate chunks dropped: {dups}",
        f"- Vector capacity used: {len(chunks) * 384:,} of 5,000,000 stored dimensions (Vectorize free tier)", "",
        "## Documents by layer", "", "| Layer | Documents | Chunks |", "|---|---:|---:|",
        *[f"| {k} | {v} | {ch_layer[k]} |" for k, v in sorted(by_layer.items())], "",
        "## Documents by jurisdiction", "", "| Jurisdiction | Documents |", "|---|---:|",
        *[f"| {k} | {v} |" for k, v in sorted(by_j.items())], "",
        "## License and reliability", "",
        "| License | Documents |", "|---|---:|", *[f"| {k} | {v} |" for k, v in sorted(by_lic.items())], "",
        "| Reliability | Documents |", "|---|---:|", *[f"| {k} | {v} |" for k, v in sorted(by_rel.items())], "",
        "## Largest documents", "", "| Document | Chunks |", "|---|---:|",
        *[f"| {d['id']} | {d['chunk_count']} |" for d in biggest], "",
        "## Problems", "", *(f"- {f}" for f in failures), ("- none" if not failures else ""),
    ]
    (CORPUS / "ingest_report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
