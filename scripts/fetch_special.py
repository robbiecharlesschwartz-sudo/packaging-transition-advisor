"""Fetchers for sources that need an API or assembly step. Each writes corpus/raw/<doc_id>.txt (+ .meta.json)
and registers/updates its row in corpus/sources.csv with format=generated.

  python scripts/fetch_special.py wiki       Wikipedia material-property pages (CC BY-SA), density/grammage refs
  python scripts/fetch_special.py mn         Minnesota Packaging Waste and Cost Reduction Act, section by section
  python scripts/fetch_special.py sec        latest 10-K Items 1, 1A (filtered) and 2 for packaging converters
  python scripts/fetch_special.py rss        trade-press headlines + RSS summaries (no article text)
  python scripts/fetch_special.py ppi        BLS Producer Price Index series for packaging inputs
  python scripts/fetch_special.py trade      US import unit values ($/kg) for packaging materials (UN Comtrade)
  python scripts/fetch_special.py all
"""
from __future__ import annotations

import json
import os
import re
import statistics
import sys
import time
from datetime import date, datetime

import feedparser
import pymupdf
import trafilatura

from common import RAW, STRUCTURED, http_get, load_env, load_sources, sha256_bytes, today, write_json, write_sources

WIKI_UA = ("packaging-transition-advisor/1.0 (open-source research tool; "
           "https://github.com/robbiecharlesschwartz-sudo/packaging-transition-advisor)")


def save_generated(doc_id: str, text: str, row: dict, extra_meta: dict | None = None) -> None:
    body = text.encode("utf-8")
    (RAW / f"{doc_id}.txt").write_bytes(body)
    write_json(RAW / f"{doc_id}.meta.json", {"doc_id": doc_id, "status": "ok", "ext": "txt", "bytes": len(body),
                                             "fetched_date": today(), "sha256": sha256_bytes(body),
                                             **(extra_meta or {})})
    rows = load_sources()
    base = dict(doc_id=doc_id, format="generated", fetch_url="", reg_status="n/a", material_tags="",
                package_tags="", notes="", doc_date="")
    base.update(row)
    for i, r in enumerate(rows):
        if r["doc_id"] == doc_id:
            rows[i] = {**r, **base}
            break
    else:
        rows.append(base)
    write_sources(rows)


# --------------------------------------------------------------------------- Wikipedia material references
WIKI_PAGES = {
    "Polyethylene_terephthalate": "PET", "High-density_polyethylene": "HDPE",
    "Low-density_polyethylene": "LDPE", "Linear_low-density_polyethylene": "LLDPE",
    "Polypropylene": "PP", "Polystyrene": "PS", "Polylactic_acid": "PLA", "Soda–lime_glass": "glass",
    "Aluminium": "aluminum", "Kraft_paper": "kraft paper", "Paperboard": "paperboard",
    "Corrugated_fiberboard": "corrugated", "Grammage": "paper grammage",
}
PROPERTY_RX = re.compile(r".{0,160}(?:g/cm3|g/cm³|kg/m3|kg/m³|g/m2|g/m²|grams per square met|gsm).{0,120}")


def wiki() -> None:
    parts = ["Material property reference excerpts (density, grammage) from Wikipedia articles, "
             "retrieved via the Wikimedia REST API. Text is CC BY-SA 4.0; each section names its article."]
    for page, label in WIKI_PAGES.items():
        r = http_get(f"https://en.wikipedia.org/api/rest_v1/page/html/{page}", ua=WIKI_UA)
        text = " ".join((trafilatura.html2txt(r.text) or "").split())
        hits = []
        for m in PROPERTY_RX.finditer(text):
            s = " ".join(m.group(0).split())
            if s not in hits and not re.search(r"Calender|Check weigher", s):
                hits.append(s)
        if hits:
            parts.append(f"## {label} (Wikipedia: {page.replace('_', ' ')}, https://en.wikipedia.org/wiki/{page})\n"
                         + "\n".join(f"- {h}" for h in hits[:8]))
        time.sleep(0.5)
    save_generated("ref-material-properties", "\n\n".join(parts), dict(
        title="Material property references: densities and paper grammage (Wikipedia excerpts)",
        publisher="Wikipedia (CC BY-SA 4.0)", source_url="https://en.wikipedia.org/wiki/Polyethylene_terephthalate",
        layer="materials", jurisdiction="global", doc_date=today(), reliability="secondary", license="open_access",
        notes="physical constants used by the weight calculator; secondary source"))
    print("wiki: ok")


