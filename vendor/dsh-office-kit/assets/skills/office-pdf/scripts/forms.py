#!/usr/bin/env python3
"""Inspect and fill AcroForm fields in a PDF, then re-check what was written.

A widget annotation can paint one value while the canonical field tree holds a
different one, so this tool treats the file as two views of the same data and
compares them after saving. `inspect` reports both views, plus orphaned widgets
and name collisions. `fill` repairs orphans, writes values, can flatten, then
reopens the result and fails loudly when a value or an appearance is missing.

Exit codes: 0 success, 1 bad arguments, 2 unreadable input or write failure,
3 refused (missing fields, ambiguous widgets, unsafe overwrite),
4 written file failed verification.
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from pathlib import Path

for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

try:
    from pypdf.generic import IndirectObject, NameObject
except ImportError:  # pragma: no cover - pypdf is a required dependency
    IndirectObject = None  # type: ignore[assignment]
    NameObject = None  # type: ignore[assignment]

from pdf_fonts import find_cjk_font, has_non_latin, register_cjk_font


def emit(value, out=None):
    text = json.dumps(value, ensure_ascii=False, indent=2, default=str)
    if out:
        target = Path(out).expanduser()
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text + "\n", encoding="utf-8")
    print(text)


def fail(message, code=1, detail=None):
    payload = {"ok": False, "error": message}
    if detail is not None:
        payload["detail"] = detail
    print(json.dumps(payload, ensure_ascii=False, indent=2, default=str), file=sys.stderr)
    raise SystemExit(code)


def rebuild_cjk_appearances(path, values, font_file):
    """Replace the appearance of text widgets whose value is non-Latin.

    pypdf can only generate appearance streams with the base-14 fonts, so a
    Chinese value would paint as question marks even though /V is correct.
    Each such widget gets a fresh form XObject drawn with a real CJK font,
    with the field border and background kept.
    """
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, NumberObject, StreamObject
    from reportlab.lib.colors import Color
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfgen import canvas as rl_canvas

    reader = PdfReader(str(path))
    report = inspect_document(reader)
    targets = []
    for widget in report["widgets"]:
        name = widget["name"]
        value = values.get(name)
        if not has_non_latin(value) or widget["field_type"] != "/Tx":
            continue
        rect = widget["rect"]
        if len(rect) != 4:
            continue
        width = float(rect[2]) - float(rect[0])
        height = float(rect[3]) - float(rect[1])
        if width <= 1 or height <= 1:
            continue
        targets.append({"page": widget["page"], "name": name, "value": value, "width": width, "height": height})
    if not targets:
        return []

    try:
        font_path = find_cjk_font(font_file)
    except FileNotFoundError as exc:
        fail(str(exc), code=2)
    if font_path is None:
        fail("values contain non-Latin text but no CJK font was found; pass --font-file", code=2)
    try:
        font_name = register_cjk_font(font_path, "FormCJK")
    except Exception as exc:
        fail(f"cannot use font file {font_path}: {exc}", code=2)

    overlay = io.BytesIO()
    page = rl_canvas.Canvas(overlay)
    for target in targets:
        width, height = target["width"], target["height"]
        page.setPageSize((width, height))
        page.setFillColor(Color(1, 1, 1))
        page.rect(0, 0, width, height, stroke=0, fill=1)
        page.setStrokeColor(Color(0.55, 0.55, 0.55))
        page.setLineWidth(0.5)
        page.rect(0.25, 0.25, width - 0.5, height - 0.5, stroke=1, fill=0)
        size = min(10.0, max(height - 3, 4.0))
        while size > 4 and pdfmetrics.stringWidth(target["value"], font_name, size) > width - 4:
            size -= 0.5
        page.setFillColor(Color(0, 0, 0))
        page.setFont(font_name, size)
        baseline = (height - size) / 2 + size * 0.22
        page.drawString(2, baseline, target["value"])
        page.showPage()
    page.save()
    overlay.seek(0)
    overlay_reader = PdfReader(overlay)

    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    original_pages = len(writer.pages)
    writer.append(overlay_reader)
    appended = writer.pages[original_pages:]

    for index, target in enumerate(targets):
        overlay_page = appended[index]
        contents = overlay_page.get_contents()
        data = contents.get_data() if contents is not None else b""
        resources = overlay_page.get("/Resources")
        stream = StreamObject()
        stream.set_data(data)
        stream[NameObject("/Type")] = NameObject("/XObject")
        stream[NameObject("/Subtype")] = NameObject("/Form")
        stream[NameObject("/FormType")] = NumberObject(1)
        stream[NameObject("/BBox")] = ArrayObject(
            [FloatObject(0), FloatObject(0), FloatObject(target["width"]), FloatObject(target["height"])]
        )
        if resources is not None:
            stream[NameObject("/Resources")] = resources
        reference = writer._add_object(stream)
        page = writer.pages[target["page"] - 1]
        for annotation in page.get("/Annots") or []:
            obj = annotation.get_object()
            if obj.get("/Subtype") != "/Widget":
                continue
            parent = obj.get("/Parent")
            source = parent.get_object() if parent is not None else obj
            tag = obj.get("/T") or source.get("/T")
            if str(tag) != target["name"]:
                continue
            obj[NameObject("/AP")] = DictionaryObject({NameObject("/N"): reference})
            break

    while len(writer.pages) > original_pages:
        writer.remove_page(len(writer.pages) - 1)
    with open(path, "wb") as handle:
        writer.write(handle)
    return [target["name"] for target in targets]


def ref_id(node):
    if isinstance(node, IndirectObject):
        return node.idnum
    return None


def load_values(spec):
    if spec == "-":
        raw = sys.stdin.read()
    elif spec.strip().startswith(("{", "[")):
        raw = spec
    else:
        path = Path(spec).expanduser()
        if not path.is_file():
            fail(f"values file not found: {path}", code=2)
        raw = path.read_text(encoding="utf-8-sig")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        fail(f"invalid values JSON: {exc}")
    if isinstance(data, dict) and isinstance(data.get("fields"), dict):
        data = data["fields"]
    if not isinstance(data, dict):
        fail('values must be a JSON object of {field name: value}')
    return data


def field_tree(reader):
    """Walk /AcroForm/Fields and return terminal fields with their references."""
    entries = []
    try:
        root = reader.trailer["/Root"]
        acroform = root.get("/AcroForm")
    except Exception:
        acroform = None
    if acroform is None:
        return entries
    fields = acroform.get_object().get("/Fields") or []
    for node in fields:
        walk_field(node, "", entries, 0)
    return entries


def walk_field(node, prefix, entries, depth):
    if depth > 12 or node is None:
        return
    obj = node.get_object()
    tag = obj.get("/T")
    name = prefix
    if tag is not None:
        name = f"{prefix}.{tag}" if prefix else str(tag)
    raw_kids = list(obj.get("/Kids") or [])
    kids = [kid.get_object() for kid in raw_kids]
    child_fields = [kid for kid in kids if kid.get("/T") is not None]
    if obj.get("/FT") is not None and not child_fields:
        widgets = [ref_id(kid) for kid, kid_obj in zip(raw_kids, kids) if kid_obj.get("/Subtype") == "/Widget"]
        if not widgets and obj.get("/Subtype") == "/Widget":
            widgets = [ref_id(node)]
        entries.append(
            {
                "name": name,
                "ref": ref_id(node),
                "type": str(obj.get("/FT")) if obj.get("/FT") is not None else None,
                "value": scalar(obj.get("/V")),
                "default": scalar(obj.get("/DV")),
                "flags": scalar(obj.get("/Ff")),
                "options": [str(option) for option in (obj.get("/Opt") or [])],
                "widget_refs": widgets,
                "node": obj,
            }
        )
    for kid_node, kid in zip(raw_kids, kids):
        if kid.get("/T") is not None:
            walk_field(kid_node, name, entries, depth + 1)


def scalar(value):
    if value is None:
        return None
    try:
        resolved = value.get_object()
    except AttributeError:
        resolved = value
    if isinstance(resolved, (list, tuple)):
        return [scalar(item) for item in resolved]
    if hasattr(resolved, "get_data"):
        return str(resolved)
    text = str(resolved)
    return text


def widget_name(widget):
    node = widget
    for _ in range(8):
        tag = node.get("/T")
        if tag is not None:
            return str(tag)
        parent = node.get("/Parent")
        if parent is None:
            return None
        node = parent.get_object()
    return None


def inherited(widget, key):
    node = widget
    for _ in range(8):
        value = node.get(key)
        if value is not None:
            return value
        parent = node.get("/Parent")
        if parent is None:
            return None
        node = parent.get_object()
    return None


def appearance(widget):
    ap = widget.get("/AP")
    if ap is None:
        return "missing", []
    normal = ap.get_object().get("/N")
    if normal is None:
        return "missing", []
    normal = normal.get_object()
    if hasattr(normal, "get_data"):
        return ("stream" if normal.get_data() else "empty_stream"), []
    if hasattr(normal, "keys"):
        states = [str(key) for key in normal.keys()]
        current = str(widget.get("/AS") or inherited(widget, "/V") or "")
        entry = normal.get(current) if current else None
        if entry is None:
            return "states_without_current", states
        entry = entry.get_object()
        length = len(entry.get_data()) if hasattr(entry, "get_data") else 0
        return ("states" if length else "states_empty_stream"), states
    return "unknown", []


def inspect_document(reader):
    entries = field_tree(reader)
    names = [entry["name"] for entry in entries]
    canonical = {entry["ref"]: entry for entry in entries if entry["ref"] is not None}

    widgets = []
    for page_number, page in enumerate(reader.pages, start=1):
        for annotation in page.get("/Annots") or []:
            obj = annotation.get_object()
            if obj.get("/Subtype") != "/Widget":
                continue
            state, states = appearance(obj)
            widgets.append(
                {
                    "page": page_number,
                    "ref": ref_id(annotation),
                    "name": widget_name(obj),
                    "parent_ref": ref_id(obj.get("/Parent")) if obj.get("/Parent") is not None else None,
                    "rect": [round(float(value), 2) for value in (obj.get("/Rect") or [])],
                    "value": scalar(obj.get("/AS")) if obj.get("/AS") is not None else scalar(inherited(obj, "/V")),
                    "field_type": str(inherited(obj, "/FT")) if inherited(obj, "/FT") is not None else None,
                    "state": scalar(obj.get("/AS")),
                    "appearance": state,
                    "appearance_states": states,
                    "_obj": obj,
                }
            )

    orphans = []
    ambiguous = []
    seen_widget_refs = {}
    for widget in widgets:
        name = widget["name"]
        has_parent = widget["parent_ref"] is not None
        if name is None:
            orphans.append({"page": widget["page"], "ref": widget["ref"], "reason": "widget has no /T and no /Parent that names it"})
            continue
        if not has_parent and (widget["ref"] not in canonical):
            orphans.append(
                {
                    "page": widget["page"],
                    "ref": widget["ref"],
                    "name": name,
                    "reason": "widget is not reachable from /AcroForm/Fields",
                }
            )
        if not has_parent and name in names:
            field = next((entry for entry in entries if entry["name"] == name), None)
            if field is not None and field["ref"] != widget["ref"]:
                ambiguous.append(
                    {
                        "name": name,
                        "widget_ref": widget["ref"],
                        "field_ref": field["ref"],
                        "detail": "widget and canonical field share a name but are separate objects without a /Parent link",
                    }
                )
        seen_widget_refs.setdefault(widget["ref"], name)

    duplicates = sorted({name for name in names if names.count(name) > 1})
    for name in duplicates:
        ambiguous.append({"name": name, "detail": "more than one top-level field carries this name"})

    need_appearances = False
    try:
        acroform = reader.trailer["/Root"].get("/AcroForm")
        if acroform is not None:
            need_appearances = bool(acroform.get_object().get("/NeedAppearances", False))
    except Exception:
        need_appearances = False

    return {
        "field_count": len(entries),
        "widget_count": len(widgets),
        "fields": [{key: value for key, value in entry.items() if key != "node"} for entry in entries],
        "widgets": [{key: value for key, value in widget.items() if key != "_obj"} for widget in widgets],
        "orphans": orphans,
        "ambiguous": ambiguous,
        "need_appearances": need_appearances,
    }


def normalise(value):
    if isinstance(value, bool):
        return "Yes" if value else "Off"
    text = "" if value is None else str(value)
    return text[1:] if text.startswith("/") else text


def values_for_field(field, value):
    if isinstance(value, bool):
        return "/Yes" if value else "/Off"
    if isinstance(value, (list, tuple)):
        return [str(item) for item in value]
    return str(value)


def flatten_widgets(path):
    """Paint every widget appearance into page content and drop the form."""
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import ArrayObject, DictionaryObject, FloatObject, NameObject, StreamObject

    reader = PdfReader(str(path))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)

    for page in writer.pages:
        annotations = page.get("/Annots")
        if not annotations:
            continue
        resources = page.get("/Resources")
        if resources is None:
            resources = DictionaryObject()
            page[NameObject("/Resources")] = resources
        resources = resources.get_object()
        xobjects = resources.get("/XObject")
        if xobjects is None:
            xobjects = DictionaryObject()
            resources[NameObject("/XObject")] = xobjects
        xobjects = xobjects.get_object()

        calls = []
        for index, annotation in enumerate(annotations):
            widget = annotation.get_object()
            if widget.get("/Subtype") != "/Widget":
                continue
            normal = widget.get("/AP")
            if normal is None:
                continue
            normal = normal.get_object().get("/N")
            if normal is None:
                continue
            normal = normal.get_object()
            if not hasattr(normal, "get_data"):
                if not hasattr(normal, "keys"):
                    continue
                state = widget.get("/AS")
                if state is None or normal.get(state) is None:
                    continue
                normal = normal[state].get_object()
            if not hasattr(normal, "get_data"):
                continue
            name = NameObject(f"/DSCJK{index}")
            xobjects[name] = normal.indirect_reference or normal
            rect = [float(value) for value in widget.get("/Rect") or []]
            bbox = [float(value) for value in normal.get("/BBox") or []]
            if len(rect) != 4 or len(bbox) != 4:
                continue
            x, y, x2, y2 = rect[0], rect[1], rect[2], rect[3]
            width = x2 - x
            height = y2 - y
            box_width = bbox[2] - bbox[0] or width
            box_height = bbox[3] - bbox[1] or height
            calls.append(
                f"q {width / box_width:.6f} 0 0 {height / box_height:.6f} {x:.4f} {y:.4f} cm {name} Do Q"
            )
        if not calls:
            continue
        stream = StreamObject()
        stream.set_data("\n".join(calls).encode("latin-1"))
        reference = writer._add_object(stream)
        existing = page.get("/Contents")
        if existing is None:
            page[NameObject("/Contents")] = reference
        elif hasattr(existing, "get_data"):
            page[NameObject("/Contents")] = ArrayObject([existing.indirect_reference or existing, reference])
        else:
            page[NameObject("/Contents")] = ArrayObject([*existing, reference])

    for page in writer.pages:
        page[NameObject("/Annots")] = ArrayObject()
    writer.root_object.pop(NameObject("/AcroForm"), None)
    with open(path, "wb") as handle:
        writer.write(handle)


def write_fill(args, values):
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(str(args.input))
    report = inspect_document(reader)
    if report["ambiguous"] and not (args.allow_ambiguous or args.flatten):
        report.update(
            {
                "ok": False,
                "error": "refusing to fill: the widget and field views disagree",
                "hint": "inspect the report, then rerun with --flatten for a static result or --allow-ambiguous if you are certain",
            }
        )
        emit(report, args.json_out)
        raise SystemExit(3)

    writer = PdfWriter()
    writer.clone_document_from_reader(reader)

    reattached = 0
    if not args.no_reattach:
        reattached = len(writer.reattach_fields() or [])

    fields = writer.get_fields() or {}
    expected = {name: values_for_field(fields[name], value) for name, value in values.items() if name in fields}
    missing = sorted(set(values) - set(fields))
    if missing:
        result = {
            "ok": False,
            "error": "fields named in the values file do not exist in this PDF",
            "missing": missing,
            "available": sorted(fields),
            "input": str(args.input),
        }
        emit(result, args.json_out)
        raise SystemExit(3)

    payload = dict(values)
    if args.flatten:
        current = {
            name: field.get("/V", "/Off" if field.get("/FT") == "/Btn" else "")
            for name, field in fields.items()
        }
        current.update(payload)
        payload = current
    payload = {name: values_for_field(fields[name], value) for name, value in payload.items()}

    cjk_values = {name: value for name, value in expected.items() if has_non_latin(value)}
    flatten = args.flatten
    if flatten and cjk_values:
        # pypdf can only flatten with base-14 fonts; keep the widgets, give them
        # real CJK appearances, then paint every appearance into the page.
        writer.update_page_form_field_values(None, payload, auto_regenerate=False, flatten=False)
        sync_button_states(writer)
    else:
        writer.update_page_form_field_values(None, payload, auto_regenerate=False, flatten=flatten)
        sync_button_states(writer)
        if flatten:
            writer.remove_annotations(subtypes="/Widget")
            writer.root_object.pop(NameObject("/AcroForm"), None)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    with open(args.out, "wb") as handle:
        writer.write(handle)

    cjk_rendered = rebuild_cjk_appearances(args.out, expected, args.font_file)
    if flatten and cjk_values:
        flatten_widgets(args.out)

    checks = verify(args.out, expected, flatten=args.flatten)
    rendered = render(args.out, args.render_dir, args.dpi)

    result = {
        "ok": all(check["ok"] for check in checks),
        "input": str(args.input),
        "output": str(args.out),
        "flatten": args.flatten,
        "reattached_fields": reattached,
        "cjk_appearance_fields": cjk_rendered,
        "written": expected,
        "checks": checks,
        "rendered_pages": rendered,
        "before": {
            "field_count": report["field_count"],
            "widget_count": report["widget_count"],
            "orphans": report["orphans"],
            "ambiguous": report["ambiguous"],
        },
    }
    emit(result, args.json_out)
    if not result["ok"]:
        raise SystemExit(4)


def sync_button_states(writer):
    """Point each button widget's /AS at the field /V, clearing stale kid values."""
    for page in writer.pages:
        for annotation in page.get("/Annots") or []:
            widget = annotation.get_object()
            if widget.get("/Subtype") != "/Widget" or inherited(widget, "/FT") != "/Btn":
                continue
            parent = widget.get("/Parent")
            source = parent.get_object() if parent is not None else widget
            value = source.get("/V") if source.get("/FT") == "/Btn" else None
            normal = widget.get("/AP")
            if normal is not None:
                normal = normal.get_object().get("/N")
            if normal is None or hasattr(normal, "get_data"):
                continue
            normal = normal.get_object()
            raw = str(value) if value is not None else None
            candidates = [] if raw is None else [raw, raw if raw.startswith("/") else f"/{raw}"]
            chosen = "/Off"
            for candidate in candidates:
                if normal.get(candidate) is not None:
                    chosen = candidate if candidate.startswith("/") else f"/{candidate}"
                    break
            widget[NameObject("/AS")] = NameObject(chosen)
            if "/V" in widget and parent is not None:
                del widget["/V"]


