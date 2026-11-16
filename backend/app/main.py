"""FastAPI entrypoint exposing REST container endpoints and /ws/stats telemetry."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.docker_service import (
    ContainerNotFoundError,
    DockerDaemonUnavailableError,
    DockerService,
    DockerServiceError,
    InvalidStateTransitionError,
)
from app.schemas import (
    ActionResponse,
    ContainerAction,
    ContainerLogsResponse,
    ContainerSummary,
    HealthResponse,
)
from app.ws_manager import TelemetryBroadcaster

settings = get_settings()
docker_service = DockerService()
broadcaster = TelemetryBroadcaster(
    docker_service=docker_service,
    interval_seconds=settings.stats_interval_seconds,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Manage background WebSocket telemetry lifecycle cleanly."""
    await broadcaster.start()
    try:
        yield
    finally:
        await broadcaster.stop()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _validate_simulated_flag(simulated: bool) -> bool:
    if simulated and not settings.allow_simulated_fallback:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Simulated mode is disabled by server configuration.",
        )
    return simulated


def _raise_http_from_service_error(exc: DockerServiceError) -> None:
    if isinstance(exc, ContainerNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    if isinstance(exc, InvalidStateTransitionError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    if isinstance(exc, DockerDaemonUnavailableError):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc


@app.get("/api/health", response_model=HealthResponse)
async def get_health() -> HealthResponse:
    """Report local Docker daemon status, engine version, and host capacity."""
    return await docker_service.get_health()


@app.get("/api/containers", response_model=list[ContainerSummary])
async def list_containers(
    simulated: bool = Query(default=False, description="Use simulated host containers when daemon is offline"),
) -> list[ContainerSummary]:
    """List all local Docker containers (running, paused, exited) with key metadata."""
    use_simulated = _validate_simulated_flag(simulated)
    try:
        return await docker_service.list_containers(simulated=use_simulated)
    except DockerServiceError as exc:
        _raise_http_from_service_error(exc)


@app.post("/api/containers/{container_id}/actions/{action}", response_model=ActionResponse)
async def execute_container_action(
    container_id: str,
    action: ContainerAction,
    simulated: bool = Query(default=False),
) -> ActionResponse:
    """Safely execute lifecycle actions (start, stop, restart, pause, unpause) on a container."""
    use_simulated = _validate_simulated_flag(simulated)
    try:
        return await docker_service.execute_action(
            container_id=container_id,
            action=action,
            simulated=use_simulated,
        )
    except DockerServiceError as exc:
        _raise_http_from_service_error(exc)


@app.get("/api/containers/{container_id}/logs", response_model=ContainerLogsResponse)
async def get_container_logs(
    container_id: str,
    tail: int = Query(default=settings.log_tail_lines, ge=10, le=500),
    simulated: bool = Query(default=False),
) -> ContainerLogsResponse:
    """Retrieve recent container logs for the inspector drawer."""
    use_simulated = _validate_simulated_flag(simulated)
    try:
        return await docker_service.get_logs(
            container_id=container_id,
            tail=tail,
            simulated=use_simulated,
        )
    except DockerServiceError as exc:
        _raise_http_from_service_error(exc)


@app.websocket("/ws/stats")
async def websocket_stats(
    websocket: WebSocket,
    simulated: bool = Query(default=False),
) -> None:
    """Stream container CPU and RAM telemetry every 2 seconds over native WebSockets."""
    use_simulated = simulated and settings.allow_simulated_fallback
    await broadcaster.connect(websocket, simulated=use_simulated)
    try:
        while True:
            # Keep connection open and allow optional client ping/keepalive frames
            await websocket.receive_text()
    except WebSocketDisconnect:
        await broadcaster.disconnect(websocket)
    except Exception:
        await broadcaster.disconnect(websocket)
