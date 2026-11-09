#!/usr/bin/env python3
"""Validate the Office runtime that the format skills promise.

Imports every distribution listed in python/requirements.txt, then asks the
helper CLI for its own `status` report (packages and renderers) and fails with
a readable message when anything the skills depend on is missing.

Exit codes:
  0  all required packages import and the helper CLI answered
  1  one or more required packages is missing or fails to import
  2  helper CLI missing, crashed, or did not return a status report
  3  bad path or argument
  4  --require-renderer was given and no document renderer was found
"""

from __future__ import annotations

import argparse
import importlib
import importlib.metadata
import json
import re
import subprocess
import sys
from pathlib import Path

# Windows consoles default to a legacy code page; every payload is UTF-8 JSON.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

DEFAULT_ROOT = Path(__file__).resolve().parents[3]
RENDERER_HINT = (
    "docx/pptx/xlsx rendering needs the DSH LibreOffice kit, which ships with DeepSeek Harness; "
    "pdf rendering needs only PyMuPDF"
)


def canonical(name: str) -> str:
    """Normalise a distribution name the way packaging does."""
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_requirements(path: Path) -> list[str]:
    """Return distribution names from a requirements file, one per line."""
    names: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.split("#", 1)[0].strip()
        if not line or line.startswith("-"):
            continue
        line = line.split(";", 1)[0].strip()
        name = re.split(r"[<>=!~\[( ]", line, maxsplit=1)[0].strip()
        if name and canonical(name) not in {canonical(n) for n in names}:
            names.append(name)
    return names


def module_map() -> dict[str, list[str]]:
    """Map canonical distribution name -> its top-level import modules."""
    mapping: dict[str, list[str]] = {}
    for module, dists in importlib.metadata.packages_distributions().items():
        for dist in dists:
            mapping.setdefault(canonical(dist), []).append(module)
    return mapping


def check_packages(requirements: list[str]) -> list[dict]:
    """Import each distribution's modules and report per-package state."""
    mapping = module_map()
    results = []
    for name in requirements:
        key = canonical(name)
        modules = sorted(mapping.get(key, []))
        if "pymupdf" in modules:
            # PyMuPDF ships a legacy `fitz` alias that prints a deprecation warning.
            modules = [m for m in modules if m != "fitz"]
        entry: dict = {"distribution": name, "modules": modules}
        try:
            entry["version"] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            entry.update(ok=False, error="not installed for this interpreter")
            results.append(entry)
            continue
        failures = []
        for module in modules:
            try:
                importlib.import_module(module)
            except Exception as exc:  # noqa: BLE001 - report any import failure verbatim
                failures.append(f"{module}: {type(exc).__name__}: {exc}")
        if failures:
            entry.update(ok=False, error="; ".join(failures))
        else:
            entry.update(ok=True)
        results.append(entry)
    return results


def cli_status(python: Path, cli: Path, timeout: float) -> dict:
    """Run `<python> <cli> status` and return the parsed JSON report."""
    proc = subprocess.run(
        [str(python), str(cli), "status"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        cwd=str(cli.parent),
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"status exited {proc.returncode}: "
            f"{(proc.stderr or proc.stdout).strip()[:800]}"
        )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"status did not print JSON: {exc}") from exc


