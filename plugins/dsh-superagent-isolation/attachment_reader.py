import json
import re
import sys
from pathlib import Path


MAX_CHARS = 5_000_000


def lines(path):
    if path.suffix == '.txt':
        yield path.read_text(encoding='utf-8-sig', errors='replace')
    elif path.suffix == '.pdf':
        import pymupdf
        with pymupdf.open(path) as document:
            for page in document:
                yield page.get_text()
    elif path.suffix == '.docx':
        from docx import Document
        document = Document(path)
        for paragraph in document.paragraphs:
            yield paragraph.text
        for table in document.tables:
            for row in table.rows:
                yield '\t'.join(cell.text for cell in row.cells)
    elif path.suffix == '.xlsx':
        from openpyxl import load_workbook
        workbook = load_workbook(path, read_only=True, data_only=False, keep_links=False)
        try:
            for sheet in workbook:
                yield sheet.title
                for row in sheet.iter_rows(values_only=True):
                    yield '\t'.join(str(cell) if cell is not None else '' for cell in row).rstrip('\t')
        finally:
            workbook.close()
    elif path.suffix == '.pptx':
        from pptx import Presentation
        for slide in Presentation(path).slides:
            for shape in slide.shapes:
                if shape.has_text_frame:
                    yield shape.text
                elif shape.has_table:
                    for row in shape.table.rows:
                        yield '\t'.join(cell.text for cell in row.cells)


def extract(path, offset, limit):
    if not re.fullmatch(r'/materials/inputs/[a-f0-9]{32}\.(?:txt|docx|xlsx|pptx|pdf)', str(path)):
        raise ValueError('invalid staged attachment')
    if path.stat().st_size > 20 * 1024 * 1024 or not 0 <= offset <= MAX_CHARS or not 1 <= limit <= 8000:
        raise ValueError('attachment exceeds a read limit')
    fragments = []
    total = 0
    for line in lines(path):
        clean = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', line)
        if not clean.strip():
            continue
        if fragments:
            clean = '\n' + clean
        fragments.append(clean[:MAX_CHARS - total])
        total += len(fragments[-1])
        if total >= MAX_CHARS:
            break
    text = ''.join(fragments).strip()
    end = min(len(text), offset + limit)
    return {'readable': bool(text), 'offset': offset, 'text': text[offset:end], 'totalChars': len(text),
            'nextOffset': end if end < len(text) else None}


if __name__ == '__main__':
    print(json.dumps(extract(Path(sys.argv[1]), int(sys.argv[2]), int(sys.argv[3])), ensure_ascii=False))
