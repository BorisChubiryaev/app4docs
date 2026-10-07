"""Self-check of the native reconstruction.

PyMuPDF does not report everything that affects how graphics look (soft masks, clipping
of images, blend modes, patterns, shadings…), so a native shape or picture can silently
come out wrong, and some paint operations have no native counterpart at all. We rasterize
our model of the page and compare it with the real page (both without text). Where they
disagree we find the responsible paint operations — missing ones, and native objects that
fail an individual check — and replace just those by a transparent picture of exactly
those operations (see layers.render_slice), at the same depth in the stacking order.
Everything else stays editable.
"""
from __future__ import annotations

import io
import math

import pymupdf
from PIL import Image, ImageChops, ImageFilter

from .graphics import _encode
from .layers import mask_ops, render_slice
from .model import ImageItem, Page, ShapeItem

CHECK_DPI = 96
CELL = 8            # px at CHECK_DPI (6 pt)
DIFF_LEVEL = 28     # per-pixel difference that counts as "wrong" (page level)
ITEM_LEVEL = 18     # the same for single-object checks
CELL_BAD = 0.15     # share of wrong pixels that makes a cell bad
ITEM_BAD = 0.02     # share of wrong pixels that fails a single object
CROP_DPI = 200
MAX_CROP_PX = 3600
MAX_CHECKS = 150    # individual object checks per page
DEBUG: list = []    # (first op, last op, bbox, #absorbed natives) of the last repair() call
TEXT_OPS = ("fill-text", "stroke-text", "ignore-text")


# ---------------------------------------------------------------- rasterize our model

def _draw_shape(p: pymupdf.Page, s: ShapeItem) -> None:
    sh = p.new_shape()
    if s.kind == "rect":
        sh.draw_rect(pymupdf.Rect(s.bbox))
    else:
        start = cur = None
        for seg in s.segments:
            if seg.op == "M":
                start = cur = seg.pts[0]
            elif seg.op == "L" and cur is not None:
                sh.draw_line(cur, seg.pts[0])
                cur = seg.pts[0]
            elif seg.op == "C" and cur is not None:
                sh.draw_bezier(cur, *seg.pts)
                cur = seg.pts[2]
            elif seg.op == "Z" and start is not None and cur is not None:
                if cur != start:
                    sh.draw_line(cur, start)
                cur = start
    rgb = lambda c: tuple(v / 255 for v in c) if c else None
    sh.finish(color=rgb(s.stroke), fill=rgb(s.fill),
              width=s.stroke_width if s.stroke else 0,
              fill_opacity=s.fill_opacity, stroke_opacity=s.stroke_opacity,
              dashes="[4 3] 0" if s.dashed else None, closePath=False)
    sh.commit()


def _draw_image(p: pymupdf.Page, it: ImageItem, zoom: float) -> None:
    x0, y0, x1, y1 = it.bbox
    w, h = x1 - x0, y1 - y0
    img = Image.open(io.BytesIO(it.data)).convert("RGBA")
    cl, ct, cr, cb = it.crop
    if cl or ct or cr or cb:
        W, H = img.size
        img = img.crop((round(cl * W), round(ct * H), round(W - cr * W), round(H - cb * H)))
    img = img.resize((max(1, round(w * zoom)), max(1, round(h * zoom))), Image.BILINEAR)
    if it.flip_h:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    if it.flip_v:
        img = img.transpose(Image.FLIP_TOP_BOTTOM)
    rect = pymupdf.Rect(it.bbox)
    if it.rotation % 360 > 0.01:
        img = img.rotate(-it.rotation, expand=True, resample=Image.BICUBIC)
        a = math.radians(it.rotation)
        rw = abs(w * math.cos(a)) + abs(h * math.sin(a))
        rh = abs(w * math.sin(a)) + abs(h * math.cos(a))
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        rect = pymupdf.Rect(cx - rw / 2, cy - rh / 2, cx + rw / 2, cy + rh / 2)
    buf = io.BytesIO()
    img.save(buf, "PNG")
    p.insert_image(rect, stream=buf.getvalue(), keep_proportion=False)