# --------------------------------------------------------------------------- Minnesota statute
def mn() -> None:
    secs = ["115A.144"] + [f"115A.{n}" for n in range(1441, 1464)]
    out = []
    for s in secs:
        r = http_get(f"https://www.revisor.mn.gov/statutes/cite/{s}/pdf", retries=1)
        if r.status_code != 200 or r.content[:4] != b"%PDF":
            continue
        d = pymupdf.open(stream=r.content, filetype="pdf")
        t = "\n".join(p.get_text() for p in d).replace("​", "")
        t = "\n".join(ln for ln in t.splitlines()
                      if not any(x in ln for x in ("Official Publication", "Revisor of Statutes", "MINNESOTA STATUTES")))
        out.append(f"## Minn. Stat. {s}\n{t.strip()}")
    save_generated("mn-statute-115a144", "\n\n".join(out), dict(
        title="Minn. Stat. 115A.144-115A.1463 Packaging Waste and Cost Reduction Act",
        publisher="Minnesota Revisor of Statutes", source_url="https://www.revisor.mn.gov/statutes/cite/115A.144",
        layer="regulation", jurisdiction="US-MN", reg_status="enacted", reliability="primary", license="public_domain",
        notes="statute; assembled by fetching each section PDF from revisor.mn.gov"))
    print(f"mn: {len(out)} sections")


# --------------------------------------------------------------------------- SEC 10-K filings
SEC_COMPANIES = {
    "sealed-air": ("Sealed Air Corporation", 1012100),
    "sonoco": ("Sonoco Products Company", 91767), "graphic-packaging": ("Graphic Packaging Holding Company", 1408075),
    "international-paper": ("International Paper Company", 51434), "ball": ("Ball Corporation", 9389),
    "crown": ("Crown Holdings, Inc.", 1219601), "o-i-glass": ("O-I Glass, Inc.", 812074),
    "smurfit-westrock": ("Smurfit Westrock plc", 2005951), "pca": ("Packaging Corporation of America", 75677),
    "silgan": ("Silgan Holdings Inc.", 849869), "aptargroup": ("AptarGroup, Inc.", 896622),
    "greif": ("Greif, Inc.", 43920),
}
RISK_KEEP = re.compile(r"sustainab|recycl|plastic|extended producer|packaging waste|single-use|environmental|"
                       r"regulat|climate|carbon|consumer preference|bio-?based|compostab|fiber-based|paper-based", re.I)


def sec_text(html: str) -> str:
    t = trafilatura.html2txt(html) or ""
    return re.sub(r"[ \t\xa0]+", " ", t)


def find_items(t: str) -> dict[str, str]:
    """Return text of Items 1, 1A and 2 from a 10-K. Headings also appear in the table of contents, so every
    item heading (1 through 7) is a boundary and each item takes the occurrence with the longest span."""
    rxs = [("1", r"item\s*1\.?\s*business"), ("1A", r"item\s*1a\.?\s*risk\s*factors"),
           ("1B", r"item\s*1b\.?\s*unresolved"), ("1C", r"item\s*1c\.?\s*cybersecurity"),
           ("2", r"item\s*2\.?\s*properties"), ("3", r"item\s*3\.?\s*legal\s*proceedings"),
           ("4", r"item\s*4\.?\s*mine\s*safety"), ("5", r"item\s*5\.?\s*market\s*for"),
           ("7", r"item\s*7\.?\s*management"), ("8", r"item\s*8\.?\s*financial\s*statements")]
    occ = {k: [m.start() for m in re.finditer(rx, t, re.I)] for k, rx in rxs}
    every = sorted(p for v in occ.values() for p in v)
    out = {}
    for k in ("1", "1A", "2"):
        best = None
        for start in occ[k]:
            nxt = next((p for p in every if p > start + 5), len(t))
            if best is None or nxt - start > best[1] - best[0]:
                best = (start, nxt)
        if best:
            out[k] = t[best[0]:min(best[1], best[0] + 60000)]
    return out


