#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Тесты навыка: чтение файлов, профилирование, валидация конфига, сборка.

Запуск: python3 scripts/test_dashboard.py
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FIXTURES = os.path.join(ROOT, "evals", "fixtures")
sys.path.insert(0, HERE)

import tabledata  # noqa: E402
import build_dashboard  # noqa: E402


def profile(path, **kw):
    tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
    tmp.close()
    args = ["profile", path, "--out", tmp.name]
    for k, v in kw.items():
        args += ["--" + k.replace("_", "-"), str(v)]
    out = subprocess.run([sys.executable, os.path.join(HERE, "tabledata.py")] + args,
                         capture_output=True, text=True, check=True)
    with open(tmp.name, encoding="utf-8") as fh:
        return json.loads(out.stdout), json.load(fh)


class ParseScalar(unittest.TestCase):
    def test_numbers_with_russian_conventions(self):
        self.assertEqual(tabledata.parse_scalar("1 234,56"), 1234.56)
        self.assertEqual(tabledata.parse_scalar("42"), 42)
        self.assertEqual(tabledata.parse_scalar("-7,5"), -7.5)

    def test_percent_becomes_fraction(self):
        self.assertAlmostEqual(tabledata.parse_scalar("15%"), 0.15)

    def test_dates(self):
        self.assertEqual(tabledata.parse_scalar("31.12.2025"), "2025-12-31")
        self.assertEqual(tabledata.parse_scalar("2025-12-31"), "2025-12-31")
        self.assertEqual(tabledata.parse_scalar("5 мая 2025"), "2025-05-05")

    def test_booleans(self):
        self.assertIs(tabledata.parse_scalar("Да"), True)
        self.assertIs(tabledata.parse_scalar("нет"), False)

    def test_text_stays_text(self):
        self.assertEqual(tabledata.parse_scalar("ООО «Ромашка»"), "ООО «Ромашка»")
        # Артикул из цифр с буквой — не число.
        self.assertEqual(tabledata.parse_scalar("12а"), "12а")


class Classify(unittest.TestCase):
    def test_single_dirty_value_does_not_break_type(self):
        col = [1, 2, 3, 4, 5, 6, 7, 8, 9, "н/д"]
        self.assertEqual(tabledata.classify(col), "number")

    def test_half_text_is_string(self):
        self.assertEqual(tabledata.classify([1, 2, "а", "б"]), "string")

    def test_empty(self):
        self.assertEqual(tabledata.classify([None, None]), "empty")


class Delimiter(unittest.TestCase):
    def test_comma_in_header_does_not_win(self):
        sample = "Дата;Тема;Время решения, ч\r\n01.01.2026;Оплата;3,5\r\n02.01.2026;Возврат;7,1\r\n"
        self.assertEqual(tabledata.sniff_delimiter(sample), ";")

    def test_plain_comma_csv(self):
        sample = "a,b,c\n1,2,3\n4,5,6\n"
        self.assertEqual(tabledata.sniff_delimiter(sample), ",")


