"""Intermediate Page model → .pptx bytes (python-pptx)."""
from __future__ import annotations

import io
from collections import Counter

from lxml import etree
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_LINE
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, MSO_AUTO_SIZE, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.shapes.shapetree import _BaseShapes
from pptx.util import Emu, Pt

from .model import ImageItem, Page, ShapeItem, TextBlock

EMU_PER_PT = 12700
MIN_SLIDE, MAX_SLIDE = 914400, 51206400
BLANK_LAYOUT = 6

# PowerPoint puts the first baseline this far below the box top for exact line spacing S:
# baseline = top + BASELINE_FRAC * S. Calibrated against PowerPoint's own PDF export.
BASELINE_FRAC = 0.8
SCRIPT_SHRINK = 0.65     # PowerPoint's rendering scale for sub/superscript runs
SINGLE_LINE_PITCH = 1.2  # line spacing (in font sizes) used for single-line boxes

_A = "http://schemas.openxmlformats.org/drawingml/2006/main"


def _fast_next_shape_id(self):
    """python-pptx rescans the whole slide for every new shape id (quadratic);
    keep a running counter per shape collection instead."""
    n = self.__dict__.get("_p2p_next_id")
    if n is None:
        n = _ORIG_NEXT_ID.fget(self)
    self.__dict__["_p2p_next_id"] = n + 1
    return n


_ORIG_NEXT_ID = _BaseShapes._next_shape_id
_BaseShapes._next_shape_id = property(_fast_next_shape_id)

_ALIGN = {"left": PP_ALIGN.LEFT, "center": PP_ALIGN.CENTER, "right": PP_ALIGN.RIGHT}


class _Frame:
    """Maps page points to slide EMU (uniform scale + centering offset)."""

    def __init__(self, page: Page, slide_w: int, slide_h: int):
        pw, ph = page.width * EMU_PER_PT, page.height * EMU_PER_PT
        self.k = min(slide_w / pw, slide_h / ph) * EMU_PER_PT  # EMU per point
        self.dx = (slide_w - page.width * self.k) / 2
        self.dy = (slide_h - page.height * self.k) / 2
        self.pt_scale = self.k / EMU_PER_PT

    def x(self, v): return int(round(self.dx + v * self.k))
    def y(self, v): return int(round(self.dy + v * self.k))
    def d(self, v): return int(round(v * self.k))


def _slide_size(pages: list[Page]) -> tuple[int, int]:
    w, h = Counter((round(p.width), round(p.height)) for p in pages).most_common(1)[0][0]
    w, h = w * EMU_PER_PT, h * EMU_PER_PT
    s = min(1.0, MAX_SLIDE / max(w, h))
    s = max(s, MIN_SLIDE / min(w, h)) if min(w, h) * s < MIN_SLIDE else s
    return int(w * s), int(h * s)


def _set_alpha(color_parent, opacity: float):
    if opacity >= 0.999:
        return
    clr = color_parent.find(qn("a:srgbClr"))
    if clr is not None:
        a = etree.SubElement(clr, qn("a:alpha"))
        a.set("val", str(int(opacity * 100000)))


def _apply_line(shape, item: ShapeItem, fr: _Frame):
    line = shape.line
    if item.stroke is None:
        line.fill.background()
        return
    line.color.rgb = RGBColor(*item.stroke)
    line.width = Emu(max(fr.d(item.stroke_width), 3175))
    if item.dashed:
        line.dash_style = MSO_LINE.DASH
    ln = shape._element.spPr.find(qn("a:ln"))
    if ln is not None:
        _set_alpha(ln.find(qn("a:solidFill")), item.stroke_opacity)


def _apply_fill(shape, item: ShapeItem):
    if item.fill is None:
        shape.fill.background()
        return
    shape.fill.solid()
    shape.fill.fore_color.rgb = RGBColor(*item.fill)
    _set_alpha(shape._element.spPr.find(qn("a:solidFill")), item.fill_opacity)


def _no_style(shape):
    """Drop the theme style reference so the theme can't add shadows/outlines."""
    style = shape._element.find(qn("p:style"))
    if style is not None:
        shape._element.remove(style)


def _custom_geometry(shape, item: ShapeItem, fr: _Frame):
    x0, y0 = item.bbox[0], item.bbox[1]
    w = max(fr.d(item.bbox[2] - x0), 1)
    h = max(fr.d(item.bbox[3] - y0), 1)
    d, k, dx, dy = [], fr.k, x0, y0
    tags = {"M": "moveTo", "L": "lnTo", "C": "cubicBezTo"}
    for seg in item.segments:
        if seg.op == "Z":
            d.append("<a:close/>")
            continue
        pts = "".join(f'<a:pt x="{round((px - dx) * k)}" y="{round((py - dy) * k)}"/>' for px, py in seg.pts)
        d.append(f"<a:{tags[seg.op]}>{pts}</a:{tags[seg.op]}>")
    fill = ' fill="none"' if item.fill is None else ""
    xml = (f'<a:custGeom xmlns:a="{_A}"><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/>'
           f'<a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="{w}" h="{h}"{fill}>'
           f'{"".join(d)}</a:path></a:pathLst></a:custGeom>')
    geom = etree.fromstring(xml)
    spPr = shape._element.spPr
    prst = spPr.find(qn("a:prstGeom"))
    prst.addprevious(geom)
    spPr.remove(prst)


def _add_shape(slide, item: ShapeItem, fr: _Frame):
    x0, y0, x1, y1 = item.bbox
    if item.kind == "line":
        (ax, ay), = item.segments[0].pts
        (bx, by), = item.segments[1].pts
        shape = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, fr.x(ax), fr.y(ay), fr.x(bx), fr.y(by))
        _no_style(shape)
        _apply_line(shape, item, fr)
        return
    w, h = max(fr.d(x1 - x0), 1), max(fr.d(y1 - y0), 1)
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, fr.x(x0), fr.y(y0), w, h)
    _no_style(shape)
    if item.kind == "path":
        _custom_geometry(shape, item, fr)
    _apply_fill(shape, item)
    _apply_line(shape, item, fr)


