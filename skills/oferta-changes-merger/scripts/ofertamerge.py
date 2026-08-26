"""Собрать объединённые изменения в публичную оферту и применить их к тексту.

Инструмент детерминирован: он меняет документ строго по подтверждённому плану
и никогда не сочиняет юридический текст. Правки выполняются хирургически над
сырым XML (document.xml / footnotes.xml), поэтому исходное оформление
сохраняется. Используется только стандартная библиотека Python.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import tempfile
from dataclasses import dataclass, field
from hashlib import sha256
from pathlib import Path
from typing import Any, Iterable
from xml.sax.saxutils import escape as xml_escape
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

DOCUMENT_PART = "word/document.xml"
FOOTNOTES_PART = "word/footnotes.xml"
NUMBERING_PART = "word/numbering.xml"

WT_RE = re.compile(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", re.S)
TR_RE = re.compile(r"<w:tr\b.*?</w:tr>", re.S)
TC_RE = re.compile(r"<w:tc>.*?</w:tc>", re.S)
P_RE = re.compile(r"<w:p(?:\s[^>]*)?>.*?</w:p>", re.S)
TAG_RE = re.compile(r"<[^>]+>")

HIGHLIGHT_COLOR = "EE0000"

# Организационно-правовые формы, отбрасываемые из ключа сортировки.
LEGAL_FORMS = ["ООО", "ОАО", "ЗАО", "ПАО", "АО", "АНО", "НАО", "ИП", "ПК", "ГК"]
_FORMS = "|".join(LEGAL_FORMS)
_FORM_TAIL = re.compile(r"\s*(?:%s)\s*$" % _FORMS)
_FORM_HEAD = re.compile(r"^(?:%s)\s+" % _FORMS)


# ─────────────────────────── общие утилиты ───────────────────────────


def unescape(text: str) -> str:
    return (
        text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&apos;", "'")
        .replace("&amp;", "&")
    )


def esc(text: str) -> str:
    return xml_escape(text)


def visible_text(fragment: str, join: str = "") -> str:
    """Видимый текст фрагмента XML.

    Раны <w:t> склеиваются БЕЗ разделителя: Word произвольно режет текст на
    раны, поэтому «28» может лежать как «2» + «8».
    """
    parts = [unescape(m.group(1)) for m in WT_RE.finditer(fragment)]
    return re.sub(r"\s+", " ", join.join(parts)).strip()


def sort_key(name: str) -> str:
    """Ключ алфавитной сортировки наименования компании.

    Выведен из действующего Приложения 1 и точно воспроизводит порядок,
    выстроенный юристами: организационная форма пишется ПОСЛЕ названия,
    кавычки не значимы, регистр не важен, ё=е, пунктуация значима
    («С-МАРКЕТИНГ» идёт перед «СалютДевайсы»).
    """
    t = name.strip()
    t = _FORM_TAIL.sub("", t)
    t = _FORM_HEAD.sub("", t)
    t = re.sub(r'["«»“”„]', "", t)
    t = re.sub(r"\s+", " ", t).strip().lower().replace("ё", "е")
    return t


def names_compatible(a: str, b: str) -> bool:
    """Одна ли это компания? Предохранитель при сопоставлении по номеру."""
    x = re.sub(r"[^0-9a-zа-я]", "", sort_key(a))
    y = re.sub(r"[^0-9a-zа-я]", "", sort_key(b))
    if not x or not y:
        return False
    if x == y or x.startswith(y) or y.startswith(x):
        return True
    i = 0
    while i < len(x) and i < len(y) and x[i] == y[i]:
        i += 1
    return i >= 12


def sha256_of(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def xml_balanced(xml: str) -> bool:
    return xml.count("<") == xml.count(">")


# ─────────────────────────── контейнер docx ───────────────────────────


@dataclass
class Docx:
    path: Path
    parts: dict[str, bytes]
    names: list[str]

    @classmethod
    def load(cls, path: Path) -> "Docx":
        try:
            with ZipFile(path) as zf:
                names = zf.namelist()
                parts = {n: zf.read(n) for n in names}
        except BadZipFile as exc:
            raise SystemExit(f"файл не является корректным DOCX: {path} ({exc})")
        if DOCUMENT_PART not in parts:
            raise SystemExit(f"в документе нет {DOCUMENT_PART}: {path}")
        return cls(path=path, parts=parts, names=names)

    def text(self, part: str) -> str | None:
        raw = self.parts.get(part)
        return raw.decode("utf-8") if raw is not None else None

    @property
    def document(self) -> str:
        return self.text(DOCUMENT_PART) or ""

    @property
    def footnotes(self) -> str | None:
        return self.text(FOOTNOTES_PART)

    @property
    def numbering(self) -> str | None:
        return self.text(NUMBERING_PART)

    def save(self, out: Path, updated: dict[str, str]) -> None:
        """Опубликовать копию через временный файл (исходник не трогаем)."""
        payload = dict(self.parts)
        for name, value in updated.items():
            payload[name] = value.encode("utf-8")
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = Path(tempfile.mkstemp(suffix=".docx", dir=str(out.parent))[1])
        try:
            with ZipFile(tmp, "w", ZIP_DEFLATED) as zf:
                for name in self.names:
                    zf.writestr(name, payload[name])
            shutil.move(str(tmp), str(out))
        finally:
            if tmp.exists():
                tmp.unlink()


# ─────────────────────────── сноски ───────────────────────────


def footnote_display_map(document: str) -> dict[int, int]:
    """Видимый номер сноски -> внутренний w:id.

    «Сноска № 32» — это 32-я по счёту ссылка в тексте, а НЕ элемент с id=32.
    """
    ids = re.findall(r'<w:footnoteReference[^>]*\bw:id="(\d+)"', document)
    return {i + 1: int(v) for i, v in enumerate(ids)}


def footnote_body_positions(document: str) -> dict[int, int]:
    out: dict[int, int] = {}
    for i, m in enumerate(re.finditer(r'<w:footnoteReference[^>]*\bw:id="(\d+)"', document)):
        out[i + 1] = m.start()
    return out


@dataclass
class Block:
    start: int
    end: int
    inner: str
    ident: int | None = None


def find_footnote(footnotes: str, fid: int) -> Block | None:
    m = re.search(r'<w:footnote\b[^>]*\bw:id="%d"[^>]*>(.*?)</w:footnote>' % fid, footnotes, re.S)
    if not m:
        return None
    return Block(m.start(), m.end(), m.group(1), fid)


def all_footnotes(footnotes: str) -> list[Block]:
    out: list[Block] = []
    for m in re.finditer(r'<w:footnote\b[^>]*\bw:id="(-?\d+)"[^>]*>(.*?)</w:footnote>', footnotes, re.S):
        out.append(Block(m.start(), m.end(), m.group(2), int(m.group(1))))
    return out


def max_footnote_id(footnotes: str) -> int:
    ids = [int(x) for x in re.findall(r'<w:footnote\b[^>]*\bw:id="(-?\d+)"', footnotes)]
    return max(ids) if ids else 1


# ───────────────────── восстановление автонумерации ─────────────────────


@dataclass
class NumberedPara:
    start: int
    end: int
    inner: str
    text: str
    number: str | None


def _roman(n: int) -> str:
    vals = ((1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"),
            (50, "l"), (40, "xl"), (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"))
    out = []
    for v, sym in vals:
        while n >= v:
            out.append(sym)
            n -= v
    return "".join(out)


def _letter(n: int) -> str:
    out = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        out = chr(ord("a") + rem) + out
    return out


def format_counter(value: int, fmt: str) -> str:
    if fmt == "lowerLetter":
        return _letter(value)
    if fmt == "upperLetter":
        return _letter(value).upper()
    if fmt == "lowerRoman":
        return _roman(value)
    if fmt == "upperRoman":
        return _roman(value).upper()
    return str(value)


@dataclass
class LevelDef:
    start: int = 1
    fmt: str = "decimal"
    text: str = ""


def parse_numbering(numbering: str | None) -> tuple[dict[str, str], dict[str, dict[int, LevelDef]], dict[str, dict[int, int]]]:
    """Разобрать numbering.xml.

    Возвращает: numId -> abstractId, abstractId -> уровни, numId -> startOverride.
    Уровень хранит шаблон w:lvlText: именно он задаёт вид номера. Например у
    списка раздела 7 шаблон «7.%1» — цифра раздела ЗАШИТА в шаблон, а %1 это
    счётчик пункта. Склеивать счётчики уровней нельзя: получится «6» вместо
    «7.6», и пункт не найдётся.
    """
    num_to_abstract: dict[str, str] = {}
    levels: dict[str, dict[int, LevelDef]] = {}
    overrides: dict[str, dict[int, int]] = {}
    if not numbering:
        return num_to_abstract, levels, overrides

    for m in re.finditer(r"<w:num\s+w:numId=\"(\d+)\".*?</w:num>", numbering, re.S):
        block = m.group(0)
        abstract = re.search(r'<w:abstractNumId\s+w:val="(\d+)"', block)
        if abstract:
            num_to_abstract[m.group(1)] = abstract.group(1)
        for ov in re.finditer(r'<w:lvlOverride\s+w:ilvl="(\d+)"(.*?)</w:lvlOverride>', block, re.S):
            start = re.search(r'<w:startOverride\s+w:val="(\d+)"', ov.group(2))
            if start:
                overrides.setdefault(m.group(1), {})[int(ov.group(1))] = int(start.group(1))

    for m in re.finditer(r'<w:abstractNum\s+w:abstractNumId="(\d+)".*?</w:abstractNum>', numbering, re.S):
        defs: dict[int, LevelDef] = {}
        for lv in re.finditer(r'<w:lvl\s+w:ilvl="(\d+)"[^>]*>(.*?)</w:lvl>', m.group(0), re.S):
            body = lv.group(2)
            start = re.search(r'<w:start\s+w:val="(\d+)"', body)
            fmt = re.search(r'<w:numFmt\s+w:val="([^"]+)"', body)
            text = re.search(r'<w:lvlText\s+w:val="([^"]*)"', body)
            defs[int(lv.group(1))] = LevelDef(
                start=int(start.group(1)) if start else 1,
                fmt=fmt.group(1) if fmt else "decimal",
                text=text.group(1) if text else "",
            )
        levels[m.group(1)] = defs
    return num_to_abstract, levels, overrides


def render_number(counters: list[int | None], ilvl: int, defs: dict[int, LevelDef]) -> str | None:
    """Собрать видимый номер по шаблону w:lvlText уровня."""
    level = defs.get(ilvl)
    if level is None:
        return None
    if level.fmt in {"bullet", "none"}:
        return None
    template = level.text or "".join("%%%d." % (i + 1) for i in range(ilvl + 1))

    def sub(m: re.Match[str]) -> str:
        idx = int(m.group(1)) - 1
        if idx < 0 or idx >= len(counters) or counters[idx] is None:
            src = defs.get(idx)
            return format_counter(src.start if src else 1, src.fmt if src else "decimal")
        src = defs.get(idx, LevelDef())
        return format_counter(counters[idx] or 0, src.fmt)

    return re.sub(r"%(\d)", sub, template).strip()


def index_paragraphs(document: str, numbering: str | None) -> list[NumberedPara]:
    """Все абзацы с ВЫЧИСЛЕННЫМИ номерами (в тексте их нет — рисует Word)."""
    num_to_abstract, levels, overrides = parse_numbering(numbering)
    counters: dict[str, list[int | None]] = {}
    out: list[NumberedPara] = []
    for m in P_RE.finditer(document):
        inner = m.group(0)
        number: str | None = None
        num_id = re.search(r'<w:numId\s+w:val="(\d+)"', inner)
        ilvl_m = re.search(r'<w:ilvl\s+w:val="(\d+)"', inner)
        if num_id and "<w:numPr>" in inner and num_id.group(1) != "0":
            nid = num_id.group(1)
            ilvl = int(ilvl_m.group(1)) if ilvl_m else 0
            defs = levels.get(num_to_abstract.get(nid, ""), {})
            level = defs.get(ilvl, LevelDef())
            start = overrides.get(nid, {}).get(ilvl, level.start)
            counter = counters.setdefault(nid, [])
            while len(counter) <= ilvl:
                counter.append(None)
            counter[ilvl] = start if counter[ilvl] is None else (counter[ilvl] or 0) + 1
            for k in range(ilvl + 1, len(counter)):
                counter[k] = None
            number = render_number(counter, ilvl, defs)
        out.append(NumberedPara(m.start(), m.end(), inner, visible_text(inner), number))
    return out


def norm_number(value: str) -> str:
    return value.strip().rstrip(". ")


def find_by_number(index: list[NumberedPara], number: str, from_offset: int = 0) -> NumberedPara | None:
    want = norm_number(number)
    for p in index:
        if p.start < from_offset:
            continue
        if p.number and norm_number(p.number) == want:
            return p
    return None


# ─────────────────────────── таблицы приложений ───────────────────────────


def appendix_offset(document: str, appendix: str) -> int:
    if appendix == "2":
        anchors = ["Способы и особенности реализации Бесшовного", "Приложение № 2", "Приложение №2"]
    else:
        anchors = [f"Приложение № {appendix}", f"Приложение №{appendix}", "Компании информационного партнерства"]
    for a in anchors:
        pos = document.find(a)
        if pos >= 0:
            return pos
    return 0


def find_appendix_table(document: str, appendix: str) -> Block | None:
    start = document.find("<w:tbl>", appendix_offset(document, appendix))
    if start < 0:
        return None
    end_tag = document.find("</w:tbl>", start)
    if end_tag < 0:
        return None
    end = end_tag + len("</w:tbl>")
    return Block(start, end, document[start:end])


def table_rows(table: str) -> list[str]:
    return TR_RE.findall(table)


def row_cells(row: str) -> list[str]:
    return TC_RE.findall(row)


def has_real_vmerge(table: str) -> bool:
    """Настоящее объединение — ячейка-продолжение (<w:vMerge/> без restart)."""
    tags = re.findall(r"<w:vMerge\b[^>]*/?>", table)
    return any('w:val="restart"' not in t for t in tags)


# ─────────────────────────── рендер выделения ───────────────────────────


def runs(text: str, bold: bool = False, color: str = HIGHLIGHT_COLOR) -> str:
    rpr = "<w:rPr>%s<w:color w:val=\"%s\"/></w:rPr>" % ("<w:b/>" if bold else "", color)
    return '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (rpr, esc(text))


def paragraph_runs(body: str, term_like: bool, color: str = HIGHLIGHT_COLOR) -> str:
    if term_like:
        m = re.search(r"\s[–—-]\s", body)
        if m and m.start() > 0:
            return runs(body[: m.start()], bold=True, color=color) + runs(body[m.start():], color=color)
    return runs(body, color=color)


def extract_ppr(paragraph: str) -> str:
    m = re.search(r"<w:pPr>.*?</w:pPr>", paragraph, re.S)
    return m.group(0) if m else ""


FOOTNOTE_REF_RUN = re.compile(r"<w:r\b[^>]*>(?:(?!</w:r>).)*?<w:footnoteReference[^>]*/>.*?</w:r>", re.S)


def replace_paragraph_runs(paragraph: str, new_runs: str) -> tuple[str, int]:
    """Заменить содержимое абзаца, СОХРАНИВ ссылки на сноски.

    Иначе сноска осталась бы «сиротой»: её элемент остаётся в footnotes.xml,
    но ссылка из текста исчезает — и вся последующая нумерация сносок
    сдвигается. Сохранённые ссылки переносятся в конец абзаца, их число
    возвращается, чтобы предупредить оператора о проверке места.
    """
    ppr = extract_ppr(paragraph)
    open_m = re.match(r"<w:p(?:\s[^>]*)?>", paragraph)
    refs = FOOTNOTE_REF_RUN.findall(paragraph)
    body = new_runs + "".join(refs)
    return "%s%s%s</w:p>" % (open_m.group(0) if open_m else "<w:p>", ppr, body), len(refs)


def strip_leading_number(text: str) -> str:
    return re.sub(r"^\s*\d+(?:\.\d+)*\.?\s*", "", text)


def strip_outer_quotes(text: str) -> str:
    t = text.strip()
    return t[1:-1] if t.startswith("«") and t.endswith("»") else t


# ─────────────────────── вставка после якорной фразы ───────────────────────


def _ignorable(ch: str) -> bool:
    return ch.isspace() or ch in "«»"


def insert_after_anchor(xml: str, anchor: str, new_runs: str) -> tuple[str, bool, str]:
    """Вставить раны сразу после якорной фразы.

    Сопоставление игнорирует пробелы и кавычки-«ёлочки»: в инструкции они
    служат разделителями фразы, а в тексте — ещё и кавычками.
    """
    tokens: list[tuple[int, int, str, str, str]] = []  # start, end, full, text, rpr
    for m in re.finditer(r"<w:r(?:\s[^>]*)?>.*?</w:r>", xml, re.S):
        full = m.group(0)
        texts = [unescape(t.group(1)) for t in WT_RE.finditer(full)]
        if not texts:
            continue
        simple = len(texts) == 1 and not re.search(
            r"<w:(tab|br|drawing|object|footnoteReference|endnoteReference)\b", full
        )
        rpr_m = re.match(r"<w:r(?:\s[^>]*)?>(\s*<w:rPr>.*?</w:rPr>)?", full, re.S)
        tokens.append((m.start(), m.end(), full, "".join(texts), (rpr_m.group(1) or "") if rpr_m else ""))
        tokens[-1] = tokens[-1] + (simple,)  # type: ignore[assignment]

    flat: list[tuple[str, int, int]] = []  # char, token index, offset in token text
    for ti, tok in enumerate(tokens):
        for oi, ch in enumerate(tok[3]):
            if _ignorable(ch):
                continue
            flat.append((ch.lower(), ti, oi))
    needle = "".join(c.lower() for c in anchor if not _ignorable(c))
    if not needle:
        return xml, False, "пустой якорь"
    haystack = "".join(c for c, _, _ in flat)
    pos = haystack.find(needle)
    if pos < 0:
        # Подсказка оператору: ищем самый длинный совпадающий префикс якоря и
        # показываем, что стоит в документе на этом месте. Автоматически
        # «дотягивать» якорь нельзя — вставка ушла бы не туда.
        hint = ""
        plain = "".join(tok[3] for tok in tokens)
        for frac in (0.85, 0.7, 0.55, 0.4):
            probe = needle[: max(12, int(len(needle) * frac))]
            if len(probe) < 12:
                break
            at = haystack.find(probe)
            if at >= 0:
                _, hti, hoi = flat[at]
                offset = sum(len(tokens[k][3]) for k in range(hti)) + hoi
                snippet = re.sub(r"\s+", " ", plain[offset: offset + len(anchor) + 24]).strip()
                hint = f"; в документе на этом месте: «{snippet}»"
                break
        return xml, False, f"якорь не найден: «{anchor}»{hint}"

    _, ti, oi = flat[pos + len(needle) - 1]
    start, end, full, text, rpr, simple = tokens[ti]  # type: ignore[misc]
    cut = oi + 1
    # Проскочить закрывающую » (вставка должна встать ПОСЛЕ кавычки).
    while cut < len(text) and (text[cut] == "»" or text[cut].isspace()):
        if text[cut] == "»":
            cut += 1
            break
        cut += 1

    if simple:
        attrs = ' xml:space="preserve"'
        before = '<w:r>%s<w:t%s>%s</w:t></w:r>' % (rpr, attrs, esc(text[:cut]))
        after = '<w:r>%s<w:t%s>%s</w:t></w:r>' % (rpr, attrs, esc(text[cut:])) if text[cut:] else ""
        return xml[:start] + before + new_runs + after + xml[end:], True, "вставлено после якоря"
    return xml[:end] + new_runs + xml[end:], True, "вставлено после рана"


# ─────────────────────────── операции с таблицами ───────────────────────────


def set_cell(cell: str, text: str, color: str = HIGHLIGHT_COLOR) -> tuple[str, int]:
    """Заменить текст ячейки.

    Ссылки на сноски из прежнего содержимого СОХРАНЯЮТСЯ (переносятся в конец
    ячейки), иначе сноска осталась бы «сиротой» — присутствовала в
    footnotes.xml, но исчезла из текста. Их число возвращается, чтобы
    оператору сообщить о необходимости проверить место ссылки.
    """
    tcpr = re.search(r"<w:tcPr>.*?</w:tcPr>", cell, re.S)
    refs = re.findall(r"<w:r\b[^>]*>(?:(?!</w:r>).)*?<w:footnoteReference[^>]*/>.*?</w:r>", cell, re.S)
    body = runs(text, color=color) + "".join(refs)
    return "<w:tc>%s<w:p>%s</w:p></w:tc>" % (tcpr.group(0) if tcpr else "", body), len(refs)


def set_row_number(row: str, num: int) -> str:
    """Переписать номер в первой ячейке, сохранив всё оформление."""
    cell = TC_RE.search(row)
    if not cell:
        return row
    first = {"done": False}

    def repl(m: re.Match[str]) -> str:
        attrs = re.match(r"<w:t(\s[^>]*)?>", m.group(0))
        a = (attrs.group(1) or "") if attrs else ""
        if not first["done"]:
            first["done"] = True
            return "<w:t%s>%s</w:t>" % (a, esc(str(num)))
        return "<w:t%s></w:t>" % a

    return row.replace(cell.group(0), WT_RE.sub(repl, cell.group(0)), 1)


def build_row(cells: list[str], color: str = HIGHLIGHT_COLOR) -> str:
    tcs = "".join("<w:tc><w:tcPr/><w:p>%s</w:p></w:tc>" % runs(c, color=color) for c in cells)
    return "<w:tr>%s</w:tr>" % tcs


def rebuild_table(table: str, rows: list[str]) -> str:
    first = table.find("<w:tr")
    prefix = table[:first] if first >= 0 else table
    suffix = "</w:tbl>" if table.endswith("</w:tbl>") else ""
    return prefix + "".join(rows) + suffix


def table_body(rows: list[str], name_col: int) -> tuple[list[str], int]:
    """Отделить шапку: строка, чья первая ячейка не число."""
    if not rows:
        return [], 0
    cells = row_cells(rows[0])
    first = visible_text(cells[0]) if cells else ""
    header = 0 if re.fullmatch(r"\d+", first) else 1
    return rows[header:], header


# ─────────────────────────── применение плана ───────────────────────────


@dataclass
class State:
    document: str
    footnotes: str | None
    numbering: str | None


@dataclass
class OpResult:
    op_id: str
    ok: bool
    message: str
    order_key: int = 0
    details: dict[str, Any] = field(default_factory=dict)


OP_TYPES = {
    "insert_after",
    "replace_point",
    "insert_point",
    "replace_footnote",
    "add_footnote",
    "replace_table_rows",
    "append_table_rows",
    "sort_table_alpha",
    "insert_table_row_alpha",
}

BIG = 10 ** 12


def _fail(op_id: str, msg: str) -> OpResult:
    return OpResult(op_id, False, msg, BIG)


def locate_replace_paragraph(state: State, op: dict[str, Any]) -> NumberedPara | None:
    """Найти абзац-цель БЕЗ угадывания.

    Термин — строго по имени (начало абзаца). Пункт — по номеру в пределах
    раздела/приложения. Искать по НОВОМУ тексту нельзя: на действующей
    редакции его ещё нет.
    """
    index = index_paragraphs(state.document, state.numbering)
    term = op.get("term")
    if term:
        want = re.sub(r"\s+", "", term).lower()
        for p in index:
            if re.sub(r"\s+", "", p.text).lower().startswith(want):
                return p
        return None
    point = op.get("point")
    if not point:
        return None
    from_offset = 0
    appendix = op.get("appendix")
    if appendix:
        heading = op.get("appendix_heading")
        if heading:
            want = re.sub(r"\s+", "", heading).lower()[:40]
            for p in index:
                if want in re.sub(r"\s+", "", p.text).lower():
                    from_offset = p.start
                    break
    found = find_by_number(index, point, from_offset)
    if found:
        return found
    want = norm_number(point).replace(".", r"\.")
    literal = re.compile(r"^\s*%s\.?(?!\d)" % want)
    for p in index:
        if p.start >= from_offset and literal.match(p.text):
            return p
    return None


def locate_point_insertion(state: State, point: str) -> tuple[NumberedPara, str] | None:
    """Место для нового пункта: перед пунктом X, либо после предыдущего.

    Поиск ведётся по всему документу в порядке следования. Привязку к номеру
    раздела не используем: короткие номера вроде «4» неоднозначны — такой же
    номер может встретиться в списке приложения ПОЗЖЕ цели и увести поиск.
    """
    index = index_paragraphs(state.document, state.numbering)
    exact = find_by_number(index, point, 0)
    if exact:
        return exact, "before"
    parts = [int(x) for x in norm_number(point).split(".") if x.isdigit()]
    if not parts:
        return None
    for prev in range(parts[-1] - 1, 0, -1):
        cand = ".".join(str(x) for x in parts[:-1] + [prev])
        found = find_by_number(index, cand, 0)
        if found:
            return found, "after"
    return None


def apply_operation(op: dict[str, Any], state: State, color: str) -> OpResult:
    op_id = str(op.get("id", "?"))
    kind = op.get("type")

    # ── вставка после якорной фразы ──
    if kind == "insert_after":
        anchor, payload = op.get("anchor"), op.get("payload")
        if not anchor or payload is None:
            return _fail(op_id, "нет якоря или текста")
        new_runs = runs(payload, color=color)
        fn_number = op.get("footnote")
        if fn_number:
            if not state.footnotes:
                return _fail(op_id, "в документе нет сносок")
            mapping = footnote_display_map(state.document)
            fid = mapping.get(int(fn_number))
            block = find_footnote(state.footnotes, fid) if fid is not None else None
            if block:
                xml, ok, _ = insert_after_anchor(block.inner, anchor, new_runs)
                if ok:
                    state.footnotes = state.footnotes[:block.start] + \
                        state.footnotes[block.start:].replace(block.inner, xml, 1)
                    pos = footnote_body_positions(state.document).get(int(fn_number), block.start)
                    return OpResult(op_id, True, f"сноска № {fn_number}: вставлено", pos)
            # Нумерация могла разойтись — ищем сноску по содержимому.
            for b in all_footnotes(state.footnotes):
                xml, ok, _ = insert_after_anchor(b.inner, anchor, new_runs)
                if ok:
                    state.footnotes = state.footnotes[:b.start] + \
                        state.footnotes[b.start:].replace(b.inner, xml, 1)
                    return OpResult(
                        op_id, True,
                        f"сноска № {fn_number}: вставлено (номер не совпал, найдено по содержимому id={b.ident})",
                        b.start,
                    )
            return _fail(op_id, f"сноска № {fn_number}: якорь «{anchor}» не найден")
        xml, ok, msg = insert_after_anchor(state.document, anchor, new_runs)
        if not ok:
            return _fail(op_id, msg)
        pos = xml.find(new_runs)
        state.document = xml
        return OpResult(op_id, True, "вставлено в текст", pos if pos >= 0 else 0)

    # ── изложить пункт/термин в новой редакции ──
    if kind == "replace_point":
        payload = op.get("payload")
        if payload is None:
            return _fail(op_id, "нет текста замены")
        para = locate_replace_paragraph(state, op)
        if not para:
            what = f"термин «{op['term']}»" if op.get("term") else f"пункт {op.get('point')}"
            return _fail(op_id, f"{what} не найден — правка неприменима к этой редакции")
        body = strip_leading_number(strip_outer_quotes(payload))
        new_runs = paragraph_runs(body, bool(op.get("term")), color)
        rebuilt, kept = replace_paragraph_runs(para.inner, new_runs)
        state.document = state.document[:para.start] + rebuilt + state.document[para.end:]
        msg = "пункт изложен в новой редакции"
        if kept:
            msg += f"; сохранено ссылок на сноски: {kept} — проверьте их место в пункте"
        return OpResult(op_id, True, msg, para.start)

    # ── добавить новый пункт (нумерация сдвигается автоматически) ──
    if kind == "insert_point":
        payload, point = op.get("payload"), op.get("point")
        if payload is None or not point:
            return _fail(op_id, "нет текста или номера нового пункта")
        loc = locate_point_insertion(state, point)
        if not loc:
            return _fail(op_id, f"не найдено место для нового пункта {point}")
        para, mode = loc
        body = strip_leading_number(strip_outer_quotes(payload))
        term_like = bool(re.search(r"\s[–—-]\s", body[:80]))
        new_para = "<w:p>%s%s</w:p>" % (extract_ppr(para.inner), paragraph_runs(body, term_like, color))
        at = para.start if mode == "before" else para.end
        state.document = state.document[:at] + new_para + state.document[at:]
        return OpResult(op_id, True, f"добавлен пункт {point} (последующие перенумеруются)", at)

    # ── изложить сноску заново ──
    if kind == "replace_footnote":
        payload, number = op.get("payload"), op.get("footnote")
        if payload is None or not number:
            return _fail(op_id, "нет текста или номера сноски")
        if not state.footnotes:
            return _fail(op_id, "в документе нет сносок")
        fid = footnote_display_map(state.document).get(int(number))
        block = find_footnote(state.footnotes, fid) if fid is not None else None
        if not block:
            return _fail(op_id, f"сноска № {number} не найдена")
        ref = re.search(r"<w:r\b[^>]*>.*?<w:footnoteRef\s*/>.*?</w:r>", block.inner, re.S)
        ppr = re.search(r"<w:pPr>.*?</w:pPr>", block.inner, re.S)
        rebuilt = "<w:p>%s%s%s</w:p>" % (
            ppr.group(0) if ppr else "",
            ref.group(0) if ref else "",
            runs(payload, color=color),
        )
        state.footnotes = state.footnotes[:block.start] + \
            state.footnotes[block.start:].replace(block.inner, rebuilt, 1)
        pos = footnote_body_positions(state.document).get(int(number), block.start)
        return OpResult(op_id, True, f"сноска № {number}: изложена в новой редакции", pos)

    # ── добавить новую сноску ──
    if kind == "add_footnote":
        payload, anchor = op.get("payload"), op.get("anchor")
        if payload is None or not anchor:
            return _fail(op_id, "нет якоря или текста сноски")
        if not state.footnotes:
            return _fail(op_id, "в документе нет блока сносок")
        new_id = max_footnote_id(state.footnotes) + 1
        rpr_m = re.search(r"<w:r\b[^>]*>(<w:rPr>.*?</w:rPr>)?(?:(?!</w:r>).)*?<w:footnoteReference", state.document, re.S)
        rpr = (rpr_m.group(1) or "") if rpr_m else '<w:rPr><w:rStyle w:val="af4"/><w:vertAlign w:val="superscript"/></w:rPr>'
        ref_run = '<w:r>%s<w:footnoteReference w:id="%d"/></w:r>' % (rpr, new_id)
        xml, ok, msg = insert_after_anchor(state.document, anchor, ref_run)
        if not ok:
            return _fail(op_id, f"сноска не добавлена — {msg}")
        state.document = xml
        element = (
            '<w:footnote w:id="%d"><w:p><w:pPr><w:pStyle w:val="af2"/><w:jc w:val="both"/></w:pPr>'
            '<w:r><w:rPr><w:rStyle w:val="af4"/></w:rPr><w:footnoteRef/></w:r>%s</w:p></w:footnote>'
        ) % (new_id, runs(" " + payload.strip(), color=color))
        state.footnotes = re.sub(r"</w:footnotes>\s*$", element + "</w:footnotes>", state.footnotes)
        pos = state.document.find('<w:footnoteReference w:id="%d"' % new_id)
        return OpResult(op_id, True, "добавлена сноска (последующие перенумеруются)", max(pos, 0))

    return _apply_table_operation(op, state, color)


def _apply_table_operation(op: dict[str, Any], state: State, color: str) -> OpResult:
    op_id = str(op.get("id", "?"))
    kind = op.get("type")
    appendix = str(op.get("appendix", "1"))
    name_col = int(op.get("name_column", 1))
    table = find_appendix_table(state.document, appendix)
    if not table:
        return _fail(op_id, f"таблица Приложения №{appendix} не найдена")
    rows = table_rows(table.inner)

    # ── заменить существующие строки ──
    if kind == "replace_table_rows":
        data = op.get("rows") or []
        if not data:
            return _fail(op_id, "нет данных строк для замены")
        cells_of = [row_cells(r) for r in rows]

        def row_number(i: int) -> int | None:
            t = visible_text(cells_of[i][0]) if cells_of[i] else ""
            return int(t) if re.fullmatch(r"\d+", t) else None

        def row_name(i: int) -> str:
            return visible_text(cells_of[i][name_col]) if len(cells_of[i]) > name_col else ""

        out = list(rows)
        taken: set[int] = set()
        replaced: list[dict[str, Any]] = []
        missing: list[dict[str, Any]] = []
        warnings: list[str] = []

        def apply_to(idx: int, new_cells: list[str], number: int, by_name: bool) -> None:
            cells = cells_of[idx]
            if len(new_cells) != len(cells):
                warnings.append(
                    "строка «%s»: столбцов в правке %d, в таблице %d"
                    % ((new_cells[name_col] if len(new_cells) > name_col else str(number)), len(new_cells), len(cells))
                )
            trpr = re.search(r"<w:trPr>.*?</w:trPr>", rows[idx], re.S)
            rebuilt: list[str] = []
            kept_refs = 0
            for i, c in enumerate(cells):
                if i == 0 or i >= len(new_cells):
                    rebuilt.append(c)
                    continue
                new_cell, refs = set_cell(c, new_cells[i], color)
                rebuilt.append(new_cell)
                kept_refs += refs
            if kept_refs:
                warnings.append(
                    "строка № %d: сохранено ссылок на сноски: %d — проверьте их место в ячейке"
                    % (number, kept_refs)
                )
            out[idx] = "<w:tr>%s%s</w:tr>" % (trpr.group(0) if trpr else "", "".join(rebuilt))
            taken.add(idx)
            replaced.append({
                "number": number,
                "name": new_cells[name_col] if len(new_cells) > name_col else "",
                "old_name": row_name(idx),
                "at_row": row_number(idx) or idx + 1,
                "by_name": by_name,
            })

        pending: list[tuple[int, list[str]]] = []
        # Проход 1 — по НАИМЕНОВАНИЮ (надёжная идентичность строки).
        for entry in data:
            new_cells = list(entry.get("cells") or [])
            number = int(entry.get("number") or 0)
            name = new_cells[name_col] if len(new_cells) > name_col else ""
            key = sort_key(name)
            idx = next((i for i in range(len(rows)) if i not in taken and key and sort_key(row_name(i)) == key), None)
            if idx is not None:
                apply_to(idx, new_cells, number, True)
            else:
                pending.append((number, new_cells))
        # Проход 2 — по номеру, но ТОЛЬКО если это та же компания.
        for number, new_cells in pending:
            name = new_cells[name_col] if len(new_cells) > name_col else ""
            idx = next((i for i in range(len(rows)) if i not in taken and row_number(i) == number), None)
            if idx is not None and names_compatible(name, row_name(idx)):
                apply_to(idx, new_cells, number, False)
            elif idx is not None:
                missing.append({"number": number, "name": name})
                warnings.append(
                    "«%s» не найдена по наименованию, а под № %d стоит другая компания («%s») — строка не изменена"
                    % (name[:40], number, row_name(idx)[:30])
                )
            else:
                missing.append({"number": number, "name": name})

        state.document = state.document[:table.start] + rebuild_table(table.inner, out) + state.document[table.end:]
        moved = [r for r in replaced if r["by_name"] and r["at_row"] != r["number"]]
        parts = [f"заменено строк: {len(replaced)}/{len(data)} в Приложении №{appendix}"]
        if moved:
            sample = ", ".join("%s №%s→№%s" % (m["name"][:24], m["number"], m["at_row"]) for m in moved[:4])
            parts.append(f"сопоставлено по наименованию (номер в правке отличается): {sample}"
                         + (f" и ещё {len(moved) - 4}" if len(moved) > 4 else ""))
        if missing:
            parts.append("не найдены: " + ", ".join(m["name"] or f"№{m['number']}" for m in missing))
        if warnings:
            parts.append("; ".join(warnings[:2]))
        return OpResult(op_id, len(replaced) > 0, "; ".join(parts), table.start,
                        {"replaced": replaced, "missing": missing, "warnings": warnings})

    # ── добавить строки в конец ──
    if kind == "append_table_rows":
        data = op.get("rows") or []
        if not data:
            return _fail(op_id, "нет строк для добавления")
        # Защита от дублей: в Оферте строка могла появиться прежней правкой.
        existing_names = {
            om_key
            for r in rows
            if (cells := row_cells(r)) and len(cells) > name_col
            and (om_key := sort_key(visible_text(cells[name_col])))
        }
        existing_numbers = {
            visible_text(cells[0]).strip()
            for r in rows if (cells := row_cells(r))
        }
        new_rows: list[str] = []
        skipped: list[str] = []
        for entry in data:
            cells_new = list(entry.get("cells") or [])
            name = cells_new[name_col] if len(cells_new) > name_col else ""
            number = (cells_new[0] or "").strip() if cells_new else ""
            key = sort_key(name)
            if (key and key in existing_names) or (number and number in existing_numbers):
                skipped.append(name or f"№{number}")
                continue
            new_rows.append(build_row(cells_new, color))
            if key:
                existing_names.add(key)
            if number:
                existing_numbers.add(number)
        if not new_rows:
            return OpResult(
                op_id, False,
                f"Приложение №{appendix}: все строки уже присутствуют — {'; '.join(skipped)}",
                table.start, {"skipped": skipped},
            )
        state.document = state.document[:table.start] + rebuild_table(table.inner, rows + new_rows) + \
            state.document[table.end:]
        msg = f"добавлено строк: {len(new_rows)} в Приложение №{appendix}"
        if skipped:
            msg += f"; пропущено (уже есть): {'; '.join(skipped)}"
        return OpResult(op_id, True, msg, table.start, {"skipped": skipped})

    # ── алфавитная пересортировка ──
    if kind == "sort_table_alpha":
        if has_real_vmerge(table.inner):
            return _fail(op_id, "в таблице есть объединённые по вертикали ячейки — сортировка выполняется вручную")
        body, header = table_body(rows, name_col)
        if len(body) < 2:
            return _fail(op_id, "в таблице недостаточно строк для сортировки")
        keyed = []
        for i, r in enumerate(body):
            cells = row_cells(r)
            name = visible_text(cells[name_col]) if len(cells) > name_col else ""
            keyed.append((sort_key(name), i, r, name))
        empty = sum(1 for k, _, _, _ in keyed if not k)
        ordered = sorted(keyed, key=lambda x: (x[0], x[1]))
        moves = [{"name": n, "from": i + 1, "to": pos + 1}
                 for pos, (_, i, _, n) in enumerate(ordered) if i != pos]
        new_body = [set_row_number(r, pos + 1) for pos, (_, _, r, _) in enumerate(ordered)]
        state.document = state.document[:table.start] + \
            rebuild_table(table.inner, rows[:header] + new_body) + state.document[table.end:]
        msg = (f"Приложение №{appendix}: уже в алфавитном порядке, нумерация проверена"
               if not moves else
               f"Приложение №{appendix}: отсортировано по алфавиту, перемещено строк: {len(moves)}")
        if empty:
            msg += f"; строк без наименования: {empty} — проверьте вручную"
        return OpResult(op_id, True, msg, table.start, {"moves": moves})

    # ── вставка строки по алфавиту ──
    if kind == "insert_table_row_alpha":
        data = op.get("rows") or []
        if not data:
            return _fail(op_id, "нет данных новой строки")
        body, header = table_body(rows, name_col)
        out = list(rows)
        inserted: list[str] = []
        skipped: list[str] = []
        for entry in data:
            cells = list(entry.get("cells") or [])
            name = cells[name_col] if len(cells) > name_col else ""
            if not name.strip():
                continue
            key = sort_key(name)
            current = out[header:]
            existing = next(
                ((i, visible_text(row_cells(r)[0]) if row_cells(r) else "")
                 for i, r in enumerate(current)
                 if len(row_cells(r)) > name_col and sort_key(visible_text(row_cells(r)[name_col])) == key),
                None,
            )
            if existing:
                skipped.append(f"{name} (уже есть, строка {existing[1]})")
                continue
            pos = len(current) + 1
            for i, r in enumerate(current):
                rc = row_cells(r)
                if len(rc) > name_col and sort_key(visible_text(rc[name_col])) > key:
                    pos = i + 1
                    break
            out.insert(header + pos - 1, build_row(cells, color))
            inserted.append(f"{name} → позиция {pos}")
        if not inserted:
            msg = ("Приложение №%s: пропущено — %s" % (appendix, "; ".join(skipped))) if skipped \
                else "не удалось определить наименование новой строки"
            return OpResult(op_id, False, msg, table.start, {"skipped": skipped})
        out = [r if i < header else set_row_number(r, i - header + 1) for i, r in enumerate(out)]
        state.document = state.document[:table.start] + rebuild_table(table.inner, out) + state.document[table.end:]
        msg = "Приложение №%s: добавлено по алфавиту (%s), нумерация обновлена" % (appendix, "; ".join(inserted))
        if skipped:
            msg += "; пропущено: " + "; ".join(skipped)
        return OpResult(op_id, True, msg, table.start, {"inserted": inserted, "skipped": skipped})

    return _fail(op_id, f"неизвестный тип операции: {kind}")


# ─────────────────────────── объединённый файл изменений ───────────────────────────


def build_combined_docx(out: Path, ops: list[dict[str, Any]], title: str) -> None:
    def para(text: str, bold: bool = False, size: int | None = None, center: bool = False) -> str:
        rpr = ""
        if bold or size:
            rpr = "<w:rPr>%s%s</w:rPr>" % ("<w:b/>" if bold else "", f'<w:sz w:val="{size}"/>' if size else "")
        ppr = '<w:pPr><w:jc w:val="center"/></w:pPr>' if center else ""
        return '<w:p>%s<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r></w:p>' % (ppr, rpr, esc(text))

    def table(rows: list[list[str]]) -> str:
        trs = "".join(
            "<w:tr>%s</w:tr>" % "".join(
                '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr><w:p><w:r>'
                '<w:t xml:space="preserve">%s</w:t></w:r></w:p></w:tc>' % esc(c) for c in r
            )
            for r in rows
        )
        return (
            '<w:tbl><w:tblPr><w:tblBorders>'
            + "".join('<w:%s w:val="single" w:sz="4" w:space="0" w:color="auto"/>' % s
                      for s in ("top", "left", "bottom", "right", "insideH", "insideV"))
            + "</w:tblBorders></w:tblPr>%s</w:tbl>" % trs
        )

    body = [para(title, bold=True, size=28, center=True),
            para("Объединённый перечень изменений (в порядке следования пунктов Оферты)", center=True),
            para("")]
    for i, op in enumerate(ops, 1):
        body.append(para(f"{i}. {op.get('raw_text') or op.get('description') or op.get('type', '')}"))
        rows = op.get("rows") or []
        cells = [list(r.get("cells") or []) for r in rows if r.get("cells")]
        if cells:
            body.append(table(cells))
        if op.get("source"):
            body.append(para(f"(источник: {op['source']})", size=18))
        body.append(para(""))

    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
        + "".join(body)
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument'
        '.wordprocessingml.document.main+xml"/></Types>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships'
        '/officeDocument" Target="word/document.xml"/></Relationships>'
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(out, "w", ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("word/document.xml", document)


# ─────────────────────────── команды ───────────────────────────


def cmd_extract(args: argparse.Namespace) -> int:
    """Выгрузить абзацы и таблицы документа «Изменения» для составления плана."""
    doc = Docx.load(Path(args.input))
    document = doc.document
    paragraphs = [visible_text(m.group(0)) for m in P_RE.finditer(document)]
    paragraphs = [p for p in paragraphs if p]
    tables: list[list[list[str]]] = []
    for tbl in re.finditer(r"<w:tbl>.*?</w:tbl>", document, re.S):
        rows = [[visible_text(c) for c in row_cells(r)] for r in table_rows(tbl.group(0))]
        tables.append(rows)
    payload = {
        "source": str(args.input),
        "sha256": sha256_of(Path(args.input)),
        "paragraphs": paragraphs,
        "tables": tables,
    }
    out = json.dumps(payload, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(out, encoding="utf-8")
        print(json.dumps({"ok": True, "paragraphs": len(paragraphs), "tables": len(tables),
                          "out": args.out}, ensure_ascii=False))
    else:
        print(out)
    return 0


def cmd_inspect(args: argparse.Namespace) -> int:
    """Показать структуру Оферты: сноски, нумерованные пункты, таблицы приложений."""
    doc = Docx.load(Path(args.input))
    index = index_paragraphs(doc.document, doc.numbering)
    numbered = [{"number": p.number, "text": p.text[:90]} for p in index if p.number]
    result: dict[str, Any] = {
        "sha256": sha256_of(Path(args.input)),
        "footnotes_in_body": len(footnote_display_map(doc.document)),
        "numbered_paragraphs": len(numbered),
    }
    if args.appendix:
        table = find_appendix_table(doc.document, args.appendix)
        if table:
            rows = table_rows(table.inner)
            body, header = table_body(rows, args.name_column)
            listed = []
            for r in body:
                cells = row_cells(r)
                listed.append({
                    "number": visible_text(cells[0]) if cells else "",
                    "name": visible_text(cells[args.name_column]) if len(cells) > args.name_column else "",
                })
            result["appendix"] = {
                "number": args.appendix,
                "rows": len(body),
                "has_header": bool(header),
                "real_vmerge": has_real_vmerge(table.inner),
                "items": listed if args.full else listed[:15],
            }
    if args.point:
        # Точечная проверка: существует ли пункт и что в нём.
        found = find_by_number(index, args.point, 0)
        result["point_lookup"] = {
            "requested": args.point,
            "found": bool(found),
            "text": found.text[:200] if found else None,
        }
    if args.points:
        shown = numbered if args.full else numbered[:40]
        result["points"] = shown
        if len(shown) < len(numbered):
            # ЯВНО сообщаем об усечении: иначе легко заключить, что пункта нет.
            result["points_truncated"] = {
                "shown": len(shown),
                "total": len(numbered),
                "hint": "показана часть списка; используйте --full или --point <номер>",
            }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def validate_plan(plan: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    ops = plan.get("operations")
    if not isinstance(ops, list) or not ops:
        return ["план должен содержать непустой массив operations"]
    seen: set[str] = set()
    for i, op in enumerate(ops):
        where = f"operations[{i}]"
        if not isinstance(op, dict):
            errors.append(f"{where}: операция должна быть объектом")
            continue
        op_id = op.get("id")
        if not op_id or not isinstance(op_id, str):
            errors.append(f"{where}: нужен строковый id")
        elif op_id in seen:
            errors.append(f"{where}: повторяющийся id «{op_id}»")
        else:
            seen.add(op_id)
        kind = op.get("type")
        if kind not in OP_TYPES:
            errors.append(f"{where}: неизвестный type «{kind}»; допустимы: {', '.join(sorted(OP_TYPES))}")
            continue
        if not op.get("raw_text"):
            errors.append(f"{where}: нужен raw_text — дословная формулировка из документа «Изменения»")
        if kind in {"insert_after", "add_footnote"} and not op.get("anchor"):
            errors.append(f"{where}: для {kind} обязателен anchor")
        if kind in {"insert_after", "replace_point", "insert_point", "replace_footnote", "add_footnote"} \
                and op.get("payload") is None:
            errors.append(f"{where}: для {kind} обязателен payload")
        if kind in {"replace_point"} and not (op.get("point") or op.get("term")):
            errors.append(f"{where}: для replace_point нужен point или term")
        if kind == "insert_point" and not op.get("point"):
            errors.append(f"{where}: для insert_point обязателен point")
        if kind in {"replace_footnote"} and not op.get("footnote"):
            errors.append(f"{where}: для replace_footnote обязателен номер footnote")
        if kind in {"replace_table_rows", "append_table_rows", "insert_table_row_alpha"}:
            rows = op.get("rows")
            if not isinstance(rows, list) or not rows:
                errors.append(f"{where}: для {kind} обязателен непустой rows")
            else:
                for j, r in enumerate(rows):
                    if not isinstance(r, dict) or not isinstance(r.get("cells"), list) or not r["cells"]:
                        errors.append(f"{where}.rows[{j}]: нужен объект с непустым массивом cells")
        if kind in {"replace_table_rows", "append_table_rows", "sort_table_alpha", "insert_table_row_alpha"} \
                and not op.get("appendix"):
            errors.append(f"{where}: для {kind} обязателен appendix")
    return errors


def cmd_validate_plan(args: argparse.Namespace) -> int:
    plan = json.loads(Path(args.plan).read_text(encoding="utf-8"))
    errors = validate_plan(plan)
    if errors:
        print(json.dumps({"ok": False, "errors": errors}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps({"ok": True, "operations": len(plan["operations"])}, ensure_ascii=False))
    return 0


def snapshot_appendix(document: str, numbering: str | None, appendix: str, name_col: int) -> dict[str, Any]:
    table = find_appendix_table(document, appendix)
    if not table:
        return {"present": False}
    rows = table_rows(table.inner)
    body, header = table_body(rows, name_col)
    items = []
    for r in body:
        cells = row_cells(r)
        items.append({
            "number": visible_text(cells[0]) if cells else "",
            "name": visible_text(cells[name_col]) if len(cells) > name_col else "",
        })
    keys = sorted(sort_key(i["name"]) for i in items if i["name"])
    actual = [sort_key(i["name"]) for i in items if i["name"]]
    return {
        "present": True,
        "rows": len(body),
        "numbering_sequential": [i["number"] for i in items] == [str(k + 1) for k in range(len(items))],
        "alphabetical": actual == keys,
        "keys": actual,
    }


def cmd_apply(args: argparse.Namespace) -> int:
    offer_path = Path(args.offer)
    plan_path = Path(args.plan)
    out_offer = Path(args.out_offer)
    out_combined = Path(args.out_combined) if args.out_combined else None
    report_path = Path(args.report) if args.report else None

    for target in [p for p in (out_offer, out_combined, report_path) if p]:
        if target.resolve() == offer_path.resolve():
            raise SystemExit("результат не может совпадать с исходной Офертой")

    input_hash = sha256_of(offer_path)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    errors = validate_plan(plan)
    if errors:
        print(json.dumps({"ok": False, "stage": "validate", "errors": errors}, ensure_ascii=False, indent=2))
        return 1

    doc = Docx.load(offer_path)
    state = State(doc.document, doc.footnotes, doc.numbering)
    ops: list[dict[str, Any]] = plan["operations"]
    appendices = sorted({str(o.get("appendix")) for o in ops if o.get("appendix")})
    name_col = int(plan.get("name_column", 1))
    before = {a: snapshot_appendix(state.document, state.numbering, a, name_col) for a in appendices}

    # Порядок применения: сначала обычные правки СНИЗУ ВВЕРХ (чтобы вставка
    # пункта/сноски не сдвигала нумерацию ещё не применённых правок выше по
    # тексту), затем нормализующие операции — они приводят таблицу в порядок
    # уже ПОСЛЕ всех замен и добавлений строк.
    keyed = []
    for op in ops:
        probe = State(state.document, state.footnotes, state.numbering)
        keyed.append((apply_operation(dict(op), probe, args.color).order_key, op))
    ordered = [op for _, op in sorted(keyed, key=lambda x: x[0])]
    normalizing = [o for o in ordered if o.get("type") == "sort_table_alpha"]
    regular = [o for o in ordered if o.get("type") != "sort_table_alpha"]
    sequence = list(reversed(regular)) + list(reversed(normalizing))

    results: dict[str, OpResult] = {}
    for op in sequence:
        res = apply_operation(dict(op), state, args.color)
        results[res.op_id] = res

    ordered_results = [results[str(o.get("id"))] for o in ordered if str(o.get("id")) in results]
    applied = [r for r in ordered_results if r.ok]
    failed = [r for r in ordered_results if not r.ok]

    if not xml_balanced(state.document) or (state.footnotes and not xml_balanced(state.footnotes)):
        print(json.dumps({"ok": False, "stage": "audit", "error": "XML результата нарушен"}, ensure_ascii=False))
        return 1

    updated = {DOCUMENT_PART: state.document}
    if state.footnotes is not None:
        updated[FOOTNOTES_PART] = state.footnotes
    doc.save(out_offer, updated)

    if out_combined:
        build_combined_docx(out_combined, [o for o in ordered if str(o.get("id")) in {r.op_id for r in applied}],
                            plan.get("title", "ИЗМЕНЕНИЯ в Публичную оферту «Удобный доступ»"))

    after = {a: snapshot_appendix(state.document, state.numbering, a, name_col) for a in appendices}
    # Какие записи были заменены НАМЕРЕННО (их прежнее наименование исчезает
    # по замыслу правки) и для каких приложений запрошена сортировка.
    replaced_keys: dict[str, set[str]] = {a: set() for a in appendices}
    sorted_appendices = {str(o.get("appendix")) for o in ops if o.get("type") == "sort_table_alpha"}
    for op in ops:
        a = str(op.get("appendix") or "")
        res = results.get(str(op.get("id")))
        if a in replaced_keys and res is not None:
            for r in res.details.get("replaced", []):
                if r.get("old_name"):
                    replaced_keys[a].add(sort_key(r["old_name"]))

    invariants: list[dict[str, Any]] = []
    for a in appendices:
        b, af = before[a], after[a]
        if not b.get("present") or not af.get("present"):
            continue
        gone = set(b.get("keys") or []) - set(af.get("keys") or [])
        lost = sorted(gone - replaced_keys.get(a, set()))
        invariants.append({
            "appendix": a,
            "rows_before": b["rows"],
            "rows_after": af["rows"],
            "lost_entries": lost,
            "replaced_entries": len(gone & replaced_keys.get(a, set())),
            "numbering_sequential": af["numbering_sequential"],
            "alphabetical": af["alphabetical"] if a in sorted_appendices else None,
        })

    if sha256_of(offer_path) != input_hash:
        print(json.dumps({"ok": False, "stage": "audit", "error": "исходная Оферта изменилась"}, ensure_ascii=False))
        return 1

    report = {
        "ok": len(failed) == 0,
        "input": str(offer_path),
        "input_sha256": input_hash,
        "output_offer": str(out_offer),
        "output_combined": str(out_combined) if out_combined else None,
        "operations": len(ops),
        "applied": len(applied),
        "failed": len(failed),
        "results": [{"id": r.op_id, "ok": r.ok, "message": r.message} for r in ordered_results],
        "appendix_invariants": invariants,
    }
    if report_path:
        lines = ["# Отчёт о внесении изменений в Оферту", "",
                 f"- Исходный файл: `{offer_path}` (SHA-256 `{input_hash}`)",
                 f"- Оферта с изменениями: `{out_offer}`"]
        if out_combined:
            lines.append(f"- Объединённый файл изменений: `{out_combined}`")
        lines += ["", f"Применено операций: **{len(applied)} из {len(ops)}**.", "", "## Операции", ""]
        for r in ordered_results:
            lines.append(f"- {'✅' if r.ok else '❌'} {r.message}")
        if invariants:
            lines += ["", "## Инварианты приложений", ""]
            for inv in invariants:
                lines.append(
                    f"- Приложение №{inv['appendix']}: строк {inv['rows_before']}→{inv['rows_after']}, "
                    f"утрачено записей {len(inv['lost_entries'])}, "
                    f"нумерация подряд: {'да' if inv['numbering_sequential'] else 'НЕТ'}, "
                    f"алфавитный порядок: "
                    + ("не требуется" if inv["alphabetical"] is None else ("да" if inv["alphabetical"] else "НЕТ"))
                )
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if len(failed) == 0 else 2


def cmd_audit(args: argparse.Namespace) -> int:
    """Независимая проверка результата: структура и инварианты приложений.

    Вердикт `ok` включает ВСЕ содержательные проверки, а не только булевы:
    уменьшение числа сносок или разрыв нумерации приложения — это провал,
    даже если XML формально цел.
    """
    result = Docx.load(Path(args.result))
    footnotes_in_body = len(footnote_display_map(result.document))
    checks: dict[str, Any] = {
        "document_xml_balanced": xml_balanced(result.document),
        "footnotes_xml_balanced": xml_balanced(result.footnotes) if result.footnotes else True,
        "footnotes_in_body": footnotes_in_body,
    }
    failures: list[str] = []
    if not checks["document_xml_balanced"]:
        failures.append("XML документа нарушен")
    if not checks["footnotes_xml_balanced"]:
        failures.append("XML сносок нарушен")

    if args.offer:
        source = Docx.load(Path(args.offer))
        missing = [n for n in source.names if n not in result.parts]
        before = len(footnote_display_map(source.document))
        delta = footnotes_in_body - before
        checks["source_parts_preserved"] = not missing
        checks["missing_parts"] = missing
        checks["footnotes_before"] = before
        checks["footnotes_added"] = delta
        checks["footnotes_not_lost"] = delta >= 0
        if missing:
            failures.append(f"утрачены части пакета: {', '.join(missing)}")
        if delta < 0:
            failures.append(
                f"число сносок в тексте уменьшилось на {-delta} "
                f"({before} → {footnotes_in_body}): ссылки потеряны, нумерация сносок сдвинулась"
            )

    if args.appendix:
        snap = snapshot_appendix(result.document, result.numbering, args.appendix, args.name_column)
        checks["appendix"] = {k: v for k, v in snap.items() if k != "keys"}
        if snap.get("present"):
            keys = [k for k in (snap.get("keys") or []) if k]
            duplicates = sorted({k for k in keys if keys.count(k) > 1})
            checks["appendix"]["duplicate_entries"] = duplicates
            if duplicates:
                failures.append(
                    "в Приложении №%s повторяются записи: %s" % (args.appendix, ", ".join(duplicates[:5]))
                )
            if not snap.get("numbering_sequential"):
                failures.append(f"нумерация Приложения №{args.appendix} не является непрерывной")

    ok = not failures
    print(json.dumps({"ok": ok, "failures": failures, "checks": checks}, ensure_ascii=False, indent=2))
    return 0 if ok else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    ex = sub.add_parser("extract", help="выгрузить абзацы и таблицы документа «Изменения»")
    ex.add_argument("input")
    ex.add_argument("--out")
    ex.set_defaults(func=cmd_extract)

    ins = sub.add_parser("inspect", help="структура Оферты: сноски, пункты, таблицы приложений")
    ins.add_argument("input")
    ins.add_argument("--appendix")
    ins.add_argument("--name-column", type=int, default=1)
    ins.add_argument("--points", action="store_true")
    ins.add_argument("--point", help="проверить конкретный номер пункта, напр. 7.6")
    ins.add_argument("--full", action="store_true")
    ins.set_defaults(func=cmd_inspect)

    vp = sub.add_parser("validate-plan", help="проверить план операций")
    vp.add_argument("plan")
    vp.set_defaults(func=cmd_validate_plan)

    ap = sub.add_parser("apply", help="применить план и собрать оба файла")
    ap.add_argument("offer")
    ap.add_argument("plan")
    ap.add_argument("--out-offer", required=True)
    ap.add_argument("--out-combined")
    ap.add_argument("--report")
    ap.add_argument("--color", default=HIGHLIGHT_COLOR)
    ap.set_defaults(func=cmd_apply)

    au = sub.add_parser("audit", help="независимая проверка результата")
    au.add_argument("result")
    au.add_argument("--offer")
    au.add_argument("--appendix")
    au.add_argument("--name-column", type=int, default=1)
    au.set_defaults(func=cmd_audit)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
