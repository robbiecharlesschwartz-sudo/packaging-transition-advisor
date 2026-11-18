"""Build cost/price_inputs.json and corpus/structured/state_laws.json from hand-reviewed specs.

Every value below carries a verbatim `quote`. The script finds the corpus chunk that contains the quote
(whitespace-insensitive) and records its chunk id, so each number in the cost table links to a passage.
If a quote cannot be found the build fails: no uncited number can reach the calculator.

Run after chunk.py:  python scripts/build_price_inputs.py
"""
from __future__ import annotations

import json
import re
import sys
from datetime import date

from common import PROCESSED, ROOT, STRUCTURED, read_json, write_json

LB_PER_KG = 2.20462262
G_PER_LB = 453.59237


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip().lower()


def load_chunks() -> dict[str, list[dict]]:
    by_doc: dict[str, list[dict]] = {}
    with open(PROCESSED / "chunks.jsonl", encoding="utf-8") as f:
        for line in f:
            c = json.loads(line)
            by_doc.setdefault(c["document_id"], []).append(c)
    return by_doc


CHUNKS = load_chunks()
DOCS = {d["id"]: d for d in read_json(PROCESSED / "documents.json", [])}
MISSING: list[str] = []


def cite(doc_id: str, quote: str) -> dict:
    q = norm(quote)
    for c in CHUNKS.get(doc_id, []):
        if q in norm((c.get("section") or "") + " " + c["content"]):
            d = DOCS[doc_id]
            return {"doc_id": doc_id, "chunk_id": c["id"], "quote": quote, "source_url": d["source_url"],
                    "title": d["title"], "publisher": d["publisher"], "doc_date": d["doc_date"],
                    "reliability": d["reliability"]}
    MISSING.append(f"{doc_id}: {quote!r}")
    return {"doc_id": doc_id, "chunk_id": None, "quote": quote}


# ----------------------------------------------------------------------------- trade unit values ($/kg)
TRADE = {r["key"]: r for r in read_json(STRUCTURED / "trade_unit_values.json", [])}


def trade_price(key: str, basis: str, ppi: str | None) -> dict | None:
    r = TRADE.get(key)
    if not r:
        return None
    return {"kind": "price_per_kg", "low": r["low"], "high": r["high"], "unit": "USD/kg", "basis": basis,
            "base_period": r["periods"], "ppi_series": ppi, "hs6": r["hs6"], "desc": r["desc"],
            **cite("trade-unit-values", f"HS {r['hs6']} {r['desc']}")}


# ----------------------------------------------------------------------------- material densities etc.
REF = "ref-material-properties"
DENSITY = {
    "pet": (1.37, 1.38, "Density 1.38 g/cm3"),
    "hdpe": (0.93, 0.97, "The density of HDPE ranges from 930 to 970 kg/m3"),
    "pe_film": (0.916, 0.940, "LLDPE 0.916-0.940"),
    "pp": (0.895, 0.93, "The density of PP is between 0.895 and 0.93 g/cm3"),
    "ps": (0.96, 1.05, "Density 0.96–1.05 g/cm3"),
    "eps": (0.05, 0.05, "foam, ρ 0.05 g/cm3"),
    "pla": (1.21, 1.43, "Density 1210–1430 kg/m3"),
    "glass": (2.52, 2.53, "Density at 20 °C (68 °F), g/cm3 2.52 2.53"),
    "aluminum": (2.70, 2.70, "The density of aluminium is 2.70 g/cm3"),
}
GRAMMAGE = {
    "paper_kraft": (40, 135, "The grammage is normally 40–135 g/m2"),
    "paperboard": (250, 250, "paperboard is a paper with a grammage above 250 g/m2"),
}
# CalRecycle "containers per segregated pound" (recycling centers, Jan 1 2026) -> average beverage container weight
CPP = {
    "aluminum": (31.1, "Aluminum 31.1 $1.66"),
    "glass": (1.79, "Glass 1.79 $0.101"),
    "pet": (26.7, "#1 PET (Polyethylene Terephthalate) 26.7 $1.46"),
    "hdpe": (9.3, "#2 HDPE (High Density Polyethylene) 9.3 $0.67"),
}