def sec() -> None:
    load_env()
    ua = os.environ.get("SEC_USER_AGENT", "packaging-transition-advisor research-script admin@example.org")
    for slug, (name, cik) in SEC_COMPANIES.items():
        try:
            sub = http_get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json", ua=ua).json()
            rec = sub["filings"]["recent"]
            idx = next(i for i, f in enumerate(rec["form"]) if f == "10-K")
            acc, doc, fdate = rec["accessionNumber"][idx], rec["primaryDocument"][idx], rec["filingDate"][idx]
            url = f"https://www.sec.gov/Archives/edgar/data/{cik}/{acc.replace('-', '')}/{doc}"
            html = http_get(url, ua=ua).text
            items = find_items(sec_text(html))
            parts = [f"{name} Form 10-K filed {fdate} (accession {acc})."]
            if "1" in items:
                words = items["1"].split()
                parts.append("## Item 1. Business\n" + " ".join(words[:7000]))
            if "1A" in items:
                paras = [p.strip() for p in re.split(r"\n\s*\n|(?<=\.)\s{2,}", items["1A"]) if RISK_KEEP.search(p)]
                parts.append("## Item 1A. Risk factors (sustainability, regulation and materials related)\n"
                             + "\n\n".join(paras)[:30000])
            if "2" in items:
                parts.append("## Item 2. Properties\n" + items["2"][:20000])
            save_generated(f"sec-10k-{slug}", "\n\n".join(parts), dict(
                title=f"{name} Annual Report (Form 10-K), Items 1, 1A and 2", publisher=f"{name} / SEC EDGAR",
                source_url=url, layer="competitor", jurisdiction="US", doc_date=fdate, reliability="primary",
                license="public_domain", notes="SEC filing; Item 2 lists plant locations used by the suppliers table"),
                {"filing_date": fdate, "accession": acc})
            print(f"sec: {slug:20} {fdate} items={list(items)}")
        except Exception as e:  # noqa: BLE001
            print(f"sec: {slug} FAILED {e}")
        time.sleep(0.4)


# --------------------------------------------------------------------------- RSS news (headlines only)
FEEDS = {
    "packagingdive": ("Packaging Dive", "https://www.packagingdive.com/feeds/news/"),
    "wastedive": ("Waste Dive", "https://www.wastedive.com/feeds/news/"),
    "resource-recycling": ("Resource Recycling", "https://resource-recycling.com/feed/"),
    "plasticsnews": ("Plastics News", "https://www.plasticsnews.com/rss/news"),
}
NEWS_KEEP = re.compile(r"packag|EPR|extended producer|recycl|compost|plastic|paper|fiber|aluminum|glass|"
                       r"bottle|pouch|mailer|foam|polystyrene|PFAS|green claims|greenwash", re.I)


