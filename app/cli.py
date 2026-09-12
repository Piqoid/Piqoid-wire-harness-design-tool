"""harness CLI entry point."""
from __future__ import annotations

import sys
from pathlib import Path

import click

from .core.project_io import HarnessProject
from .engine.validator import format_json, format_text, validate


@click.group()
def cli():
    """Wiring harness design tool CLI."""


@cli.command()
@click.argument("project_path", type=click.Path(exists=True))
@click.option("--format", "fmt", type=click.Choice(["text", "json"]), default="text")
@click.option("--harness", "harness_name", default=None, help="Validate a specific harness")
@click.option("--library", "library_path", default=None, type=click.Path())
def validate(project_path, fmt, harness_name, library_path):
    """Validate a harness project and report diagnostics."""
    root = Path(project_path)
    try:
        project = HarnessProject.load(root)
    except Exception as e:
        click.echo(f"ERROR: Failed to load project: {e}", err=True)
        sys.exit(1)

    lib_root = Path(library_path) if library_path else root / "library"

    from .engine.validator import validate as _validate
    diagnostics = _validate(project, harness_name=harness_name, library_root=lib_root)

    if fmt == "json":
        click.echo(format_json(diagnostics), nl=False)
    else:
        click.echo(format_text(diagnostics), nl=False)

    # Exit 1 if any unwaived errors
    has_errors = any(
        d.severity == "error" and not d.waived
        for d in diagnostics
    )
    if has_errors:
        sys.exit(1)


@cli.command("fmt")
@click.argument("project_path", type=click.Path(exists=True))
def fmt_cmd(project_path):
    """Re-write all project files in canonical form."""
    root = Path(project_path)
    try:
        project = HarnessProject.load(root)
    except Exception as e:
        click.echo(f"ERROR: Failed to load project: {e}", err=True)
        sys.exit(1)

    modified = project.fmt()
    if modified:
        click.echo(f"Formatted {len(modified)} file(s):")
        for p in modified:
            click.echo(f"  {p}")
    else:
        click.echo("All files already in canonical form.")


@cli.command("serve")
@click.argument("project_path", default=".", type=click.Path(exists=True))
@click.option("--port", default=0, type=int, help="Port (0 = auto-select)")
@click.option("--host", default="127.0.0.1")
def serve_cmd(project_path, port, host):
    """Start the harness tool web server."""
    import os
    os.environ["HARNESS_PROJECT_ROOT"] = str(Path(project_path).resolve())
    from .server.run import serve
    from click.testing import CliRunner
    # Invoke directly via the run module
    import uvicorn
    import socket

    root = Path(project_path).resolve()
    os.environ["HARNESS_PROJECT_ROOT"] = str(root)
    if port == 0:
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
    (root / ".server_port").write_text(str(port))
    click.echo(f"Harness Tool server → http://{host}:{port}")
    try:
        uvicorn.run(
            "app.server._factory:make",
            factory=True,
            host=host,
            port=port,
            log_level="info",
        )
    finally:
        p = root / ".server_port"
        if p.exists():
            p.unlink()


@cli.command("schema")
@click.option("--output", "-o", default=None, type=click.Path(), help="Output file (default: stdout)")
def schema_cmd(output):
    """Export JSON Schema for all entity types."""
    import json
    from .models.bus import Bus
    from .models.bundle import Bundle
    from .models.cable import Cable
    from .models.link import Link
    from .models.net import Net
    from .models.node import Node, NodePort
    from .models.pair import DifferentialPair
    from .models.project import ProjectMeta
    from .models.segment import Segment
    from .models.signal import SignalProfile
    from .models.splice import Splice

    schemas = {}
    for model in [
        SignalProfile, Node, NodePort, Net, Segment,
        Bus, Cable, Bundle, DifferentialPair, Link, Splice, ProjectMeta,
    ]:
        schemas[model.__name__] = model.model_json_schema()

    out = json.dumps(schemas, indent=2, ensure_ascii=False) + "\n"
    if output:
        Path(output).write_text(out, encoding="utf-8")
        click.echo(f"Schema written to {output}")
    else:
        click.echo(out, nl=False)


