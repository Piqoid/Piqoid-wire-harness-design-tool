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
from .routes.load import router as load_router, LAST_HARNESS_FILE, do_load

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent.parent / "static"


def create_app() -> FastAPI:
    app = FastAPI(title="Harness Tool API", version="0.1.0")

    @app.on_event("startup")
    async def _load():
        if LAST_HARNESS_FILE.exists():
            try:
                path = LAST_HARNESS_FILE.read_text(encoding="utf-8").strip()
                harness_name = do_load(Path(path))
                log.info("Auto-loaded harness '%s' from %s", harness_name, path)
            except Exception as e:
                log.warning("Could not auto-load last harness: %s", e)
        else:
            log.info("No last harness file found — waiting for user to open a folder")

    app.include_router(load_router)
    app.include_router(project_router)
    app.include_router(validation_router)
    app.include_router(entities_router)
    app.include_router(ws_router)

    if STATIC_DIR.exists() and any(STATIC_DIR.iterdir()):
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
        log.info("Serving static files from %s", STATIC_DIR)

    return app