# ----------------------------------------------------------------------------- Oregon 2025 PRO fee schedule
OR_DOC = "or-caa-annual-2025"
OR_FEES = [  # (category, material keys, cents/lb low, high, quote)
    ("Glass Bottles and Jars & Other Containers", ["glass"], 11.0, 11.0, "Glass Bottles and Jars & Other Containers PRO 9.9 ¢/lb 1.1 ¢/lb 11.0 ¢/lb"),
    ("Aluminum Containers", ["aluminum"], 2.0, 2.0, "Aluminum Containers USCL 2.0 ¢/lb 0.0 ¢/lb 2.0 ¢/lb"),
    ("Steel Containers", ["steel"], 6.0, 6.0, "Steel Containers USCL 6.0 ¢/lb 0.0 ¢/lb 6.0 ¢/lb"),
    ("Kraft Paper", ["paper_kraft"], 4.0, 4.0, "Kraft Paper USCL 4.0 ¢/lb 0.0 ¢/lb 4.0 ¢/lb"),
    ("Corrugated Cardboard", ["corrugated"], 4.0, 4.0, "Corrugated Cardboard USCL 4.0 ¢/lb 0.0 ¢/lb 4.0 ¢/lb"),
    ("Paperboard", ["paperboard"], 4.0, 4.0, "Paperboard USCL 4.0 ¢/lb 0.0 ¢/lb 4.0 ¢/lb"),
    ("Other Paper Laminates", ["paper_barrier"], 46.0, 46.0, "Other Paper Laminates N/A 46.0 ¢/lb 0.0 ¢/lb 46.0 ¢/lb"),
    ("Other Paper Packaging", ["molded_fiber"], 4.0, 4.0, "Other Paper Packaging USCL 4.0 ¢/lb 0.0 ¢/lb 4.0 ¢/lb"),
    ("PET (#1) - Bottles, Jugs, and Jars (accepted)", ["pet", "rpet"], 12.0, 12.0, "PET (#1) - Bottles, Jugs, and Jars USCL 12.0 ¢/lb"),
    ("HDPE (#2) - Bottles, Jugs and Jars (natural to pigmented)", ["hdpe"], 6.0, 14.0, "HDPE (#2) — Bottles, Jugs and Jars USCL 6.0 ¢/lb"),
    ("PP (#5) - Tubs, Pails and Buckets to Bottles", ["pp_rigid"], 14.0, 18.0, "PP (#5) — Tubs, Pails and Buckets"),
    ("PS (#6) Expanded/Foamed (white to hinged containers)", ["ps_eps"], 103.0, 140.0, "PS (#6) White Expanded/Foamed PRO 103.0 ¢/lb"),
    ("PVC (#3) - Rigid Items", ["pvc"], 82.0, 82.0, "PVC (#3) — Rigid Items N/A 82.0 ¢/lb"),
    ("PLA, PHA, PHB - Rigid Items", ["pla_rigid"], 82.0, 82.0, "PLA, PHA, PHB — Rigid Items N/A 82.0 ¢/lb"),
    ("HDPE (#2)/LDPE (#4) Flexible and Film", ["pe_film"], 55.0, 55.0, "HDPE (#2)/LDPE (#4) Flexible and Film PRO 55.0 ¢/lb"),
    ("PP (#5) Flexible and Film Items", ["pp_film"], 114.0, 114.0, "PP (#5) Flexible and Film Items N/A 114.0 ¢/lb"),
    ("PLA, PHA, PHB - Flexible and Film Items", ["pla_film"], 114.0, 114.0, "PLA, PHA, PHB — Flexible and Film Items N/A 114.0 ¢/lb"),
    ("Plastic Laminates and Other Flexible Plastic", ["multilayer_film"], 114.0, 114.0, "Plastic Laminates and Other Flexible Plastic N/A 114.0 ¢/lb"),
]