def verify(path, expected, flatten):
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    checks = []
    if not flatten:
        fields = reader.get_fields() or {}
        for name, wanted in expected.items():
            found = fields.get(name)
            if found is None:
                checks.append({"check": f"field {name} present", "ok": False, "expected": wanted, "actual": None})
                continue
            actual = scalar(found.get("/V"))
            checks.append(
                {
                    "check": f"field {name} /V",
                    "ok": normalise(actual) == normalise(wanted),
                    "expected": normalise(wanted),
                    "actual": normalise(actual),
                }
            )

    view = inspect_document(reader)
    widgets = view["widgets"]
    if flatten:
        checks.append({"check": "no widgets remain", "ok": len(widgets) == 0, "actual": len(widgets)})
        checks.append(
            {
                "check": "no form fields remain",
                "ok": not (reader.get_fields() or {}),
                "actual": sorted(reader.get_fields() or {}),
            }
        )
        checks.append(
            {
                "check": "/AcroForm removed",
                "ok": "/AcroForm" not in reader.trailer["/Root"],
                "actual": "/AcroForm" in reader.trailer["/Root"],
            }
        )
    else:
        grouped = {}
        for widget in widgets:
            grouped.setdefault(widget["name"], []).append(widget)
        for name, members in grouped.items():
            if name not in expected:
                continue
            wanted = normalise(expected[name])
            for widget in members:
                checks.append(
                    {
                        "check": f"widget {name} has an appearance stream",
                        "ok": widget["appearance"] in {"stream", "states"},
                        "page": widget["page"],
                        "appearance": widget["appearance"],
                        "states": widget["appearance_states"],
                    }
                )
            if members[0]["field_type"] == "/Btn":
                painted = [normalise(widget["value"]) for widget in members]
                if wanted == "Off":
                    ok = all(state == "Off" for state in painted)
                else:
                    ok = wanted in painted
                checks.append(
                    {
                        "check": f"button group {name} paints {wanted}",
                        "ok": ok,
                        "actual": painted,
                    }
                )
            else:
                for widget in members:
                    effective = normalise(widget["value"])
                    checks.append(
                        {
                            "check": f"widget {name} agrees with field /V",
                            "ok": effective == wanted,
                            "page": widget["page"],
                            "actual": effective,
                        }
                    )
    return checks