def rss(max_per_feed: int = 30) -> None:
    rows = load_sources()
    kept = 0
    for slug, (pub, url) in FEEDS.items():
        try:
            feed = feedparser.parse(http_get(url).content)
        except Exception as e:  # noqa: BLE001
            print(f"rss: {slug} FAILED {e}")
            continue
        n = 0
        for e in feed.entries:
            title = (e.get("title") or "").strip()
            summary = trafilatura.html2txt(e.get("summary") or "") if e.get("summary") else ""
            summary = " ".join(summary.split())[:600]
            if not title or not NEWS_KEEP.search(title + " " + summary):
                continue
            pp = e.get("published_parsed") or e.get("updated_parsed")
            d = date(*pp[:3]).isoformat() if pp else today()
            link = e.get("link", "")
            doc_id = "news-" + slug + "-" + sha256_bytes(link.encode())[:10]
            text = f"## Headline\n{title} ({pub}, {d}).\n\nRSS summary: {summary or '(none)'}\n\nLink: {link}"
            body = text.encode("utf-8")
            (RAW / f"{doc_id}.txt").write_bytes(body)
            write_json(RAW / f"{doc_id}.meta.json", {"doc_id": doc_id, "status": "ok", "ext": "txt",
                                                     "fetched_date": today(), "sha256": sha256_bytes(body)})
            if not any(r["doc_id"] == doc_id for r in rows):
                rows.append(dict(doc_id=doc_id, title=title[:200], publisher=pub, source_url=link, fetch_url="",
                                 format="generated", layer="news", jurisdiction="US", doc_date=d, reg_status="n/a",
                                 reliability="press", license="link_only", material_tags="", package_tags="",
                                 notes="headline + RSS summary only"))
                kept += 1
            n += 1
            if n >= max_per_feed:
                break
        print(f"rss: {slug} {n} items")
    write_sources(rows)
    print(f"rss: {kept} new news documents")


# --------------------------------------------------------------------------- BLS Producer Price Index
PPI_SERIES = {
    "PCU325211325211": "Plastics material and resin manufacturing",
    "PCU326111326111": "Plastics bag and pouch manufacturing",
    "PCU326112326112": "Plastics packaging film and unlaminated sheet manufacturing",
    "PCU326160326160": "Plastics bottle manufacturing",
    "PCU322211322211": "Corrugated and solid fiber box manufacturing",
    "PCU322212322212": "Folding paperboard box manufacturing",
    "PCU322220322220": "Paper bag and coated and treated paper manufacturing",
    "PCU322130322130": "Paperboard mills",
    "PCU327213327213": "Glass container manufacturing",
    "PCU331315331315": "Aluminum sheet, plate, and foil manufacturing",
    "PCU332431332431": "Metal can manufacturing",
    "PCU484121484121": "General freight trucking, long-distance truckload",
}


def ppi() -> None:
    load_env()
    key = os.environ.get("BLS_API_KEY", "").strip()
    end = date.today().year
    body = {"seriesid": list(PPI_SERIES), "startyear": str(end - 9), "endyear": str(end)}
    if key:
        body["registrationkey"] = key
    api = "https://api.bls.gov/publicAPI/v2/timeseries/data/" if key else "https://api.bls.gov/publicAPI/v1/timeseries/data/"
    import requests
    r = requests.post(api, json=body, timeout=60, headers={"User-Agent": WIKI_UA})
    res = r.json()
    if res.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError(f"BLS: {res.get('message')}")
    series_rows, parts = [], [
        "US Bureau of Labor Statistics, Producer Price Index (PPI) by industry, not seasonally adjusted. "
        "Index values (base varies by series). Used to adjust older $/kg baselines to the current month: "
        "price_now = price_base x (PPI_now / PPI_base)."]
    for s in res["Results"]["series"]:
        sid, label = s["seriesID"], PPI_SERIES.get(s["seriesID"], s["seriesID"])
        pts = [(f"{d['year']}-{d['period'][1:]}", float(d["value"])) for d in s["data"]
               if d["period"].startswith("M") and d["period"] != "M13" and d["value"] not in ("-", "")]
        pts.sort()
        for period, v in pts:
            series_rows.append({"series_id": sid, "period": period, "value": v, "label": label})
        if not pts:
            continue
        latest_p, latest_v = pts[-1]
        yr_ago = next((v for p, v in pts if p == f"{int(latest_p[:4]) - 1}{latest_p[4:]}"), None)
        chg = f"{(latest_v / yr_ago - 1) * 100:+.1f}% vs a year earlier" if yr_ago else "no year-ago value"
        annual = {}
        for p, v in pts:
            annual.setdefault(p[:4], []).append(v)
        ann = "; ".join(f"{y}: {statistics.mean(vs):.1f}" for y, vs in sorted(annual.items()))
        recent = "; ".join(f"{p}: {v:.1f}" for p, v in pts[-12:])
        parts.append(f"## PPI {sid} {label}\nLatest value {latest_v:.1f} for {latest_p} ({chg}). "
                     f"Annual averages: {ann}. Last 12 months: {recent}.")
    write_json(STRUCTURED / "ppi_series.json", series_rows)
    save_generated("bls-ppi-packaging", "\n\n".join(parts), dict(
        title="Producer Price Index series for packaging inputs (BLS)", publisher="US Bureau of Labor Statistics",
        source_url="https://www.bls.gov/ppi/", layer="prices", jurisdiction="US", doc_date=today(),
        reliability="primary", license="public_domain", notes="pulled from BLS Public Data API"))
    print(f"ppi: {len(series_rows)} monthly points")