@cli.command("export")
@click.argument("harness_path", type=click.Path(exists=True))
@click.option("--format", "fmt", type=click.Choice([
    "cut-list", "bom", "netlist-csv", "netlist-net",
    "pinouts", "wire-labels", "svg", "report-json", "report-html", "pqh", "all",
]), default="pqh", show_default=True)
@click.option("--harness", "harness_name", default=None, help="Harness folder name (auto-detected if only one)")
@click.option("--output", "-o", default=None, type=click.Path(), help="Output file or directory")
@click.option("--library", "library_path", default=None, type=click.Path())
def export_cmd(harness_path, fmt, harness_name, output, library_path):
    """Export harness data to various formats."""
    import json as _json
    from .core.project_io import HarnessData, HarnessProject
    from .exports import bom as _bom, cut_list as _cl, connector_pinout as _cp
    from .exports import netlist as _nl, report as _rpt, svg_topology as _svg, wire_labels as _wl
    from .exports import pqh as _pqh

    hpath = Path(harness_path)

    # Support loading a bare harness folder or a project root
    if (hpath / "nodes.json").exists() or (hpath / "nets.json").exists():
        # bare harness folder
        harness = HarnessData.load(hpath)
        hname = harness_name or hpath.name

        # Build a minimal synthetic project for pqh/validate
        from .models.project import ProjectMeta
        proj = HarnessProject(hpath.parent)
        proj.meta = ProjectMeta(id=hname, name=hname, schema_version=1, tag_defs=[], display_rules=[], waivers=[])
        proj.harnesses = {hname: harness}
    else:
        try:
            proj = HarnessProject.load(hpath)
        except FileNotFoundError as e:
            click.echo(f"ERROR: {e}", err=True)
            sys.exit(1)
        names = list(proj.harnesses.keys())
        if not names:
            click.echo("ERROR: No harnesses found in project", err=True)
            sys.exit(1)
        hname = harness_name or names[0]
        harness = proj.harnesses.get(hname)
        if harness is None:
            click.echo(f"ERROR: Harness '{hname}' not found. Available: {names}", err=True)
            sys.exit(1)

    lib_root = Path(library_path) if library_path else hpath.parent / "library"

    def _out_path(default_name: str) -> Path:
        if output:
            p = Path(output)
            if p.is_dir():
                return p / default_name
            return p
        return Path(default_name)

    def _write(path: Path, data):
        if isinstance(data, str):
            path.write_text(data, encoding="utf-8")
        else:
            path.write_bytes(data)
        click.echo(f"  -> {path}")

    formats = [fmt] if fmt != "all" else [
        "cut-list", "bom", "netlist-csv", "netlist-net",
        "pinouts", "wire-labels", "svg", "report-json", "report-html", "pqh",
    ]

    # When outputting multiple formats, treat output as a directory
    if len(formats) > 1 and output:
        out_dir = Path(output)
        out_dir.mkdir(parents=True, exist_ok=True)

    for f in formats:
        if f == "cut-list":
            _write(_out_path("cut_list.csv"), _cl.generate(harness))
        elif f == "bom":
            _write(_out_path("bom.csv"), _bom.generate(harness))
        elif f == "netlist-csv":
            _write(_out_path("netlist.csv"), _nl.generate_csv(harness))
        elif f == "netlist-net":
            _write(_out_path("netlist.net"), _nl.generate_kicad_net(harness, hname))
        elif f == "pinouts":
            _write(_out_path("pinouts.csv"), _cp.generate_combined_csv(harness))
        elif f == "wire-labels":
            _write(_out_path("wire_labels.csv"), _wl.generate(harness))
        elif f == "svg":
            _write(_out_path("topology.svg"), _svg.generate(harness))
        elif f == "report-json":
            from .engine.validator import validate as _validate
            diags = _validate(proj, harness_name=hname, library_root=lib_root)
            _write(_out_path("report.json"), _rpt.generate_json(diags))
        elif f == "report-html":
            from .engine.validator import validate as _validate
            diags = _validate(proj, harness_name=hname, library_root=lib_root)
            _write(_out_path(f"report_{hname}.html"), _rpt.generate_html(diags, hname))
        elif f == "pqh":
            # Bare harness folder: hpath IS the harness dir; project root: hpath/harness/hname
            if (hpath / "nodes.json").exists() or (hpath / "nets.json").exists():
                _hdir = hpath
            else:
                _hdir = hpath / "harness" / hname
            data = _pqh.export_pqh(
                proj, harness_name=hname,
                library_root=lib_root if lib_root.exists() else None,
                harness_dir=_hdir if _hdir.exists() else None,
            )
            _write(_out_path(f"{hname}.pqh"), data)


@cli.command("import")
@click.argument("pqh_file", type=click.Path(exists=True))
@click.option("--into", "target_dir", default=".", type=click.Path(), help="Target directory")
@click.option("--mode", type=click.Choice(["new", "merge", "library_only"]), default="new", show_default=True)
@click.option("--conflict-policy", type=click.Choice(["skip", "import_new"]), default="skip", show_default=True)
def import_cmd(pqh_file, target_dir, mode, conflict_policy):
    """Import a .pqh portable bundle."""
    from .exports import pqh as _pqh

    raw = Path(pqh_file).read_bytes()
    result = _pqh.import_pqh(raw, Path(target_dir), mode=mode, conflict_policy=conflict_policy)

    click.echo(f"Imported harnesses: {result['imported_harnesses'] or '(none)'}")
    if result["library_conflicts"]:
        click.echo(f"Library conflicts ({len(result['library_conflicts'])}):")
        for c in result["library_conflicts"]:
            click.echo(f"  {c}")
    if result["diagnostics"]:
        for d in result["diagnostics"]:
            click.echo(f"  [{d['severity'].upper()}] {d['rule_id']}: {d['message']}")
    else:
        click.echo("Import complete — no issues.")


@cli.command("diff")
@click.argument("pqh_a", type=click.Path(exists=True))
@click.argument("pqh_b", type=click.Path(exists=True))
@click.option("--format", "fmt", type=click.Choice(["text", "json"]), default="text")
def diff_cmd(pqh_a, pqh_b, fmt):
    """Diff two .pqh bundles by file checksums."""
    import json as _json
    from .exports import pqh as _pqh

    a = Path(pqh_a).read_bytes()
    b = Path(pqh_b).read_bytes()
    result = _pqh.diff_pqh(a, b)

    if fmt == "json":
        click.echo(_json.dumps(result, indent=2))
        return

    click.echo(f"Summary: {result['summary']}")
    if result["added"]:
        click.echo(f"\nAdded ({len(result['added'])}):")
        for f in result["added"]:
            click.echo(f"  + {f}")
    if result["removed"]:
        click.echo(f"\nRemoved ({len(result['removed'])}):")
        for f in result["removed"]:
            click.echo(f"  - {f}")
    if result["changed"]:
        click.echo(f"\nChanged ({len(result['changed'])}):")
        for f in result["changed"]:
            click.echo(f"  ~ {f}")
    if not (result["added"] or result["removed"] or result["changed"]):
        click.echo("Bundles are identical.")


if __name__ == "__main__":
    cli()