def render(path, out_dir, dpi):
    if not out_dir:
        return []
    try:
        import pymupdf
    except ImportError:  # pragma: no cover
        import fitz as pymupdf  # type: ignore[no-redef]
    out_dir.mkdir(parents=True, exist_ok=True)
    zoom = dpi / 72.0
    pages = []
    with pymupdf.open(str(path)) as document:
        for index, page in enumerate(document, start=1):
            target = out_dir / f"page-{index}.png"
            page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False).save(str(target))
            pages.append(str(target))
    return pages


def main():
    parser = argparse.ArgumentParser(
        description="Inspect or fill AcroForm fields, then verify the written values and appearances.",
        epilog="Example: forms.py fill --input form.pdf --out form-filled.pdf --values values.json",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    inspect_parser = commands.add_parser("inspect", help="Report fields, widgets, orphans, and collisions")
    inspect_parser.add_argument("--input", required=True, help="PDF file to inspect")
    inspect_parser.add_argument("--json-out", help="Also write the JSON report to this path")

    fill_parser = commands.add_parser("fill", help="Write values, optionally flatten, then verify")
    fill_parser.add_argument("--input", required=True, help="Source PDF; it is never modified")
    fill_parser.add_argument("--out", required=True, help="Destination PDF")
    fill_parser.add_argument(
        "--values",
        required=True,
        help='JSON object of {field: value}; accepts a file path, inline JSON, or "-" for stdin',
    )
    fill_parser.add_argument("--flatten", action="store_true", help="Paint values and remove every widget")
    fill_parser.add_argument("--font-file", help="TTF/OTF/TTC file used to paint non-Latin values")
    fill_parser.add_argument("--no-reattach", action="store_true", help="Do not repair widgets missing from /AcroForm/Fields")
    fill_parser.add_argument("--allow-ambiguous", action="store_true", help="Fill even when widget and field views disagree")
    fill_parser.add_argument("--render-dir", help="Rasterise the result here for a visual check")
    fill_parser.add_argument("--dpi", type=int, default=110, help="Render resolution (default: 110)")
    fill_parser.add_argument("--json-out", help="Also write the JSON report to this path")

    args = parser.parse_args()
    if args.command == "inspect":
        from pypdf import PdfReader

        source = Path(args.input).expanduser()
        if not source.is_file():
            fail(f"input not found: {source}", code=2)
        try:
            reader = PdfReader(str(source))
        except Exception as exc:
            fail(f"cannot open PDF: {exc}", code=2)
        report = inspect_document(reader)
        report.update({"ok": True, "input": str(source), "page_count": len(reader.pages)})
        emit(report, args.json_out)
        return

    source = Path(args.input).expanduser()
    if not source.is_file():
        fail(f"input not found: {source}", code=2)
    args.input = source
    args.out = Path(args.out).expanduser()
    if args.out.resolve() == source.resolve():
        fail("refusing to overwrite the source PDF; choose a different --out", code=3)
    if args.dpi < 24 or args.dpi > 600:
        fail("--dpi must be between 24 and 600")
    args.render_dir = Path(args.render_dir).expanduser() if args.render_dir else None
    write_fill(args, load_values(args.values))


if __name__ == "__main__":
    main()