# ----------------------------------------------------------------------------- state laws (map + KPI)
STATE_LAWS = [
    ("OR", "epr", "fees_in_effect", "Plastic Pollution and Recycling Modernization Act (SB 582, 2021)", "2021-08-06",
     "2025-07-01", "Producer fees begin (program year July 1 - Dec. 31, 2025)", OR_DOC, "Fees for Program Year July 1 – Dec. 31, 2025"),
    ("CO", "epr", "fees_in_effect", "Producer Responsibility Program for Statewide Recycling (HB22-1355)", "2022-06-03",
     "2026-01-01", "Producer responsibility dues first payable (January 2026); dues schedule not public",
     "co-epr-cdphe", "Producers must pay producer responsibility dues on “covered materials” to the program in January 2026"),
    ("CA", "epr", "enacted", "SB 54 Plastic Pollution Prevention and Packaging Producer Responsibility Act", "2022-06-30",
     "2026-10-13", "CalRecycle received the PRO's producer responsibility plan", "ca-sb54-calrecycle",
     "CalRecycle received Circular Action Alliance’s producer responsibility plan"),
    ("ME", "epr", "enacted", "Stewardship program for packaging (38 M.R.S. §2146)", "2021-07-12", None, None,
     "me-statute-2146", "Alternative collection program"),
    ("MN", "epr", "enacted", "Packaging Waste and Cost Reduction Act (Minn. Stat. 115A.144-115A.1463)", "2024-05-24",
     "2028-10-01", "PRO stewardship plan due to the commissioner", "mn-statute-115a144",
     "submit a stewardship plan to the commissioner by October 1, 2028"),
    ("MD", "epr", "enacted", "SB 901 (2025) Packaging and Paper Products - Producer Responsibility Plans", "2025-05-13",
     None, None, "md-sb901", "PRODUCER RESPONSIBILITY"),
    ("WA", "epr", "enacted", "Recycling Reform Act (SB 5284, 2025)", "2025-05-17", "2030-01-01",
     "Statewide, consistent curbside recycling services begin", "wa-recycling-reform",
     "Statewide, consistent, and increased curbside recycling services begin in 2030."),
    ("OR", "material_ban", "in_force", "Polystyrene foam foodware ban (SB 543, 2023)", None, "2025-01-01",
     "Foam foodware and packing peanuts prohibited", "or-eps-ban", "prohibits food vendors from using polystyrene foam containers for prepared food"),
    ("WA", "material_ban", "in_force", "Expanded polystyrene (EPS) ban (2021 plastics law)", None, "2024-06-01",
     "EPS food service products banned", "wa-plastic-bans", "As of June 2024, food service products like containers, plates, bowls, clam shells, trays, and cups are banned."),
    ("CO", "material_ban", "in_force", "Plastic Pollution Reduction Act (HB21-1162): EPS food containers", "2021-07-06",
     "2024-01-01", "EPS food containers prohibited", "co-hb21-1162", "Prohibition on use of expanded polystyrene food  containers."),
    ("WA", "recycled_content", "in_force", "Post-consumer recycled content (PCRC) minimums", None, "2036-01-01",
     "All covered packaging at least 50 percent PCRC", "wa-recycled-content",
     "By 2036, all packaging for covered products must contain at least 50 percent PCRC"),
    ("CA", "labeling", "in_force", "SB 343 recyclability claims and the chasing-arrows symbol", "2021-10-05", None, None,
     "ca-sb343-calrecycle", "chasing arrows"),
]


