import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repeatedHeaderRows } from '../src/pages/PdfToWord/engine/tableContinuation.ts';
import type { CellBlock, TableBlock } from '../src/pages/PdfToWord/engine/types.ts';

const cell = (rowSpan = 1, covered = false): CellBlock => ({ rowSpan, covered, colSpan: 1, paras: [], images: [], shading: null, vAlign: 'top' });
const table = (rows: CellBlock[][], headerRows = 2): TableBlock => ({ kind: 'table', rows, headerRows, colWidths: [50, 50], rowHeights: rows.map(() => 20), borders: true, x0: 0, top: 100, bottom: 0, page: 0 });

test('removes a complete repeated header with vertical merges', () => {
  const a = table([[cell(2), cell()], [cell(1, true), cell()], [cell(), cell()]]);
  assert.equal(repeatedHeaderRows(a, structuredClone(a)), 2);
});

test('keeps a partially matching header instead of orphaning merged cells', () => {
  const a = table([[cell(2), cell()], [cell(1, true), cell()], [cell(), cell()]]);
  const b = structuredClone(a);
  b.rows[1][1].colSpan = 2;
  assert.equal(repeatedHeaderRows(a, b), 0);
});

test('keeps headers with merges extending into body rows', () => {
  const a = table([[cell(3), cell()], [cell(1, true), cell()], [cell(1, true), cell()]]);
  assert.equal(repeatedHeaderRows(a, structuredClone(a)), 0);
});

test('keeps a header-only continuation and different header depths', () => {
  const a = table([[cell(), cell()], [cell(), cell()], [cell(), cell()]]);
  assert.equal(repeatedHeaderRows(a, table(a.rows.slice(0, 2))), 0);
  assert.equal(repeatedHeaderRows(a, table(a.rows, 1)), 0);
});