def _draw(p: pymupdf.Page, it, zoom: float) -> None:
    if isinstance(it, ShapeItem):
        _draw_shape(p, it)
    else:
        _draw_image(p, it, zoom)


def _natives(model: Page):
    return [it for it in model.items
            if isinstance(it, ShapeItem) or (isinstance(it, ImageItem) and not it.is_text)]


def model_raster(model: Page, rect: pymupdf.Rect, zoom: float) -> Image.Image:
    doc = pymupdf.open()
    p = doc.new_page(width=rect.width, height=rect.height)
    if model.background:
        p.draw_rect(p.rect, color=None, fill=tuple(v / 255 for v in model.background))
    for it in sorted(_natives(model), key=lambda i: i.z):
        _draw(p, it, zoom)
    pix = p.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def _item_raster(it, rect: pymupdf.Rect, clip: pymupdf.Rect, zoom: float) -> Image.Image:
    doc = pymupdf.open()
    p = doc.new_page(width=rect.width, height=rect.height)
    _draw(p, it, zoom)
    pix = p.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), clip=clip, alpha=True)
    return Image.frombytes("RGBa", (pix.width, pix.height), pix.samples).convert("RGBA")


# ---------------------------------------------------------------- compare

def _diff_mask(a: Image.Image, b: Image.Image, level: int = DIFF_LEVEL) -> Image.Image:
    """Pixels that differ noticeably; blurring first cancels anti-aliasing noise."""
    blur = ImageFilter.GaussianBlur(1.5)
    diff = ImageChops.difference(a.convert("RGB").filter(blur), b.convert("RGB").filter(blur))
    r, g, bl = diff.split()
    d = ImageChops.lighter(ImageChops.lighter(r, g), bl)
    return d.point(lambda v: 255 if v > level else 0)


def _on(img: Image.Image, shade: int) -> Image.Image:
    bg = Image.new("RGBA", img.size, (shade, shade, shade, 255))
    bg.alpha_composite(img)
    return bg.convert("RGB")


class _Grid:
    def __init__(self, mask: Image.Image, zoom: float):
        self.cols, self.rows = math.ceil(mask.width / CELL), math.ceil(mask.height / CELL)
        px = mask.resize((self.cols, self.rows), Image.BOX).load()
        self.bad = [[px[x, y] > CELL_BAD * 255 for x in range(self.cols)] for y in range(self.rows)]
        self.s = CELL / zoom
        self.any = any(any(r) for r in self.bad)

    def hits(self, rect: pymupdf.Rect) -> bool:
        s = self.s
        for y in range(max(0, int(rect.y0 / s)), min(self.rows, math.ceil(rect.y1 / s))):
            row = self.bad[y]
            for x in range(max(0, int(rect.x0 / s)), min(self.cols, math.ceil(rect.x1 / s))):
                if row[x]:
                    return True
        return False


def _item_ok(page: pymupdf.Page, it, rect: pymupdf.Rect) -> bool:
    """Does the native object look like the PDF paint operation it came from?"""
    clip = (pymupdf.Rect(it.bbox) + (-2, -2, 2, 2)) & rect
    if clip.is_empty:
        return True
    z = int(it.z)
    ref = render_slice(page, z, z + getattr(it, "ops", 1), clip, CHECK_DPI)
    ours = _item_raster(it, rect, clip, CHECK_DPI / 72)
    if ours.size != ref.size:
        ours = ours.resize(ref.size)
    limit = max(12, ITEM_BAD * ref.width * ref.height)
    # on white and on black: catches wrong colour as well as wrong transparency
    return all(_diff_mask(_on(ref, v), _on(ours, v), ITEM_LEVEL).histogram()[255] <= limit
               for v in (255, 0))


# ---------------------------------------------------------------- repair

EXTENT_DPI = 24


def _painted_extent(page: pymupdf.Page, op: int, box: pymupdf.Rect) -> pymupdf.Rect:
    """Where an operation really paints (shadings report the whole plane; clips cut paths)."""
    img = render_slice(page, op, op + 1, box, EXTENT_DPI)
    bb = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    if bb is None:
        return pymupdf.Rect()
    k = 72 / EXTENT_DPI
    x0, y0 = int(box.x0 * EXTENT_DPI / 72) * k, int(box.y0 * EXTENT_DPI / 72) * k
    r = pymupdf.Rect(x0 + bb[0] * k, y0 + bb[1] * k, x0 + bb[2] * k, y0 + bb[3] * k)
    return (r + (-k, -k, k, k)) & box