def build() -> int:
    inputs: list[dict] = []

    def add(material: str, item: dict | None) -> str | None:
        if not item:
            return None
        item = {"id": f"{material}:{item['kind']}:{len(inputs)}", "material": material, **item}
        inputs.append(item)
        return item["id"]

    def density(key: str, ref: str) -> dict:
        lo, hi, q = DENSITY[ref]
        return {"kind": "density", "low": lo, "high": hi, "unit": "g/cm3", **cite(REF, q)}

    def grammage(ref: str) -> dict:
        lo, hi, q = GRAMMAGE[ref]
        return {"kind": "grammage", "low": lo, "high": hi, "unit": "g/m2", **cite(REF, q)}

    def container(ref: str) -> dict:
        cpp, q = CPP[ref]
        g = round(G_PER_LB / cpp, 1)
        return {"kind": "container_weight", "low": g, "high": g, "unit": "g per average beverage container",
                "note": f"{cpp} containers per pound (CalRecycle) -> {g} g each", **cite("calrecycle-rates-2026", q)}

    materials: dict[str, dict] = {}
    plan = {
        "pet": dict(price=trade_price("PLASTIC_BOTTLES", "finished plastic bottles/containers (HS 392330)", "PCU326160326160"),
                    resin=trade_price("PET", "PET resin (HS 390761)", "PCU325211325211"),
                    density=density("pet", "pet"), container=container("pet")),
        "rpet": dict(price=None, density=density("rpet", "pet"), container=container("pet")),
        "hdpe": dict(price=trade_price("PLASTIC_BOTTLES", "finished plastic bottles/containers (HS 392330)", "PCU326160326160"),
                     resin=trade_price("PE_HD", "HDPE resin (HS 390120)", "PCU325211325211"),
                     density=density("hdpe", "hdpe"), container=container("hdpe")),
        "pp_rigid": dict(price=trade_price("PP", "PP resin (HS 390210); conversion not included", "PCU325211325211"),
                         density=density("pp_rigid", "pp")),
        "ps_eps": dict(price=trade_price("EPS", "expansible PS resin (HS 390311); conversion not included", "PCU325211325211"),
                       density=density("ps_eps", "eps")),
        "pvc": dict(price=None),
        "pla_rigid": dict(price=None, density=density("pla_rigid", "pla")),
        "glass": dict(price=trade_price("GLASS_CONTAINERS", "finished glass containers (HS 701090)", "PCU327213327213"),
                      density=density("glass", "glass"), container=container("glass")),
        "aluminum": dict(price=trade_price("AL_CONTAINERS", "finished aluminum containers incl. cans (HS 761290)", "PCU332431332431"),
                         foil=trade_price("AL_FOIL", "aluminum foil (HS 760711)", "PCU331315331315"),
                         density=density("aluminum", "aluminum"), container=container("aluminum")),
        "steel": dict(price=trade_price("STEEL_CANS", "finished steel cans (HS 731021)", "PCU332431332431")),
        "pe_film": dict(price=trade_price("PE_FILM", "PE film and sheet (HS 392010)", "PCU326112326112"),
                        sacks=trade_price("PE_SACKS", "finished PE sacks and bags (HS 392321)", "PCU326111326111"),
                        density=density("pe_film", "pe_film")),
        "pp_film": dict(price=trade_price("PP_FILM", "PP film and sheet (HS 392020)", "PCU326112326112"),
                        density=density("pp_film", "pp")),
        "multilayer_film": dict(price=trade_price("OTHER_FILM", "other plastic film incl. laminates (HS 392190), proxy", "PCU326112326112")),
        "pla_film": dict(price=None, density=density("pla_film", "pla")),
        "paper_kraft": dict(price=trade_price("PAPER_SACKS", "finished paper sacks and bags (HS 481940)", "PCU322220322220"),
                            sheet=trade_price("KRAFT_PAPER", "uncoated kraft paper <=150 g/m2 (HS 480439)", "PCU322220322220"),
                            grammage=grammage("paper_kraft")),
        "paper_barrier": dict(price=trade_price("PLASTIC_COATED_PAPER", "plastic-coated paper (HS 481159), proxy", "PCU322220322220"),
                              grammage=grammage("paper_kraft")),
        "paperboard": dict(price=trade_price("FOLDING_CARTONS", "finished folding cartons (HS 481920)", "PCU322212322212"),
                           sheet=trade_price("MULTIPLY_BOARD", "multi-ply coated paperboard (HS 481092)", "PCU322130322130"),
                           grammage=grammage("paperboard")),
        "corrugated": dict(price=trade_price("CORRUGATED_BOXES", "finished corrugated boxes (HS 481910)", "PCU322211322211")),
        "molded_fiber": dict(price=trade_price("MOLDED_PULP", "molded pulp articles (HS 482370)", "PCU322211322211")),
        "reuse_refill": dict(price=None),
    }
    for key, spec in plan.items():
        materials[key] = {k: add(key, v) for k, v in spec.items()}

    epr = []
    for cat, keys, lo, hi, q in OR_FEES:
        c = cite(OR_DOC, q)
        epr.append({"id": f"OR:{cat}", "state": "OR", "material_category": cat, "material_keys": keys,
                    "cents_per_lb_low": lo, "cents_per_lb_high": hi,
                    "fee_per_kg_low": round(lo / 100 * LB_PER_KG, 4), "fee_per_kg_high": round(hi / 100 * LB_PER_KG, 4),
                    "effective_date": "2025-07-01", **c})

    laws = []
    for st, typ, status, title, enacted, kd, kde, doc, q in STATE_LAWS:
        c = cite(doc, q)
        laws.append({"id": f"{st}:{typ}", "state": st, "law_type": typ, "status": status, "title": title,
                     "enacted_date": enacted, "key_date": kd, "key_date_event": kde, "source_doc_id": doc,
                     "source_chunk_id": c.get("chunk_id"), "source_url": c.get("source_url")})

    if MISSING:
        print("QUOTES NOT FOUND (fix the spec or the corpus):")
        for m in MISSING:
            print("  -", m)
        return 1

    out = {
        "generated": date.today().isoformat(),
        "note": "Every value is cited to a corpus chunk. Reviewed by hand before release; see docs/DECISIONS.md D16-D18.",
        "states_fee_schedule_public": ["OR"],
        "states_fees_in_effect": sorted({l["state"] for l in laws if l["law_type"] == "epr" and l["status"] == "fees_in_effect"}),
        "inputs": inputs, "materials": materials, "epr_fees": epr,
        "freight": None,
    }
    write_json(ROOT / "cost" / "price_inputs.json", out)
    write_json(STRUCTURED / "state_laws.json", laws)
    print(f"price_inputs.json: {len(inputs)} cited inputs, {len(epr)} fee rows; state_laws.json: {len(laws)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(build())
