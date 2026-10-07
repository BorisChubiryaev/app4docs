"""Images and vector drawings → ImageItem / ShapeItem."""
from __future__ import annotations

import io
import math

import pymupdf
from PIL import Image

from .model import ImageItem, Rect, Segment, ShapeItem

MIN_SIZE = 0.3  # points


def _rgb(t) -> tuple[int, int, int] | None:
    if t is None:
        return None
    t = tuple(t)
    if len(t) == 1:
        t = t * 3
    elif len(t) == 4:  # CMYK
        c, m, y, k = t
        t = ((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k))
    return tuple(max(0, min(255, round(v * 255))) for v in t[:3])


# ---------------------------------------------------------------- images

MAX_IMG_DPI = 250      # downsample images denser than this at their displayed size
MAX_IMG_SIDE = 4000


def _encode(img: Image.Image, photo_hint: bool) -> bytes:
    buf = io.BytesIO()
    if img.mode in ("RGBA", "LA"):
        img.save(buf, "PNG")
    elif photo_hint or img.getcolors(maxcolors=4096) is None:
        img.convert("RGB").save(buf, "JPEG", quality=90)
    else:
        img.save(buf, "PNG")
    return buf.getvalue()


def _fit(img: Image.Image, w_pt: float, h_pt: float) -> Image.Image:
    limit_w = min(MAX_IMG_SIDE, max(64, w_pt / 72 * MAX_IMG_DPI))
    limit_h = min(MAX_IMG_SIDE, max(64, h_pt / 72 * MAX_IMG_DPI))
    s = min(1.0, limit_w / img.width, limit_h / img.height)
    if s < 0.9:
        img = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    return img


def _pix_to_pil(pix: pymupdf.Pixmap) -> Image.Image:
    if pix.alpha:
        pix = pymupdf.Pixmap(pix, 0)
    if pix.colorspace is None or pix.colorspace.n not in (1, 3):
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    mode = "L" if pix.n == 1 else "RGB"
    return Image.frombytes(mode, (pix.width, pix.height), pix.samples)


def image_bytes_from_xref(doc: pymupdf.Document, xref: int, w_pt: float, h_pt: float) -> bytes | None:
    try:
        info = doc.extract_image(xref)
        if not info:
            return None
        smask = info.get("smask") or 0
        big = (info["width"] > max(64, w_pt / 72 * MAX_IMG_DPI) / 0.9
               or info["height"] > max(64, h_pt / 72 * MAX_IMG_DPI) / 0.9)
        if not smask and not big and info["ext"] in ("jpeg", "jpg") and info.get("colorspace") in (1, 3):
            return info["image"]  # untouched original JPEG
        if not smask and not big and info["ext"] == "png":
            return info["image"]
        img = _pix_to_pil(pymupdf.Pixmap(doc, xref))
        if smask:
            mask = _pix_to_pil(pymupdf.Pixmap(doc, smask)).convert("L")
            if mask.size != img.size:
                mask = mask.resize(img.size, Image.BILINEAR)
            if mask.getextrema() != (255, 255):
                img = img.convert("RGBA")
                img.putalpha(mask)
        return _encode(_fit(img, w_pt, h_pt), info["ext"] in ("jpeg", "jpg", "jpx"))
    except Exception:
        return None


def image_bytes_from_block(block, w_pt: float, h_pt: float) -> bytes | None:
    """Inline images (no xref): decode from a PyMuPDF dict image block."""
    try:
        img = _pix_to_pil(pymupdf.Pixmap(block["image"]))
        return _encode(_fit(img, w_pt, h_pt), block.get("ext") in ("jpeg", "jpg"))
    except Exception:
        return None


def image_item(transform, bbox, data_fn, page_rect: pymupdf.Rect, z: float) -> ImageItem | None:
    a, b, c, d, e, f = transform
    w, h = math.hypot(a, b), math.hypot(c, d)
    if w < MIN_SIZE or h < MIN_SIZE:
        return None
    if not pymupdf.Rect(bbox).intersects(page_rect):
        return None
    data = data_fn(w, h)
    if data is None:
        return None
    rot = math.degrees(math.atan2(b, a))
    flip_v = (a * d - b * c) < 0
    cx, cy = e + (a + c) / 2, f + (b + d) / 2
    item = ImageItem(bbox=(cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2), data=data,
                     rotation=rot % 360, flip_v=flip_v, z=z)
    # upright images that stick out of the page: crop (non-destructively) to the page
    if abs(rot) < 0.01 and not flip_v:
        x0, y0, x1, y1 = item.bbox
        cl = max(0.0, (page_rect.x0 - x0) / w)
        ct = max(0.0, (page_rect.y0 - y0) / h)
        cr = max(0.0, (x1 - page_rect.x1) / w)
        cb = max(0.0, (y1 - page_rect.y1) / h)
        if cl or ct or cr or cb:
            item.crop = (cl, ct, cr, cb)
            item.bbox = (max(x0, page_rect.x0), max(y0, page_rect.y0),
                         min(x1, page_rect.x1), min(y1, page_rect.y1))
    return item


# ---------------------------------------------------------------- drawings

