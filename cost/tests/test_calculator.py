import json
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from calculator import estimate  # noqa: E402
from geometry import area_cm2  # noqa: E402

CASES = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("c", CASES["geometry"], ids=lambda c: f"{c['package_type']}-{c['why'][:20]}")
def test_geometry(c):
    a, _ = area_cm2(c["package_type"], c["dims"])
    if c["area"] is None:
        assert a is None
    else:
        assert a == pytest.approx(c["area"], abs=0.01)


def _pair(x):
    return None if x is None else [x["low"], x["high"]]


@pytest.mark.parametrize("c", CASES["estimates"], ids=lambda c: c["name"])
def test_estimate(c):
    res = estimate(c["profile"], c["options"], CASES["catalog"], CASES["laws"], c["ppi"])
    by = {o["key"]: o for o in res["options"]}
    for key, exp in c["expect"].items():
        o = by[key]
        if "weight" in exp:
            got = [o["weight_g"]["low"], o["weight_g"]["high"]]
            if exp["weight"][0] is None:
                assert got == [None, None]
            else:
                assert got == pytest.approx(exp["weight"], abs=1e-3)
        if "material" in exp:
            if exp["material"] is None:
                assert o["material_cost"] is None
            else:
                assert _pair(o["material_cost"]) == pytest.approx(exp["material"], abs=1e-5)
        if "total" in exp:
            assert _pair(o["total_per_unit"]) == pytest.approx(exp["total"], abs=1e-5)
        if "annual" in exp:
            assert _pair(o["annual"]) == pytest.approx(exp["annual"], abs=0.5)
        for k, v in exp.items():
            if k.startswith("epr_status_"):
                assert o["epr"][k[-2:]]["status"] == v
            elif k.startswith("epr_"):
                assert _pair(o["epr"][k[-2:]]) == pytest.approx(v, abs=1e-5)


def test_live_catalog_is_fully_cited():
    cat = json.loads((HERE.parent / "price_inputs.json").read_text(encoding="utf-8"))
    for i in cat["inputs"] + cat["epr_fees"]:
        assert i.get("chunk_id"), f"uncited input {i['id']}"
        assert i["low"] if "low" in i else i["fee_per_kg_low"] is not None


def test_ranges_never_collapse_to_false_precision():
    c = CASES["estimates"][0]
    res = estimate(c["profile"], c["options"], CASES["catalog"], CASES["laws"], c["ppi"])
    assert res["confidence"] in ("Low", "Medium")
    assert "not a supplier quote" in res["note"]
