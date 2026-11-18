"""Deterministic cost calculator (brief section 7). The LLM never produces these numbers.

estimate(profile, options, catalog, laws, ppi_factors) -> dict

  profile      Package Profile (section 3), e.g. {"package_type": "mailer", "unit_weight_g": 30, ...}
  options      [{"key": "pe_film", "label": "...", "is_current": True}, {"key": "paper_kraft", ...}]
  catalog      cost/price_inputs.json (every value cited to a corpus chunk)
  laws         state_laws rows (for EPR status per state)
  ppi_factors  {"PCU...": 1.02}  = PPI_now / mean(PPI over the price's base period)

The TypeScript port (worker/src/cost/calculator.ts) is checked against the same cases (cost/tests/cases.json).
"""
from __future__ import annotations

from geometry import area_cm2

FLEX = {"pe_film", "pp_film", "multilayer_film", "pla_film"}
GRAMMAGE_KEYS = {"paper_kraft", "paper_barrier", "paperboard"}
BAGLIKE = {"mailer", "flexible pouch/film"}


def _rng(lo, hi):
    return {"low": lo, "high": hi}


def _input(catalog: dict, iid: str | None) -> dict | None:
    if not iid:
        return None
    return next((i for i in catalog["inputs"] if i["id"] == iid), None)


def _mat(catalog: dict, key: str) -> dict:
    return catalog["materials"].get(key, {})


def price_for(catalog: dict, key: str, package_type: str | None) -> dict | None:
    m = _mat(catalog, key)
    if key == "pe_film" and package_type in ("mailer",) and m.get("sacks"):
        return _input(catalog, m["sacks"])
    if key == "paperboard" and package_type not in ("folding carton",) and m.get("sheet"):
        return _input(catalog, m["sheet"])
    if key == "aluminum" and package_type in ("flexible pouch/film", "tray/clamshell", "label/sleeve") and m.get("foil"):
        return _input(catalog, m["foil"])
    return _input(catalog, m.get("price"))


def current_weight(profile: dict, key: str, catalog: dict) -> dict:
    if profile.get("unit_weight_g"):
        w = float(profile["unit_weight_g"])
        return {**_rng(w, w), "method": "given in profile", "inputs": []}
    area, how = area_cm2(profile.get("package_type"), profile.get("dimensions"))
    th = profile.get("thickness")
    dens = _input(catalog, _mat(catalog, key).get("density"))
    if area and th and dens:
        cm = th["value"] / 10000 if th.get("unit") == "micron" else th["value"] / 10
        return {**_rng(round(area * cm * dens["low"], 3), round(area * cm * dens["high"], 3)),
                "method": f"area {area:.0f} cm² ({how}) × thickness × density", "inputs": [dens["id"]]}
    cont = _input(catalog, _mat(catalog, key).get("container"))
    if cont and profile.get("package_type") in ("rigid bottle", "can", "jar"):
        return {**_rng(cont["low"], cont["high"]), "method": "average beverage-container weight (CalRecycle)",
                "inputs": [cont["id"]]}
    return {"low": None, "high": None, "method": "gap: give unit weight, or dimensions + thickness", "inputs": [], "gap": True}


def alt_weight(profile: dict, key: str, cur_key: str, cur: dict, catalog: dict) -> dict:
    pt = profile.get("package_type")
    if key == cur_key:
        return {**cur, "method": cur["method"]}
    area, how = area_cm2(pt, profile.get("dimensions"))
    m = _mat(catalog, key)
    cm = _mat(catalog, cur_key)
    has_cur = cur.get("low") is not None

    if key in GRAMMAGE_KEYS:
        gram = _input(catalog, m.get("grammage"))
        if area and gram:
            m2 = area / 10000
            return {**_rng(round(m2 * gram["low"], 3), round(m2 * gram["high"], 3)),
                    "method": f"area {area:.0f} cm² ({how}) × cited grammage range", "inputs": [gram["id"]]}

    ca, cc = _input(catalog, m.get("container")), _input(catalog, cm.get("container"))
    if has_cur and ca and cc:
        r = ca["low"] / cc["low"]
        return {**_rng(round(cur["low"] * r, 3), round(cur["high"] * r, 3)),
                "method": f"current weight × average container-weight ratio {r:.2f} (CalRecycle)",
                "inputs": [ca["id"], cc["id"]], "assumption": "ratio of average beverage containers, not same-size"}

    da, dc = _input(catalog, m.get("density")), _input(catalog, cm.get("density"))
    th = profile.get("thickness")
    if area and th and da:
        t = th["value"] / 10000 if th.get("unit") == "micron" else th["value"] / 10
        return {**_rng(round(area * t * da["low"], 3), round(area * t * da["high"], 3)),
                "method": "same wall/film thickness × alternative density", "inputs": [da["id"]],
                "assumption": "same gauge as the current package"}

    same_family = (key in FLEX and cur_key in FLEX) or (key in {"pet", "rpet", "hdpe", "pp_rigid", "pla_rigid"}
                                                        and cur_key in {"pet", "rpet", "hdpe", "pp_rigid", "pla_rigid"})
    if has_cur and same_family:
        if da and dc:
            lo, hi = da["low"] / dc["high"], da["high"] / dc["low"]
            return {**_rng(round(cur["low"] * lo, 3), round(cur["high"] * hi, 3)),
                    "method": "current weight × density ratio", "inputs": [da["id"], dc["id"]],
                    "assumption": "same gauge as the current package"}
        return {**_rng(cur["low"], cur["high"]), "method": "equal weight assumed", "inputs": [],
                "assumption": "no cited gauge or density for one of the materials; equal weight assumed"}
    return {"low": None, "high": None, "method": "gap: no cited basis to estimate this alternative's weight",
            "inputs": [], "gap": True}


