"""WebSocket validation channel."""
from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from ...core.project_io import HarnessData
from ...engine.validator import validate
from ..state import get_harness_dir, get_harness_name, get_project, is_loaded

router = APIRouter()
log = logging.getLogger(__name__)

DEBOUNCE_MS = 100


@router.websocket("/ws/validate/{harness_name}")
async def ws_validate(websocket: WebSocket, harness_name: str):
    await websocket.accept()

    async def run_and_send():
        if not is_loaded():
            await websocket.send_json({"error": "No harness loaded"})
            return
        # Reload harness data from disk so validation sees the latest saves.
        harness_data = HarnessData.load(get_harness_dir())
        proj = get_project()
        current_name = get_harness_name()
        proj.harnesses[current_name] = harness_data
        if current_name not in proj.harnesses:
            await websocket.send_json({"error": f"Harness '{current_name}' not found"})
            return
        library_root = get_harness_dir().parent / "library"
        diagnostics = validate(proj, harness_name=current_name, library_root=library_root)
        await websocket.send_json([d.as_dict() for d in diagnostics])

    try:
        await run_and_send()

        while True:
            try:
                msg = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                if msg == "refresh":
                    await asyncio.sleep(DEBOUNCE_MS / 1000)
                    await run_and_send()
            except asyncio.TimeoutError:
                await websocket.send_json({"ping": True})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.error("WS error: %s", e)