class ReadXlsx(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.summary, cls.data = profile(os.path.join(FIXTURES, "sales_2025.xlsx"))

    def test_row_count_and_sheet(self):
        self.assertEqual(self.summary["row_count"], 1200)
        self.assertEqual(self.summary["sheet"], "Продажи")

    def test_dates_are_recognised_by_cell_format(self):
        col = next(c for c in self.data["columns"] if c["name"] == "Дата")
        self.assertEqual(col["type"], "date")
        self.assertEqual(col["min"], "2025-01-01")
        self.assertEqual(col["max"], "2025-12-31")

    def test_roles(self):
        roles = {c["name"]: c["role"] for c in self.data["columns"]}
        self.assertEqual(roles["№"], "id")
        self.assertEqual(roles["Регион"], "dimension")
        self.assertEqual(roles["Выручка"], "measure")
        # Дробная мера уникальна в каждой строке, но это не идентификатор.
        self.assertEqual(roles["Прибыль"], "measure")

    def test_top_values_omitted_for_identifiers(self):
        col = next(c for c in self.data["columns"] if c["name"] == "№")
        self.assertNotIn("top_values", col)


class ReadCsv(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.summary, cls.data = profile(os.path.join(FIXTURES, "support_tickets.csv"))

    def test_cp1251_and_semicolons(self):
        names = [c["name"] for c in self.data["columns"]]
        self.assertEqual(names[0], "Дата обращения")
        self.assertIn("Время решения, ч", names)

    def test_types(self):
        types = {c["name"]: c["type"] for c in self.data["columns"]}
        self.assertEqual(types["Дата обращения"], "date")
        self.assertEqual(types["Время решения, ч"], "number")
        self.assertEqual(types["Решено"], "bool")


class Derive(unittest.TestCase):
    def setUp(self):
        _, data = profile(os.path.join(FIXTURES, "sales_2025.xlsx"))
        self.path = tempfile.NamedTemporaryFile(suffix=".json", delete=False).name
        json.dump(data, open(self.path, "w", encoding="utf-8"), ensure_ascii=False)

    def run_derive(self, name, expr):
        return subprocess.run(
            [sys.executable, os.path.join(HERE, "tabledata.py"), "derive", self.path,
             "--name", name, "--expr", expr],
            capture_output=True, text=True)

    def test_margin(self):
        res = self.run_derive("Маржа, %", "Прибыль / Выручка * 100")
        self.assertEqual(res.returncode, 0, res.stderr)
        col = json.loads(res.stdout)["column"]
        self.assertEqual(col["type"], "number")
        self.assertGreater(col["mean"], 0)
        data = json.load(open(self.path, encoding="utf-8"))
        self.assertEqual(len(data["rows"][0]), len(data["columns"]))

    def test_column_name_with_comma_and_space(self):
        _, data = profile(os.path.join(FIXTURES, "support_tickets.csv"))
        path = tempfile.NamedTemporaryFile(suffix=".json", delete=False).name
        json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False)
        res = subprocess.run(
            [sys.executable, os.path.join(HERE, "tabledata.py"), "derive", path,
             "--name", "Дни", "--expr", "Время решения, ч / 24"],
            capture_output=True, text=True)
        self.assertEqual(res.returncode, 0, res.stdout + res.stderr)

    def test_code_execution_is_refused(self):
        for expr in ("__import__('os').system('id')", "open('/etc/passwd').read()",
                     "(1).__class__.__base__"):
            res = self.run_derive("Взлом", expr)
            self.assertEqual(res.returncode, 1, expr)
            self.assertIn("error", res.stdout)

    def test_division_by_zero_yields_empty_not_crash(self):
        res = self.run_derive("Ноль", "Выручка / (Выручка - Выручка)")
        self.assertEqual(res.returncode, 0, res.stderr)
        self.assertEqual(json.loads(res.stdout)["не_посчиталось"], 1200)


class Validate(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _, cls.data = profile(os.path.join(FIXTURES, "sales_2025.xlsx"))

    def errors(self, config):
        return build_dashboard.validate(config, self.data)

    def test_valid_config_passes(self):
        cfg = {"charts": [{"type": "hbar", "dimension": "Регион", "measure": "Выручка"}]}
        self.assertEqual(self.errors(cfg), [])

    def test_typo_suggests_real_column(self):
        errs = self.errors({"charts": [{"type": "bar", "dimension": "регион"}]})
        self.assertTrue(any("Регион" in e for e in errs), errs)

    def test_sum_over_text_column(self):
        errs = self.errors({"kpis": [{"label": "x", "column": "Регион", "agg": "sum"}],
                            "charts": [{"type": "bar", "dimension": "Регион"}]})
        self.assertTrue(any("нужен number" in e for e in errs), errs)

    def test_line_over_categories_is_flagged(self):
        errs = self.errors({"charts": [{"type": "line", "dimension": "Регион", "measure": "Выручка"}]})
        self.assertTrue(any("линия" in e.lower() for e in errs), errs)

    def test_high_cardinality_requires_limit(self):
        errs = self.errors({"charts": [{"type": "bar", "dimension": "Прибыль", "measure": "Выручка"}]})
        self.assertTrue(any("limit" in e for e in errs), errs)
        ok = self.errors({"charts": [{"type": "bar", "dimension": "Прибыль",
                                      "measure": "Выручка", "limit": 10}]})
        self.assertEqual(ok, [])

    def test_stacked_bar_needs_series(self):
        errs = self.errors({"charts": [{"type": "stacked-bar", "dimension": "Регион",
                                        "measure": "Выручка"}]})
        self.assertTrue(any("series" in e for e in errs), errs)

    def test_unknown_chart_type(self):
        errs = self.errors({"charts": [{"type": "линия", "dimension": "Регион"}]})
        self.assertTrue(any("неизвестен" in e for e in errs), errs)

    def test_empty_charts(self):
        self.assertTrue(any("нет ни одного графика" in e for e in self.errors({"charts": []})))

    def test_span_out_of_grid(self):
        errs = self.errors({"charts": [{"type": "bar", "dimension": "Регион", "span": 14}]})
        self.assertTrue(any("span" in e for e in errs), errs)


class Build(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _, cls.data = profile(os.path.join(FIXTURES, "sales_2025.xlsx"))
        cls.config = {
            "title": "Продажи 2025",
            "filters": [{"column": "Регион"}, {"column": "Дата"}],
            "kpis": [{"label": "Выручка", "column": "Выручка", "agg": "sum", "format": "money"}],
            "charts": [
                {"type": "line", "title": "Динамика", "dimension": "Дата",
                 "bucket": "month", "measure": "Выручка"},
                {"type": "hbar", "title": "Регионы", "dimension": "Регион", "measure": "Выручка"},
                {"type": "table", "title": "Сделки", "columns": ["Дата", "Регион", "Выручка"]},
            ],
        }
        cls.out = tempfile.NamedTemporaryFile(suffix=".html", delete=False).name
        cls.result = build_dashboard.build(cls.config, cls.data, cls.out)
        cls.html = open(cls.out, encoding="utf-8").read()

    def test_single_file_result(self):
        self.assertTrue(self.result["size_kb"] > 10)
        self.assertEqual(self.result["charts"], 3)

    def test_no_external_resources(self):
        # Дашборд открывают с диска в сети без интернета — любая внешняя
        # ссылка на скрипт, стиль или шрифт сделает его битым.
        for tag in re.findall(r"<(?:script|link|img)[^>]*>", self.html):
            self.assertNotIn("http", tag, tag)

    def test_data_is_embedded(self):
        self.assertIn("Екатеринбург", self.html)
        self.assertIn('id="dash-data"', self.html)

    def test_script_tag_inside_data_cannot_break_out(self):
        data = json.loads(json.dumps(self.data))
        data["rows"][0][2] = "</script><script>alert(1)</script>"
        out = tempfile.NamedTemporaryFile(suffix=".html", delete=False).name
        build_dashboard.build(self.config, data, out)
        html = open(out, encoding="utf-8").read()
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("<\\/script>", html)

    def test_runtime_assets_are_inlined(self):
        self.assertIn("window.__DASH__", self.html)
        self.assertIn("--dash-bg", self.html)


if __name__ == "__main__":
    unittest.main(verbosity=2)
