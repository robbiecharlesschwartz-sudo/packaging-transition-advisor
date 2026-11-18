"""Write corpus/processed/local_seed.sql: the corpus and structured tables as SQL for a local D1 (wrangler dev).

Local D1 has no row-read limits, so development and testing do not consume the free-tier daily budget.
Vectors stay in the remote Vectorize index (wrangler dev uses it via `remote: true`); chunk ids match.

  python scripts/build_local_seed.py
  cd worker && npx wrangler d1 migrations apply pta-db --local && npx wrangler d1 execute pta-db --local --file ../corpus/processed/local_seed.sql
"""
from __future__ import annotations

import json
import sys

from common import PROCESSED, ROOT, STRUCTURED, read_json, today


def q(v) -> str:
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    if isinstance(v, (list, dict)):
        v = json.dumps(v, ensure_ascii=False)
    return "'" + str(v).replace("'", "''") + "'"


def ins(table: str, cols: list[str], rows: list[dict]) -> list[str]:
    return [f"INSERT OR REPLACE INTO {table} ({','.join(cols)}) VALUES ({','.join(q(r.get(c)) for c in cols)});" for r in rows]


def main() -> int:
    docs = read_json(PROCESSED / "documents.json", [])
    chunks = [json.loads(l) for l in open(PROCESSED / "chunks.jsonl", encoding="utf-8")]
    out = ["DELETE FROM chunks_fts;", "DELETE FROM chunks;", "DELETE FROM documents;"]
    out += ins("documents", ["id", "title", "publisher", "source_url", "layer", "jurisdiction", "doc_date", "fetched_date",
                             "reg_status", "reliability", "license", "content_hash", "material_tags", "package_tags",
                             "summary", "chunk_count"], docs)
    out += ins("chunks", ["id", "document_id", "chunk_index", "content", "page", "section", "layer", "jurisdiction",
                          "doc_date", "license", "material_tags", "package_tags"], chunks)
    out.append("INSERT INTO chunks_fts (rowid, title, section, content) SELECT c.rowid, d.title, COALESCE(c.section,''), "
               "c.content FROM chunks c JOIN documents d ON d.id = c.document_id;")
    out.append(f"INSERT OR REPLACE INTO meta (key, value) VALUES ('corpus_updated', {q(today())});")
    out.append("INSERT OR REPLACE INTO meta (key, value) VALUES ('chunk_count', (SELECT COUNT(*) FROM chunks));")
    out.append("INSERT OR REPLACE INTO meta (key, value) VALUES ('document_count', (SELECT COUNT(*) FROM documents));")
    out.append("DELETE FROM ppi_series;")
    out += ins("ppi_series", ["series_id", "period", "value", "label"], read_json(STRUCTURED / "ppi_series.json", []))
    (PROCESSED / "local_seed.sql").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"local_seed.sql: {len(docs)} documents, {len(chunks)} chunks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
