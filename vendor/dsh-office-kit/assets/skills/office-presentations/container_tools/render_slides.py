"""Render a deck to PNGs, one per slide, using whatever engine is available.

Purpose: the verification loop needs pixels. Ask the plugin CLI first: it renders
through the DSH LibreOffice kit. When that is unavailable, fall back to the draft
geometry renderer in `preview_render.py` and say so loudly in the JSON — a draft
preview proves placement, not typography.

Inputs may be a .pptx or a .pdf. Output is `<out-dir>/slide-NN.png` for every
page, plus `<out-dir>/render.json`.

Exit codes:
  0  at least one page rendered
  2  input missing or unreadable
  3  no engine produced output
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))


def office_cli() -> Path:
    """The plugin's helper CLI, which owns renderer discovery."""
    return Path(__file__).resolve().parents[4] / "python" / "office_cli.py"


def rasterise_pdf(pdf_path: Path, out_dir: Path, dpi: int) -> list[str]:
    try:
        import pymupdf as fitz
    except ImportError:  # pragma: no cover
        import fitz

    files: list[str] = []
    document = fitz.open(str(pdf_path))
    try:
        zoom = dpi / 72.0
        for index, page in enumerate(document, start=1):
            png = out_dir / f"slide-{index:02d}.png"
            page.get_pixmap(matrix=fitz.Matrix(zoom, zoom)).save(str(png))
            files.append(str(png))
    finally:
        document.close()
    return files


def render_with_office(source: Path, out_dir: Path, dpi: int) -> dict:
    """Export through the CLI, which renders with the bundled LibreOffice kit."""
    scratch = Path(tempfile.mkdtemp(prefix="dsh-render-"))
    try:
        completed = subprocess.run(
            [sys.executable, str(office_cli()), "pptx", "render",
             "--input", str(source), "--out-dir", str(scratch), "--dpi", str(dpi)],
            capture_output=True, text=True, timeout=300, check=False,
        )
        if completed.returncode != 0:
            raise RuntimeError((completed.stderr or completed.stdout or "render failed").strip()[:400])
        report = json.loads(completed.stdout)
        files: list[str] = []
        for index, page in enumerate(report.get("pages") or [], start=1):
            target = out_dir / f"slide-{index:02d}.png"
            shutil.move(page, target)
            files.append(str(target))
        return {
            "ok": bool(files),
            "engine": report.get("renderer") or "office",
            "fidelity": "faithful",
            "slides": len(files),
            "dpi": dpi,
            "files": files,
        }
    finally:
        shutil.rmtree(scratch, ignore_errors=True)


def render(input_path: str | Path, out_dir: str | Path, dpi: int = 110, engine: str = "auto", width: int = 1600) -> dict:
    source = Path(input_path)
    destination = Path(out_dir)
    if not source.is_file():
        return {"ok": False, "error": {"code": "input_missing", "message": f"no such file: {source}"}}
    destination.mkdir(parents=True, exist_ok=True)

    if source.suffix.lower() == ".pdf":
        files = rasterise_pdf(source, destination, dpi)
        return {"ok": bool(files), "engine": "pdf-raster", "fidelity": "faithful", "slides": len(files), "dpi": dpi, "files": files}

    notes: list[str] = []
    if engine in {"auto", "office"}:
        try:
            return render_with_office(source, destination, dpi)
        except Exception as exc:  # noqa: BLE001 - fall through to the draft engine
            notes.append(f"office render failed: {exc}")

    if engine == "office":
        return {"ok": False, "engine": "office", "notes": notes, "error": {"code": "no_engine", "message": "the DSH LibreOffice renderer is not available (see office_status)"}}

    from preview_render import render_preview

    report = render_preview(source, destination, width)
    report["notes"] = notes + [
        "Draft preview: geometry is exact, type is approximate. Treat colours and fonts as indicative only.",
    ]
    report["files"] = [str(Path(item).resolve()) for item in report["files"]]
    return report


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Render a .pptx or .pdf into one PNG per page.")
    parser.add_argument("--input", required=True, help="deck or PDF to render")
    parser.add_argument("--out-dir", required=True, help="directory for slide-NN.png and render.json")
    parser.add_argument("--dpi", type=int, default=110, help="raster dpi when a real renderer is used (default 110)")
    parser.add_argument("--width", type=int, default=1600, help="pixel width for the draft renderer (default 1600)")
    parser.add_argument("--engine", choices=("auto", "office", "draft"), default="auto", help="force an engine (default auto)")
    parser.add_argument("--json-out", help="also write the report here")
    args = parser.parse_args(argv)

    report = render(args.input, args.out_dir, args.dpi, args.engine, args.width)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "render.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if args.json_out:
        Path(args.json_out).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    json.dump(report, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    if report.get("ok"):
        return 0
    return 2 if report.get("error", {}).get("code") == "input_missing" else 3


if __name__ == "__main__":
    raise SystemExit(main())
