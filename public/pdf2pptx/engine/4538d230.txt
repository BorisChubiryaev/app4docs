"""Render a slice of a page's paint order.

Painting operations are numbered exactly like PyMuPDF's ``get_bboxlog()`` (and the
``seqno`` of ``get_drawings()`` / ``get_texttrace()``). ``render_slice(page, a, b, …)``
draws only the operations with a <= number < b onto a transparent pixmap, while clips,
groups, soft masks and pattern cells are always passed through so the drawn objects
look exactly as on the page. Text is never drawn (it stays editable in the PPTX).
"""
from __future__ import annotations

import pymupdf
import pymupdf.mupdf as mu
from PIL import Image

# the operation kinds PyMuPDF's bbox device numbers
_COUNTED = ("fill_path", "stroke_path", "fill_text", "stroke_text", "ignore_text",
            "fill_shade", "fill_image", "fill_image_mask")
_TEXT = ("fill_text", "stroke_text", "ignore_text")


class _SliceDevice(mu.FzDevice2):
    def __init__(self, target, start: int, end: int):
        super().__init__()
        self.t = target
        self.start, self.end = start, end
        self.n = 0
        self.in_mask = 0      # inside a soft-mask definition: everything counts for the mask
        self.tiles = []       # pattern cells: drawn iff the pattern starts inside the slice
        for name in _COUNTED + (
                "clip_path", "clip_stroke_path", "clip_text", "clip_stroke_text", "clip_image_mask",
                "pop_clip", "begin_mask", "end_mask", "begin_group", "end_group", "begin_tile",
                "end_tile", "render_flags", "set_default_colorspaces", "begin_layer", "end_layer",
                "begin_structure", "end_structure", "begin_metatext", "end_metatext"):
            getattr(self, "use_virtual_" + name)()

    def _paint(self, kind: str) -> bool:
        i = self.n
        self.n += 1
        if self.in_mask:
            return True
        if kind in _TEXT:
            return False
        if self.tiles and self.tiles[-1]:
            return True
        return self.start <= i < self.end

    # counted painting operations
    def fill_path(self, ctx, *a):
        if self._paint("fill_path"):
            mu.ll_fz_fill_path(self.t, *a)

    def stroke_path(self, ctx, *a):
        if self._paint("stroke_path"):
            mu.ll_fz_stroke_path(self.t, *a)

    def fill_text(self, ctx, *a):
        if self._paint("fill_text"):
            mu.ll_fz_fill_text(self.t, *a)

    def stroke_text(self, ctx, *a):
        if self._paint("stroke_text"):
            mu.ll_fz_stroke_text(self.t, *a)

    def ignore_text(self, ctx, *a):
        self._paint("ignore_text")

    def fill_shade(self, ctx, *a):
        if self._paint("fill_shade"):
            mu.ll_fz_fill_shade(self.t, *a)

    def fill_image(self, ctx, *a):
        if self._paint("fill_image"):
            mu.ll_fz_fill_image(self.t, *a)

    def fill_image_mask(self, ctx, *a):
        if self._paint("fill_image_mask"):
            mu.ll_fz_fill_image_mask(self.t, *a)

    # state: always forwarded
    def clip_path(self, ctx, *a): mu.ll_fz_clip_path(self.t, *a)
    def clip_stroke_path(self, ctx, *a): mu.ll_fz_clip_stroke_path(self.t, *a)
    def clip_text(self, ctx, *a): mu.ll_fz_clip_text(self.t, *a)
    def clip_stroke_text(self, ctx, *a): mu.ll_fz_clip_stroke_text(self.t, *a)
    def clip_image_mask(self, ctx, *a): mu.ll_fz_clip_image_mask(self.t, *a)
    def pop_clip(self, ctx): mu.ll_fz_pop_clip(self.t)

    def begin_mask(self, ctx, *a):
        self.in_mask += 1
        mu.ll_fz_begin_mask(self.t, *a)

    def end_mask(self, ctx, tr):
        self.in_mask = max(0, self.in_mask - 1)
        mu.ll_fz_end_mask_tr(self.t, tr)

    def begin_group(self, ctx, *a): mu.ll_fz_begin_group(self.t, *a)
    def end_group(self, ctx): mu.ll_fz_end_group(self.t)

    def begin_tile(self, ctx, *a):
        self.tiles.append(bool(self.in_mask) or self.start <= self.n < self.end)
        return mu.ll_fz_begin_tile_tid(self.t, *a)

    def end_tile(self, ctx):
        if self.tiles:
            self.tiles.pop()
        mu.ll_fz_end_tile(self.t)

    def render_flags(self, ctx, *a): mu.ll_fz_render_flags(self.t, *a)
    def set_default_colorspaces(self, ctx, *a): mu.ll_fz_set_default_colorspaces(self.t, *a)
    def begin_layer(self, ctx, *a): mu.ll_fz_begin_layer(self.t, *a)
    def end_layer(self, ctx): mu.ll_fz_end_layer(self.t)
    def begin_structure(self, ctx, *a): mu.ll_fz_begin_structure(self.t, *a)
    def end_structure(self, ctx): mu.ll_fz_end_structure(self.t)
    def begin_metatext(self, ctx, *a): mu.ll_fz_begin_metatext(self.t, *a)
    def end_metatext(self, ctx): mu.ll_fz_end_metatext(self.t)


