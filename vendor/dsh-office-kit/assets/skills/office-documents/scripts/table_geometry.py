#!/usr/bin/env python
"""Audit table widths in twips, and optionally make every table fit the page.

Word stores table widths three ways (``tblW``, grid columns, cell widths) and they
disagree often enough that a table overflows the margin after a page-size change.
``--fix`` makes the table fixed-layout and distributes the text width across the
grid, writing the same number to each cell so the two can no longer disagree.

Exit codes: 0 clean, 1 problems found (without --fix), 2 bad input.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import docx_kit as kit

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass


def text_width_twips(doc: kit.Docx) -> int:
    sections = doc.sections()
    if not sections:
        return 9360
    sect = sections[0]
    page = sect.find(kit.q("pgSz"))
    margins = sect.find(kit.q("pgMar"))
    width = int(page.get(kit.q("w")) or 12240) if page is not None else 12240
    if margins is None:
        return width - 2880
    return width - sum(int(margins.get(kit.q(side)) or 0) for side in ("left", "right"))


def grid_widths(table) -> list[int]:
    grid = table.find(kit.q("tblGrid"))
    if grid is None:
        return []
    widths = []
    for column in grid.findall(kit.q("gridCol")):
        value = column.get(kit.q("w"))
        widths.append(int(value) if value and value.lstrip("-").isdigit() else 0)
    return widths


def table_info(table) -> dict:
    props = table.find(kit.q("tblPr"))
    width = None
    layout = None
    if props is not None:
        node = props.find(kit.q("tblW"))
        if node is not None:
            width = {"type": node.get(kit.q("type")), "value": node.get(kit.q("w"))}
        node = props.find(kit.q("tblLayout"))
        if node is not None:
            layout = node.get(kit.q("type"))
    widths = grid_widths(table)
    cells = table.findall(".//" + kit.q("tc"))
    cell_widths = []
    for cell in cells:
        node = cell.find(kit.q("tcPr") + "/" + kit.q("tcW"))
        if node is not None and (node.get(kit.q("w")) or "").isdigit():
            cell_widths.append(int(node.get(kit.q("w"))))
    return {
        "tblW": width,
        "layout": layout,
        "grid_twips": widths,
        "grid_total": sum(widths),
        "cells": len(cells),
        "cell_width_min": min(cell_widths) if cell_widths else None,
        "cell_width_max": max(cell_widths) if cell_widths else None,
    }


def fix_table(table, target: int) -> None:
    props = table.find(kit.q("tblPr"))
    if props is None:
        props = etree.Element(kit.q("tblPr"))
        table.insert(0, props)
    for tag in ("tblW", "tblLayout"):
        for existing in props.findall(kit.q(tag)):
            props.remove(existing)
    width = etree.SubElement(props, kit.q("tblW"))
    width.set(kit.q("type"), "dxa")
    width.set(kit.q("w"), str(target))
    etree.SubElement(props, kit.q("tblLayout")).set(kit.q("type"), "fixed")

    columns = grid_widths(table)
    if not columns:
        columns = [1]
    total = sum(columns) or len(columns)
    scaled = [max(1, target * value // total) for value in columns]
    remainder = target - sum(scaled)
    order = sorted(range(len(columns)), key=lambda index: (target * columns[index]) % total, reverse=True)
    for index in range(max(0, remainder)):
        scaled[order[index % len(order)]] += 1
    grid = table.find(kit.q("tblGrid"))
    if grid is None:
        grid = etree.Element(kit.q("tblGrid"))
        table.insert(1, grid)
    for column in list(grid):
        grid.remove(column)
    for value in scaled:
        etree.SubElement(grid, kit.q("gridCol")).set(kit.q("w"), str(value))

    for row in table.findall(kit.q("tr")):
        position = 0
        for cell in row.findall(kit.q("tc")):
            span = 1
            cell_props = cell.find(kit.q("tcPr"))
            if cell_props is None:
                cell_props = etree.Element(kit.q("tcPr"))
                cell.insert(0, cell_props)
            node = cell_props.find(kit.q("gridSpan"))
            if node is not None and (node.get(kit.q("val")) or "").isdigit():
                span = int(node.get(kit.q("val")))
            own = sum(scaled[position : position + span]) or scaled[0]
            for existing in cell_props.findall(kit.q("tcW")):
                cell_props.remove(existing)
            tcw = etree.SubElement(cell_props, kit.q("tcW"))
            tcw.set(kit.q("type"), "dxa")
            tcw.set(kit.q("w"), str(own))
            position += span


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit table geometry in twips and optionally fit tables to the text width.")
    parser.add_argument("docx", help="Input .docx")
    parser.add_argument("--fix", action="store_true", help="Set fixed layout and rewrite grid/cell widths to fit the page")
    parser.add_argument("--out", default=None, help="Output .docx (required with --fix, defaults to overwriting)")
    args = parser.parse_args(argv)

    try:
        doc = kit.Docx(args.docx)
    except (OSError, KeyError) as exc:
        print("error: %s" % exc, file=sys.stderr)
        return 2

    target = text_width_twips(doc)
    tables = list(doc.body().iter(kit.q("tbl")))
    rows = [table_info(table) for table in tables]
    findings = []
    for index, info in enumerate(rows, start=1):
        if info["grid_total"] and info["grid_total"] > target:
            findings.append({"kind": "grid_wider_than_text", "table": index, "grid_total": info["grid_total"], "text_width": target})
        if info["layout"] != "fixed":
            findings.append({"kind": "not_fixed_layout", "table": index})
        if info["cell_width_max"] and info["grid_total"] and info["cell_width_max"] > info["grid_total"]:
            findings.append({"kind": "cell_wider_than_grid", "table": index})
        if info["tblW"] and info["tblW"]["type"] == "pct" and not info["grid_total"]:
            findings.append({"kind": "percent_width_without_grid", "table": index})

    if args.fix:
        if not tables:
            print("error: no tables found", file=sys.stderr)
            return 2
        for table in tables:
            fix_table(table, target)
        out = args.out or args.docx
        doc.save(out)
        remaining = []
        for index, info in enumerate((table_info(table) for table in tables), start=1):
            if info["grid_total"] and info["grid_total"] > target:
                remaining.append({"kind": "grid_wider_than_text", "table": index, "grid_total": info["grid_total"], "text_width": target})
            if info["layout"] != "fixed":
                remaining.append({"kind": "not_fixed_layout", "table": index})
        kit.emit({"ok": not remaining, "fixed": True, "output": str(Path(out)), "tables": len(tables), "text_width": target, "findings": remaining})
        return 0 if not remaining else 1

    kit.emit({"ok": not findings, "text_width": target, "tables": rows, "findings": findings})
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main())
