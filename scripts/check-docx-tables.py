"""Check generated DOCX XML and table grids: python scripts/check-docx-tables.py result.docx."""
import sys
import zipfile
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def check(path):
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if name.endswith(('.xml', '.rels')):
                ET.fromstring(archive.read(name))
        root = ET.fromstring(archive.read('word/document.xml'))
    tables = list(root.iter(W + 'tbl'))
    errors = []
    for ti, table in enumerate(tables, 1):
        grid = len(table.find(W + 'tblGrid'))
        previous = {}
        for ri, row in enumerate(table.findall(W + 'tr'), 1):
            col = 0
            active = {}
            for cell in row.findall(W + 'tc'):
                span = cell.find(f'{W}tcPr/{W}gridSpan')
                width = int(span.get(W + 'val')) if span is not None else 1
                merge = cell.find(f'{W}tcPr/{W}vMerge')
                if merge is not None:
                    if merge.get(W + 'val', 'continue') == 'continue' and previous.get(col) != width:
                        errors.append(f'Table {ti}, row {ri}: orphaned vertical merge at column {col}')
                    active[col] = width
                col += width
            if col != grid:
                errors.append(f'Table {ti}, row {ri}: {col} columns, expected {grid}')
            previous = active
    if errors:
        raise ValueError('\n'.join(errors))
    print(f'OK: XML, grids and vertical merges in {len(tables)} tables')


if __name__ == '__main__':
    check(sys.argv[1])
