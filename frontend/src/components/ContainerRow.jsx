import { Eye, Pause, Play, RotateCw, Square } from 'lucide-react';

function StatusPill({ status }) {
  const normalized = (status || 'unknown').toLowerCase();

  if (normalized === 'running') {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-medium text-[#10B981]">
        <span className="relative flex h-2 w-2">
          <span className="live-dot-ring absolute inline-flex h-full w-full rounded-full bg-[#10B981]" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[#10B981]" />
        </span>
        Running
      </span>
    );
  }

  if (normalized === 'paused') {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-medium text-[#F59E0B]">
        <span className="h-2 w-2 rounded-full bg-[#F59E0B]" />
        Paused
      </span>
    );
  }

  if (normalized === 'restarting') {
    return (
      <span className="inline-flex items-center gap-2 text-xs font-medium text-[#38BDF8]">
        <span className="h-2 w-2 rounded-full bg-[#38BDF8] animate-pulse" />
        Restarting
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-[#8F99AD]">
      <span className="h-2 w-2 rounded-full border border-[#5B6476] bg-transparent" />
      <span className="capitalize">{normalized}</span>
    </span>
  );
}

function PortChips({ ports }) {
  if (!ports || ports.length === 0) {
    return <span className="text-xs font-mono-tabular text-[#5B6476]">—</span>;
  }

  const visible = ports.slice(0, 2);
  const extra = ports.length - visible.length;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {visible.map((port, idx) => (
        <span
          key={`${port.private_port}-${port.public_port ?? 'int'}-${idx}`}
          className="inline-flex items-center px-1.5 py-0.5 rounded bg-[#090A0C] border border-[#222631] text-[11px] font-mono-tabular text-[#8F99AD]"
        >
          {port.public_port ? (
            <>
              <span className="text-[#ECEFF4]">{port.public_port}</span>
              <span className="text-[#5B6476] mx-0.5">:</span>
              <span>{port.private_port}</span>
            </>
          ) : (
            <span>
              {port.private_port}/{port.type}
            </span>
          )}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[11px] font-mono-tabular text-[#5B6476]">+{extra}</span>
      )}
    </div>
  );
}

export function ContainerRow({
  container,
  metric,
  pendingAction,
  isSelected,
  onSelect,
  onAction,
}) {
  const status = (container.status || '').toLowerCase();
  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isStopped = status === 'exited' || status === 'created' || status === 'dead';
  const isBusy = Boolean(pendingAction);

  const cpuPercent = isRunning && metric ? metric.cpu_percent : 0;
  const memPercent = isRunning && metric ? metric.memory_percent : 0;
  const memMb = isRunning && metric ? metric.memory_usage_mb : 0;

  const cpuRatio = Math.max(0, Math.min(1, cpuPercent / 100));
  const memRatio = Math.max(0, Math.min(1, memPercent / 100));

  const stopPropAction = (e, action) => {
    e.stopPropagation();
    onAction(container.id, action);
  };

  return (
    <tr
      onClick={() => onSelect(container)}
      className={`row-interactive border-b border-[#1A1E28] cursor-pointer group ${
        isSelected ? 'bg-[#171A21]' : 'bg-transparent'
      }`}
    >
      {/* Container Identity */}
      <td className="py-3.5 pl-4 pr-3 align-middle">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[#ECEFF4] truncate">
                {container.name}
              </span>
              <span className="text-[11px] font-mono-tabular text-[#5B6476] bg-[#090A0C] border border-[#1A1E28] px-1.5 py-0.5 rounded">
                {container.id}
              </span>
            </div>
            <div className="text-xs font-mono-tabular text-[#8F99AD] truncate max-w-[260px] mt-0.5">
              {container.image}
            </div>
          </div>
        </div>
      </td>

      {/* State */}
      <td className="py-3.5 px-3 align-middle whitespace-nowrap">
        <StatusPill status={status} />
        {container.uptime && (
          <div className="text-[11px] font-mono-tabular text-[#5B6476] mt-0.5">
            {container.uptime}
          </div>
        )}
      </td>

      {/* Exposed Ports */}
      <td className="py-3.5 px-3 align-middle hidden md:table-cell">
        <PortChips ports={container.ports} />
      </td>

      {/* CPU Live Bar (GPU scaleX) */}
      <td className="py-3.5 px-3 align-middle w-40">
        {isRunning ? (
          <div>
            <div className="flex items-center justify-between text-xs font-mono-tabular mb-1.5">
              <span className={cpuPercent > 80 ? 'text-[#EF4444]' : 'text-[#ECEFF4]'}>
                {cpuPercent.toFixed(1)}%
              </span>
              <span className="text-[10px] text-[#5B6476]">CPU</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#1A1E28] overflow-hidden">
              <div
                className={`meter-fill h-full w-full rounded-full ${
                  cpuPercent > 80 ? 'bg-[#EF4444]' : 'bg-[#10B981]'
                }`}
                style={{ transform: `scaleX(${cpuRatio})` }}
              />
            </div>
          </div>
        ) : (
          <span className="text-xs font-mono-tabular text-[#5B6476]">0.0%</span>
        )}
      </td>

      {/* RAM Live Bar (GPU scaleX) */}
      <td className="py-3.5 px-3 align-middle w-44">
        {isRunning ? (
          <div>
            <div className="flex items-center justify-between text-xs font-mono-tabular mb-1.5">
              <span className="text-[#ECEFF4]">{memMb.toFixed(0)} MB</span>
              <span className="text-[11px] text-[#38BDF8]">{memPercent.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[#1A1E28] overflow-hidden">
              <div
                className="meter-fill h-full w-full rounded-full bg-[#38BDF8]"
                style={{ transform: `scaleX(${memRatio})` }}
              />
            </div>
          </div>
        ) : (
          <span className="text-xs font-mono-tabular text-[#5B6476]">—</span>
        )}
      </td>

      {/* Safe Control Actions */}
      <td className="py-3.5 pl-3 pr-4 align-middle text-right whitespace-nowrap">
        <div
          className={`inline-flex items-center justify-end gap-1.5 ${
            isBusy ? 'action-transitioning pointer-events-none' : ''
          }`}
        >
          {isStopped && (
            <button
              type="button"
              disabled={isBusy}
              onClick={(e) => stopPropAction(e, 'start')}
              className="btn-tactile inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#10B981]/12 border border-[#10B981]/35 text-[#10B981] hover:bg-[#10B981]/20 text-xs font-medium cursor-pointer"
              title="Iniciar contenedor"
            >
              <Play className="w-3 h-3" />
              Iniciar
            </button>
          )}

          {isRunning && (
            <button
              type="button"
              disabled={isBusy}
              onClick={(e) => stopPropAction(e, 'pause')}
              className="btn-tactile p-1.5 rounded bg-[#111318] border border-[#222631] text-[#8F99AD] hover:text-[#F59E0B] hover:border-[#F59E0B]/40 cursor-pointer"
              title="Pausar contenedor"
              aria-label={`Pausar ${container.name}`}
            >
              <Pause className="w-3.5 h-3.5" />
            </button>
          )}

          {isPaused && (
            <button
              type="button"
              disabled={isBusy}
              onClick={(e) => stopPropAction(e, 'unpause')}
              className="btn-tactile inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#F59E0B]/12 border border-[#F59E0B]/35 text-[#F59E0B] hover:bg-[#F59E0B]/20 text-xs font-medium cursor-pointer"
              title="Reanudar contenedor"
            >
              <Play className="w-3 h-3" />
              Reanudar
            </button>
          )}

          <button
            type="button"
            disabled={isBusy}
            onClick={(e) => stopPropAction(e, 'restart')}
            className="btn-tactile p-1.5 rounded bg-[#111318] border border-[#222631] text-[#8F99AD] hover:text-[#ECEFF4] hover:border-[#3A4256] cursor-pointer"
            title="Reiniciar contenedor"
            aria-label={`Reiniciar ${container.name}`}
          >
            <RotateCw className={`w-3.5 h-3.5 ${pendingAction === 'restart' ? 'animate-spin' : ''}`} />
          </button>

          {(isRunning || isPaused) && (
            <button
              type="button"
              disabled={isBusy}
              onClick={(e) => stopPropAction(e, 'stop')}
              className="btn-tactile p-1.5 rounded bg-[#111318] border border-[#222631] text-[#8F99AD] hover:text-[#EF4444] hover:border-[#EF4444]/40 cursor-pointer"
              title="Detener contenedor"
              aria-label={`Detener ${container.name}`}
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(container);
            }}
            className="btn-tactile p-1.5 rounded bg-[#111318] border border-[#222631] text-[#8F99AD] hover:text-[#38BDF8] hover:border-[#38BDF8]/40 cursor-pointer ml-0.5"
            title="Abrir inspector y logs"
            aria-label={`Inspeccionar ${container.name}`}
          >
            <Eye className="w-3.5 h-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}