def repair(page: pymupdf.Page, model: Page) -> int:
    """Compare the model with the real page and patch disagreements. Returns #patches."""
    rect = page.rect
    zoom = CHECK_DPI / 72
    log = page.get_bboxlog()
    masked, softmasked = mask_ops(page)
    # images that only feed a soft mask are never painted: drop their native copies
    model.items = [it for it in model.items
                   if not (isinstance(it, ImageItem) and not it.is_text and int(it.z) in masked)]
    ref = render_slice(page, 0, len(log), rect, CHECK_DPI)
    reference = Image.new("RGBA", ref.size, (255, 255, 255, 255))
    reference.alpha_composite(ref)
    ours = model_raster(model, rect, zoom)
    if ours.size != reference.size:
        ours = ours.resize(reference.size)
    grid = _Grid(_diff_mask(reference.convert("RGB"), ours), zoom)
    if not grid.any and not softmasked:
        return 0

    natives = _natives(model)
    by_z: dict[int, list] = {}
    native_z = {model.background_z} if model.background_z is not None else set()
    for it in natives:
        by_z.setdefault(int(it.z), []).append(it)
        native_z.update(range(int(it.z), int(it.z) + getattr(it, "ops", 1)))

    problems = []  # (op index, bbox)
    checks = 0
    for i, (kind, r) in enumerate(log):
        if kind in TEXT_OPS or i in masked:
            continue
        box = pymupdf.Rect(r) & rect
        if box.is_empty:
            continue
        if i in softmasked:  # soft masks have no PowerPoint equivalent
            problems.append((i, box))
            continue
        if not grid.hits(box):
            continue
        if i not in native_z:
            problems.append((i, box))
        elif i in by_z:
            for it in by_z[i]:
                if checks >= MAX_CHECKS:
                    problems.append((i, box))
                    break
                checks += 1
                if not _item_ok(page, it, rect):
                    problems.append((i, box))
                    break
    if not problems:
        return 0
    problems = [(i, _painted_extent(page, i, box)) for i, box in problems]
    problems = [(i, box) for i, box in problems if not box.is_empty]

    # group problem operations into patches: consecutive in paint order and touching,
    # with no correct native object in between that would need to stay on top of them
    patches: list[list] = []   # [first, last, bbox]
    for i, box in problems:
        if patches:
            first, last, pbox = patches[-1]
            between = any(z in by_z and any(pymupdf.Rect(it.bbox).intersects(pbox | box) for it in by_z[z])
                          and not any(z == pi for pi, _ in problems)
                          for z in range(last + 1, i))
            if (pbox + (-4, -4, 4, 4)).intersects(box) and not between:
                patches[-1] = [first, i, pbox | box]
                continue
        patches.append([i, i, box])

    done = 0
    absorbed: set[int] = set()
    DEBUG.clear()
    for first, last, box in patches:
        n_before = len(absorbed)
        # native objects inside the slice are drawn by the patch itself
        grown = True
        while grown:
            grown = False
            for z in range(first - 1, last + 1):
                for it in by_z.get(z, []):
                    if z + getattr(it, "ops", 1) <= first:
                        continue
                    ib = pymupdf.Rect(it.bbox) & rect
                    if id(it) not in absorbed and ib.intersects(box):
                        absorbed.add(id(it))
                        if not box.contains(ib):
                            box = box | ib
                            grown = True
        dpi = min(CROP_DPI, MAX_CROP_PX * 72 / max(box.width, box.height, 1))
        img = render_slice(page, first, last + 1, box, max(72, dpi))
        DEBUG.append((first, last, tuple(round(v) for v in box), len(absorbed) - n_before))
        if img.getextrema()[3][1] == 0:
            continue  # nothing visible
        model.items.append(ImageItem(bbox=tuple(box), data=_encode(img, photo_hint=False),
                                     z=first - 0.25))
        done += 1
    model.items = [it for it in model.items if id(it) not in absorbed]
    return done
