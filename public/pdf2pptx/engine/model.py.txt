"""Intermediate page model shared by extraction and PPTX building.

All coordinates are PDF points with a top-left origin (PyMuPDF convention).
Colors are (r, g, b) tuples of ints 0..255.
"""
from __future__ import annotations

from dataclasses import dataclass, field

Color = tuple[int, int, int]
Rect = tuple[float, float, float, float]  # x0, y0, x1, y1
Point = tuple[float, float]


@dataclass
class Run:
    text: str
    font: str
    size: float
    color: Color
    bold: bool = False
    italic: bool = False
    link: str | None = None
    shift: float = 0.0              # baseline shift in points (+ superscript, - subscript)
    opacity: float = 1.0
    spacing: float = 0.0            # extra advance after each character, points


@dataclass
class TextBlock:
    bbox: Rect                      # unrotated box (for rotated text: centered on the real one)
    lines: list[list[Run]]          # each line is a list of styled runs
    line_pitch: float | None = None # baseline-to-baseline distance for multi-line blocks
    align: str = "left"             # left | center | right
    indent: float = 0.0             # first-line offset from the body margin (negative: hanging)
    n_lines: int = 1                # visual line count in the PDF
    rotation: float = 0.0           # degrees, clockwise
    first_baseline: float = 0.0     # y of the first line's baseline
    size: float = 12.0              # dominant font size of the first line
    ascender: float = 0.9           # font metrics (fractions of size) of the first line
    descender: float = -0.2
    z: float = 1e9


@dataclass
class ImageItem:
    bbox: Rect                      # unrotated box, centered on the real one
    data: bytes                     # PNG or JPEG bytes
    rotation: float = 0.0
    flip_h: bool = False
    flip_v: bool = False
    crop: Rect = (0.0, 0.0, 0.0, 0.0)  # fractions cut from left, top, right, bottom
    z: float = 0.0
    is_text: bool = False           # glyphs kept as a picture (unusable font encoding)


@dataclass
class Segment:
    op: str                         # "M" move, "L" line, "C" cubic, "Z" close
    pts: tuple[Point, ...] = ()


@dataclass
class ShapeItem:
    bbox: Rect
    segments: list[Segment]
    fill: Color | None = None
    fill_opacity: float = 1.0
    stroke: Color | None = None
    stroke_opacity: float = 1.0
    stroke_width: float = 0.0
    dashed: bool = False
    kind: str = "path"              # path | rect | line
    z: float = 0.0
    ops: int = 1                    # paint operations this shape spans (fill + stroke = 2)


@dataclass
class Page:
    width: float
    height: float
    items: list = field(default_factory=list)
    background: Color | None = None
    background_z: int | None = None   # paint op that produced the background colour

    def sorted_items(self):
        return sorted(self.items, key=lambda it: it.z)
