"""Print the top retrieved chunks for a query (checks retrieval by hand).

Usage: python scripts/ask.py "which states have packaging EPR fees" [--layers regulation] [--states CA,OR] [-k 8]
"""
from __future__ import annotations

import argparse
import os
import sys
import textwrap

import requests

from common import load_env


def main() -> int:
    load_env()
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("--layers", default="")
    ap.add_argument("--states", default="")
    ap.add_argument("-k", type=int, default=8)
    ap.add_argument("--full", action="store_true")
    a = ap.parse_args()
    r = requests.get(os.environ["WORKER_URL"].rstrip("/") + "/api/search",
                     params={"q": a.query, "layers": a.layers, "states": a.states, "k": a.k}, timeout=60)
    r.raise_for_status()
    res = r.json()
    print(f"vector hits {res['stats']['vector']}, keyword hits {res['stats']['keyword']}, fused {res['stats']['fused']}\n")
    for i, p in enumerate(res["passages"], 1):
        print(f"[{i}] {p['document_id']}  ({p['layer']}, {p['jurisdiction']}, {p['doc_date'] or 'n.d.'})  "
              f"score={p['score']:.4f} v#{p['vector_rank']} kw#{p['keyword_rank']}")
        print(f"    {p['title']} - {p['section'] or ''} p.{p['page'] or '-'}")
        body = p["content"] if a.full else p["content"][:400]
        print(textwrap.indent(textwrap.fill(body.replace("\n", " "), 110), "    "), "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
