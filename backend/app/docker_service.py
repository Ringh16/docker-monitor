"""Asynchronous wrapper around the official Docker SDK with live and simulated telemetry."""

from __future__ import annotations

import asyncio
import math
import random
import threading
import time
from datetime import datetime, timezone
from typing import Any

import docker
from docker.errors import APIError, DockerException, NotFound

from app.schemas import (
    ActionResponse,
    ContainerAction,
    ContainerLogsResponse,
    ContainerMetric,
    ContainerSummary,
    HealthResponse,
    PortMapping,
    StatsBroadcastPayload,
)


class DockerServiceError(Exception):
    """Base error for Docker service failures."""


class DockerDaemonUnavailableError(DockerServiceError):
    """Raised when the local Docker socket or named pipe cannot be reached."""


class ContainerNotFoundError(DockerServiceError):
    """Raised when a container ID or name does not exist."""


class InvalidStateTransitionError(DockerServiceError):
    """Raised when a lifecycle action is invalid for the container's current state."""


ALLOWED_TRANSITIONS: dict[ContainerAction, set[str]] = {
    "start": {"exited", "created", "dead"},
    "stop": {"running", "paused", "restarting"},
    "restart": {"running", "paused", "exited", "restarting"},
    "pause": {"running"},
    "unpause": {"paused"},
}


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _parse_ports(raw_ports: dict[str, Any] | None) -> list[PortMapping]:
    """Normalize Docker SDK port mapping dictionary into structured PortMapping items."""
    if not raw_ports:
        return []

    parsed: list[PortMapping] = []
    seen: set[tuple[str, int, int | None, str]] = set()

    for container_port_proto, bindings in raw_ports.items():
        port_part, _, proto = container_port_proto.partition("/")
        try:
            private_port = int(port_part)
        except ValueError:
            continue
        protocol = proto or "tcp"

        if not bindings:
            key = ("", private_port, None, protocol)
            if key not in seen:
                seen.add(key)
                parsed.append(
                    PortMapping(
                        ip="",
                        private_port=private_port,
                        public_port=None,
                        type=protocol,
                    )
                )
            continue

        for binding in bindings:
            host_ip = binding.get("HostIp") or "0.0.0.0"
            raw_host_port = binding.get("HostPort")
            public_port = int(raw_host_port) if raw_host_port and raw_host_port.isdigit() else None
            key = (host_ip, private_port, public_port, protocol)
            if key not in seen:
                seen.add(key)
                parsed.append(
                    PortMapping(
                        ip=host_ip,
                        private_port=private_port,
                        public_port=public_port,
                        type=protocol,
                    )
                )

    parsed.sort(key=lambda item: (item.public_port or 999999, item.private_port))
    return parsed


def _format_uptime(state: dict[str, Any], status: str) -> str | None:
    """Compute a concise human-readable duration from Docker container state timestamps."""
    raw_ts = state.get("StartedAt") if status in {"running", "paused", "restarting"} else state.get("FinishedAt")
    if not raw_ts or raw_ts.startswith("0001-01-01"):
        return None
    try:
        cleaned = raw_ts.replace("Z", "+00:00")
        # Truncate sub-microsecond precision if Docker returns 9 fractional digits
        if "." in cleaned:
            head, tail = cleaned.split(".", 1)
            tz_idx = max(tail.find("+"), tail.find("-"))
            if tz_idx != -1:
                frac = tail[:tz_idx][:6]
                tz_part = tail[tz_idx:]
                cleaned = f"{head}.{frac}{tz_part}"
            else:
                cleaned = f"{head}.{tail[:6]}"
        dt = datetime.fromisoformat(cleaned)
        seconds = max(0, int((datetime.now(timezone.utc) - dt).total_seconds()))
    except ValueError:
        return None

    if seconds < 60:
        return f"{seconds}s"
    minutes, sec = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m {sec}s"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes}m"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours}h"


def calculate_cpu_percent(stats: dict[str, Any]) -> float:
    """Compute CPU utilization using the official Docker CLI delta formula."""
    cpu_stats = stats.get("cpu_stats") or {}
    precpu_stats = stats.get("precpu_stats") or {}

    cpu_usage = cpu_stats.get("cpu_usage") or {}
    precpu_usage = precpu_stats.get("cpu_usage") or {}

    cpu_delta = cpu_usage.get("total_usage", 0) - precpu_usage.get("total_usage", 0)
    system_delta = cpu_stats.get("system_cpu_usage", 0) - precpu_stats.get("system_cpu_usage", 0)

    if cpu_delta <= 0 or system_delta <= 0:
        return 0.0

    percpu = cpu_usage.get("percpu_usage") or []
    online_cpus = cpu_stats.get("online_cpus") or len(percpu) or 1
    percent = (cpu_delta / system_delta) * online_cpus * 100.0
    return round(max(0.0, percent), 2)