def renderer_summary(report: dict) -> dict:
    """Reduce the CLI renderer block to a simple availability answer."""
    renderers = report.get("renderers") or {}
    kit = renderers.get("kit") or {}
    can_render = renderers.get("can_render") or {}
    available = {
        "kit": {
            "available": bool(kit.get("available")),
            "backend": kit.get("backend") or None,
            "version": kit.get("version") or None,
            "error": kit.get("error") or None,
            "remedy": kit.get("remedy") or None,
        },
        "can_render": {k: bool(can_render.get(k)) for k in ("docx", "pptx", "xlsx", "pdf")},
    }
    available["any"] = bool(available["can_render"]["docx"])
    return available


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate the Office runtime the skills promise (packages + renderer status).",
    )
    parser.add_argument("--python", default=sys.executable, help="interpreter to validate (default: this one)")
    parser.add_argument(
        "--requirements",
        default=str(DEFAULT_ROOT / "python" / "requirements.txt"),
        help="requirements file (default: <plugin>/python/requirements.txt)",
    )
    parser.add_argument(
        "--cli",
        default=str(DEFAULT_ROOT / "python" / "office_cli.py"),
        help="helper CLI path (default: <plugin>/python/office_cli.py)",
    )
    parser.add_argument("--require-renderer", action="store_true", help="exit 4 when no document renderer is installed")
    parser.add_argument("--timeout", type=float, default=180.0, help="seconds allowed for the status call")
    parser.add_argument("--json", action="store_true", help="print one JSON object instead of prose")
    args = parser.parse_args(argv)

    python = Path(args.python)
    requirements_path = Path(args.requirements)
    cli = Path(args.cli)
    for label, path in (("requirements", requirements_path), ("cli", cli)):
        if not path.is_file():
            print(f"error: {label} file not found: {path}", file=sys.stderr)
            return 3
    if not python.exists():
        print(f"error: interpreter not found: {python}", file=sys.stderr)
        return 3

    requirements = parse_requirements(requirements_path)
    if not requirements:
        print(f"error: no packages listed in {requirements_path}", file=sys.stderr)
        return 3

    packages = check_packages(requirements)
    missing = [p["distribution"] for p in packages if not p["ok"]]

    report: dict = {
        "ok": False,
        "python": {"executable": str(python), "version": sys.version.split()[0] if python == Path(sys.executable) else None},
        "requirements": {"path": str(requirements_path), "distributions": requirements},
        "cli": {"path": str(cli)},
        "packages": packages,
        "missing": missing,
        "warnings": [],
    }

    if missing:
        report["error"] = f"{len(missing)} of {len(requirements)} required package(s) missing: {', '.join(missing)}"
        report["remedy"] = f'"{python}" -m pip install -r "{requirements_path}"'
        emit(args, report)
        return 1

    try:
        status = cli_status(python, cli, args.timeout)
    except (OSError, subprocess.SubprocessError, RuntimeError) as exc:
        report["error"] = f"helper CLI status failed: {exc}"
        emit(args, report)
        return 2

    if status.get("command") != "status":
        report["error"] = "helper CLI did not identify itself as the status command"
        emit(args, report)
        return 2

    cli_python = (status.get("python") or {}).get("executable")
    report["python"]["version"] = (status.get("python") or {}).get("version") or report["python"]["version"]
    if cli_python and Path(cli_python).resolve() != python.resolve():
        report["warnings"].append(f"status reported a different interpreter: {cli_python}")

    cli_missing = [p.get("package") for p in status.get("packages") or [] if not p.get("installed")]
    if cli_missing:
        report["error"] = f"status disagrees with direct imports; still missing: {', '.join(str(p) for p in cli_missing)}"
        emit(args, report)
        return 2

    renderers = renderer_summary(status)
    report["renderers"] = renderers
    if not renderers["any"]:
        report["warnings"].append(f"no document renderer found: {RENDERER_HINT}")
        if args.require_renderer:
            report["error"] = "no document renderer found (--require-renderer)"
            emit(args, report)
            return 4

    report["ok"] = True
    emit(args, report)
    return 0


def emit(args: argparse.Namespace, report: dict) -> None:
    """Print the machine report or a short human summary."""
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return

    print(f"interpreter  {report['python']['executable']}  (python {report['python']['version'] or '?'})")
    print(f"requirements {report['requirements']['path']}  ({len(report['requirements']['distributions'])} distributions)")
    for item in report["packages"]:
        mark = "ok  " if item["ok"] else "FAIL"
        detail = item.get("version") or item.get("error", "")
        modules = f"  ({', '.join(item['modules'])})" if item["modules"] else ""
        print(f"  [{mark}] {item['distribution']:<16} {detail}{modules}")
    if "renderers" in report:
        r = report["renderers"]
        kit = r["kit"]
        detail = f"backend={kit['backend'] or 'none'}"
        if kit["error"]:
            detail += f"; error={kit['error']}"
        print(f"renderer     libreoffice-kit available={kit['available']} {detail}; "
              f"can_render={r['can_render']}")
    for warning in report["warnings"]:
        print(f"warning      {warning}")
    if report.get("error"):
        print(f"FAILED       {report['error']}", file=sys.stderr)
        if report.get("remedy"):
            print(f"remedy       {report['remedy']}", file=sys.stderr)
        return
    print(f"OK           {len(report['packages'])}/{len(report['packages'])} packages import; helper CLI status matches")


if __name__ == "__main__":
    sys.exit(main())
