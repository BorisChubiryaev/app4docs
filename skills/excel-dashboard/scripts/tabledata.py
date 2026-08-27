#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Чтение xlsx/csv без сторонних библиотек и профилирование колонок.

Задача скрипта — превратить произвольный файл пользователя в один
нормализованный JSON, на который дальше опирается сборка дашборда, и показать
агенту профиль данных, чтобы тот выбирал графики по фактам, а не наугад.

Команды:
  sheets  <file>                     — список листов книги
  profile <file> [--sheet S] [--out data.json] [--header-row N] [--max-rows N]
  derive  <data.json> --name "Маржа, %" --expr "Прибыль / Выручка * 100"
"""
from __future__ import annotations

import argparse
import ast
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import zipfile
from xml.etree import ElementTree as ET

NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
NS_REL_DOC = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
NS_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"

# ── общие утилиты ─────────────────────────────────────────────────────────────

def die(msg: str) -> None:
    print(json.dumps({"error": msg}, ensure_ascii=False))
    sys.exit(1)


def col_index(ref: str) -> int:
    """A1 -> 0, B7 -> 1, AA3 -> 26."""
    n = 0
    for ch in ref:
        if ch.isalpha():
            n = n * 26 + (ord(ch.upper()) - 64)
        else:
            break
    return n - 1


def excel_serial_to_date(value: float, date1904: bool = False):
    """Серийная дата Excel -> datetime. Учитывает мифическое 29.02.1900."""
    base = dt.datetime(1904, 1, 1) if date1904 else dt.datetime(1899, 12, 30)
    try:
        return base + dt.timedelta(days=float(value))
    except (OverflowError, ValueError):
        return None


def iso(d: dt.datetime) -> str:
    if d.hour or d.minute or d.second:
        return d.strftime("%Y-%m-%dT%H:%M:%S")
    return d.strftime("%Y-%m-%d")


# ── xlsx ──────────────────────────────────────────────────────────────────────

DATE_FMT_IDS = set(range(14, 23)) | {27, 30, 36, 45, 46, 47, 50, 57, 58} | set(range(59, 82))


def _shared_strings(z: zipfile.ZipFile) -> list[str]:
    try:
        raw = z.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    out: list[str] = []
    root = ET.fromstring(raw)
    for si in root.findall(f"{NS_MAIN}si"):
        # <si> может состоять из нескольких <r><t>, склеиваем без разделителей:
        # разбиение на раны — особенность форматирования, а не текста.
        parts = [t.text or "" for t in si.iter(f"{NS_MAIN}t")]
        out.append("".join(parts))
    return out


def _date_styles(z: zipfile.ZipFile) -> set[int]:
    """Индексы стилей (s="…"), которые означают дату/время."""
    try:
        root = ET.fromstring(z.read("xl/styles.xml"))
    except KeyError:
        return set()
    custom_date: set[int] = set()
    numfmts = root.find(f"{NS_MAIN}numFmts")
    if numfmts is not None:
        for nf in numfmts.findall(f"{NS_MAIN}numFmt"):
            code = (nf.get("formatCode") or "").lower()
            code = re.sub(r"\[[^\]]*\]", "", code)
            code = re.sub(r'"[^"]*"', "", code)
            if re.search(r"[ymdhs]", code) and "e" not in code.replace("e+", ""):
                custom_date.add(int(nf.get("numFmtId")))
    styles: set[int] = set()
    xfs = root.find(f"{NS_MAIN}cellXfs")
    if xfs is not None:
        for i, xf in enumerate(xfs.findall(f"{NS_MAIN}xf")):
            fid = int(xf.get("numFmtId") or 0)
            if fid in DATE_FMT_IDS or fid in custom_date:
                styles.add(i)
    return styles


def _sheet_list(z: zipfile.ZipFile) -> list[tuple[str, str]]:
    """[(имя листа, путь к xml)] в порядке книги."""
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels_raw = z.read("xl/_rels/workbook.xml.rels")
    rels = {
        r.get("Id"): r.get("Target")
        for r in ET.fromstring(rels_raw).findall(f"{NS_PKG_REL}Relationship")
    }
    out = []
    sheets = wb.find(f"{NS_MAIN}sheets")
    for sh in (sheets or []):
        target = rels.get(sh.get(f"{NS_REL_DOC}id"), "")
        if target.startswith("/"):
            path = target.lstrip("/")
        else:
            path = "xl/" + target.replace("../", "")
        out.append((sh.get("name") or "", path))
    return out


def _is_1904(z: zipfile.ZipFile) -> bool:
    try:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
    except KeyError:
        return False
    pr = wb.find(f"{NS_MAIN}workbookPr")
    return bool(pr is not None and pr.get("date1904") in ("1", "true"))


def read_xlsx(path: str, sheet: str | None, max_rows: int | None):
    with zipfile.ZipFile(path) as z:
        sheets = _sheet_list(z)
        if not sheets:
            die("в книге нет листов")
        chosen = sheets[0]
        if sheet:
            for s in sheets:
                if s[0] == sheet or s[0].lower() == sheet.lower():
                    chosen = s
                    break
            else:
                if sheet.isdigit() and 1 <= int(sheet) <= len(sheets):
                    chosen = sheets[int(sheet) - 1]
                else:
                    die("лист «%s» не найден; есть: %s" % (sheet, ", ".join(s[0] for s in sheets)))
        strings = _shared_strings(z)
        date_styles = _date_styles(z)
        d1904 = _is_1904(z)
        rows: list[list] = []
        # Итеративный разбор: большие листы не должны съедать память целиком.
        with z.open(chosen[1]) as fh:
            for _, el in ET.iterparse(fh, events=("end",)):
                if el.tag != f"{NS_MAIN}row":
                    continue
                cells: dict[int, object] = {}
                for c in el.findall(f"{NS_MAIN}c"):
                    idx = col_index(c.get("r") or "")
                    if idx < 0:
                        continue
                    cells[idx] = _cell_value(c, strings, date_styles, d1904)
                width = (max(cells) + 1) if cells else 0
                rows.append([cells.get(i) for i in range(width)])
                el.clear()
                if max_rows and len(rows) > max_rows + 5:
                    break
        return chosen[0], rows, [s[0] for s in sheets]


def _cell_value(c, strings, date_styles, d1904):
    t = c.get("t")
    if t == "inlineStr":
        return "".join(x.text or "" for x in c.iter(f"{NS_MAIN}t")) or None
    v = c.find(f"{NS_MAIN}v")
    if v is None or v.text is None:
        return None
    raw = v.text
    if t == "s":
        i = int(raw)
        return strings[i] if 0 <= i < len(strings) else None
    if t == "b":
        return raw == "1"
    if t in ("str", "e"):
        return raw
    try:
        num = float(raw)
    except ValueError:
        return raw
    s_idx = c.get("s")
    if s_idx is not None and int(s_idx) in date_styles:
        d = excel_serial_to_date(num, d1904)
        if d:
            return iso(d)
    return int(num) if num.is_integer() and abs(num) < 1e15 else num


# ── csv ───────────────────────────────────────────────────────────────────────

def sniff_delimiter(sample: str) -> str:
    """Разделитель — тот, что даёт СТАБИЛЬНОЕ число колонок на всех строках.

    csv.Sniffer здесь ненадёжен: запятая внутри заголовка («Время решения, ч»)
    легко перевешивает настоящий «;». Стабильность разбиения — признак куда
    более надёжный, чем частота символа.
    """
    lines = [ln for ln in sample.splitlines() if ln.strip()][:20]
    if not lines:
        return ","
    best, best_score = ",", (-1, 0)
    for cand in (";", ",", "\t", "|"):
        counts = [len(r) for r in csv.reader(lines, delimiter=cand)]
        if not counts:
            continue
        mode = max(set(counts), key=counts.count)
        if mode < 2:
            continue
        score = (counts.count(mode) / len(counts), mode)
        if score > best_score:
            best_score, best = score, cand
    return best


def read_csv(path: str, max_rows: int | None):
    with open(path, "rb") as fh:
        head = fh.read(65536)
    encoding = "utf-8-sig"
    for enc in ("utf-8-sig", "cp1251", "utf-16"):
        try:
            head.decode(enc)
            encoding = enc
            break
        except UnicodeDecodeError:
            continue
    text = open(path, encoding=encoding, errors="replace").read()
    delim = sniff_delimiter(text[:16384])
    rows = []
    for r in csv.reader(io.StringIO(text), delimiter=delim):
        rows.append([(x if x != "" else None) for x in r])
        if max_rows and len(rows) > max_rows + 5:
            break
    return os.path.basename(path), rows, []


# ── разбор значений и типизация ───────────────────────────────────────────────

NUM_RE = re.compile(r"^[-+]?(\d[\d  ']*)(?:[.,]\d+)?%?$")
DATE_PATTERNS = (
    ("%Y-%m-%d", re.compile(r"^\d{4}-\d{2}-\d{2}$")),
    ("%d.%m.%Y", re.compile(r"^\d{2}\.\d{2}\.\d{4}$")),
    ("%d/%m/%Y", re.compile(r"^\d{2}/\d{2}/\d{4}$")),
    ("%Y/%m/%d", re.compile(r"^\d{4}/\d{2}/\d{2}$")),
    ("%d.%m.%y", re.compile(r"^\d{2}\.\d{2}\.\d{2}$")),
    ("%Y-%m-%dT%H:%M:%S", re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")),
    ("%Y-%m-%d %H:%M:%S", re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$")),
    ("%d.%m.%Y %H:%M", re.compile(r"^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}$")),
)
MONTHS_RU = {
    "янв": 1, "фев": 2, "мар": 3, "апр": 4, "май": 5, "мая": 5, "июн": 6,
    "июл": 7, "авг": 8, "сен": 9, "окт": 10, "ноя": 11, "дек": 12,
}


def parse_scalar(value):
    """Строку из csv/ячейки привести к числу/дате/булеву, если это оно и есть."""
    if value is None or isinstance(value, (int, float, bool)):
        return value
    s = str(value).strip()
    if not s:
        return None
    low = s.lower()
    if low in ("да", "true", "истина", "yes"):
        return True
    if low in ("нет", "false", "ложь", "no"):
        return False
    for fmt, rx in DATE_PATTERNS:
        if rx.match(s):
            try:
                return iso(dt.datetime.strptime(s[: len(fmt) + 6].strip(), fmt))
            except ValueError:
                break
    m = re.match(r"^(\d{1,2})\s+([а-яё]{3})[а-яё.]*\s+(\d{4})$", low)
    if m and m.group(2) in MONTHS_RU:
        try:
            return iso(dt.datetime(int(m.group(3)), MONTHS_RU[m.group(2)], int(m.group(1))))
        except ValueError:
            pass
    if NUM_RE.match(s):
        cleaned = s.replace(" ", "").replace(" ", "").replace("'", "")
        pct = cleaned.endswith("%")
        cleaned = cleaned.rstrip("%")
        if cleaned.count(",") == 1 and cleaned.count(".") == 0:
            cleaned = cleaned.replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
        try:
            num = float(cleaned)
        except ValueError:
            return s
        if pct:
            num = num / 100.0
        return int(num) if num.is_integer() and abs(num) < 1e15 else num
    return s


def classify(values: list) -> str:
    """Тип колонки по фактическим значениям, а не по имени."""
    kinds = {"number": 0, "date": 0, "bool": 0, "string": 0}
    for v in values:
        if v is None:
            continue
        if isinstance(v, bool):
            kinds["bool"] += 1
        elif isinstance(v, (int, float)):
            kinds["number"] += 1
        elif isinstance(v, str) and re.match(r"^\d{4}-\d{2}-\d{2}", v):
            kinds["date"] += 1
        else:
            kinds["string"] += 1
    total = sum(kinds.values())
    if total == 0:
        return "empty"
    # Одиночные примеси («н/д» в числовой колонке) не должны ломать тип.
    for kind in ("date", "number", "bool"):
        if kinds[kind] / total >= 0.9:
            return kind
    return "string"


def build_dataset(name: str, raw_rows: list[list], header_row: int | None, max_rows: int | None):
    rows = [r for r in raw_rows if any(x is not None and str(x).strip() != "" for x in r)]
    if not rows:
        die("в файле нет данных")
    hidx = (header_row - 1) if header_row else 0
    if header_row is None:
        # Шапка — первая строка, где значений больше, чем в среднем пусто,
        # и где нет чисел (заголовки почти всегда текстовые).
        for i, r in enumerate(rows[:10]):
            filled = [x for x in r if x not in (None, "")]
            if len(filled) >= max(2, len(r) * 0.6) and all(
                not isinstance(parse_scalar(x), (int, float)) or isinstance(parse_scalar(x), bool)
                for x in filled
            ):
                hidx = i
                break
    header = rows[hidx]
    width = max(len(r) for r in rows[hidx:])
    names: list[str] = []
    seen: dict[str, int] = {}
    for i in range(width):
        raw = header[i] if i < len(header) else None
        nm = str(raw).strip() if raw not in (None, "") else "Колонка %d" % (i + 1)
        nm = re.sub(r"\s+", " ", nm)
        if nm in seen:
            seen[nm] += 1
            nm = "%s (%d)" % (nm, seen[nm])
        else:
            seen[nm] = 1
        names.append(nm)

    body = []
    for r in rows[hidx + 1:]:
        row = [parse_scalar(r[i]) if i < len(r) else None for i in range(width)]
        if all(v is None for v in row):
            continue
        body.append(row)
        if max_rows and len(body) >= max_rows:
            break

    columns = []
    for i, nm in enumerate(names):
        col = [row[i] for row in body]
        kind = classify(col)
        present = [v for v in col if v is not None]
        info = {
            "name": nm,
            "index": i,
            "type": kind,
            "missing": len(col) - len(present),
            "unique": len({str(v) for v in present}),
        }
        if kind == "number":
            nums = [v for v in present if isinstance(v, (int, float)) and not isinstance(v, bool)]
            if nums:
                nums_sorted = sorted(nums)
                info["min"] = nums_sorted[0]
                info["max"] = nums_sorted[-1]
                info["sum"] = round(sum(nums), 6)
                info["mean"] = round(sum(nums) / len(nums), 6)
                info["median"] = nums_sorted[len(nums_sorted) // 2]
        elif kind == "date":
            ds = sorted(str(v) for v in present)
            info["min"], info["max"] = ds[0], ds[-1]
        counts: dict[str, int] = {}
        for v in present:
            k = str(v)
            counts[k] = counts.get(k, 0) + 1
        # Топ значений нужен, чтобы выбрать разрезы; для колонок-идентификаторов
        # он бесполезен и только раздувает вывод.
        if info["unique"] <= 50:
            top = sorted(counts.items(), key=lambda kv: -kv[1])[:8]
            info["top_values"] = [{"value": k, "count": n} for k, n in top]
        # Подсказка для выбора графиков: что это — измерение, мера или ключ.
        # «Ключ» — это сплошь уникальные целые или строки; дробные величины
        # тоже почти всегда уникальны, но это меры, а не идентификаторы.
        all_int = kind == "string" or all(
            isinstance(v, int) and not isinstance(v, bool) for v in present
        )
        if present and all_int and info["unique"] == len(present) and info["unique"] > 20:
            info["role"] = "id"
        elif kind in ("string", "bool") and info["unique"] <= max(30, len(body) * 0.2):
            info["role"] = "dimension"
        elif kind == "date":
            info["role"] = "time"
        elif kind == "number":
            info["role"] = "measure" if info["unique"] > 10 else "dimension?"
        else:
            info["role"] = "text"
        columns.append(info)

    return {"source": name, "row_count": len(body), "columns": columns, "rows": body}


# ── вычисляемые колонки ───────────────────────────────────────────────────────

SAFE_FUNCS = {"abs": abs, "round": round, "min": min, "max": max, "int": int, "float": float}
SAFE_NODES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Load,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
    ast.USub, ast.UAdd, ast.Call, ast.IfExp, ast.Compare,
    ast.Lt, ast.LtE, ast.Gt, ast.GtE, ast.Eq, ast.NotEq,
    ast.BoolOp, ast.And, ast.Or,
)


def compile_expr(expr: str, names: list[str]):
    """Скомпилировать арифметику над колонками.

    Только выражения: имена колонок, числа, арифметика, сравнения и несколько
    безопасных функций. Никаких импортов и атрибутов — данные пользователя не
    повод исполнять произвольный код.
    """
    # Имена с пробелами и знаками («Время решения, ч») нельзя записать
    # идентификатором, поэтому заменяем их на плейсхолдеры до разбора.
    mapping = {}
    prepared = expr
    for i, nm in enumerate(sorted(names, key=len, reverse=True)):
        ph = "_c%d" % i
        if nm in prepared:
            prepared = prepared.replace(nm, ph)
            mapping[ph] = nm
    tree = ast.parse(prepared, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, SAFE_NODES):
            raise ValueError("в выражении недопустима конструкция %s" % type(node).__name__)
        if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name)
                                           or node.func.id not in SAFE_FUNCS):
            raise ValueError("разрешены только функции: %s" % ", ".join(sorted(SAFE_FUNCS)))
        if isinstance(node, ast.Name) and node.id not in mapping and node.id not in SAFE_FUNCS:
            raise ValueError("неизвестное имя «%s» — проверьте название колонки" % node.id)
    return compile(tree, "<expr>", "eval"), mapping


def cmd_derive(args):
    ds = json.load(open(args.file, encoding="utf-8"))
    names = [c["name"] for c in ds["columns"]]
    if args.name in names:
        die("колонка «%s» уже есть" % args.name)
    try:
        code, mapping = compile_expr(args.expr, names)
    except (ValueError, SyntaxError) as exc:
        die("выражение отклонено: %s" % exc)
    pos = {c["name"]: c["index"] for c in ds["columns"]}
    failed = 0
    for row in ds["rows"]:
        env = dict(SAFE_FUNCS)
        for ph, nm in mapping.items():
            env[ph] = row[pos[nm]]
        try:
            v = eval(code, {"__builtins__": {}}, env)  # noqa: S307 — выражение проверено выше
            v = None if isinstance(v, bool) or not isinstance(v, (int, float)) else round(float(v), 6)
            if v is not None and v != v:  # NaN
                v = None
        except Exception:
            v = None
            failed += 1
        row.append(v)
    ds["columns"] = build_dataset_columns(ds, args.name)
    json.dump(ds, open(args.file, "w", encoding="utf-8"), ensure_ascii=False)
    col = ds["columns"][-1]
    print(json.dumps({"ok": True, "column": col, "не_посчиталось": failed},
                     ensure_ascii=False, indent=2))


def build_dataset_columns(ds: dict, new_name: str) -> list:
    """Пересобрать описания колонок после добавления вычисляемой."""
    i = len(ds["columns"])
    col = [row[i] for row in ds["rows"]]
    present = [v for v in col if v is not None]
    kind = classify(col)
    info = {"name": new_name, "index": i, "type": kind,
            "missing": len(col) - len(present), "unique": len({str(v) for v in present}),
            "role": "measure" if kind == "number" else "text"}
    if present and kind == "number":
        nums = sorted(present)
        info["min"], info["max"] = nums[0], nums[-1]
        info["sum"] = round(sum(nums), 6)
        info["mean"] = round(sum(nums) / len(nums), 6)
        info["median"] = nums[len(nums) // 2]
    return ds["columns"] + [info]


def cmd_profile(args):
    path = args.file
    ext = os.path.splitext(path)[1].lower()
    if ext in (".xlsx", ".xlsm"):
        name, raw, sheets = read_xlsx(path, args.sheet, args.max_rows)
    elif ext in (".csv", ".txt", ".tsv"):
        name, raw, sheets = read_csv(path, args.max_rows)
    else:
        die("поддерживаются только .xlsx/.xlsm и .csv/.tsv (получено: %s)" % ext)
    ds = build_dataset(name, raw, args.header_row, args.max_rows)
    ds["file"] = os.path.abspath(path)
    ds["sheets"] = sheets
    out = args.out or os.path.splitext(path)[0] + ".data.json"
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(ds, fh, ensure_ascii=False)
    summary = {
        "data_json": os.path.abspath(out),
        "sheet": ds["source"],
        "sheets": sheets,
        "row_count": ds["row_count"],
        "columns": [{k: v for k, v in c.items() if k != "index"} for c in ds["columns"]],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))


def cmd_sheets(args):
    with zipfile.ZipFile(args.file) as z:
        print(json.dumps([s[0] for s in _sheet_list(z)], ensure_ascii=False, indent=2))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("profile")
    p.add_argument("file")
    p.add_argument("--sheet")
    p.add_argument("--out")
    p.add_argument("--header-row", type=int)
    p.add_argument("--max-rows", type=int)
    p.set_defaults(func=cmd_profile)
    dv = sub.add_parser("derive")
    dv.add_argument("file")
    dv.add_argument("--name", required=True)
    dv.add_argument("--expr", required=True)
    dv.set_defaults(func=cmd_derive)
    s = sub.add_parser("sheets")
    s.add_argument("file")
    s.set_defaults(func=cmd_sheets)
    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
