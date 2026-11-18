"""Build the structured suppliers tables from SEC 10-K filings already in the corpus.

- suppliers.json        one row per company: material/product tags and certifications, each with an evidence
                        chunk id (the passage that states it). No tag without evidence.
- supplier_plants.json  US locations listed in 10-K Item 2 (Properties), geocoded with the Census Gazetteer
                        (places file) so the map and distance ranking need no geocoding API.
- state_centers.json    Census 2020 state centers of population (for distance to sales states).

Only public business information is stored (company, plant city/state, product lines, filing link).
Run after chunk.py:  python scripts/build_suppliers.py
"""
from __future__ import annotations

import csv
import io
import json
import re
import sys
import zipfile

from common import PROCESSED, RAW, ROOT, STRUCTURED, http_get, today, write_json

GEO = RAW / "geo"
STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "DC": "District of Columbia", "FL": "Florida", "GA": "Georgia",
    "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas",
    "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico", "NY": "New York", "NC": "North Carolina",
    "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island",
    "SC": "South Carolina", "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
}
NAME_TO_ABBR = {v.lower(): k for k, v in STATES.items()}

MATERIAL_RULES = [
    (r"aluminum (?:beverage )?(?:cans?|containers|bottles|packaging)|beverage cans", ["aluminum"]),
    (r"glass containers?|glass bottles", ["glass"]),
    (r"steel (?:cans|containers)|metal containers|tinplate|aerosol cans", ["steel"]),
    (r"corrugated", ["corrugated"]),
    (r"paperboard|folding cartons?", ["paperboard"]),
    (r"paper bags?|kraft paper|paper-based|paper packaging", ["paper_kraft"]),
    (r"mou?lded (?:fib(?:er|re)|pulp)", ["molded_fiber"]),
    (r"flexible packaging|\bfilms?\b|pouches", ["pe_film", "pp_film", "multilayer_film"]),
    (r"\bPET\b|rigid plastic|plastic containers|plastic bottles", ["pet", "hdpe", "pp_rigid"]),
    (r"recycled (?:content|PET|resin|plastic)|post-consumer resin|\bPCR\b", ["rpet"]),
    (r"compostable", ["pla_rigid", "pla_film", "molded_fiber"]),
    (r"mailers?", ["pe_film", "paper_kraft"]),
    (r"polystyrene|foam (?:packaging|containers)", ["ps_eps"]),
]
PRODUCT_RULES = [
    (r"bottles?", "rigid bottle"), (r"\bjars?\b", "jar"), (r"\bcans?\b", "can"), (r"folding cartons?|cartons", "folding carton"),
    (r"corrugated (?:boxes|packaging|products)|shipping containers|boxes", "corrugated box"),
    (r"pouch|flexible packaging", "flexible pouch/film"), (r"mailers?", "mailer"), (r"\bcups?\b|\blids?\b", "cup/lid"),
    (r"trays?|clamshell", "tray/clamshell"), (r"labels?|sleeves?", "label/sleeve"), (r"closures|dispens", "other"),
]
CERT_RULES = [(r"\bFSC\b|Forest Stewardship Council", "FSC"), (r"\bSFI\b|Sustainable Forestry Initiative", "SFI"),
              (r"How2Recycle", "How2Recycle"), (r"\bBPI\b|Biodegradable Products Institute", "BPI compostable"),
              (r"Association of Plastic Recyclers|\bAPR\b", "APR recognition"), (r"BioPreferred", "USDA BioPreferred")]


# Reviewed by hand (docs/FIXED_BY_HAND.md #11): keyword rules over-tagged companies with materials they only
# mention as competitors, so product lines are now a spec of verbatim 10-K quotes, each verified against a chunk.
SUPPLIER_SPEC = {
    "ball": [(["aluminum"], ["can", "rigid bottle"], "Our largest product line is aluminum beverage containers")],
    "crown": [(["aluminum", "steel"], ["can"], "manufactures metal cans and ends (aluminum and steel)")],
    "graphic-packaging": [(["paperboard"], ["folding carton", "tray/clamshell", "cup/lid"],
                           "cups and bowls made primarily from recycled paperboard")],
    "greif": [(["corrugated", "paperboard"], ["corrugated box"], "We produce and sell containerboard, corrugated sheets, corrugated containers")],
    "international-paper": [(["corrugated", "paperboard", "paper_kraft"], ["corrugated box"],
                             "We produce renewable fiber-based packaging products")],
    "o-i-glass": [(["glass"], ["rigid bottle", "jar"], "leading manufacturers of glass containers")],
    "pca": [(["corrugated"], ["corrugated box"], "91 corrugated products plants")],
    "sealed-air": [(["multilayer_film", "pe_film"], ["flexible pouch/film"], "CRYOVAC® brand Barrier Bags, CRYOVAC® brand Form-Fill-Seal Films")],
    "silgan": [(["steel", "aluminum"], ["can"], "we manufacture steel and aluminum two-piece cans")],
    "smurfit-westrock": [(["corrugated", "paperboard"], ["corrugated box", "folding carton"],
                          "Our main categories of packaging are corrugated containers, manufactured from containerboard; and consumer packaging, manufactured from paperboard"),
                         (["paper_kraft"], ["mailer"], "Other kraft paper has a large number of uses such as but not limited to paper bags")],
    "sonoco": [(["paperboard"], ["other"], "Our rigid paper containers are manufactured from 100% recycled paperboard"),
               (["steel", "aluminum"], ["can"], "The principal raw materials used by the Company are recovered paper, paperboard, steel, and aluminum")],
    "aptargroup": [([], ["other"], "design and manufacturing of drug and consumer product dosing, dispensing and protection technologies")],
}

