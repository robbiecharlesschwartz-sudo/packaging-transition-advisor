"""Surface-area estimates per package type (cm^2). Pure functions; assumptions are returned with the value.

The TypeScript port in worker/src/cost/geometry.ts must give identical results (checked by cost/tests/cases.json).
"""
from __future__ import annotations

import math


def area_cm2(package_type: str | None, dims: dict | None) -> tuple[float | None, str]:
    d = dims or {}
    L, W, H = d.get("l_cm"), d.get("w_cm"), d.get("h_cm")
    g, V = d.get("gusset_cm") or 0.0, d.get("volume_ml")
    pt = package_type or "other"

    if pt in ("flexible pouch/film", "mailer") and L and W:
        a = 2 * L * W + 2 * g * W
        return a, f"2·L·W{' + 2·gusset·W' if g else ''} (two faces{', gusset' if g else ''}; seals ignored)"
    if pt in ("corrugated box", "folding carton") and L and W and H:
        return 2 * (L * W + L * H + W * H), "2(LW + LH + WH) (closed box; flaps and overlaps ignored)"
    if pt == "tray/clamshell" and L and W and H:
        return 2 * (L * W + 2 * H * (L + W)), "clamshell = 2 × open tray (LW + 2H(L+W))"
    if pt in ("rigid bottle", "jar", "can", "cup/lid"):
        if W and H:
            r, h = W / 2, H
        elif V:
            ratio = {"rigid bottle": 2.5, "jar": 1.0, "can": 1.8, "cup/lid": 1.2}[pt]
            # V = pi r^2 h with h = ratio * 2r  ->  r = (V / (2 pi ratio))^(1/3)
            r = (V / (2 * math.pi * ratio)) ** (1 / 3)
            h = ratio * 2 * r
        else:
            return None, "needs volume or diameter and height"
        if pt == "cup/lid":
            return math.pi * r * r + 2 * math.pi * r * h, "open cylinder (base + wall)" + ("" if W else f" from volume, h = 1.2·d")
        how = "closed cylinder (wall + 2 ends)" + ("" if W else f" from volume, h/d assumed")
        return 2 * math.pi * r * h + 2 * math.pi * r * r, how
    if pt == "label/sleeve" and L and W:
        return L * W, "L·W (single layer)"
    if L and W and H:
        return 2 * (L * W + L * H + W * H), "2(LW + LH + WH)"
    if L and W:
        return 2 * L * W, "2·L·W"
    return None, "dimensions not given"
