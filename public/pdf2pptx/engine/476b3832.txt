"""Map PDF (PostScript) font names to font families PowerPoint knows."""
from __future__ import annotations

import re

_SUBSET = re.compile(r"^[A-Z]{6}\+")
_CAMEL = re.compile(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")
_GARBAGE = re.compile(r"^(?:F|T|TT|C|R|CIDFont|Font)\d*$|^.{0,2}$", re.I)
_BOLD = re.compile(r"bold|black|heavy|semibold|demi", re.I)
_ITALIC = re.compile(r"italic|oblique|(?<=-)it$|(?<=-)ital", re.I)

_KNOWN = {
    "helvetica": "Arial", "helveticaneue": "Arial", "arial": "Arial", "arialmt": "Arial",
    "arialnarrow": "Arial Narrow", "times": "Times New Roman", "timesroman": "Times New Roman",
    "timesnewroman": "Times New Roman", "timesnewromanps": "Times New Roman",
    "courier": "Courier New", "couriernew": "Courier New", "couriernewps": "Courier New",
    "symbol": "Symbol", "symbolmt": "Symbol", "zapfdingbats": "Wingdings",
    "wingdings": "Wingdings", "wingdingsregular": "Wingdings",
    "calibri": "Calibri", "cambria": "Cambria", "cambriamath": "Cambria Math",
    "segoeui": "Segoe UI", "verdana": "Verdana", "tahoma": "Tahoma", "georgia": "Georgia",
    "trebuchetms": "Trebuchet MS", "garamond": "Garamond", "consolas": "Consolas",
    "centurygothic": "Century Gothic", "bookantiqua": "Book Antiqua",
    "palatinolinotype": "Palatino Linotype", "impact": "Impact",
    "comicsansms": "Comic Sans MS", "lucidaconsole": "Lucida Console",
    "sfprodisplay": "Arial", "sfprotext": "Arial", "sfpro": "Arial",
}

# LaTeX Computer Modern / Latin Modern families
_TEX_PREFIXES = (
    ("cmmi", "Cambria Math"), ("cmsy", "Cambria Math"), ("cmex", "Cambria Math"),
    ("msbm", "Cambria Math"), ("msam", "Cambria Math"), ("cmtt", "Courier New"),
    ("cmss", "Arial"), ("cm", "Times New Roman"), ("lmroman", "Times New Roman"),
    ("lmsans", "Arial"), ("lmmono", "Courier New"),
    ("sfss", "Arial"), ("sftt", "Courier New"), ("sf", "Times New Roman"),   # cm-super
    ("ecss", "Arial"), ("ectt", "Courier New"), ("ec", "Times New Roman"),   # EC fonts
)
_TEX_SHORT = ("cm", "sf", "ec")

FLAG_ITALIC = 2
FLAG_SERIF = 4
FLAG_MONO = 8
FLAG_BOLD = 16


def map_font(pdf_name: str, flags: int = 0) -> tuple[str, bool, bool]:
    """Return (family, bold, italic) for a PDF font name and PyMuPDF span flags."""
    name = _SUBSET.sub("", pdf_name or "").strip()
    bold = bool(flags & FLAG_BOLD) or bool(_BOLD.search(name))
    italic = bool(flags & FLAG_ITALIC) or bool(_ITALIC.search(name))

    base = re.split(r"[-,+]", name, maxsplit=1)[0]
    style = name[len(base):].lower()
    base = re.sub(r"(PSMT|MT|PS)$", "", base)
    key = re.sub(r"[^a-z0-9]", "", base.lower())

    if not key or _GARBAGE.match(base):
        return _generic(flags), bold, italic
    if key in _KNOWN:
        family = _KNOWN[key]
    else:
        tex = next((f for p, f in _TEX_PREFIXES if key.startswith(p) and _is_tex(key, p)), None)
        if tex:
            return (tex, bold or key[2:4] == "bx",
                    italic or key[2:4] in ("ti", "sl") or key.startswith("cmmi"))
        family = _CAMEL.sub(" ", base).replace("_", " ").strip()
    if "light" in style and family in ("Calibri", "Segoe UI"):
        family += " Light"
    return family, bold, italic


def _is_tex(key: str, prefix: str) -> bool:
    rest = key[len(prefix):]
    return prefix not in _TEX_SHORT or bool(re.match(r"^[a-z]{0,4}\d+$", rest))


def _generic(flags: int) -> str:
    if flags & FLAG_MONO:
        return "Courier New"
    if flags & FLAG_SERIF:
        return "Times New Roman"
    return "Arial"
