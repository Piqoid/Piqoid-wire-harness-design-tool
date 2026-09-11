"""Start the development server."""
from __future__ import annotations

import logging
import socket
from pathlib import Path

import click
import uvicorn

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


def _find_free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@click.command()
@click.argument("project_path", default=".", type=click.Path(exists=True))
@click.option("--port", default=0, type=int, help="Port (0 = auto)")
@click.option("--host", default="127.0.0.1")
@click.option("--reload", "hot_reload", is_flag=True, default=False)
def serve(project_path: str, port: int, host: str, hot_reload: bool):
    """Start the harness tool server."""
    import os
    root = Path(project_path).resolve()
    os.environ["HARNESS_PROJECT_ROOT"] = str(root)

    if port == 0:
        port = _find_free_port()

    port_file = root / ".server_port"
    port_file.write_text(str(port))
    click.echo(f"Harness Tool server → http://{host}:{port}")
    click.echo(f"Project: {root}")

    try:
        uvicorn.run(
            f"app.server._factory:make",
            factory=True,
            host=host,
            port=port,
            reload=hot_reload,
            log_level="info",
        )
    finally:
        port_file.unlink(missing_ok=True)


if __name__ == "__main__":
    serve()
