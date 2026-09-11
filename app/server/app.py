"""FastAPI application factory."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .routes.project import router as project_router
from .routes.validation import router as validation_router
from .routes.entities import router as entities_router
from .routes.ws import router as ws_router
from . import state

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent.parent / "static"


def create_app(project_root: Path) -> FastAPI:
    from ..core.project_io import HarnessProject

    app = FastAPI(title="Harness Tool API", version="0.1.0")

    @app.on_event("startup")
    async def _load():
        proj = HarnessProject.load(project_root)
        state.set_project(proj)
        log.info("Loaded project: %s  (%d harness(es))",
                 proj.meta.name, len(proj.harnesses))

    app.include_router(project_router)
    app.include_router(validation_router)
    app.include_router(entities_router)
    app.include_router(ws_router)

    # Serve the built React app if the static directory exists.
    # In dev mode, Vite dev server proxies the API, so the static dir may not
    # be built yet — that's fine.
    if STATIC_DIR.exists() and any(STATIC_DIR.iterdir()):
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
        log.info("Serving static files from %s", STATIC_DIR)

    return app
