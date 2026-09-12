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


if __name__ == "__main__":
    cli()