def render_slice(page: pymupdf.Page, start: int, end: int, clip: pymupdf.Rect, dpi: float) -> Image.Image:
    """RGBA picture of paint operations [start, end) inside ``clip`` (page points)."""
    zoom = dpi / 72
    ctm = mu.FzMatrix(zoom, 0, 0, zoom, 0, 0)
    ir = pymupdf.IRect(
        int(clip.x0 * zoom), int(clip.y0 * zoom), int(clip.x1 * zoom + 0.999), int(clip.y1 * zoom + 0.999))
    bbox = mu.FzIrect(ir.x0, ir.y0, ir.x1, ir.y1)
    pix = mu.fz_new_pixmap_with_bbox(mu.fz_device_rgb(), bbox, mu.FzSeparations(), 1)
    mu.fz_clear_pixmap(pix)
    draw = mu.fz_new_draw_device(mu.FzMatrix(), pix)
    dev = _SliceDevice(draw.m_internal, start, end)
    mu.fz_run_page(page.this if isinstance(page.this, mu.FzPage) else mu.FzPage(page.this),
                   dev, ctm, mu.FzCookie())
    mu.fz_close_device(dev)
    mu.fz_close_device(draw)
    p = pymupdf.Pixmap(pix)
    return Image.frombytes("RGBa", (p.width, p.height), p.samples).convert("RGBA")


class _MaskScanner(mu.FzDevice2):
    """Counts paint operations like the bbox log and notes which ones only define a soft mask
    and which ones are painted through a soft mask (PowerPoint cannot express those)."""

    def __init__(self):
        super().__init__()
        self.n, self.depth = 0, 0
        self.masked, self.softmasked = set(), set()
        self.stack: list[str] = []
        for name in _COUNTED + ("begin_mask", "end_mask", "pop_clip", "clip_path", "clip_stroke_path",
                                "clip_text", "clip_stroke_text", "clip_image_mask"):
            getattr(self, "use_virtual_" + name)()

    def _op(self, *_):
        if self.depth:
            self.masked.add(self.n)
        elif "m" in self.stack:
            self.softmasked.add(self.n)
        self.n += 1

    fill_path = stroke_path = fill_text = stroke_text = ignore_text = _op
    fill_shade = fill_image = fill_image_mask = _op

    def _clip(self, *_):
        self.stack.append("c")

    clip_path = clip_stroke_path = clip_text = clip_stroke_text = clip_image_mask = _clip

    def pop_clip(self, *_):
        if self.stack:
            self.stack.pop()

    def begin_mask(self, *_):
        self.depth += 1

    def end_mask(self, *_):
        self.depth = max(0, self.depth - 1)
        self.stack.append("m")


def mask_ops(page: pymupdf.Page) -> tuple[set[int], set[int]]:
    """(operations that only build soft masks, operations painted through a soft mask)."""
    dev = _MaskScanner()
    mu.fz_run_page(page.this if isinstance(page.this, mu.FzPage) else mu.FzPage(page.this),
                   dev, mu.FzMatrix(), mu.FzCookie())
    mu.fz_close_device(dev)
    return dev.masked, dev.softmasked
