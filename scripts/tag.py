"""Keyword rules that assign material_tags and package_tags to chunks and documents.

Rules beat an LLM pass here: they are free, deterministic and easy to spot-check.
Spot-check results are logged in docs/FIXED_BY_HAND.md.
"""
from __future__ import annotations

import re
from collections import Counter

MATERIAL_RULES: dict[str, str] = {
    "PET": r"\bPET\b|polyethylene terephthalate",
    "rPET": r"\brPET\b|recycled PET|post-consumer PET",
    "HDPE": r"\bHDPE\b|high[- ]density polyethylene",
    "LDPE/LLDPE": r"\bLL?DPE\b|low[- ]density polyethylene",
    "PE": r"\bpolyethylene\b|\bPE\b",
    "PP": r"\bPP\b|polypropylene",
    "PS/EPS": r"polystyrene|\bEPS\b|styrofoam|\bfoam (?:food|container|cup|tray)",
    "PVC": r"\bPVC\b|polyvinyl chloride",
    "multilayer laminate": r"multi-?layer|multi-?material|laminate",
    "glass": r"\bglass\b",
    "aluminum": r"alumin(?:i)?um",
    "steel": r"\bsteel\b|tinplate",
    "paper": r"\bpaper\b|\bkraft\b",
    "paperboard": r"paperboard|folding carton|cartonboard|boxboard",
    "corrugated": r"corrugated|\bOCC\b",
    "molded fiber": r"mou?lded (?:fib(?:er|re)|pulp)",
    "PLA": r"\bPLA\b|polylactic",
    "PHA": r"\bPHA\b|polyhydroxyalkanoate",
    "compostable": r"compostab",
    "bio-based": r"bio-?based|bioplastic",
}

PACKAGE_RULES: dict[str, str] = {
    "flexible pouch/film": r"\bpouch|flexible packag|\bfilms?\b|\bwrappers?\b",
    "rigid bottle": r"\bbottles?\b",
    "jar": r"\bjars?\b",
    "tray/clamshell": r"\btrays?\b|clamshell",
    "folding carton": r"folding carton|\bcartons?\b",
    "corrugated box": r"corrugated box|shipping box|\bboxes\b",
    "mailer": r"\bmailers?\b|padded envelope|poly mailer",
    "cup/lid": r"\bcups?\b|\blids?\b",
    "can": r"\bcans\b|beverage can|aluminum can",
    "label/sleeve": r"\blabels?\b|shrink sleeve|\bsleeves?\b",
    "bag": r"\bbags?\b|\bsacks?\b",
    "foodware": r"foodware|food ?service ware|food service",
    "beverage container": r"beverage container|deposit",
}

_M = {k: re.compile(v, re.I) for k, v in MATERIAL_RULES.items()}
_P = {k: re.compile(v, re.I) for k, v in PACKAGE_RULES.items()}


def tag_text(text: str) -> tuple[list[str], list[str]]:
    mats = [k for k, rx in _M.items() if rx.search(text)]
    pkgs = [k for k, rx in _P.items() if rx.search(text)]
    return mats, pkgs


def doc_tags(chunk_tags: list[list[str]], extra: list[str], min_share: float = 0.1) -> list[str]:
    """Tags that appear in at least `min_share` of a document's chunks (or at least twice)."""
    c = Counter(t for tags in chunk_tags for t in set(tags))
    n = max(len(chunk_tags), 1)
    keep = {t for t, k in c.items() if k >= 2 and k / n >= min_share}
    return sorted(keep | set(extra))