# --------------------------------------------------------------------------- Census import unit values
HS_CODES = {
    "390110": ("PE_LD", "Polyethylene, specific gravity < 0.94 (LDPE/LLDPE resin), primary forms"),
    "390120": ("PE_HD", "Polyethylene, specific gravity >= 0.94 (HDPE resin), primary forms"),
    "390210": ("PP", "Polypropylene resin, primary forms"),
    "390311": ("EPS", "Expansible polystyrene, primary forms"),
    "390319": ("PS", "Polystyrene (other), primary forms"),
    "390761": ("PET", "PET resin, viscosity number >= 78 ml/g (bottle grade)"),
    "390770": ("PLA", "Poly(lactic acid) resin, primary forms"),
    "392010": ("PE_FILM", "Plates, sheets, film of polymers of ethylene, non-cellular, not reinforced"),
    "392020": ("PP_FILM", "Plates, sheets, film of polymers of propylene, non-cellular, not reinforced"),
    "392190": ("OTHER_FILM", "Other plates, sheets, film, foil and strip of plastics (incl. laminates), not cellular"),
    "481159": ("PLASTIC_COATED_PAPER", "Paper and paperboard coated, impregnated or covered with plastics (other)"),
    "731021": ("STEEL_CANS", "Iron or steel cans closed by soldering or crimping, capacity < 50 litres"),
    "392321": ("PE_SACKS", "Sacks and bags (including cones) of polymers of ethylene"),
    "392330": ("PLASTIC_BOTTLES", "Carboys, bottles, flasks and similar articles of plastics"),
    "480411": ("KRAFTLINER", "Kraftliner, uncoated, unbleached, in rolls or sheets"),
    "480439": ("KRAFT_PAPER", "Other uncoated kraft paper and paperboard weighing 150 g/m2 or less"),
    "481092": ("MULTIPLY_BOARD", "Multi-ply coated paper and paperboard"),
    "481910": ("CORRUGATED_BOXES", "Cartons, boxes and cases of corrugated paper or paperboard"),
    "481920": ("FOLDING_CARTONS", "Folding cartons, boxes and cases of non-corrugated paper or paperboard"),
    "481940": ("PAPER_SACKS", "Other sacks and bags of paper, including cones"),
    "482370": ("MOLDED_PULP", "Moulded or pressed articles of paper pulp"),
    "701090": ("GLASS_CONTAINERS", "Glass carboys, bottles, jars, pots and similar containers"),
    "760711": ("AL_FOIL", "Aluminum foil, not backed, rolled but not further worked, <= 0.2 mm"),
    "761290": ("AL_CONTAINERS", "Aluminum casks, drums, cans, boxes and similar containers <= 300 litres"),
}


def _periods(n: int, lag_months: int) -> list[str]:
    d = date.today().replace(day=1)
    y, m = d.year, d.month - lag_months
    out = []
    for _ in range(n):
        while m <= 0:
            y, m = y - 1, m + 12
        out.append(f"{y}{m:02d}")
        m -= 1
    return sorted(out)


