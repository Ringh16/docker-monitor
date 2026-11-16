"""WebSocket connection manager and 2-second telemetry broadcast loop."""

from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from fastapi import WebSocket

from app.docker_service import DockerDaemonUnavailableError, DockerService

logger = logging.getLogger("docker_monitor.ws")


class TelemetryBroadcaster:
    """Manages active /ws/stats clients and broadcasts container telemetry every 2 seconds."""

    def __init__(self, docker_service: DockerService, interval_seconds: float = 2.0) -> None:
        self._docker_service = docker_service
        self._interval_seconds = interval_seconds
        self._connections: dict[WebSocket, bool] = {}
        self._lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None

    async def start(self) -> None:
        """Start the background telemetry polling loop."""
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._poll_and_broadcast(), name="telemetry-broadcaster")

    async def stop(self) -> None:
        """Cancel the background polling loop and close active sockets."""
        if self._task is not None:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task
            self._task = None

        async with self._lock:
            sockets = list(self._connections.keys())
            self._connections.clear()

        for ws in sockets:
            with suppress(Exception):
                await ws.close()

    async def connect(self, websocket: WebSocket, simulated: bool = False) -> None:
        """Accept a WebSocket client and immediately push an initial telemetry frame."""
        await websocket.accept()
        async with self._lock:
            self._connections[websocket] = simulated

        # Deliver immediate snapshot so the UI never waits 2 seconds on initial connect
        await self._send_single_snapshot(websocket, simulated)

    async def disconnect(self, websocket: WebSocket) -> None:
        """Remove a disconnected WebSocket client."""
        async with self._lock:
            self._connections.pop(websocket, None)

    async def _send_single_snapshot(self, websocket: WebSocket, simulated: bool) -> None:
        interval_ms = int(self._interval_seconds * 1000)
        try:
            payload = await self._docker_service.collect_stats(
                interval_ms=interval_ms,
                simulated=simulated,
            )
            await websocket.send_json(payload.model_dump())
        except DockerDaemonUnavailableError as exc:
            await websocket.send_json(
                {
                    "type": "error",
                    "code": "DOCKER_UNAVAILABLE",
                    "message": str(exc),
                }
            )
        except Exception as exc:  # noqa: BLE001
            logger.debug("Failed sending initial snapshot: %s", exc)

    async def _broadcast_group(self, sockets: list[WebSocket], simulated: bool) -> None:
        if not sockets:
            return

        interval_ms = int(self._interval_seconds * 1000)
        try:
            payload = await self._docker_service.collect_stats(
                interval_ms=interval_ms,
                simulated=simulated,
            )
            message = payload.model_dump()
        except DockerDaemonUnavailableError as exc:
            message = {
                "type": "error",
                "code": "DOCKER_UNAVAILABLE",
                "message": str(exc),
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error collecting telemetry: %s", exc)
            message = {
                "type": "error",
                "code": "TELEMETRY_ERROR",
                "message": "Unexpected telemetry polling error.",
            }

        stale_sockets: list[WebSocket] = []
        results = await asyncio.gather(
            *(ws.send_json(message) for ws in sockets),
            return_exceptions=True,
        )
        for ws, outcome in zip(sockets, results):
            if isinstance(outcome, Exception):
                stale_sockets.append(ws)

        if stale_sockets:
            async with self._lock:
                for ws in stale_sockets:
                    self._connections.pop(ws, None)

    async def _poll_and_broadcast(self) -> None:
        """Continuously emit telemetry snapshots at the configured interval while clients exist."""
        while True:
            async with self._lock:
                live_sockets = [ws for ws, sim in self._connections.items() if not sim]
                sim_sockets = [ws for ws, sim in self._connections.items() if sim]

            if live_sockets or sim_sockets:
                await asyncio.gather(
                    self._broadcast_group(live_sockets, simulated=False),
                    self._broadcast_group(sim_sockets, simulated=True),
                )

            await asyncio.sleep(self._interval_seconds)
