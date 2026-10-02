"""PDF page → intermediate Page model."""
from __future__ import annotations

import io

import pymupdf
from PIL import Image

from .graphics import (covers_page, drawings_in_context, image_bytes_from_block,
                       image_bytes_from_xref, image_item, shape_item)
from .model import ImageItem, Page
from .verify import repair
from .text import TEXT_FLAGS, extract_pieces, group_paragraphs, ruling_lines, to_text_block

MAX_PATHS = 2500        # above this, vector art becomes one background picture
MAX_RENDER_PX = 3600    # long side of rasterized regions


def _dpi_for(rect: pymupdf.Rect, dpi: int = 220) -> int:
    long_side = max(rect.width, rect.height, 1)
    return int(max(72, min(dpi, MAX_RENDER_PX * 72 / long_side)))


def render(page: pymupdf.Page, clip=None, with_text=True, dpi=220, fmt="png") -> bytes:
    src = page
    if not with_text:
        tmp = pymupdf.open()
        tmp.insert_pdf(page.parent, from_page=page.number, to_page=page.number)
        src = tmp[0]
        src.add_redact_annot(src.rect, fill=False)
        src.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_NONE,
                             graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
                             text=pymupdf.PDF_REDACT_TEXT_REMOVE)
    area = pymupdf.Rect(clip) if clip is not None else src.rect
    pix = src.get_pixmap(dpi=_dpi_for(area, dpi), clip=area, alpha=False)
    return pix.tobytes("jpeg", jpg_quality=90) if fmt == "jpeg" else pix.tobytes("png")


class TextOnly:
    """The page with images and vector art removed: renders glyphs on transparency."""

    def __init__(self, page: pymupdf.Page):
        self.doc = pymupdf.open()
        self.doc.insert_pdf(page.parent, from_page=page.number, to_page=page.number)
        p = self.doc[0]
        p.add_redact_annot(p.rect, fill=False)
        p.apply_redactions(images=pymupdf.PDF_REDACT_IMAGE_REMOVE,
                           graphics=pymupdf.PDF_REDACT_LINE_ART_REMOVE_IF_TOUCHED,
                           text=pymupdf.PDF_REDACT_TEXT_NONE)
        self.zoom = _dpi_for(p.rect, 300) / 72
        pix = p.get_pixmap(matrix=pymupdf.Matrix(self.zoom, self.zoom), alpha=True)
        self.image = Image.frombytes("RGBA", (pix.width, pix.height), pix.samples)

    def png(self, clip: pymupdf.Rect) -> bytes:
        z = self.zoom
        box = (int(clip.x0 * z), int(clip.y0 * z), int(clip.x1 * z + 0.999), int(clip.y1 * z + 0.999))
        buf = io.BytesIO()
        self.image.crop(box).save(buf, "PNG")
        return buf.getvalue()


def _background_item(page: pymupdf.Page) -> ImageItem:
    pr = page.rect
    return ImageItem(bbox=(pr.x0, pr.y0, pr.x1, pr.y1),
                     data=render(page, with_text=False, fmt="jpeg"), z=-1)


def extract_page(page: pymupdf.Page, mode: str = "editable") -> Page:
    if page.rotation:
        page.remove_rotation()
    pr = page.rect
    result = Page(width=pr.width, height=pr.height)
    raw = page.get_text("rawdict", flags=TEXT_FLAGS)
    drawings = list(drawings_in_context(page))
    rules = ruling_lines(d for d, _, _ in drawings)

    # ---- text
    pieces = extract_pieces(page, raw, rules)
    text_only = None
    for i, (group, align) in enumerate(group_paragraphs(pieces, rules)):
        if group[0].garbled:  # text without usable unicode: keep the glyphs as a picture
            bx = pymupdf.Rect(group[0].bbox)
            bx = pymupdf.Rect(bx.x0 - 1, bx.y0 - 1, bx.x1 + 1, bx.y1 + 1) & pr
            if not bx.is_empty:
                text_only = text_only or TextOnly(page)
                result.items.append(ImageItem(bbox=tuple(bx), data=text_only.png(bx),
                                              z=min(p.z for p in group), is_text=True))
            continue
        result.items.append(to_text_block(group, align))

    if mode == "exact":
        result.items.append(_background_item(page))
        return result

    # ---- graphics
    log = page.get_bboxlog()
    if len(drawings) > MAX_PATHS:
        result.items.append(_background_item(page))
        return result

    shapes = [s for s in (shape_item(d, pr, op, clip) for d, op, clip in drawings) if s]
    shapes.sort(key=lambda s: s.z)
    if shapes and covers_page(shapes[0], pr):
        first_other = min([i for i, (k, _) in enumerate(log)
                           if k in ("fill-image", "fill-imask", "fill-shade")], default=1e9)
        if shapes[0].z < first_other:
            result.background = shapes[0].fill
            result.background_z = int(shapes[0].z)
            shapes = shapes[1:]
    result.items += shapes

    # images ↔ paint operations: by order when the counts agree, else by transformed frame
    # (PyMuPDF's image list also contains shadings, rasterized)
    image_slots = [(i, pymupdf.Rect(r)) for i, (k, r) in enumerate(log)
                   if k in ("fill-image", "fill-imgmask", "fill-shade")]
    infos = page.get_image_info(xrefs=True)
    by_order = len(image_slots) == len(infos)
    used: set[int] = set()
    inline_blocks = None
    doc = page.parent
    for n, info in enumerate(infos):
        br = pymupdf.Rect(info["bbox"])
        if by_order:
            z = image_slots[n][0]
        else:
            frame = pymupdf.Rect(0, 0, 1, 1) * pymupdf.Matrix(info["transform"])
            z = next((i for i, r in image_slots if i not in used and
                      abs(r.x0 - frame.x0) + abs(r.y0 - frame.y0) + abs(r.x1 - frame.x1) + abs(r.y1 - frame.y1) < 2),
                     None)
            if z is None:
                z = next((i for i, _ in image_slots if i not in used), 0)
        used.add(z)
        xref = info.get("xref") or 0
        if xref:
            data_fn = lambda w, h, x=xref: image_bytes_from_xref(doc, x, w, h)
        else:
            if inline_blocks is None:
                inline_blocks = [b for b in page.get_text("dict", flags=pymupdf.TEXT_PRESERVE_IMAGES)["blocks"]
                                 if b.get("type") == 1]
            blk = next((b for b in inline_blocks if pymupdf.Rect(b["bbox"]) == br), None)
            if blk is None:
                continue
            data_fn = lambda w, h, b=blk: image_bytes_from_block(b, w, h)
        item = image_item(info["transform"], info["bbox"], data_fn, pr, float(z))
        if item:
            result.items.append(item)

    # anything we could not reproduce faithfully is replaced by an exact picture
    repair(page, result)
    return result
