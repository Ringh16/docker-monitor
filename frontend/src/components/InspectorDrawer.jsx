import { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Copy,
  Pause,
  Play,
  RefreshCw,
  RotateCw,
  Square,
  Terminal,
  X,
} from 'lucide-react';

function buildChartPath(points, width, height, maxVal = 100) {
  if (!points || points.length === 0) return '';
  if (points.length === 1) {
    const y = height - (Math.min(maxVal, points[0]) / maxVal) * (height - 8) - 4;
    return `0,${y.toFixed(1)} ${width},${y.toFixed(1)}`;
  }
  const step = width / (points.length - 1);
  return points
    .map((val, idx) => {
      const clamped = Math.max(0, Math.min(maxVal, val));
      const x = idx * step;
      const y = height - (clamped / maxVal) * (height - 8) - 4;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function InspectorDrawer({
  container,
  metric,
  historySamples,
  pendingAction,
  onClose,
  onAction,
  fetchLogs,
}) {
  const [logs, setLogs] = useState([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsError, setLogsError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const isOpen = Boolean(container);

  // Trigger hardware-accelerated slide-in cleanly on mount
  useEffect(() => {
    if (isOpen) {
      const frame = requestAnimationFrame(() => setIsVisible(true));
      return () => cancelAnimationFrame(frame);
    }
    setIsVisible(false);
    return undefined;
  }, [isOpen]);

  // Close instantaneously on Escape (0ms keyboard friction)
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  const loadLogs = useCallback(async () => {
    if (!container) return;
    setLogsLoading(true);
    setLogsError(null);
    try {
      const data = await fetchLogs(container.id);
      setLogs(data.lines || []);
    } catch (err) {
      setLogsError(err.message || 'No fue posible cargar los logs.');
    } finally {
      setLogsLoading(false);
    }
  }, [container, fetchLogs]);

  useEffect(() => {
    if (container) {
      loadLogs();
    }
  }, [container, loadLogs]);

  if (!container) {
    return null;
  }

  const status = (container.status || '').toLowerCase();
  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isStopped = status === 'exited' || status === 'created' || status === 'dead';
  const isBusy = Boolean(pendingAction);

  const cpuSeries = (historySamples || []).map((s) => s.cpu);
  const memSeries = (historySamples || []).map((s) => s.mem);
  const cpuPath = buildChartPath(cpuSeries, 440, 110, 100);
  const memPath = buildChartPath(memSeries, 440, 110, 100);

  const handleCopyLogs = async () => {
    if (logs.length === 0) return;
    try {
      await navigator.clipboard.writeText(logs.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked in non-HTTPS contexts
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`drawer-backdrop fixed inset-0 bg-black/65 backdrop-blur-[2px] ${
          isVisible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Slide-over Inspector Panel (< 250ms) */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Inspector de ${container.name}`}
        className={`drawer-panel relative z-10 w-full max-w-[540px] h-full bg-[#111318] border-l border-[#222631] flex flex-col ${
          isVisible ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#222631] flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-semibold text-[#ECEFF4] truncate">
                {container.name}
              </h2>
              <span className="text-[11px] font-mono-tabular px-2 py-0.5 rounded bg-[#090A0C] border border-[#222631] text-[#8F99AD]">
                {container.id}
              </span>
            </div>
            <p className="text-xs font-mono-tabular text-[#8F99AD] mt-1 truncate">
              {container.image}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn-tactile p-1.5 rounded-md bg-[#171A21] border border-[#222631] text-[#8F99AD] hover:text-[#ECEFF4] cursor-pointer"
            aria-label="Cerrar inspector"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Lifecycle Action Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-lg bg-[#090A0C] border border-[#222631]">
            <div>
              <div className="text-[11px] text-[#5B6476]">Estado actual</div>
              <div className="text-sm font-medium text-[#ECEFF4] capitalize mt-0.5">
                {container.state_detail || status}
              </div>
            </div>

            <div className={`flex items-center gap-2 ${isBusy ? 'action-transitioning pointer-events-none' : ''}`}>
              {isStopped && (
                <button
                  type="button"
                  onClick={() => onAction(container.id, 'start')}
                  className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#10B981]/15 border border-[#10B981]/40 text-[#10B981] text-xs font-medium cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  Iniciar
                </button>
              )}
              {isRunning && (
                <button
                  type="button"
                  onClick={() => onAction(container.id, 'pause')}
                  className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#171A21] border border-[#222631] text-[#ECEFF4] hover:border-[#F59E0B]/50 hover:text-[#F59E0B] text-xs font-medium cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5" />
                  Pausar
                </button>
              )}
              {isPaused && (
                <button
                  type="button"
                  onClick={() => onAction(container.id, 'unpause')}
                  className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#F59E0B]/15 border border-[#F59E0B]/40 text-[#F59E0B] text-xs font-medium cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  Reanudar
                </button>
              )}
              <button
                type="button"
                onClick={() => onAction(container.id, 'restart')}
                className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#171A21] border border-[#222631] text-[#ECEFF4] hover:border-[#3A4256] text-xs font-medium cursor-pointer"
              >
                <RotateCw className={`w-3.5 h-3.5 ${pendingAction === 'restart' ? 'animate-spin' : ''}`} />
                Reiniciar
              </button>
              {(isRunning || isPaused) && (
                <button
                  type="button"
                  onClick={() => onAction(container.id, 'stop')}
                  className="btn-tactile inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-[#EF4444]/12 border border-[#EF4444]/35 text-[#EF4444] hover:bg-[#EF4444]/20 text-xs font-medium cursor-pointer"
                >
                  <Square className="w-3.5 h-3.5" />
                  Detener
                </button>
              )}
            </div>
          </div>

          {/* Live Resource Telemetry Chart */}
          <div className="rounded-lg bg-[#090A0C] border border-[#222631] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-[#8F99AD]">
                Oscilograma en Vivo (Ventana 48s)
              </span>
              <div className="flex items-center gap-4 text-xs font-mono-tabular">
                <span className="text-[#10B981]">
                  CPU {isRunning && metric ? `${metric.cpu_percent.toFixed(1)}%` : '0.0%'}
                </span>
                <span className="text-[#38BDF8]">
                  RAM {isRunning && metric ? `${metric.memory_percent.toFixed(1)}%` : '0.0%'}
                </span>
              </div>
            </div>

            <div className="h-28 w-full relative">
              <svg viewBox="0 0 440 110" preserveAspectRatio="none" className="w-full h-full">
                <line x1="0" y1="27" x2="440" y2="27" stroke="#1A1E28" strokeDasharray="3 3" />
                <line x1="0" y1="55" x2="440" y2="55" stroke="#1A1E28" strokeDasharray="3 3" />
                <line x1="0" y1="82" x2="440" y2="82" stroke="#1A1E28" strokeDasharray="3 3" />
                {memPath && (
                  <polyline
                    fill="none"
                    stroke="#38BDF8"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={memPath}
                  />
                )}
                {cpuPath && (
                  <polyline
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={cpuPath}
                  />
                )}
              </svg>
            </div>

            <div className="grid grid-cols-3 gap-3 pt-3 mt-3 border-t border-[#1A1E28] text-xs font-mono-tabular">
              <div>
                <div className="text-[10px] text-[#5B6476]">Memoria</div>
                <div className="text-[#ECEFF4] mt-0.5">
                  {metric ? `${metric.memory_usage_mb.toFixed(1)} MB` : '0 MB'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#5B6476]">Red RX / TX</div>
                <div className="text-[#ECEFF4] mt-0.5">
                  {metric ? `${metric.net_rx_mb.toFixed(1)} / ${metric.net_tx_mb.toFixed(1)} MB` : '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-[#5B6476]">Procesos (PIDs)</div>
                <div className="text-[#ECEFF4] mt-0.5">{metric ? metric.pids : 0}</div>
              </div>
            </div>
          </div>

          {/* Ports & Runtime Metadata */}
          <div>
            <h3 className="text-xs font-medium text-[#8F99AD] mb-2.5">Puertos Expuestos</h3>
            {container.ports && container.ports.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {container.ports.map((p, idx) => (
                  <span
                    key={`${p.private_port}-${idx}`}
                    className="px-2.5 py-1 rounded bg-[#090A0C] border border-[#222631] text-xs font-mono-tabular text-[#ECEFF4]"
                  >
                    {p.public_port ? `${p.ip || '0.0.0.0'}:${p.public_port} -> ${p.private_port}/${p.type}` : `${p.private_port}/${p.type} (interno)`}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#5B6476]">Sin puertos mapeados al host.</p>
            )}
          </div>

          {/* Container Logs */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2 text-xs font-medium text-[#8F99AD]">
                <Terminal className="w-3.5 h-3.5 text-[#10B981]" />
                Logs Recientes (tail 120)
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyLogs}
                  className="btn-tactile inline-flex items-center gap-1 px-2 py-1 rounded bg-[#171A21] border border-[#222631] text-[11px] text-[#8F99AD] hover:text-[#ECEFF4] cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3 text-[#10B981]" /> : <Copy className="w-3 h-3" />}
                  {copied ? 'Copiado' : 'Copiar'}
                </button>
                <button
                  type="button"
                  onClick={loadLogs}
                  className="btn-tactile p-1 rounded bg-[#171A21] border border-[#222631] text-[#8F99AD] hover:text-[#ECEFF4] cursor-pointer"
                  title="Refrescar logs"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="rounded-lg bg-[#090A0C] border border-[#222631] p-3 font-mono-tabular text-[11px] leading-relaxed text-[#C8D0DF] max-h-72 overflow-y-auto">
              {logsError ? (
                <div className="text-[#EF4444]">{logsError}</div>
              ) : logs.length === 0 ? (
                <div className="text-[#5B6476]">
                  {logsLoading ? 'Leyendo flujo stdout/stderr…' : 'Sin líneas de log disponibles.'}
                </div>
              ) : (
                logs.map((line, i) => (
                  <div key={i} className="py-0.5 break-all border-b border-[#111318] last:border-b-0">
                    {line}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
