"""Extract text from corpus/raw/* into corpus/processed/<doc_id>.json.

PDF -> PyMuPDF (page numbers + table-of-contents sections)
HTML -> trafilatura (markdown, so headings become sections)
XML -> Europe PMC JATS full text
TXT -> generated documents (sections start with '## ')
link_only -> only the page's own <title>/description, never body text
"""
from __future__ import annotations

import argparse
import re
import sys
import warnings
import xml.etree.ElementTree as ET

warnings.filterwarnings("ignore")

import pymupdf  # noqa: E402
import trafilatura  # noqa: E402

from common import PROCESSED, RAW, load_sources, read_json, write_json  # noqa: E402

HEADING = re.compile(r"^(#{1,6})\s+(.*)$")


def clean(t: str) -> str:
    t = t.replace("­", "").replace("​", "")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip()


def parse_pdf(path) -> tuple[list[dict], dict]:
    doc = pymupdf.open(path)
    toc = doc.get_toc(simple=True)  # [level, title, page]
    blocks = []
    for i, page in enumerate(doc, start=1):
        text = clean(page.get_text("text"))
        if not text:
            continue
        section = None
        for lvl, title, p in toc:
            if p <= i and lvl <= 2:
                section = title.strip()
        blocks.append({"page": i, "section": section, "text": text})
    meta = doc.metadata or {}
    date = None
    m = re.match(r"D:(\d{4})(\d{2})(\d{2})", meta.get("creationDate") or "")
    if m:
        date = f"{m[1]}-{m[2]}-{m[3]}"
    return blocks, {"title": meta.get("title"), "date": date, "pages": doc.page_count}


def parse_markdown_sections(md: str) -> list[dict]:
    blocks, section, buf = [], None, []
    for line in md.splitlines():
        h = HEADING.match(line)
        if h:
            if buf:
                blocks.append({"page": None, "section": section, "text": clean("\n".join(buf))})
                buf = []
            section = h[2].strip(" *")[:160]
        else:
            buf.append(line)
    if buf:
        blocks.append({"page": None, "section": section, "text": clean("\n".join(buf))})
    return [b for b in blocks if b["text"]]


def parse_html(path) -> tuple[list[dict], dict]:
    html = path.read_bytes().decode("utf-8", errors="replace")
    md = trafilatura.extract(html, output_format="markdown", include_tables=True,
                             include_links=False, include_comments=False, favor_recall=True) or ""
    m = trafilatura.extract_metadata(html)
    meta = {"title": m.title if m else None, "date": m.date if m else None,
            "description": m.description if m else None}
    blocks = parse_markdown_sections(md)
    if sum(len(b["text"].split()) for b in blocks) < 300:
        raw = trafilatura.html2txt(html) or ""
        if len(raw.split()) > 2 * max(1, sum(len(b["text"].split()) for b in blocks)):
            meta["fallback"] = "html2txt"
            blocks = [{"page": None, "section": None, "text": clean(raw)}]
    return blocks, meta


def parse_jats(path) -> tuple[list[dict], dict]:
    root = ET.parse(path).getroot()

    def txt(el):
        return clean(" ".join("".join(el.itertext()).split())) if el is not None else ""

    title = txt(root.find(".//article-title"))
    lic = root.find(".//license")
    blocks = []
    abstract = root.find(".//abstract")
    if abstract is not None:
        blocks.append({"page": None, "section": "Abstract", "text": txt(abstract)})
    body = root.find(".//body")
    if body is not None:
        for sec in body.iter("sec"):
            heading = txt(sec.find("title")) or None
            paras = [txt(p) for p in sec.findall("p")]
            paras = [p for p in paras if p]
            if paras:
                blocks.append({"page": None, "section": heading, "text": "\n\n".join(paras)})
    for tw in root.iter("table-wrap"):
        cap = txt(tw.find(".//caption"))
        rows = []
        for tr in tw.iter("tr"):
            cells = [txt(td) for td in list(tr) if td.tag in ("td", "th")]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            blocks.append({"page": None, "section": f"Table: {cap[:120]}" if cap else "Table",
                           "text": (cap + "\n" if cap else "") + "\n".join(rows)})
    y = root.find(".//pub-date/year")
    return blocks, {"title": title, "date": y.text if y is not None else None,
                    "license_text": txt(lic)[:300] if lic is not None else None}


def parse_txt(path) -> tuple[list[dict], dict]:
    text = path.read_text(encoding="utf-8")
    md = re.sub(r"^## ", "# ", text, flags=re.M)
    return parse_markdown_sections(md), {}


def link_only_blocks(src: dict, meta: dict) -> list[dict]:
    parts = [f"{src['title']} ({src['publisher']})."]
    if meta.get("description"):
        parts.append(f"Source description: {meta['description'].strip()}")
    parts.append(f"Full text is not stored (license: link_only). See {src['source_url']}.")
    if src.get("notes"):
        parts.append(f"Note: {src['notes']}")
    return [{"page": None, "section": "Reference", "text": " ".join(parts)}]


def parse_one(src: dict) -> dict:
    doc_id = src["doc_id"]
    fmeta = read_json(RAW / f"{doc_id}.meta.json", {})
    ext = fmeta.get("ext")
    path = RAW / f"{doc_id}.{ext}" if ext else None
    if src.get("format") == "generated":
        path = RAW / f"{doc_id}.txt"
        ext = "txt"
    if path is None or not path.exists():
        if src["license"] == "link_only":
            return {"doc_id": doc_id, "blocks": link_only_blocks(src, {}), "meta": {}}
        raise FileNotFoundError(f"{doc_id}: no raw file (run fetch.py)")

    if src["license"] == "link_only":
        meta = {}
        if ext == "html":
            _, meta = parse_html(path)
        return {"doc_id": doc_id, "blocks": link_only_blocks(src, meta), "meta": meta}

    blocks, meta = {"pdf": parse_pdf, "html": parse_html, "xml": parse_jats, "txt": parse_txt}[ext](path)
    return {"doc_id": doc_id, "blocks": blocks, "meta": meta}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    sources = load_sources()
    if a.only:
        keep = set(a.only.split(","))
        sources = [s for s in sources if s["doc_id"] in keep]
    failures = []
    for s in sources:
        try:
            out = parse_one(s)
            words = sum(len(b["text"].split()) for b in out["blocks"])
            out["words"] = words
            write_json(PROCESSED / f"{s['doc_id']}.json", out)
            flag = "  <-- LOW TEXT" if words < 150 and s["license"] != "link_only" else ""
            print(f"{s['doc_id']:38} {len(out['blocks']):5} blocks {words:8} words{flag}")
        except Exception as e:  # noqa: BLE001
            failures.append((s["doc_id"], str(e)))
            print(f"FAIL {s['doc_id']}: {e}")
    print(f"\nparsed {len(sources) - len(failures)}/{len(sources)}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