def ensure_geo() -> None:
    GEO.mkdir(parents=True, exist_ok=True)
    if not (GEO / "2024_Gaz_place_national.txt").exists():
        z = zipfile.ZipFile(io.BytesIO(http_get(
            "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip").content))
        z.extractall(GEO)
    if not (GEO / "cenpop_st.txt").exists():
        (GEO / "cenpop_st.txt").write_bytes(http_get(
            "https://www2.census.gov/geo/docs/reference/cenpop2020/CenPop2020_Mean_ST.txt").content)


def load_places() -> dict[tuple[str, str], tuple[float, float]]:
    out = {}
    with open(GEO / "2024_Gaz_place_national.txt", encoding="latin-1") as f:
        r = csv.DictReader(f, delimiter="\t")
        for row in r:
            row = {k.strip(): v for k, v in row.items()}
            name = re.sub(r" (city|town|village|CDP|borough|municipality|city and borough|metropolitan government.*|"
                          r"unified government.*|consolidated government.*|urban county)$", "", row["NAME"]).strip()
            out[(name.lower(), row["USPS"])] = (float(row["INTPTLAT"]), float(row["INTPTLONG"]))
    return out


def state_centers() -> dict[str, dict]:
    out = {}
    with open(GEO / "cenpop_st.txt", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            ab = NAME_TO_ABBR.get(row["STNAME"].lower())
            if ab:
                out[ab] = {"lat": float(row["LATITUDE"]), "lng": float(row["LONGITUDE"]), "name": row["STNAME"]}
    return out


LOC_RX = re.compile(r"((?:[A-Z][A-Za-z.'\-]*\s){0,3}[A-Z][A-Za-z.'\-]*),\s*(" + "|".join(
    sorted(list(STATES) + list(STATES.values()), key=len, reverse=True)) + r")\b")


def extract_locations(text: str, places) -> list[tuple[str, str, float, float]]:
    seen, out = set(), []
    for m in LOC_RX.finditer(text):
        words, st = m.group(1).split(), m.group(2)
        ab = st if st in STATES else NAME_TO_ABBR[st.lower()]
        for k in range(min(4, len(words)), 0, -1):  # longest suffix that is a real place in that state
            city = " ".join(words[-k:])
            ll = places.get((city.lower(), ab)) or places.get((city.lower().replace("st.", "saint"), ab))
            if ll:
                if (city, ab) not in seen:
                    seen.add((city, ab))
                    out.append((city, ab, ll[0], ll[1]))
                break
    return out


def main() -> int:
    ensure_geo()
    places = load_places()
    chunks: dict[str, list[dict]] = {}
    with open(PROCESSED / "chunks.jsonl", encoding="utf-8") as f:
        for line in f:
            c = json.loads(line)
            if c["document_id"].startswith("sec-10k-"):
                chunks.setdefault(c["document_id"], []).append(c)
    docs = {d["id"]: d for d in json.loads((PROCESSED / "documents.json").read_text(encoding="utf-8"))}

    suppliers, plants, missing = [], [], []
    for doc_id, cs in sorted(chunks.items()):
        d = docs[doc_id]
        name = d["title"].split(" Annual Report")[0]
        sid = doc_id.replace("sec-10k-", "")
        mats, prods, certs, evidence = set(), set(), set(), []
        for keys, ptags, quote in SUPPLIER_SPEC.get(sid, []):
            q = " ".join(quote.split()).lower()
            hit = next((c for c in cs if q in " ".join(c["content"].split()).lower()), None)
            if not hit:
                missing.append(f"{sid}: {quote!r}")
                continue
            mats.update(keys)
            prods.update(ptags)
            evidence.append({"what": f"product line: {', '.join(keys) or 'n/a'}", "chunk_id": hit["id"], "quote": quote})
        for rx, tag in CERT_RULES:
            for c in cs:
                m = re.search(rx, c["content"])
                if m:
                    certs.add(tag)
                    s = max(0, m.start() - 120)
                    evidence.append({"what": f"certification: {tag}", "chunk_id": c["id"],
                                     "quote": " ".join(c["content"][s:m.end() + 120].split())})
                    break
        props = " ".join(c["content"] for c in cs if (c.get("section") or "").startswith("Item 2"))
        locs = extract_locations(props, places)
        for i, (city, st, lat, lng) in enumerate(locs):
            plants.append({"id": f"{sid}:{i}", "supplier_id": sid, "city": city, "state": st, "lat": lat, "lng": lng,
                           "plant_type": "facility listed in 10-K Item 2", "source_doc_id": doc_id})
        suppliers.append({"id": sid, "company_name": name, "website": None, "inquiry_url": d["source_url"],
                          "material_tags": sorted(mats), "product_tags": sorted(prods), "certifications": sorted(certs),
                          "scale_tier": "large", "source_doc_ids": [doc_id], "evidence": evidence,
                          "last_verified": today(), "us_plants_listed": len(locs)})
        print(f"{sid:20} plants={len(locs):3} materials={sorted(mats)} certs={sorted(certs)}")

    if missing:
        print("QUOTES NOT FOUND:")
        for m in missing:
            print("  -", m)
        return 1
    write_json(STRUCTURED / "suppliers.json", suppliers)
    write_json(STRUCTURED / "supplier_plants.json", plants)
    write_json(ROOT / "worker" / "src" / "data" / "state_centers.json", state_centers())
    print(f"\n{len(suppliers)} suppliers, {len(plants)} US plant locations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
