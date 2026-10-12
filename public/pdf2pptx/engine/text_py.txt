"""Turn PyMuPDF rawdict text into positioned, styled TextBlocks."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

import pymupdf

from .fonts import map_font
from .model import Color, Rect, Run, TextBlock

TEXT_FLAGS = pymupdf.TEXT_PRESERVE_WHITESPACE | pymupdf.TEXT_MEDIABOX_CLIP
GAP_SPLIT = 1.6    # horizontal gap (in font sizes) that splits a line into separate boxes
GAP_SPACE = 0.22   # gap that implies a missing space between glyphs


def int_rgb(c: int) -> Color:
    return (c >> 16) & 255, (c >> 8) & 255, c & 255


@dataclass
class Piece:
    """One visual line fragment: a run of glyphs on a common baseline."""
    runs: list[Run]
    bbox: Rect
    baseline: float
    size: float
    ascender: float
    descender: float
    dir: tuple[float, float]
    garbled: bool = False
    z: float = 1e6

    @property
    def x0(self): return self.bbox[0]
    @property
    def x1(self): return self.bbox[2]
    @property
    def cx(self): return (self.bbox[0] + self.bbox[2]) / 2
    @property
    def horizontal(self): return abs(self.dir[0] - 1) < 1e-3 and abs(self.dir[1]) < 1e-3


@dataclass
class _Group:
    pieces: list[Piece] = field(default_factory=list)
    mode: str | None = None

    @property
    def last(self): return self.pieces[-1]


@dataclass
class Rules:
    """Table borders / rules: vertical (x, y0, y1) and horizontal (y, x0, x1) segments."""
    vertical: list[tuple[float, float, float]] = field(default_factory=list)
    horizontal: list[tuple[float, float, float]] = field(default_factory=list)

    def cuts_row(self, y: float, x0: float, x1: float) -> bool:
        return any(x0 - 1 <= x <= x1 + 1 and a <= y <= b for x, a, b in self.vertical)

    def between(self, y0: float, y1: float, x0: float, x1: float) -> bool:
        return any(y0 < y < y1 and a < x1 and b > x0 for y, a, b in self.horizontal)


def ruling_lines(drawings) -> Rules:
    rules = Rules()

    def add(p, q):
        if abs(p[0] - q[0]) < 1 and abs(p[1] - q[1]) > 2:
            rules.vertical.append((p[0], min(p[1], q[1]), max(p[1], q[1])))
        elif abs(p[1] - q[1]) < 1 and abs(p[0] - q[0]) > 2:
            rules.horizontal.append((p[1], min(p[0], q[0]), max(p[0], q[0])))

    for d in drawings:
        for it in d.get("items", []):
            if it[0] == "l":
                add(it[1], it[2])
            elif it[0] in ("re", "qu"):
                r = it[1] if it[0] == "re" else it[1].rect
                if r.width < 2.5 and r.height > 2:        # thin bar = vertical rule
                    add((r.x0, r.y0), (r.x0, r.y1))
                elif r.height < 2.5 and r.width > 2:      # thin bar = horizontal rule
                    add((r.x0, r.y0), (r.x1, r.y0))
                else:                                      # box edges (table cells)
                    add((r.x0, r.y0), (r.x0, r.y1)); add((r.x1, r.y0), (r.x1, r.y1))
                    add((r.x0, r.y0), (r.x1, r.y0)); add((r.x0, r.y1), (r.x1, r.y1))
    return rules


def _links(page: pymupdf.Page):
    return [(pymupdf.Rect(l["from"]), l["uri"]) for l in page.get_links()
            if l.get("kind") == pymupdf.LINK_URI and l.get("uri")]


def _link_at(links, x, y):
    for r, uri in links:
        if r.x0 - 1 <= x <= r.x1 + 1 and r.y0 - 1 <= y <= r.y1 + 1:
            return uri
    return None


_LAT = re.compile(r"[A-Za-z]")
_CYR = re.compile(r"[А-Яа-яЁё]")
_ODD = re.compile(r"[?@<>=;\\^_`|~#$%&*\[\]{}]")
_LDL = re.compile(r"[^\W\d_]\d+[^\W\d_]")


def _suspicious(token: str) -> bool:
    token = token.strip("?!.,;:()[]{}«»\"'“”„…-—–")  # ordinary edge punctuation
    letters = sum(ch.isalpha() for ch in token)
    if letters == 0:
        return False
    return bool((_LAT.search(token) and _CYR.search(token)) or _ODD.search(token)
                or _LDL.search(token))


_MOJIBAKE = (("mac_roman", "cp1251"), ("cp1252", "cp1251"), ("latin-1", "cp1251"),
             ("latin-1", "koi8_r"))
_OPEN_Q, _CLOSE_Q, _DASH = set("“„«‘"), set("”»’"), set("–—")


def _same_line(a, b) -> bool:
    return abs(a["origin"][1] - b["origin"][1]) < 2 and -2 < b["bbox"][0] - a["bbox"][2] < 4


def _apply_decoding(chars, src: str, dst: str) -> None:
    """Re-decode glyphs; quote/dash code points stay punctuation only where they sit
    like punctuation (the same byte is a letter in the target encoding)."""
    out = [c["c"] if c["c"] in _OPEN_Q | _CLOSE_Q | _DASH else c["c"].encode(src).decode(dst)
           for c in chars]
    for i, ch in enumerate(out):
        if ch not in _OPEN_Q | _CLOSE_Q | _DASH:
            continue
        prev = out[i - 1] if i and _same_line(chars[i - 1], chars[i]) else " "
        nxt = out[i + 1] if i + 1 < len(out) and _same_line(chars[i], chars[i + 1]) else " "
        if ch in _OPEN_Q:
            keep = (prev.isspace() or prev in "(") and (nxt.isupper() or nxt.isdigit())
        elif ch in _CLOSE_Q:
            keep = (prev.isalnum() or prev in ".!?") and (nxt.isspace() or nxt in ".,;:!?)")
        else:
            keep = prev.isspace() and nxt.isspace()
        if not keep:
            out[i] = ch.encode(src).decode(dst)
    for c, new in zip(chars, out):
        c["c"] = new


def _cyr_ratio(text: str) -> float:
    letters = [c for c in text if c.isalpha()]
    return sum(bool(_CYR.match(c)) for c in letters) / len(letters) if letters else 0.0


def _vowel_ok(text: str) -> bool:
    """Real Russian text has ~40% vowels among letters."""
    letters = [c for c in text.lower() if _CYR.match(c)]
    return bool(letters) and 0.25 < sum(c in "аеёиоуыэюя" for c in letters) / len(letters) < 0.6


def repair_mojibake(glyphs) -> None:
    """Fix Cyrillic stored in a legacy 8-bit font encoding (e.g. 'Ôîðìóëà' → 'Формула'),
    per font, in place."""
    by_font: dict[str, list] = {}
    for ch, span in glyphs:
        by_font.setdefault(span["font"], []).append(ch)
    for chars in by_font.values():
        text = "".join(c["c"] for c in chars)
        nonascii = [c for c in text if ord(c) > 127 and c.isalpha()]
        if len(nonascii) < 8 or _cyr_ratio(text) > 0.1:
            continue
        for src, dst in _MOJIBAKE:
            try:
                fixed = text.encode(src).decode(dst)
            except (UnicodeEncodeError, UnicodeDecodeError):
                continue
            if _cyr_ratio(fixed) > 0.6 and _vowel_ok(fixed):
                _apply_decoding(chars, src, dst)
                break


def _piece_text(glyphs) -> str:
    out, prev = [], None
    for ch, span in glyphs:
        if prev is not None and ch["bbox"][0] - prev["bbox"][2] > GAP_SPACE * span["size"]:
            out.append(" ")
        out.append(ch["c"])
        prev = ch
    return "".join(out)


def broken_fonts(pieces: list[list]) -> set[str]:
    """Fonts whose extracted text looks like a broken ToUnicode map
    (e.g. 'HaE9?9Aи9' instead of 'Население')."""
    stats: dict[str, list[int]] = {}
    for glyphs in pieces:
        fonts = [span["font"] for _, span in glyphs]
        font = max(set(fonts), key=fonts.count)
        tokens = [t for t in _piece_text(glyphs).split() if len(t) >= 2]
        st = stats.setdefault(font, [0, 0])
        st[0] += sum(map(_suspicious, tokens))
        st[1] += len(tokens)
    return {f for f, (bad, total) in stats.items() if total >= 3 and bad / total > 0.45}


def _horizontal(d) -> bool:
    return abs(d[0] - 1) < 1e-3 and abs(d[1]) < 1e-3


def _rows(glyphs):
    """Group glyphs into rows sharing a baseline (PDFs often emit text out of order);
    each row is sorted left to right with doubly painted glyphs removed."""
    glyphs.sort(key=lambda g: g[0]["origin"][1])
    rows = []
    for g in glyphs:
        y, size = g[0]["origin"][1], g[1]["size"]
        if rows and abs(y - rows[-1][0]) <= 0.2 * min(size, rows[-1][1]):
            rows[-1][2].append(g)
        else:
            rows.append([y, size, [g]])
    for r in rows:  # row size from visible glyphs (a stray space may be full-size)
        r[1] = max((sp["size"] for ch, sp in r[2] if not ch["c"].isspace()), default=r[1])
    rows = _attach_scripts(rows)
    out = []
    for y, size, row in rows:
        row.sort(key=lambda g: g[0]["bbox"][0])
        clean = []
        for g in row:
            if clean:
                p = clean[-1][0]
                # the same glyph painted twice (fake bold / shadow): keep one
                if g[0]["c"] == p["c"] and abs(g[0]["bbox"][0] - p["bbox"][0]) < 0.15 * g[1]["size"]:
                    continue
            clean.append(g)
        out.append((y, size, clean))
    return out


def _attach_scripts(rows):
    """Fold sub/superscript rows (smaller glyphs slightly off a bigger row's baseline)
    into that row; each glyph remembers its shift in points."""
    for ch, _ in (g for r in rows for g in r[2]):
        ch["_shift"] = 0.0
    merged = set()
    for i in sorted(range(len(rows)), key=lambda i: rows[i][1]):
        y, size, glyphs = rows[i]
        x0 = min(g[0]["bbox"][0] for g in glyphs)
        x1 = max(g[0]["bbox"][2] for g in glyphs)
        best = None
        for j, (my, msize, mg) in enumerate(rows):
            if (j == i or j in merged or not 1.15 * size <= msize <= 2.6 * size
                    or abs(my - y) > 0.65 * msize or _under(glyphs, mg)):
                continue
            mx0 = min(g[0]["bbox"][0] for g in mg) - msize
            mx1 = max(g[0]["bbox"][2] for g in mg) + msize
            if x1 < mx0 or x0 > mx1:
                continue
            if best is None or abs(my - y) < abs(rows[best][0] - y):
                best = j
        if best is not None:
            my = rows[best][0]
            for g in glyphs:
                g[0]["_shift"] = my - g[0]["origin"][1]
            rows[best][2].extend(glyphs)
            merged.add(i)
    return [r for i, r in enumerate(rows) if i not in merged]


def _under(small, main) -> bool:
    """True if the small glyphs sit under/over the main row's glyphs (a separate line),
    rather than in the gaps after them (indices)."""
    spans = [(g[0]["bbox"][0], g[0]["bbox"][2]) for g in main if not g[0]["c"].isspace()]
    inside = sum(any(a + 0.5 < (g[0]["bbox"][0] + g[0]["bbox"][2]) / 2 < b - 0.5 for a, b in spans)
                 for g in small if not g[0]["c"].isspace())
    return inside > 0.3 * max(1, sum(not g[0]["c"].isspace() for g in small))


def _bridged(row, x: float, size: float) -> bool:
    """Does text on this row run across x (no column gap there)?"""
    left = right = None
    for ch, _ in row:
        x0, x1 = ch["bbox"][0], ch["bbox"][2]
        if x0 <= x <= x1:
            return True
        if x1 <= x:
            left = x1 if left is None else max(left, x1)
        elif right is None:
            right = x0
    return left is not None and right is not None and right - left < GAP_SPLIT * size


def _split_rows(rows, rules: Rules):
    """Cut rows at wide gaps, unless neighbouring lines run straight across the gap
    (then it is just a stretched space in justified text, not a column gap)."""
    pieces = []
    for i, (y, size, row) in enumerate(rows):
        neighbours = [r for j in (i - 1, i + 1) if 0 <= j < len(rows)
                      for r in [rows[j]] if abs(r[0] - y) < 2.2 * size and 0.8 < r[1] / size < 1.25]
        cur, right = [], None
        for g in row:
            ch = g[0]
            if cur and rules.cuts_row(y - 0.3 * size, right, ch["bbox"][0]):
                pieces.append(cur)
                cur, right = [], None
            elif cur and not ch["c"].isspace() and not cur[-1][0]["c"].isspace():
                gap = ch["bbox"][0] - right
                if gap > GAP_SPLIT * size:
                    mid = (ch["bbox"][0] + right) / 2
                    if not neighbours or not all(_bridged(r[2], mid, size) for r in neighbours):
                        pieces.append(cur)
                        cur, right = [], None
            cur.append(g)
            right = ch["bbox"][2] if right is None else max(right, ch["bbox"][2])
        if cur:
            pieces.append(cur)
    return pieces


SPACE_EM = 0.25    # assumed width of an inserted space, in font sizes


def _spacing(ch, nxt) -> float:
    """Extra advance after glyph ch (letter-spacing, justification, kerning), in points."""
    adv = ch["bbox"][2] - ch["origin"][0]
    extra = nxt["origin"][0] - (ch["origin"][0] + adv)
    q = round(extra, 1)
    return 0.0 if abs(q) < 0.15 else q


def _make_piece(glyphs, links, direction, broken=frozenset()) -> Piece | None:
    horizontal = _horizontal(direction)
    # trim surrounding whitespace glyphs
    while glyphs and glyphs[0][0]["c"].isspace():
        glyphs = glyphs[1:]
    while glyphs and glyphs[-1][0]["c"].isspace():
        glyphs = glyphs[:-1]
    if not glyphs:
        return None

    # one token per output character: (text, style, spacing after it)
    tokens = []
    bad = 0
    for i, (ch, span) in enumerate(glyphs):
        c = ch["c"]
        if c == "�" or span["font"] in broken:
            bad += 1
        family, bold, italic = map_font(span["font"], span["flags"])
        bx = ch["bbox"]
        link = _link_at(links, (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2) if links else None
        shift = round(ch.get("_shift", 0.0), 1)
        style = (family, round(span["size"] * 2) / 2, int_rgb(span["color"]), bold, italic, link,
                 shift if abs(shift) > 0.5 else 0.0, round(ch.get("_alpha", 1.0), 2))
        nxt = glyphs[i + 1][0] if i + 1 < len(glyphs) else None
        if nxt is None or not horizontal:
            tokens.append((c, style, 0.0))
            continue
        gap = nxt["bbox"][0] - bx[2]
        if gap > GAP_SPACE * span["size"] and not c.isspace() and not nxt["c"].isspace():
            # words positioned apart without a space glyph: insert one that fills the gap
            tokens.append((c, style, 0.0))
            tokens.append((" ", style, round(gap - SPACE_EM * span["size"], 1)))
        else:
            tokens.append((c, style, _spacing(ch, nxt)))

    runs: list[Run] = []
    for text, style, spc in tokens:
        key = style + (spc,)
        if runs and (runs[-1].font, runs[-1].size, runs[-1].color, runs[-1].bold, runs[-1].italic,
                     runs[-1].link, runs[-1].shift, runs[-1].opacity, runs[-1].spacing) == key:
            runs[-1].text += text
        else:
            runs.append(Run(text, *style[:7], opacity=style[7], spacing=spc))

    spans = [s for _, s in glyphs]
    main = max(spans, key=lambda s: s["size"])
    xs0 = [c["bbox"][0] for c, _ in glyphs] + [c["bbox"][2] for c, _ in glyphs]
    ys0 = [c["bbox"][1] for c, _ in glyphs] + [c["bbox"][3] for c, _ in glyphs]
    bbox = (min(xs0), min(ys0), max(xs0), max(ys0))
    anchor = next((c for c, _ in glyphs if abs(c.get("_shift", 0.0)) <= 0.5), glyphs[0][0])
    return Piece(runs=runs, bbox=bbox, baseline=anchor["origin"][1], size=main["size"],
                 ascender=main.get("ascender", 0.9), descender=main.get("descender", -0.2),
                 dir=direction, garbled=bad > 0.3 * len(glyphs),
                 z=min(c.get("_z", 1e6) for c, _ in glyphs))


def _trace_index(page: pymupdf.Page) -> dict:
    """Glyph origin → (paint order, opacity) from the text trace."""
    index = {}
    for span in page.get_texttrace():
        for ch in span["chars"]:
            o = ch[2]
            index[(round(o[0], 1), round(o[1], 1))] = (span["seqno"], span.get("opacity", 1.0))
    return index


def extract_pieces(page: pymupdf.Page, raw: dict, rules: Rules | None = None) -> list[Piece]:
    rules = rules or Rules()
    links = _links(page)
    flat, rotated = [], []
    for block in raw["blocks"]:
        if block.get("type") != 0:
            continue
        for line in block["lines"]:
            if line.get("wmode", 0) != 0:
                continue
            glyphs = [(ch, span) for span in line["spans"] if span.get("alpha", 255) != 0
                      for ch in span["chars"]]  # alpha 0: invisible text (OCR layer)
            if not glyphs:
                continue
            if _horizontal(line["dir"]):
                flat.extend(glyphs)
            else:
                rotated.append((glyphs, tuple(line["dir"])))

    trace = _trace_index(page)
    for ch, _ in flat + [g for gl, _ in rotated for g in gl]:
        z, alpha = trace.get((round(ch["origin"][0], 1), round(ch["origin"][1], 1)), (1e6, 1.0))
        ch["_z"], ch["_alpha"] = z, alpha
    repair_mojibake(flat + [g for gl, _ in rotated for g in gl])
    groups = [(p, (1.0, 0.0)) for p in _split_rows(_rows(flat), rules)]
    groups += rotated
    broken = broken_fonts([g for g, _ in groups])
    out = [_make_piece(g, links, d, broken) for g, d in groups]
    out = [p for p in out if p]
    out.sort(key=lambda p: (round(p.baseline, 1), p.x0))
    return out


MAX_INDENT = 12  # first-line indent limit, in font sizes


def _fits(g: _Group, p: Piece, rules: Rules) -> str | None:
    """Return the paragraph mode ('left'/'center'/'right') if p continues paragraph g.
    'left' tolerates a first-line (or hanging) indent."""
    last = g.last
    if not (p.horizontal and last.horizontal):
        return None
    size = max(p.size, last.size)
    if not 0.8 <= p.size / last.size <= 1.25:
        return None
    pitch = p.baseline - last.baseline
    if not 0.95 * size <= pitch <= 1.9 * size:
        return None
    if len(g.pieces) >= 2:
        prev_pitch = last.baseline - g.pieces[-2].baseline
        if abs(pitch - prev_pitch) > 0.2 * size:
            return None
    tol = 0.6 * size
    if p.x1 < last.x0 or p.x0 > last.x1:
        return None
    if rules.between(last.baseline, p.baseline - p.size * 0.7, max(p.x0, last.x0), min(p.x1, last.x1)):
        return None
    first, body = g.pieces[0], g.pieces[1:]
    mode = g.mode
    if body:  # body margin already known
        if mode == "left" and all(abs(p.x0 - q.x0) < tol for q in body):
            return "left"
    elif abs(p.x0 - first.x0) < tol:
        return "left"
    if mode in (None, "center") and all(abs(p.cx - q.cx) < tol for q in g.pieces):
        return "center"
    indent = first.x0 - p.x0              # >0: first-line indent, <0: hanging indent
    # a right-aligned pair looks exactly like an indented one; indents are far more common
    if not body and 0 < indent < MAX_INDENT * size:
        return "left"
    if mode in (None, "right") and all(abs(p.x1 - q.x1) < tol for q in g.pieces):
        return "right"
    if not body and -4 * size < indent <= 0 and p.x1 > first.x0:
        return "left"
    return None


def group_paragraphs(pieces: list[Piece], rules: Rules | None = None) -> list[tuple[list[Piece], str]]:
    rules = rules or Rules()
    groups: list[_Group] = []
    for p in pieces:
        for g in reversed(groups[-30:]):
            if p.garbled or g.last.garbled:
                continue
            mode = _fits(g, p, rules)
            if mode:
                g.pieces.append(p)
                g.mode = mode
                break
        else:
            groups.append(_Group([p]))
    return [(g.pieces, _alignment(g)) for g in groups]


def _alignment(g: _Group) -> str:
    if g.mode in ("center", "right"):
        return g.mode
    lines = g.pieces
    if len(lines) >= 3:
        size = max(p.size for p in lines)
        right = max(p.x1 for p in lines)
        if all(right - p.x1 < 0.6 * size for p in lines[:-1]):
            return "justify"  # spacing is reproduced per glyph, no reflow needed
    return "left"


def to_text_block(pieces: list[Piece], align: str) -> TextBlock:
    first = pieces[0]
    if not first.horizontal:
        return _rotated_block(first)
    body_x0 = min(p.x0 for p in pieces[1:]) if len(pieces) > 1 else first.x0
    indent = first.x0 - body_x0 if align in ("left", "justify") else 0.0
    x0 = min(first.x0, body_x0) if align in ("left", "justify") else min(p.x0 for p in pieces)
    x1 = max(p.x1 for p in pieces)
    y0 = min(p.bbox[1] for p in pieces)
    y1 = max(p.bbox[3] for p in pieces)
    pitch = None
    if len(pieces) > 1:
        pitch = (pieces[-1].baseline - first.baseline) / (len(pieces) - 1)
    return TextBlock(bbox=(x0, y0, x1, y1), lines=[p.runs for p in pieces], line_pitch=pitch,
                     align="left" if align == "justify" else align,
                     first_baseline=first.baseline, size=first.size, ascender=first.ascender,
                     descender=first.descender, indent=indent, n_lines=len(pieces),
                     z=min(p.z for p in pieces))


def _rotated_block(p: Piece) -> TextBlock:
    angle = math.degrees(math.atan2(p.dir[1], p.dir[0]))
    bx = p.bbox
    cx, cy = (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2
    w, h = bx[2] - bx[0], bx[3] - bx[1]
    c, s = abs(math.cos(math.radians(angle))), abs(math.sin(math.radians(angle)))
    thick = p.size * (p.ascender - p.descender)
    if c > 0.99:
        length = w
    elif s > 0.99:
        length = h
    else:
        length = max((w - thick * s) / c, (h - thick * c) / s, p.size)
    box = (cx - length / 2, cy - thick / 2, cx + length / 2, cy + thick / 2)
    return TextBlock(bbox=box, lines=[p.runs], rotation=angle % 360, size=p.size,
                     ascender=p.ascender, descender=p.descender,
                     first_baseline=box[1] + p.ascender * p.size, z=p.z)
