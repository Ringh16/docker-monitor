import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_HISTORY_SAMPLES = 24;

function getApiBase() {
  return import.meta.env.VITE_API_BASE || '';
}

function buildWsUrl(simulated) {
  const configuredWs = import.meta.env.VITE_WS_BASE;
  if (configuredWs) {
    return `${configuredWs}/ws/stats?simulated=${simulated}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws/stats?simulated=${simulated}`;
}

export function useDockerTelemetry() {
  const [containers, setContainers] = useState([]);
  const [health, setHealth] = useState(null);
  const [liveStats, setLiveStats] = useState({});
  const [hostSummary, setHostSummary] = useState({
    total_containers: 0,
    running: 0,
    paused: 0,
    stopped: 0,
    aggregate_cpu_percent: 0,
    aggregate_memory_mb: 0,
    aggregate_memory_limit_mb: 0,
    host_cpus: 0,
  });
  const [history, setHistory] = useState({});
  const [wsStatus, setWsStatus] = useState('connecting');
  const [lastTickAt, setLastTickAt] = useState(null);
  const [simulatedMode, setSimulatedMode] = useState(false);
  const [daemonError, setDaemonError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingActions, setPendingActions] = useState({});
  const [toast, setToast] = useState(null);

  const wsRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const toastTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const lastRunningCountRef = useRef(null);

  const showToast = useCallback((message, tone = 'info') => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ id: Date.now(), message, tone });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 3200);
  }, []);

  const fetchHealthAndContainers = useCallback(
    async (useSimulated, showLoader = false) => {
      if (showLoader) setIsLoading(true);
      const apiBase = getApiBase();

      try {
        const [healthRes, containersRes] = await Promise.all([
          fetch(`${apiBase}/api/health`),
          fetch(`${apiBase}/api/containers?simulated=${useSimulated}`),
        ]);

        if (healthRes.ok) {
          const healthData = await healthRes.json();
          setHealth(healthData);
        }

        if (!containersRes.ok) {
          const errorBody = await containersRes.json().catch(() => ({}));
          const detail = errorBody.detail || `Error HTTP ${containersRes.status}`;
          if (containersRes.status === 503 && !useSimulated) {
            setDaemonError(detail);
            setContainers([]);
            return;
          }
          throw new Error(detail);
        }

        const list = await containersRes.json();
        setContainers(list);
        setDaemonError(null);
      } catch (err) {
        setDaemonError(err.message || 'No se pudo conectar con el servidor de telemetría.');
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Sync REST list & health when simulatedMode changes
  useEffect(() => {
    setHistory({});
    setLiveStats({});
    lastRunningCountRef.current = null;
    fetchHealthAndContainers(simulatedMode, true);
  }, [simulatedMode, fetchHealthAndContainers]);

  // Native WebSocket connection with automatic exponential backoff reconnect
  useEffect(() => {
    let isDisposed = false;

    const connectSocket = () => {
      if (isDisposed) return;

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      setWsStatus(reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting');
      const socket = new WebSocket(buildWsUrl(simulatedMode));
      wsRef.current = socket;

      socket.onopen = () => {
        if (isDisposed) return;
        reconnectAttemptRef.current = 0;
        setWsStatus('connected');
      };

      socket.onmessage = (event) => {
        if (isDisposed) return;
        try {
          const payload = JSON.parse(event.data);

          if (payload.type === 'error') {
            if (payload.code === 'DOCKER_UNAVAILABLE' && !simulatedMode) {
              setDaemonError(payload.message);
              setWsStatus('unavailable');
            }
            return;
          }

          if (payload.type === 'stats_tick') {
            setDaemonError(null);
            setWsStatus('connected');
            setLastTickAt(payload.timestamp);

            const nextStats = payload.containers || {};
            setLiveStats(nextStats);

            if (payload.host_summary) {
              setHostSummary(payload.host_summary);
              const nextRunning = payload.host_summary.running;
              if (
                lastRunningCountRef.current !== null &&
                lastRunningCountRef.current !== nextRunning
              ) {
                fetchHealthAndContainers(simulatedMode, false);
              }
              lastRunningCountRef.current = nextRunning;
            }

            setHistory((prev) => {
              const updated = { ...prev };
              for (const [id, metric] of Object.entries(nextStats)) {
                const existing = updated[id] || [];
                const nextPoint = {
                  cpu: metric.cpu_percent,
                  mem: metric.memory_percent,
                  memMb: metric.memory_usage_mb,
                  ts: metric.timestamp,
                };
                updated[id] = [...existing.slice(-(MAX_HISTORY_SAMPLES - 1)), nextPoint];
              }
              return updated;
            });
          }
        } catch {
          // Ignore malformed non-JSON frames
        }
      };

      socket.onerror = () => {
        if (isDisposed) return;
        setWsStatus('reconnecting');
      };

      socket.onclose = () => {
        if (isDisposed) return;
        setWsStatus('reconnecting');
        const delayMs = Math.min(6000, 1000 * 2 ** reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(connectSocket, delayMs);
      };
    };

    connectSocket();

    return () => {
      isDisposed = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [simulatedMode, fetchHealthAndContainers]);

  const executeAction = useCallback(
    async (containerId, action) => {
      const apiBase = getApiBase();
      setPendingActions((prev) => ({ ...prev, [containerId]: action }));

      try {
        const res = await fetch(
          `${apiBase}/api/containers/${encodeURIComponent(containerId)}/actions/${action}?simulated=${simulatedMode}`,
          { method: 'POST' }
        );
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(body.detail || `Error ejecutando '${action}'`);
        }

        showToast(`${body.name}: ${action} completado (${body.duration_ms}ms)`, 'success');
        await fetchHealthAndContainers(simulatedMode, false);
        return body;
      } catch (err) {
        showToast(err.message || `Error al ejecutar '${action}'`, 'error');
        return null;
      } finally {
        setPendingActions((prev) => {
          const copy = { ...prev };
          delete copy[containerId];
          return copy;
        });
      }
    },
    [simulatedMode, fetchHealthAndContainers, showToast]
  );

  const fetchLogs = useCallback(
    async (containerId, tail = 120) => {
      const apiBase = getApiBase();
      const res = await fetch(
        `${apiBase}/api/containers/${encodeURIComponent(containerId)}/logs?tail=${tail}&simulated=${simulatedMode}`
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.detail || 'No se pudieron obtener los logs.');
      }
      return body;
    },
    [simulatedMode]
  );

  const refreshAll = useCallback(() => {
    return fetchHealthAndContainers(simulatedMode, false);
  }, [simulatedMode, fetchHealthAndContainers]);

  return {
    containers,
    health,
    liveStats,
    hostSummary,
    history,
    wsStatus,
    lastTickAt,
    simulatedMode,
    setSimulatedMode,
    daemonError,
    isLoading,
    pendingActions,
    toast,
    executeAction,
    fetchLogs,
    refreshAll,
  };
}
