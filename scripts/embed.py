"""Send chunked documents to the worker, which embeds them (Workers AI) and writes Vectorize + D1.

Only documents whose content hash changed are re-sent. Documents no longer in sources.csv are deleted.
Usage: python scripts/embed.py [--all] [--only id1,id2] [--prune]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import requests

from common import PROCESSED, load_env, read_json

BATCH = 25


def post(url: str, token: str, path: str, body: dict, tries: int = 4) -> dict:
    for i in range(tries):
        r = requests.post(url + path, json=body, headers={"Authorization": f"Bearer {token}"}, timeout=120)
        if r.ok:
            return r.json()
        if r.status_code in (429, 500, 502, 503) and i < tries - 1:
            time.sleep(5 * (i + 1))
            continue
        raise RuntimeError(f"{path} -> {r.status_code}: {r.text[:300]}")
    raise RuntimeError("unreachable")


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="re-embed even unchanged documents")
    ap.add_argument("--only", default="")
    ap.add_argument("--prune", action="store_true", help="delete documents not in documents.json")
    a = ap.parse_args()
    url, token = os.environ["WORKER_URL"].rstrip("/"), os.environ["ADMIN_TOKEN"]

    docs = read_json(PROCESSED / "documents.json", [])
    chunks: dict[str, list] = {}
    with open(PROCESSED / "chunks.jsonl", encoding="utf-8") as f:
        for line in f:
            c = json.loads(line)
            chunks.setdefault(c["document_id"], []).append(c)

    remote = post(url, token, "/api/admin/hashes", {})
    only = set(a.only.split(",")) if a.only else None
    todo = [d for d in docs if (only is None or d["id"] in only) and (a.all or only or remote.get(d["id"]) != d["content_hash"])]
    total = sum(len(chunks.get(d["id"], [])) for d in todo)
    print(f"{len(todo)} documents to embed ({total} chunks); {len(docs) - len(todo)} unchanged")
    done = 0
    for d in todo:
        cs = chunks.get(d["id"], [])
        for i in range(0, max(len(cs), 1), BATCH):
            post(url, token, "/api/admin/ingest", {"document": d, "chunks": cs[i:i + BATCH], "replace": i == 0})
            done += len(cs[i:i + BATCH])
        print(f"  {d['id']:40} {len(cs):4} chunks   ({done}/{total})")

    if a.prune:
        keep = {d["id"] for d in docs}
        for doc_id in remote:
            if doc_id not in keep:
                post(url, token, "/api/admin/delete-doc", {"id": doc_id})
                print(f"  pruned {doc_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