def calculate_memory_stats(stats: dict[str, Any]) -> tuple[float, float, float]:
    """Compute used MB, limit MB, and memory percentage accounting for cgroup cache."""
    mem_stats = stats.get("memory_stats") or {}
    usage = float(mem_stats.get("usage") or 0.0)
    limit = float(mem_stats.get("limit") or 0.0)
    details = mem_stats.get("stats") or {}

    # cgroup v2 reports inactive_file; cgroup v1 reports cache
    reclaimable = float(details.get("inactive_file", details.get("cache", 0.0)) or 0.0)
    used_bytes = max(0.0, usage - reclaimable)

    mb_factor = 1024.0 * 1024.0
    used_mb = round(used_bytes / mb_factor, 2)
    limit_mb = round(limit / mb_factor, 2)
    percent = round((used_bytes / limit) * 100.0, 2) if limit > 0 else 0.0
    return used_mb, limit_mb, percent


def calculate_network_mb(stats: dict[str, Any]) -> tuple[float, float]:
    """Aggregate network RX/TX bytes across container interfaces in megabytes."""
    networks = stats.get("networks") or {}
    rx_bytes = sum(float(iface.get("rx_bytes") or 0.0) for iface in networks.values())
    tx_bytes = sum(float(iface.get("tx_bytes") or 0.0) for iface in networks.values())
    mb_factor = 1024.0 * 1024.0
    return round(rx_bytes / mb_factor, 2), round(tx_bytes / mb_factor, 2)


