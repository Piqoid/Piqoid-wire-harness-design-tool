"""WebSocket validation channel."""
from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ...core.project_io import HarnessProject
from ...engine.validator import validate
from ..state import get_project_root

router = APIRouter()
log = logging.getLogger(__name__)

DEBOUNCE_MS = 100


@router.websocket("/ws/validate/{harness_name}")
async def ws_validate(websocket: WebSocket, harness_name: str):
    await websocket.accept()
    root = get_project_root()
    library_root = root / "library"

    async def run_and_send():
        proj = HarnessProject.load(root)
        if harness_name not in proj.harnesses:
            await websocket.send_json({"error": f"Harness '{harness_name}' not found"})
            return
        diagnostics = validate(proj, harness_name=harness_name, library_root=library_root)
        await websocket.send_json([d.as_dict() for d in diagnostics])

    try:
        # Send diagnostics immediately on connect
        await run_and_send()

        # Keep connection alive; client can send "refresh" to re-validate
        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if msg == "refresh":
                    await asyncio.sleep(DEBOUNCE_MS / 1000)
                    await run_and_send()
            except asyncio.TimeoutError:
                # Send a heartbeat ping
                await websocket.send_json({"ping": True})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.error("WS error: %s", e)
