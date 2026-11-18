"""Find open-access (CC-licensed) papers in Europe PMC for the materials/demand layers.

Prints candidates; chosen ones are added to sources.csv with format=epmc and fetch_url=<PMCID>.
Usage: python scripts/discover_openaccess.py "paper-based packaging barrier" [-n 8]
"""
import argparse
import sys

from common import http_get


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("query")
    ap.add_argument("-n", type=int, default=8)
    a = ap.parse_args()
    q = f'({a.query}) AND OPEN_ACCESS:y AND HAS_FT:y AND (LICENSE:"cc by" OR LICENSE:"cc-by") AND PUB_YEAR:[2019 TO 2026]'
    r = http_get("https://www.ebi.ac.uk/europepmc/webservices/rest/search",
                 params={"query": q, "format": "json", "pageSize": a.n, "resultType": "core", "sort": "CITED desc"})
    for x in r.json().get("resultList", {}).get("result", []):
        print(f"{x.get('pmcid','-'):12} {x.get('pubYear')} cit={x.get('citedByCount',0):4} {x.get('license','?'):8} "
              f"{x.get('journalInfo',{}).get('journal',{}).get('title','')[:28]:28} | {x.get('title','')[:110]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