def _segments(items, close_path: bool) -> list[Segment]:
    segs: list[Segment] = []
    cur = None

    def move(p):
        nonlocal cur
        if cur is None or abs(cur[0] - p[0]) > 1e-3 or abs(cur[1] - p[1]) > 1e-3:
            segs.append(Segment("M", ((p[0], p[1]),)))

    for it in items:
        op = it[0]
        if op == "l":
            p1, p2 = it[1], it[2]
            move(p1)
            segs.append(Segment("L", ((p2.x, p2.y),)))
            cur = (p2.x, p2.y)
        elif op == "c":
            p1, c1, c2, p2 = it[1:5]
            move(p1)
            segs.append(Segment("C", ((c1.x, c1.y), (c2.x, c2.y), (p2.x, p2.y))))
            cur = (p2.x, p2.y)
        elif op == "re":
            r = it[1]
            segs += [Segment("M", ((r.x0, r.y0),)), Segment("L", ((r.x1, r.y0),)),
                     Segment("L", ((r.x1, r.y1),)), Segment("L", ((r.x0, r.y1),)), Segment("Z")]
            cur = None
        elif op == "qu":
            q = it[1]
            segs += [Segment("M", ((q.ul.x, q.ul.y),)), Segment("L", ((q.ur.x, q.ur.y),)),
                     Segment("L", ((q.lr.x, q.lr.y),)), Segment("L", ((q.ll.x, q.ll.y),)),
                     Segment("Z")]
            cur = None
    if close_path and segs and segs[-1].op != "Z":
        segs.append(Segment("Z"))
    return segs


def _is_axis_quad(q) -> bool:
    return (abs(q.ul.y - q.ur.y) < 0.01 and abs(q.ll.y - q.lr.y) < 0.01
            and abs(q.ul.x - q.ll.x) < 0.01 and abs(q.ur.x - q.lr.x) < 0.01)


def drawings_in_context(page: pymupdf.Page):
    """Yield (path, opacity, clip_rect) with transparency-group opacity and clip scissors
    inherited from enclosing groups/clips (plain get_drawings ignores both)."""
    stack: list[tuple[int, float, pymupdf.Rect | None]] = []
    for e in page.get_drawings(extended=True):
        level = e.get("level", 0)
        while stack and stack[-1][0] >= level:
            stack.pop()
        typ = e.get("type")
        if typ == "group":
            stack.append((level, e.get("opacity") or 1.0, None))
        elif typ == "clip":
            stack.append((level, 1.0, pymupdf.Rect(e["scissor"])))
        elif e.get("items"):
            opacity, clip = 1.0, None
            for _, op, sc in stack:
                opacity *= op
                if sc is not None:
                    clip = sc if clip is None else clip & sc
            yield e, opacity, clip


def shape_item(d, page_rect: pymupdf.Rect, opacity: float = 1.0,
               clip: pymupdf.Rect | None = None) -> ShapeItem | None:
    shape = _shape_item(d, page_rect)
    if shape is None:
        return None
    shape.fill_opacity *= opacity
    shape.stroke_opacity *= opacity
    if clip is not None and shape.kind == "rect" and shape.stroke is None:
        r = pymupdf.Rect(shape.bbox) & clip
        if r.is_empty:
            return None
        shape.bbox = (r.x0, r.y0, r.x1, r.y1)
    return shape


def _shape_item(d, page_rect: pymupdf.Rect) -> ShapeItem | None:
    typ = d.get("type") or ""
    fill = _rgb(d.get("fill")) if "f" in typ else None
    stroke = _rgb(d.get("color")) if "s" in typ else None
    if fill is None and stroke is None:
        return None
    rect = pymupdf.Rect(d["rect"])
    if not rect.intersects(page_rect) and not (rect.is_empty and page_rect.contains(rect.tl)):
        return None
    items = d["items"]
    if not items:
        return None
    width = d.get("width") or 0.0
    dashes = (d.get("dashes") or "").strip()
    shape = ShapeItem(
        bbox=(rect.x0, rect.y0, rect.x1, rect.y1), segments=[], fill=fill,
        fill_opacity=d.get("fill_opacity") if d.get("fill_opacity") is not None else 1.0,
        stroke=stroke,
        stroke_opacity=d.get("stroke_opacity") if d.get("stroke_opacity") is not None else 1.0,
        stroke_width=width if width > 0 else 0.25,
        dashed=bool(dashes) and not dashes.startswith("[]"),
        z=float(d.get("seqno", 0)),
        ops=2 if typ == "fs" else 1,  # fill+stroke paths are painted as two operations
    )
    if len(items) == 1 and (items[0][0] == "re" or (items[0][0] == "qu" and _is_axis_quad(items[0][1]))):
        r = items[0][1] if items[0][0] == "re" else items[0][1].rect
        shape.kind = "rect"
        shape.bbox = (r.x0, r.y0, r.x1, r.y1)
        return shape
    if len(items) == 1 and items[0][0] == "l" and fill is None:
        p1, p2 = items[0][1], items[0][2]
        shape.kind = "line"
        shape.segments = [Segment("M", ((p1.x, p1.y),)), Segment("L", ((p2.x, p2.y),))]
        return shape
    shape.segments = _segments(items, bool(d.get("closePath")))
    # bbox from actual coordinates (control points included, harmless)
    xs = [p[0] for s in shape.segments for p in s.pts]
    ys = [p[1] for s in shape.segments for p in s.pts]
    if xs:
        shape.bbox = (min(xs), min(ys), max(xs), max(ys))
    return shape


def covers_page(shape: ShapeItem, page_rect: pymupdf.Rect) -> bool:
    if shape.kind != "rect" or shape.stroke is not None or shape.fill is None:
        return False
    if shape.fill_opacity < 0.999:
        return False
    r = pymupdf.Rect(shape.bbox) & page_rect
    return r.get_area() >= 0.98 * page_rect.get_area()