def _add_picture(slide, item: ImageItem, fr: _Frame):
    x0, y0, x1, y1 = item.bbox
    pic = slide.shapes.add_picture(io.BytesIO(item.data), fr.x(x0), fr.y(y0),
                                   max(fr.d(x1 - x0), 1), max(fr.d(y1 - y0), 1))
    if item.rotation % 360 > 0.01:
        pic.rotation = item.rotation
    xfrm = pic._element.spPr.find(qn("a:xfrm"))
    if item.flip_h:
        xfrm.set("flipH", "1")
    if item.flip_v:
        xfrm.set("flipV", "1")
    cl, ct, cr, cb = item.crop
    if cl or ct or cr or cb:
        pic.crop_left, pic.crop_top, pic.crop_right, pic.crop_bottom = cl, ct, cr, cb


def _set_fonts(run, family: str):
    rPr = run._r.get_or_add_rPr()
    for tag in ("a:latin", "a:ea", "a:cs"):
        el = rPr.find(qn(tag))
        if el is None:
            el = etree.SubElement(rPr, qn(tag))
        el.set("typeface", family)


def _add_text(slide, item: TextBlock, fr: _Frame):
    n = item.n_lines
    pitch = item.line_pitch if (n > 1 and item.line_pitch) else SINGLE_LINE_PITCH * item.size
    x0, _, x1, _ = item.bbox
    top = item.first_baseline - BASELINE_FRAC * pitch
    height = pitch * n
    width = (x1 - x0) * 1.04 + item.size * 0.3
    if item.rotation:
        item.align = "center"  # keep the rotation center on the text center
    if item.align == "center":
        x0 = (x0 + x1 - width) / 2
    elif item.align == "right":
        x0 = x1 - width
    if item.rotation:
        cy = (item.bbox[1] + item.bbox[3]) / 2
        top = cy - height / 2

    tb = slide.shapes.add_textbox(fr.x(x0), fr.y(top), fr.d(width), fr.d(height))
    tf = tb.text_frame
    tf.word_wrap = False
    tf.auto_size = MSO_AUTO_SIZE.NONE
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.TOP
    if item.rotation:
        tb.rotation = item.rotation

    p = tf.paragraphs[0]
    p.alignment = _ALIGN.get(item.align, PP_ALIGN.LEFT)
    p.line_spacing = Pt(pitch * fr.pt_scale)
    p.space_before = p.space_after = Pt(0)
    if abs(item.indent) > 0.5:
        pPr = p._p.get_or_add_pPr()
        if item.indent < 0:  # hanging indent: body sits right of the first line
            pPr.set("marL", str(fr.d(-item.indent)))
        pPr.set("indent", str(fr.d(item.indent)))
    for i, line in enumerate(item.lines):
        if i:
            p.add_line_break()
        for r in line:
            run = p.add_run()
            run.text = r.text
            f = run.font
            size = r.size * fr.pt_scale
            if r.shift:
                # PowerPoint draws baseline-shifted runs at ~2/3 size: compensate
                size /= SCRIPT_SHRINK
                pct = r.shift * fr.pt_scale / (0.85 * size) * 100000
                run._r.get_or_add_rPr().set("baseline", str(int(max(-100000, min(100000, pct)))))
            f.size = Pt(max(1.0, round(size * 2) / 2))
            f.bold = r.bold
            f.italic = r.italic
            f.color.rgb = RGBColor(*r.color)
            rPr = run._r.get_or_add_rPr()
            _set_alpha(rPr.find(qn("a:solidFill")), r.opacity)
            if r.spacing:
                rPr.set("spc", str(int(round(r.spacing * fr.pt_scale * 100))))
            _set_fonts(run, r.font)
            if r.link:
                run.hyperlink.address = r.link
                _keep_link_color(run)


def _keep_link_color(run):
    """Make PowerPoint draw the link in the run's own color instead of the theme's."""
    click = run._r.get_or_add_rPr().find(qn("a:hlinkClick"))
    if click is None:
        return
    ext_lst = etree.SubElement(click, qn("a:extLst"))
    ext = etree.SubElement(ext_lst, qn("a:ext"))
    ext.set("uri", "{A12FA001-AC4F-418D-AE19-62706E023703}")
    clr = etree.SubElement(ext, "{http://schemas.microsoft.com/office/drawing/2018/hyperlinkcolor}hlinkClr",
                           nsmap={"ahyp": "http://schemas.microsoft.com/office/drawing/2018/hyperlinkcolor"})
    clr.set("val", "tx")


def build_pptx(pages: list[Page]) -> bytes:
    prs = Presentation()
    sw, sh = _slide_size(pages) if pages else (MIN_SLIDE * 10, MIN_SLIDE * 7)
    prs.slide_width, prs.slide_height = sw, sh
    layout = prs.slide_layouts[BLANK_LAYOUT]
    for page in pages:
        slide = prs.slides.add_slide(layout)
        slide.shapes  # noqa: B018 - materialize the cached shape collection (id counter)
        fr = _Frame(page, sw, sh)
        if page.background:
            slide.background.fill.solid()
            slide.background.fill.fore_color.rgb = RGBColor(*page.background)
        for item in page.sorted_items():
            if isinstance(item, TextBlock):
                _add_text(slide, item, fr)
            elif isinstance(item, ImageItem):
                _add_picture(slide, item, fr)
            elif isinstance(item, ShapeItem):
                _add_shape(slide, item, fr)
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()
