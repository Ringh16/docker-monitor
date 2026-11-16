"""Pydantic v2 schemas for Docker containers, telemetry ticks, and control actions."""

from typing import Any, Literal
from pydantic import BaseModel, Field


ContainerAction = Literal["start", "stop", "restart", "pause", "unpause"]
TelemetryMode = Literal["live", "simulated"]


class PortMapping(BaseModel):
    """Exposed container port mapping."""

    ip: str = "0.0.0.0"
    private_port: int
    public_port: int | None = None
    type: str = "tcp"


class ContainerSummary(BaseModel):
    """Normalized metadata for a local Docker container."""

    id: str = Field(..., description="Short 12-character container ID")
    name: str
    image: str
    status: str
    state_detail: str
    ports: list[PortMapping] = Field(default_factory=list)
    created_at: str
    uptime: str | None = None


class ContainerMetric(BaseModel):
    """Point-in-time CPU, memory, PID, and network telemetry for a running container."""

    id: str
    name: str
    status: str
    cpu_percent: float = Field(..., ge=0.0)
    memory_usage_mb: float = Field(..., ge=0.0)
    memory_limit_mb: float = Field(..., ge=0.0)
    memory_percent: float = Field(..., ge=0.0)
    pids: int = Field(0, ge=0)
    net_rx_mb: float = Field(0.0, ge=0.0)
    net_tx_mb: float = Field(0.0, ge=0.0)
    timestamp: str


class StatsBroadcastPayload(BaseModel):
    """WebSocket payload emitted every polling interval."""

    type: Literal["stats_tick"] = "stats_tick"
    mode: TelemetryMode
    timestamp: str
    interval_ms: int
    host_summary: dict[str, Any]
    containers: dict[str, ContainerMetric]


class ActionResponse(BaseModel):
    """Result returned after executing a container lifecycle action."""

    id: str
    name: str
    action: ContainerAction
    previous_status: str
    current_status: str
    message: str
    duration_ms: float


class ContainerLogsResponse(BaseModel):
    """Tail log lines for a container."""

    id: str
    name: str
    lines: list[str]
    mode: TelemetryMode


class HealthResponse(BaseModel):
    """Daemon connectivity and API health report."""

    status: Literal["ok", "degraded"]
    docker_connected: bool
    engine_version: str | None = None
    os_type: str | None = None
    architecture: str | None = None
    cpus: int | None = None
    memory_total_gb: float | None = None
    containers_total: int = 0
    containers_running: int = 0
    error: str | None = None
