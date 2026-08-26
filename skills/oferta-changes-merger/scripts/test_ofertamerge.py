"""Тесты движка. Закрепляют дефекты, найденные на реальных документах."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ofertamerge as om  # noqa: E402


def make_docx(path: Path, document: str, footnotes: str | None = None, numbering: str | None = None) -> Path:
    with ZipFile(path, "w", ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr(om.DOCUMENT_PART, document)
        if footnotes is not None:
            zf.writestr(om.FOOTNOTES_PART, footnotes)
        if numbering is not None:
            zf.writestr(om.NUMBERING_PART, numbering)
    return path


def para(text: str, num_id: str | None = None, ilvl: int = 1) -> str:
    ppr = f'<w:pPr><w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="{num_id}"/></w:numPr></w:pPr>' if num_id else ""
    return f'<w:p>{ppr}<w:r><w:t>{text}</w:t></w:r></w:p>'


def cell(text: str) -> str:
    return f"<w:tc><w:tcPr/><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>"


def table(rows: list[list[str]]) -> str:
    trs = "".join("<w:tr>" + "".join(cell(c) for c in r) + "</w:tr>" for r in rows)
    return f"<w:tbl><w:tblPr/>{trs}</w:tbl>"


NUMBERING = (
    '<w:numbering>'
    '<w:num w:numId="13"><w:abstractNumId w:val="20"/></w:num>'
    '<w:num w:numId="27"><w:abstractNumId w:val="12"/></w:num>'
    # Обычный список: номер собирается из счётчиков уровней.
    '<w:abstractNum w:abstractNumId="20">'
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>'
    '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2."/></w:lvl>'
    "</w:abstractNum>"
    # Список раздела 7: цифра раздела ЗАШИТА в шаблон, %1 — счётчик пункта.
    '<w:abstractNum w:abstractNumId="12">'
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="7.%1"/></w:lvl>'
    "</w:abstractNum></w:numbering>"
)


class SortKeyTests(unittest.TestCase):
    def test_legal_form_dropped_from_either_side(self) -> None:
        self.assertEqual(om.sort_key('"БИЗОН" ООО'), "бизон")
        self.assertEqual(om.sort_key("АО «Интеркомп»"), "интеркомп")

    def test_prefixes_are_part_of_the_name(self) -> None:
        self.assertEqual(om.sort_key('НКО "ЮМани" ООО'), "нко юмани")
        self.assertEqual(om.sort_key('СК "Сбербанк Страхование" ООО'), "ск сбербанк страхование")

    def test_punctuation_is_significant(self) -> None:
        # «С-МАРКЕТИНГ» должен идти ПЕРЕД «СалютДевайсы» — так в действующей Оферте.
        self.assertLess(om.sort_key('"С-МАРКЕТИНГ" ООО'), om.sort_key('"СалютДевайсы" ООО'))

    def test_double_spaces_collapse(self) -> None:
        # Из-за двойного пробела правка иначе не совпадёт с текстом Оферты.
        self.assertEqual(om.sort_key("АО «Объединенное  Кредитное Бюро»"),
                         om.sort_key('"Объединенное Кредитное Бюро" АО'))

    def test_shorter_name_sorts_before_its_extension(self) -> None:
        self.assertLess(om.sort_key('СК "Сбербанк Страхование" ООО'),
                        om.sort_key('СК "Сбербанк Страхование Жизни" ООО'))


class NamesCompatibleTests(unittest.TestCase):
    def test_same_company_with_extra_tail(self) -> None:
        # Реальный случай Приложения 2: ячейка склеивает наименование, сайт и
        # перечень сервисов, поэтому хвост у правки и у Оферты различается.
        change = "ООО «Звук»https://zvuk.comМобильное приложение «Звук», «Мой Звук», ПО Звук"
        offer = "ООО «Звук»https://zvuk.comМобильное приложение «Звук»"
        self.assertTrue(om.names_compatible(change, offer))

    def test_different_companies_rejected(self) -> None:
        self.assertFalse(om.names_compatible("АО «Объединенное Кредитное Бюро»", '"СберЛогистика" ООО'))


class VisibleTextTests(unittest.TestCase):
    def test_runs_join_without_separator(self) -> None:
        # «28», разрезанное на раны, не должно стать «2 8».
        self.assertEqual(om.visible_text("<w:t>2</w:t><w:t>8</w:t>"), "28")


class NumberingTests(unittest.TestCase):
    def test_auto_numbers_are_reconstructed(self) -> None:
        doc = "<w:document><w:body>" + para("Первый", "13") + para("Второй", "13") + "</w:body></w:document>"
        index = om.index_paragraphs(doc, NUMBERING)
        self.assertEqual([om.norm_number(p.number or "") for p in index], ["1.1", "1.2"])

    def test_section_number_hardcoded_in_lvltext_is_honoured(self) -> None:
        """Шаблон «7.%1» даёт «7.6», а не «6».

        Из-за игнорирования w:lvlText пункты разделов 4–9 не находились —
        реконструкция выдавала голый счётчик.
        """
        doc = "<w:document><w:body>" + "".join(
            para(f"Пункт {i}", "27", ilvl=0) for i in range(1, 7)
        ) + "</w:body></w:document>"
        index = om.index_paragraphs(doc, NUMBERING)
        self.assertEqual([p.number for p in index][-1], "7.6")
        self.assertIsNotNone(om.find_by_number(index, "7.6", 0))

    def test_letter_and_roman_formats(self) -> None:
        self.assertEqual(om.format_counter(3, "lowerLetter"), "c")
        self.assertEqual(om.format_counter(4, "upperRoman"), "IV")


class InsertAfterAnchorTests(unittest.TestCase):
    def test_insertion_lands_after_closing_quote(self) -> None:
        xml = '<w:p><w:r><w:t>ООО СК «Сбербанк Страхование» и другие</w:t></w:r></w:p>'
        out, ok, _ = om.insert_after_anchor(xml, "«ООО СК «Сбербанк Страхование»", "<w:r><w:t>X</w:t></w:r>")
        self.assertTrue(ok)
        self.assertIn("Страхование»</w:t></w:r><w:r><w:t>X</w:t>", out)

    def test_missing_anchor_reports_failure(self) -> None:
        _, ok, msg = om.insert_after_anchor("<w:p><w:r><w:t>текст</w:t></w:r></w:p>", "нет такого", "<w:r/>")
        self.assertFalse(ok)
        self.assertIn("не найден", msg)

    def test_near_miss_anchor_reports_actual_wording(self) -> None:
        """Опечатка в якоре не подгоняется молча, но подсказка выдаётся."""
        xml = '<w:p><w:r><w:t>Расчет скоринговой оценки, далее по тексту</w:t></w:r></w:p>'
        _, ok, msg = om.insert_after_anchor(xml, "«Расчет скоринговой оценка»", "<w:r/>")
        self.assertFalse(ok)
        self.assertIn("в документе на этом месте", msg)
        self.assertIn("оценки", msg)


class TableOperationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rows = [["1", '"БИЗОН" ООО', "адрес 1"],
                     ["2", '"Газета.Ру" АО', "адрес 2"],
                     ["3", '"Интеркомп" АО', "адрес 3"]]
        doc = ("<w:document><w:body><w:p><w:r><w:t>Приложение № 1</w:t></w:r></w:p>"
               + table(self.rows) + "</w:body></w:document>")
        self.state = om.State(doc, None, None)

    def test_row_matched_by_name_not_by_number(self) -> None:
        """Номер в правке относится к другой редакции — берём по наименованию."""
        op = {"id": "t", "type": "replace_table_rows", "appendix": "1",
              "rows": [{"number": 1, "cells": ["1", "АО «Интеркомп»", "новый адрес"]}]}
        res = om.apply_operation(op, self.state, om.HIGHLIGHT_COLOR)
        self.assertTrue(res.ok)
        self.assertEqual(res.details["replaced"][0]["at_row"], 3)
        self.assertIn("новый адрес", self.state.document)
        self.assertIn("БИЗОН", self.state.document)  # чужая строка не тронута

    def test_number_fallback_refuses_different_company(self) -> None:
        """Под этим номером другая компания — строку не трогаем."""
        op = {"id": "t", "type": "replace_table_rows", "appendix": "1",
              "rows": [{"number": 1, "cells": ["1", "ООО «Совершенно Другая»", "адрес"]}]}
        res = om.apply_operation(op, self.state, om.HIGHLIGHT_COLOR)
        self.assertFalse(res.ok)
        self.assertIn("БИЗОН", self.state.document)
        self.assertNotIn("Совершенно Другая", self.state.document)

    def test_footnote_reference_survives_cell_replacement(self) -> None:
        doc = ("<w:document><w:body><w:p><w:r><w:t>Приложение № 1</w:t></w:r></w:p>"
               '<w:tbl><w:tblPr/><w:tr>' + cell("1")
               + '<w:tc><w:tcPr/><w:p><w:r><w:t>"БИЗОН" ООО</w:t></w:r>'
                 '<w:r><w:footnoteReference w:id="5"/></w:r></w:p></w:tc>'
               + "</w:tr></w:tbl></w:body></w:document>")
        state = om.State(doc, None, None)
        op = {"id": "t", "type": "replace_table_rows", "appendix": "1",
              "rows": [{"number": 1, "cells": ["1", '"БИЗОН" ООО']}]}
        res = om.apply_operation(op, state, om.HIGHLIGHT_COLOR)
        self.assertTrue(res.ok)
        self.assertIn('<w:footnoteReference w:id="5"/>', state.document)

    def test_alphabetical_sort_is_idempotent(self) -> None:
        op = {"id": "s", "type": "sort_table_alpha", "appendix": "1"}
        res = om.apply_operation(op, self.state, om.HIGHLIGHT_COLOR)
        self.assertTrue(res.ok)
        self.assertEqual(res.details["moves"], [])

    def test_alphabetical_sort_restores_order_and_renumbers(self) -> None:
        rows = [["1", '"Интеркомп" АО', "а3"], ["2", '"БИЗОН" ООО', "а1"], ["3", '"Газета.Ру" АО', "а2"]]
        doc = ("<w:document><w:body><w:p><w:r><w:t>Приложение № 1</w:t></w:r></w:p>"
               + table(rows) + "</w:body></w:document>")
        state = om.State(doc, None, None)
        om.apply_operation({"id": "s", "type": "sort_table_alpha", "appendix": "1"}, state, om.HIGHLIGHT_COLOR)
        tbl = om.find_appendix_table(state.document, "1")
        names = [om.visible_text(om.row_cells(r)[1]) for r in om.table_rows(tbl.inner)]
        numbers = [om.visible_text(om.row_cells(r)[0]) for r in om.table_rows(tbl.inner)]
        self.assertEqual(names, ['"БИЗОН" ООО', '"Газета.Ру" АО', '"Интеркомп" АО'])
        self.assertEqual(numbers, ["1", "2", "3"])

    def test_duplicate_is_not_inserted(self) -> None:
        op = {"id": "i", "type": "insert_table_row_alpha", "appendix": "1",
              "rows": [{"cells": ["", 'ООО «БИЗОН»', "адрес"]}]}
        res = om.apply_operation(op, self.state, om.HIGHLIGHT_COLOR)
        self.assertFalse(res.ok)
        self.assertIn("уже есть", res.message)

    def test_new_row_lands_in_alphabetical_position(self) -> None:
        op = {"id": "i", "type": "insert_table_row_alpha", "appendix": "1",
              "rows": [{"cells": ["", 'ООО «Домклик»', "адрес"]}]}
        res = om.apply_operation(op, self.state, om.HIGHLIGHT_COLOR)
        self.assertTrue(res.ok)
        tbl = om.find_appendix_table(self.state.document, "1")
        names = [om.visible_text(om.row_cells(r)[1]) for r in om.table_rows(tbl.inner)]
        self.assertEqual(names.index("ООО «Домклик»"), 2)  # после Газета.Ру, перед Интеркомп


class PlanValidationTests(unittest.TestCase):
    def test_missing_raw_text_is_rejected(self) -> None:
        errors = om.validate_plan({"operations": [{"id": "a", "type": "sort_table_alpha", "appendix": "1"}]})
        self.assertTrue(any("raw_text" in e for e in errors))

    def test_duplicate_ids_are_rejected(self) -> None:
        op = {"id": "a", "type": "sort_table_alpha", "appendix": "1", "raw_text": "x"}
        errors = om.validate_plan({"operations": [op, dict(op)]})
        self.assertTrue(any("повтор" in e for e in errors))

    def test_valid_plan_passes(self) -> None:
        errors = om.validate_plan({"operations": [
            {"id": "a", "type": "sort_table_alpha", "appendix": "1", "raw_text": "x"}]})
        self.assertEqual(errors, [])


class ApplyEndToEndTests(unittest.TestCase):
    def test_source_is_never_modified_and_outputs_are_produced(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            doc = ("<w:document><w:body><w:p><w:r><w:t>Приложение № 1</w:t></w:r></w:p>"
                   + table([["1", '"Интеркомп" АО', "а"], ["2", '"БИЗОН" ООО', "б"]])
                   + "</w:body></w:document>")
            offer = make_docx(tmp_path / "offer.docx", doc)
            before = om.sha256_of(offer)
            plan = {"operations": [{"id": "s", "type": "sort_table_alpha", "appendix": "1", "raw_text": "сортировка"}]}
            (tmp_path / "plan.json").write_text(json.dumps(plan, ensure_ascii=False), encoding="utf-8")
            code = om.main(["apply", str(offer), str(tmp_path / "plan.json"),
                            "--out-offer", str(tmp_path / "out.docx"),
                            "--out-combined", str(tmp_path / "combined.docx"),
                            "--report", str(tmp_path / "report.md")])
            self.assertEqual(code, 0)
            self.assertEqual(om.sha256_of(offer), before)
            for name in ("out.docx", "combined.docx", "report.md"):
                self.assertTrue((tmp_path / name).stat().st_size > 0, name)

    def test_output_path_equal_to_input_is_refused(self) -> None:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            offer = make_docx(tmp_path / "offer.docx", "<w:document><w:body/></w:document>")
            plan = {"operations": [{"id": "s", "type": "sort_table_alpha", "appendix": "1", "raw_text": "x"}]}
            (tmp_path / "plan.json").write_text(json.dumps(plan), encoding="utf-8")
            with self.assertRaises(SystemExit):
                om.main(["apply", str(offer), str(tmp_path / "plan.json"), "--out-offer", str(offer)])


if __name__ == "__main__":
    unittest.main()
