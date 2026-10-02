"""PDF bytes → PPTX bytes."""
from __future__ import annotations

import logging
import os
from concurrent.futures import ProcessPoolExecutor, as_completed
from typing import Callable

import pymupdf

from .build import build_pptx
from .extract import extract_page, render
from .model import ImageItem, Page

log = logging.getLogger(__name__)
MODES = ("editable", "exact")


class ConversionError(Exception):
    """Input that cannot be converted (not a PDF, encrypted, empty)."""


def open_pdf(pdf_bytes: bytes) -> pymupdf.Document:
    try:
        doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    except Exception as e:
        raise ConversionError("Файл повреждён или это не PDF.") from e
    if doc.needs_pass:
        raise ConversionError("PDF защищён паролем — снимите защиту и попробуйте снова.")
    if doc.page_count == 0:
        raise ConversionError("В PDF нет страниц.")
    return doc


def _picture_page(page: pymupdf.Page) -> Page:
    r = page.rect
    return Page(width=r.width, height=r.height,
                items=[ImageItem(bbox=(r.x0, r.y0, r.x1, r.y1), data=render(page, fmt="jpeg"))])


def _extract_range(pdf_bytes: bytes, start: int, stop: int, mode: str) -> list[Page]:
    doc = pymupdf.open(stream=pdf_bytes, filetype="pdf")
    pages = []
    for i in range(start, stop):
        try:
            pages.append(extract_page(doc[i], mode))
        except Exception:
            log.exception("page %d failed, falling back to a picture", i + 1)
            pages.append(_picture_page(doc[i]))
    return pages


def convert(pdf_bytes: bytes, mode: str = "editable",
            progress: Callable[[int, int], None] | None = None, workers: int | None = None) -> bytes:
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    total = open_pdf(pdf_bytes).page_count
    workers = workers or min(os.cpu_count() or 1, 8)
    chunk = max(1, min(8, -(-total // (workers * 2))))
    ranges = [(s, min(s + chunk, total)) for s in range(0, total, chunk)]
    results: dict[int, list[Page]] = {}
    done = 0
    if workers == 1 or len(ranges) == 1:
        for s, e in ranges:
            results[s] = _extract_range(pdf_bytes, s, e, mode)
            done += e - s
            if progress:
                progress(done, total)
    else:
        with ProcessPoolExecutor(max_workers=min(workers, len(ranges))) as pool:
            futures = {pool.submit(_extract_range, pdf_bytes, s, e, mode): (s, e) for s, e in ranges}
            for fut in as_completed(futures):
                s, e = futures[fut]
                results[s] = fut.result()
                done += e - s
                if progress:
                    progress(done, total)
    pages = [p for s in sorted(results) for p in results[s]]
    return build_pptx(pages)