def _epr_states(profile: dict, catalog: dict, laws: list[dict]) -> list[str]:
    st = [s for s in (profile.get("sales_states") or []) if s and s != "nationwide"]
    if not st or "nationwide" in (profile.get("sales_states") or []):
        return sorted(set(catalog.get("states_fees_in_effect", [])) | {l["state"] for l in laws if l["law_type"] == "epr"})
    return st


def epr_for(state: str, key: str, w: dict, catalog: dict, laws: list[dict]) -> dict:
    rows = [f for f in catalog["epr_fees"] if f["state"] == state and key in f["material_keys"]]
    if rows and w.get("low") is not None:
        f = rows[0]
        return {"low": w["low"] / 1000 * f["fee_per_kg_low"], "high": w["high"] / 1000 * f["fee_per_kg_high"],
                "category": f["material_category"], "inputs": [f["id"]]}
    law = next((l for l in laws if l["state"] == state and l["law_type"] == "epr"), None)
    if state in catalog.get("states_fees_in_effect", []):
        if state in catalog.get("states_fee_schedule_public", []):
            return {"status": "fees in effect; no fee category mapped for this material", "gap": True}
        return {"status": "fees in effect; fee schedule not public", "gap": True}
    if law:
        return {"status": "law enacted; fees not yet in effect"}
    return {"status": "no packaging EPR law in corpus"}


def estimate(profile: dict, options: list[dict], catalog: dict, laws: list[dict], ppi_factors: dict | None = None) -> dict:
    ppi_factors = ppi_factors or {}
    pt = profile.get("package_type")
    cur_opt = next((o for o in options if o.get("is_current")), options[0])
    cur_key = cur_opt["key"]
    cur_w = current_weight(profile, cur_key, catalog)
    states = _epr_states(profile, catalog, laws)
    units = profile.get("annual_units")
    out, used, gaps = [], set(), []

    for o in options:
        key = o["key"]
        w = cur_w if o.get("is_current") else alt_weight(profile, key, cur_key, cur_w, catalog)
        used.update(w.get("inputs", []))
        price = price_for(catalog, key, pt)
        mat = None
        if price and w.get("low") is not None:
            f = ppi_factors.get(price.get("ppi_series"), 1.0)
            mat = {"low": w["low"] / 1000 * price["low"] * f, "high": w["high"] / 1000 * price["high"] * f,
                   "basis": price.get("basis"), "ppi_factor": round(f, 4), "inputs": [price["id"]]}
            used.add(price["id"])
        else:
            gaps.append(f"{o['label']}: material cost not estimated ("
                        f"{'no cited $/kg price' if not price else 'weight unknown'})")
        if w.get("gap"):
            gaps.append(f"{o['label']}: {w['method']}")
        epr = {s: epr_for(s, key, w, catalog, laws) for s in states}
        for s, e in epr.items():
            used.update(e.get("inputs", []))
        fee_vals = [e for e in epr.values() if "low" in e]
        total = None
        if mat:
            total = {"low": mat["low"] + (min(e["low"] for e in fee_vals) if fee_vals else 0),
                     "high": mat["high"] + (max(e["high"] for e in fee_vals) if fee_vals else 0)}
        annual = {"low": total["low"] * units, "high": total["high"] * units} if (total and units) else None
        delta = None
        if not o.get("is_current") and w.get("low") is not None and cur_w.get("low") is not None:
            delta = {"low": round(w["low"] - cur_w["high"], 3), "high": round(w["high"] - cur_w["low"], 3)}
        out.append({"key": key, "label": o["label"], "is_current": bool(o.get("is_current")), "weight_g": w,
                    "material_cost": mat, "epr": epr, "freight": {"weight_delta_g": delta, "cost": None,
                                                                   "note": "no cited freight $/kg in corpus"},
                    "total_per_unit": total, "annual": annual})

    for s in states:
        if any(o["epr"][s].get("status", "").startswith("fees in effect; fee schedule not public") for o in out):
            gaps.append(f"{s}: EPR fees are in effect but the fee schedule is not public")
    gaps.append("Freight: no cited freight cost per kg; only the weight difference is shown")
    if any(o["material_cost"] and "proxy" in (o["material_cost"]["basis"] or "") for o in out):
        gaps.append("Some prices use a trade-category proxy (marked 'proxy'); confirm with supplier quotes")

    inputs = [i for i in catalog["inputs"] if i["id"] in used] + [f for f in catalog["epr_fees"] if f["id"] in used]
    primary = sum(1 for i in inputs if i.get("reliability") == "primary")
    complete = all(o["total_per_unit"] for o in out)
    confidence = "Medium" if complete and inputs and primary / len(inputs) >= 0.6 else "Low"
    return {"options": out, "states": states, "confidence": confidence, "gaps": sorted(set(gaps)),
            "inputs": inputs, "annual_units": units,
            "note": "Order-of-magnitude estimate from public data (trade-statistics unit values, PRO fee schedules), "
                    "not a supplier quote. Ranges, not point values."}