def trade(months: int = 12) -> None:
    """US import unit values ($/kg) per HS6 code from UN Comtrade's public preview API (no key needed).
    Comtrade's US figures are reported by the US Census Bureau. Unit value = primary (CIF) value / net weight."""
    import requests
    rows, periods = [], []
    url = "https://comtradeapi.un.org/public/v1/preview/C/M/HS"
    for lag in (2, 3, 4, 5):  # trade data lags 2-5 months; find the latest month with data
        periods = _periods(months, lag)
        r = requests.get(url, params={"reporterCode": 842, "period": periods[-1], "cmdCode": ",".join(HS_CODES),
                                      "flowCode": "M", "partnerCode": 0}, timeout=120)
        if r.ok and r.json().get("data"):
            break
    for p in periods:  # the preview endpoint allows one period per request
        for attempt in range(3):
            r = requests.get(url, params={"reporterCode": 842, "period": p, "cmdCode": ",".join(HS_CODES),
                                          "flowCode": "M", "partnerCode": 0}, timeout=120)
            if r.ok:
                rows += r.json().get("data", [])
                break
            time.sleep(5 * (attempt + 1))
        time.sleep(1.5)
    if not rows:
        raise RuntimeError("Comtrade preview API returned no data")
    out_rows, parts = [], [
        "US general imports by HS6 code, monthly, from the UN Comtrade database (US data as reported by the US Census "
        "Bureau), retrieved through the Comtrade public preview API. Import unit value = customs value (CIF, USD) "
        "divided by net weight (kg). These are border prices for traded goods (resin, film, finished packaging "
        "articles), not supplier quotes. Low/high = 10th/90th percentile of the monthly unit values."]
    for hs, (key, desc) in HS_CODES.items():
        vals = sorted([(x["period"], x["primaryValue"] / x["netWgt"]) for x in rows
                       if x["cmdCode"] == hs and (x.get("netWgt") or 0) > 0 and (x.get("primaryValue") or 0) > 0])
        if len(vals) < 3:
            print(f"trade: {hs} {key}: skipped ({len(vals)} months with weight)")
            continue
        uv = sorted(v for _, v in vals)
        q = statistics.quantiles(uv, n=10)
        low, high, med = q[0], q[-1], statistics.median(uv)
        span = f"{vals[0][0][:4]}-{vals[0][0][4:]} to {vals[-1][0][:4]}-{vals[-1][0][4:]}"
        out_rows.append({"hs6": hs, "key": key, "desc": desc, "low": round(low, 3), "high": round(high, 3),
                         "median": round(med, 3), "periods": span, "n_months": len(vals)})
        monthly = "; ".join(f"{p[:4]}-{p[4:]}: ${u:.2f}/kg" for p, u in vals)
        parts.append(f"## HS {hs} {desc}\nUS import unit value {span}: median ${med:.2f}/kg, "
                     f"10th-90th percentile range ${low:.2f}-${high:.2f}/kg ({len(vals)} months). Monthly: {monthly}.")
        print(f"trade: {hs} {key:16} ${low:.2f}-{high:.2f}/kg")
    write_json(STRUCTURED / "trade_unit_values.json", out_rows)
    span = f"{periods[0][:4]}-{periods[0][4:]} to {periods[-1][:4]}-{periods[-1][4:]}"
    save_generated("trade-unit-values", "\n\n".join(parts), dict(
        title=f"US import unit values for packaging materials, {span} (UN Comtrade / US Census data)",
        publisher="UN Comtrade (US Census Bureau data)", source_url="https://comtradeplus.un.org/",
        layer="prices", jurisdiction="US", doc_date=today(), reliability="primary", license="public_domain",
        notes="computed: import value / net weight per HS6 code; official trade statistics"))


def main() -> int:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "all"
    fns = {"wiki": wiki, "mn": mn, "sec": sec, "rss": rss, "ppi": ppi, "trade": trade}
    for name in (fns if cmd == "all" else [cmd]):
        try:
            fns[name]()
        except Exception as e:  # noqa: BLE001
            print(f"{name}: FAILED {e}")
            if cmd != "all":
                return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
