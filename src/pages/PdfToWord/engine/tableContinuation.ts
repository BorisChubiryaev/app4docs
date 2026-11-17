import type { TableBlock } from './types';

/** Remove a repeated header only as a complete, structurally identical unit.
 * Cutting part of a header can leave covered cells without their merge origin.
 */
export function repeatedHeaderRows(previous: TableBlock, next: TableBlock): number {
  const count = next.headerRows;
  if (!count || count !== previous.headerRows || count >= next.rows.length || count > previous.rows.length) return 0;
  for (let r = 0; r < count; r++) {
    const a = previous.rows[r];
    const b = next.rows[r];
    if (a.length !== b.length) return 0;
    for (let c = 0; c < b.length; c++) {
      const x = a[c];
      const y = b[c];
      if (x.covered !== y.covered || x.rowSpan !== y.rowSpan || x.colSpan !== y.colSpan) return 0;
      // A vertical merge must not extend into the retained body rows.
      if (!y.covered && r + y.rowSpan > count) return 0;
      const text = (cell: typeof x) => cell.paras.map(p => p.runs.map(run => run.text).join('')).join(' ').replace(/\s+/g, ' ').trim();
      if (text(x) !== text(y) || x.images.length || y.images.length) return 0;
    }
  }
  return count;
}