class SimulatedDockerHost:
    """In-memory simulated Docker host for local UI development when daemon is offline."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._tick = 0
        now_iso = _utc_now_iso()
        self._containers: dict[str, dict[str, Any]] = {
            "c8f1a09b32e1": {
                "id": "c8f1a09b32e1",
                "name": "edge-gateway",
                "image": "envoyproxy/envoy:v1.31-latest",
                "status": "running",
                "state_detail": "Up 4 hours (healthy)",
                "ports": [
                    PortMapping(ip="0.0.0.0", private_port=8080, public_port=80, type="tcp"),
                    PortMapping(ip="0.0.0.0", private_port=8443, public_port=443, type="tcp"),
                ],
                "created_at": now_iso,
                "uptime": "4h 18m",
                "base_cpu": 18.4,
                "base_mem_mb": 214.0,
                "limit_mb": 1024.0,
                "pids": 42,
                "rx_mb": 148.2,
                "tx_mb": 312.6,
            },
            "7d22b419e04a": {
                "id": "7d22b419e04a",
                "name": "pg-telemetry-primary",
                "image": "postgres:16.4-alpine",
                "status": "running",
                "state_detail": "Up 2 days (healthy)",
                "ports": [
                    PortMapping(ip="127.0.0.1", private_port=5432, public_port=5432, type="tcp"),
                ],
                "created_at": now_iso,
                "uptime": "2d 6h",
                "base_cpu": 34.8,
                "base_mem_mb": 1420.0,
                "limit_mb": 4096.0,
                "pids": 29,
                "rx_mb": 890.4,
                "tx_mb": 1204.1,
            },
            "a39e7100c51b": {
                "id": "a39e7100c51b",
                "name": "redis-stream-bus",
                "image": "redis:7.4-alpine",
                "status": "running",
                "state_detail": "Up 2 days",
                "ports": [
                    PortMapping(ip="127.0.0.1", private_port=6379, public_port=6379, type="tcp"),
                ],
                "created_at": now_iso,
                "uptime": "2d 6h",
                "base_cpu": 6.2,
                "base_mem_mb": 96.5,
                "limit_mb": 512.0,
                "pids": 7,
                "rx_mb": 64.9,
                "tx_mb": 72.3,
            },
            "f1049c882d77": {
                "id": "f1049c882d77",
                "name": "ingest-worker-01",
                "image": "ghcr.io/core-ops/ingest-worker:2.14.0",
                "status": "running",
                "state_detail": "Up 53 minutes",
                "ports": [
                    PortMapping(ip="", private_port=9100, public_port=None, type="tcp"),
                ],
                "created_at": now_iso,
                "uptime": "53m 12s",
                "base_cpu": 52.5,
                "base_mem_mb": 688.0,
                "limit_mb": 1024.0,
                "pids": 64,
                "rx_mb": 410.0,
                "tx_mb": 195.8,
            },
            "2b66d8e41a03": {
                "id": "2b66d8e41a03",
                "name": "metrics-archiver",
                "image": "prom/prometheus:v2.55.0",
                "status": "paused",
                "state_detail": "Up 9 hours (Paused)",
                "ports": [
                    PortMapping(ip="127.0.0.1", private_port=9090, public_port=9090, type="tcp"),
                ],
                "created_at": now_iso,
                "uptime": "9h 04m",
                "base_cpu": 0.0,
                "base_mem_mb": 412.0,
                "limit_mb": 2048.0,
                "pids": 14,
                "rx_mb": 28.4,
                "tx_mb": 19.1,
            },
            "9e510fa24b8c": {
                "id": "9e510fa24b8c",
                "name": "db-migration-job",
                "image": "alpine/psql:16",
                "status": "exited",
                "state_detail": "Exited (0) 3 hours ago",
                "ports": [],
                "created_at": now_iso,
                "uptime": "3h 10m",
                "base_cpu": 0.0,
                "base_mem_mb": 0.0,
                "limit_mb": 512.0,
                "pids": 0,
                "rx_mb": 1.2,
                "tx_mb": 0.8,
            },
        }

    def list_containers(self) -> list[ContainerSummary]:
        with self._lock:
            return [
                ContainerSummary(
                    id=item["id"],
                    name=item["name"],
                    image=item["image"],
                    status=item["status"],
                    state_detail=item["state_detail"],
                    ports=item["ports"],
                    created_at=item["created_at"],
                    uptime=item["uptime"],
                )
                for item in self._containers.values()
            ]

    def execute_action(self, container_id: str, action: ContainerAction) -> ActionResponse:
        start_time = time.perf_counter()
        with self._lock:
            item = self._containers.get(container_id)
            if not item:
                # Also allow matching by name
                item = next((c for c in self._containers.values() if c["name"] == container_id), None)
            if not item:
                raise ContainerNotFoundError(f"Container '{container_id}' not found.")

            previous = item["status"]
            if previous not in ALLOWED_TRANSITIONS[action]:
                raise InvalidStateTransitionError(
                    f"Action '{action}' is not valid while container '{item['name']}' is '{previous}'."
                )

            if action == "start":
                item["status"] = "running"
                item["state_detail"] = "Up 1 second"
                item["uptime"] = "1s"
            elif action == "stop":
                item["status"] = "exited"
                item["state_detail"] = "Exited (0) just now"
                item["uptime"] = "0s"
            elif action == "restart":
                item["status"] = "running"
                item["state_detail"] = "Up 1 second (restarted)"
                item["uptime"] = "1s"
                item["rx_mb"] += 0.2
            elif action == "pause":
                item["status"] = "paused"
                item["state_detail"] = f"Up {item['uptime'] or '1m'} (Paused)"
            elif action == "unpause":
                item["status"] = "running"
                item["state_detail"] = f"Up {item['uptime'] or '1m'}"

            elapsed_ms = round((time.perf_counter() - start_time) * 1000.0 + 42.0, 1)
            return ActionResponse(
                id=item["id"],
                name=item["name"],
                action=action,
                previous_status=previous,
                current_status=item["status"],
                message=f"Container '{item['name']}' transitioned {previous} -> {item['status']}.",
                duration_ms=elapsed_ms,
            )

    def collect_stats_payload(self, interval_ms: int) -> StatsBroadcastPayload:
        with self._lock:
            self._tick += 1
            now_iso = _utc_now_iso()
            metrics: dict[str, ContainerMetric] = {}
            total_cpu = 0.0
            total_mem_mb = 0.0
            total_limit_mb = 0.0
            running_count = 0
            paused_count = 0
            stopped_count = 0

            for idx, item in enumerate(self._containers.values()):
                status = item["status"]
                if status == "running":
                    running_count += 1
                    wave = math.sin(self._tick * 0.65 + idx * 1.3) * 6.5
                    jitter = random.uniform(-2.2, 2.8)
                    cpu = round(max(0.8, min(98.5, item["base_cpu"] + wave + jitter)), 2)

                    mem_drift = math.cos(self._tick * 0.35 + idx) * 12.0 + random.uniform(-4.0, 6.0)
                    mem_mb = round(max(16.0, min(item["limit_mb"] * 0.96, item["base_mem_mb"] + mem_drift)), 2)
                    limit_mb = item["limit_mb"]
                    mem_pct = round((mem_mb / limit_mb) * 100.0, 2)

                    item["rx_mb"] = round(item["rx_mb"] + random.uniform(0.04, 0.35), 2)
                    item["tx_mb"] = round(item["tx_mb"] + random.uniform(0.03, 0.28), 2)

                    total_cpu += cpu
                    total_mem_mb += mem_mb
                    total_limit_mb += limit_mb

                    metrics[item["id"]] = ContainerMetric(
                        id=item["id"],
                        name=item["name"],
                        status=status,
                        cpu_percent=cpu,
                        memory_usage_mb=mem_mb,
                        memory_limit_mb=limit_mb,
                        memory_percent=mem_pct,
                        pids=item["pids"] + random.randint(-1, 2),
                        net_rx_mb=item["rx_mb"],
                        net_tx_mb=item["tx_mb"],
                        timestamp=now_iso,
                    )
                elif status == "paused":
                    paused_count += 1
                else:
                    stopped_count += 1

            host_summary = {
                "total_containers": len(self._containers),
                "running": running_count,
                "paused": paused_count,
                "stopped": stopped_count,
                "aggregate_cpu_percent": round(total_cpu, 2),
                "aggregate_memory_mb": round(total_mem_mb, 2),
                "aggregate_memory_limit_mb": round(total_limit_mb, 2),
                "host_cpus": 8,
            }
            return StatsBroadcastPayload(
                mode="simulated",
                timestamp=now_iso,
                interval_ms=interval_ms,
                host_summary=host_summary,
                containers=metrics,
            )

    def get_logs(self, container_id: str, tail: int) -> ContainerLogsResponse:
        with self._lock:
            item = self._containers.get(container_id)
            if not item:
                raise ContainerNotFoundError(f"Container '{container_id}' not found.")
            now = datetime.now(timezone.utc)
            sample_lines = [
                f"{now.isoformat()} [INFO] {item['name']}: telemetry stream attached (pid={item['pids']})",
                f"{now.isoformat()} [INFO] {item['name']}: image={item['image']} status={item['status']}",
                f"{now.isoformat()} [DEBUG] {item['name']}: healthcheck passed latency=1.42ms",
                f"{now.isoformat()} [INFO] {item['name']}: net_rx={item['rx_mb']}MB net_tx={item['tx_mb']}MB",
                f"{now.isoformat()} [INFO] {item['name']}: memory_limit={item['limit_mb']}MB cgroup=v2",
            ]
            if item["status"] == "paused":
                sample_lines.append(f"{now.isoformat()} [WARN] {item['name']}: container frozen via cgroup_freezer")
            elif item["status"] == "exited":
                sample_lines.append(f"{now.isoformat()} [INFO] {item['name']}: process exited with status code 0")

            return ContainerLogsResponse(
                id=item["id"],
                name=item["name"],
                lines=sample_lines[-tail:],
                mode="simulated",
            )


class DockerService:
    """Async facade over Docker SDK with clean error translation and optional simulated host."""

    def __init__(self) -> None:
        self._client: docker.DockerClient | None = None
        self._client_lock = threading.Lock()
        self.simulated_host = SimulatedDockerHost()

    def _get_client_sync(self) -> docker.DockerClient:
        """Lazily initialize and ping the local Docker daemon client."""
        with self._client_lock:
            if self._client is None:
                try:
                    self._client = docker.from_env(timeout=5)
                except DockerException as exc:
                    raise DockerDaemonUnavailableError(
                        f"Unable to connect to local Docker daemon: {exc}"
                    ) from exc

            try:
                self._client.ping()
            except DockerException as exc:
                # Reset stale client so subsequent attempts can reconnect cleanly
                self._client = None
                raise DockerDaemonUnavailableError(
                    f"Local Docker daemon did not respond to ping: {exc}"
                ) from exc

            return self._client

    def _get_health_sync(self) -> HealthResponse:
        try:
            client = self._get_client_sync()
            info = client.info()
            mem_bytes = float(info.get("MemTotal") or 0.0)
            return HealthResponse(
                status="ok",
                docker_connected=True,
                engine_version=info.get("ServerVersion"),
                os_type=info.get("OSType"),
                architecture=info.get("Architecture"),
                cpus=info.get("NCPU"),
                memory_total_gb=round(mem_bytes / (1024**3), 2) if mem_bytes > 0 else None,
                containers_total=int(info.get("Containers") or 0),
                containers_running=int(info.get("ContainersRunning") or 0),
            )
        except DockerDaemonUnavailableError as exc:
            return HealthResponse(
                status="degraded",
                docker_connected=False,
                error=str(exc),
            )

    def _list_containers_sync(self) -> list[ContainerSummary]:
        client = self._get_client_sync()
        try:
            raw_containers = client.containers.list(all=True)
        except DockerException as exc:
            raise DockerDaemonUnavailableError(f"Failed listing containers: {exc}") from exc

        summaries: list[ContainerSummary] = []
        for container in raw_containers:
            attrs = container.attrs or {}
            state = attrs.get("State") or {}
            network_settings = attrs.get("NetworkSettings") or {}
            config = attrs.get("Config") or {}

            image_name = config.get("Image")
            if not image_name or image_name.startswith("sha256:"):
                try:
                    image_tags = container.image.tags
                    if image_tags:
                        image_name = image_tags[0]
                except DockerException:
                    pass
            if not image_name:
                raw_image_id = attrs.get("Image", "")
                image_name = raw_image_id.removeprefix("sha256:")[:12] or "unknown"
            elif image_name.startswith("sha256:"):
                image_name = image_name.removeprefix("sha256:")[:12]

            status = (container.status or state.get("Status") or "unknown").lower()

            summaries.append(
                ContainerSummary(
                    id=(container.id or container.short_id)[:12],
                    name=container.name.lstrip("/"),
                    image=image_name,
                    status=status,
                    state_detail=attrs.get("State", {}).get("Status", status),
                    ports=_parse_ports(network_settings.get("Ports")),
                    created_at=attrs.get("Created", _utc_now_iso()),
                    uptime=_format_uptime(state, status),
                )
            )

        status_rank = {"running": 0, "restarting": 1, "paused": 2, "created": 3, "exited": 4}
        summaries.sort(key=lambda item: (status_rank.get(item.status, 5), item.name.lower()))
        return summaries

    def _execute_action_sync(self, container_id: str, action: ContainerAction) -> ActionResponse:
        started_at = time.perf_counter()
        client = self._get_client_sync()
        try:
            container = client.containers.get(container_id)
        except NotFound as exc:
            raise ContainerNotFoundError(f"Container '{container_id}' not found.") from exc
        except DockerException as exc:
            raise DockerDaemonUnavailableError(f"Error looking up container: {exc}") from exc

        previous_status = (container.status or "unknown").lower()
        if previous_status not in ALLOWED_TRANSITIONS[action]:
            raise InvalidStateTransitionError(
                f"Cannot '{action}' container '{container.name}' while status is '{previous_status}'."
            )

        try:
            if action == "start":
                container.start()
            elif action == "stop":
                container.stop(timeout=8)
            elif action == "restart":
                container.restart(timeout=8)
            elif action == "pause":
                container.pause()
            elif action == "unpause":
                container.unpause()

            container.reload()
            current_status = (container.status or "unknown").lower()
        except APIError as exc:
            raise DockerServiceError(f"Docker API rejected '{action}': {exc.explanation or exc}") from exc
        except DockerException as exc:
            raise DockerDaemonUnavailableError(f"Docker daemon error during '{action}': {exc}") from exc

        elapsed_ms = round((time.perf_counter() - started_at) * 1000.0, 1)
        return ActionResponse(
            id=container.short_id,
            name=container.name.lstrip("/"),
            action=action,
            previous_status=previous_status,
            current_status=current_status,
            message=f"Container '{container.name}' executed '{action}' ({previous_status} -> {current_status}).",
            duration_ms=elapsed_ms,
        )

    def _get_logs_sync(self, container_id: str, tail: int) -> ContainerLogsResponse:
        client = self._get_client_sync()
        try:
            container = client.containers.get(container_id)
            raw_logs = container.logs(tail=tail, timestamps=True)
        except NotFound as exc:
            raise ContainerNotFoundError(f"Container '{container_id}' not found.") from exc
        except DockerException as exc:
            raise DockerDaemonUnavailableError(f"Error reading logs: {exc}") from exc

        decoded = raw_logs.decode("utf-8", errors="replace") if isinstance(raw_logs, bytes) else str(raw_logs)
        lines = [line for line in decoded.splitlines() if line.strip()]
        return ContainerLogsResponse(
            id=container.short_id,
            name=container.name.lstrip("/"),
            lines=lines,
            mode="live",
        )

    def _list_all_with_client_sync(self) -> tuple[list[Any], int, int, int, int]:
        """Retrieve containers and host core count in one thread hop."""
        client = self._get_client_sync()
        all_containers = client.containers.list(all=True)
        running = [c for c in all_containers if (c.status or "").lower() == "running"]
        paused = sum(1 for c in all_containers if (c.status or "").lower() == "paused")
        stopped = len(all_containers) - len(running) - paused
        try:
            host_cpus = int(client.info().get("NCPU") or 1)
        except DockerException:
            host_cpus = 1
        return running, len(all_containers), paused, stopped, host_cpus

    @staticmethod
    def _fetch_single_container_stat_sync(container: Any) -> ContainerMetric:
        raw_stats = container.stats(stream=False)
        cpu_pct = calculate_cpu_percent(raw_stats)
        mem_used_mb, mem_limit_mb, mem_pct = calculate_memory_stats(raw_stats)
        net_rx_mb, net_tx_mb = calculate_network_mb(raw_stats)
        pids = int((raw_stats.get("pids_stats") or {}).get("current") or 0)

        return ContainerMetric(
            id=container.short_id,
            name=container.name.lstrip("/"),
            status=(container.status or "running").lower(),
            cpu_percent=cpu_pct,
            memory_usage_mb=mem_used_mb,
            memory_limit_mb=mem_limit_mb,
            memory_percent=mem_pct,
            pids=pids,
            net_rx_mb=net_rx_mb,
            net_tx_mb=net_tx_mb,
            timestamp=_utc_now_iso(),
        )

    async def get_health(self) -> HealthResponse:
        return await asyncio.to_thread(self._get_health_sync)

    async def list_containers(self, simulated: bool = False) -> list[ContainerSummary]:
        if simulated:
            return self.simulated_host.list_containers()
        return await asyncio.to_thread(self._list_containers_sync)

    async def execute_action(
        self, container_id: str, action: ContainerAction, simulated: bool = False
    ) -> ActionResponse:
        if simulated:
            return self.simulated_host.execute_action(container_id, action)
        return await asyncio.to_thread(self._execute_action_sync, container_id, action)

    async def get_logs(
        self, container_id: str, tail: int = 120, simulated: bool = False
    ) -> ContainerLogsResponse:
        if simulated:
            return self.simulated_host.get_logs(container_id, tail)
        return await asyncio.to_thread(self._get_logs_sync, container_id, tail)

    async def collect_stats(self, interval_ms: int, simulated: bool = False) -> StatsBroadcastPayload:
        """Concurrently gather live CPU/RAM metrics for all running containers."""
        if simulated:
            return self.simulated_host.collect_stats_payload(interval_ms)

        running_containers, total_count, paused_count, stopped_count, host_cpus = await asyncio.to_thread(
            self._list_all_with_client_sync
        )

        tasks = [
            asyncio.to_thread(self._fetch_single_container_stat_sync, container)
            for container in running_containers
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        metrics: dict[str, ContainerMetric] = {}
        total_cpu = 0.0
        total_mem_mb = 0.0
        total_limit_mb = 0.0

        for result in results:
            if isinstance(result, ContainerMetric):
                metrics[result.id] = result
                total_cpu += result.cpu_percent
                total_mem_mb += result.memory_usage_mb
                total_limit_mb += result.memory_limit_mb

        return StatsBroadcastPayload(
            mode="live",
            timestamp=_utc_now_iso(),
            interval_ms=interval_ms,
            host_summary={
                "total_containers": total_count,
                "running": len(running_containers),
                "paused": paused_count,
                "stopped": stopped_count,
                "aggregate_cpu_percent": round(total_cpu, 2),
                "aggregate_memory_mb": round(total_mem_mb, 2),
                "aggregate_memory_limit_mb": round(total_limit_mb, 2),
                "host_cpus": host_cpus,
            },
            containers=metrics,
        )
