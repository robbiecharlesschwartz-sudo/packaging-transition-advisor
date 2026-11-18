"""Load the versioned structured tables into D1 through the worker's admin endpoint.

Tables: ppi_series, state_laws, epr_fees, price_inputs, suppliers, supplier_plants.
(The worker also bundles cost/price_inputs.json and the suppliers JSON at deploy time; D1 copies make the data
queryable for eval and ad-hoc SQL, and ppi_series in D1 is what the weekly cron keeps current.)
"""
from __future__ import annotations

import os
import sys

import requests

from common import ROOT, STRUCTURED, load_env, read_json


def post(table: str, rows: list[dict], truncate: bool = True) -> None:
    url, tok = os.environ["WORKER_URL"].rstrip("/"), os.environ["ADMIN_TOKEN"]
    for i in range(0, max(len(rows), 1), 400):
        r = requests.post(f"{url}/api/admin/load", json={"table": table, "rows": rows[i:i + 400], "truncate": truncate and i == 0},
                          headers={"Authorization": f"Bearer {tok}"}, timeout=120)
        r.raise_for_status()
    print(f"{table:16} {len(rows)} rows")


def main() -> int:
    load_env()
    cat = read_json(ROOT / "cost" / "price_inputs.json")
    post("ppi_series", read_json(STRUCTURED / "ppi_series.json", []))
    post("state_laws", read_json(STRUCTURED / "state_laws.json", []))
    post("epr_fees", [{"id": f["id"], "state": f["state"], "material_category": f["material_category"],
                       "material_keys": f["material_keys"], "fee_per_kg": (f["fee_per_kg_low"] + f["fee_per_kg_high"]) / 2,
                       "fee_unit_original": f"{f['cents_per_lb_low']}-{f['cents_per_lb_high']} cents/lb",
                       "effective_date": f["effective_date"], "source_doc_id": f["doc_id"], "source_chunk_id": f["chunk_id"],
                       "source_url": f.get("source_url")} for f in cat["epr_fees"]])
    post("price_inputs", [{"id": i["id"], "material": i["material"], "kind": i["kind"], "unit": i["unit"], "low": i["low"],
                           "high": i["high"], "base_period": i.get("base_period"), "ppi_series": i.get("ppi_series"),
                           "source_doc_id": i["doc_id"], "source_chunk_id": i["chunk_id"], "source_url": i.get("source_url"),
                           "note": i.get("basis") or i.get("note"), "reliability": i.get("reliability"), "reviewed": True}
                          for i in cat["inputs"]])
    sups = read_json(STRUCTURED / "suppliers.json", [])
    post("suppliers", [{**s, "evidence": s.get("evidence")} for s in sups])
    post("supplier_plants", read_json(STRUCTURED / "supplier_plants.json", []))
    return 0


if __name__ == "__main__":
    sys.exit(main())
