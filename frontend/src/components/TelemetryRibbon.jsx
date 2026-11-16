function buildPolylinePoints(values, width, height, maxVal = 100) {
  if (!values || values.length === 0) return '';
  if (values.length === 1) {
    const y = height - (Math.min(maxVal, values[0]) / maxVal) * (height - 4) - 2;
    return `0,${y.toFixed(1)} ${width},${y.toFixed(1)}`;
  }

  const stepX = width / (values.length - 1);
  return values
    .map((val, idx) => {
      const clamped = Math.max(0, Math.min(maxVal, val));
      const x = idx * stepX;
      const y = height - (clamped / maxVal) * (height - 4) - 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export function TelemetryRibbon({ containers, liveStats, history, selectedId, onSelect }) {
  const runningContainers = containers
    .filter((c) => c.status === 'running')
    .sort((a, b) => {
      const cpuA = liveStats[a.id]?.cpu_percent ?? 0;
      const cpuB = liveStats[b.id]?.cpu_percent ?? 0;
      return cpuB - cpuA;
    })
    .slice(0, 4);

  if (runningContainers.length === 0) {
    return null;
  }

  return (
    <section aria-label="Telemetría activa en vivo" className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
          <h2 className="text-xs font-medium text-[#8F99AD]">
            Trazas de Carga en Vivo · Top Contenedores Activos
          </h2>
        </div>
        <span className="text-[11px] font-mono-tabular text-[#5B6476]">
          <span className="text-[#10B981]">━ CPU%</span>
          <span className="mx-2 text-[#222631]">|</span>
          <span className="text-[#38BDF8]">━ RAM%</span>
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {runningContainers.map((container) => {
          const stat = liveStats[container.id];
          const samples = history[container.id] || [];
          const cpuSeries = samples.map((s) => s.cpu);
          const memSeries = samples.map((s) => s.mem);

          const cpuVal = stat?.cpu_percent ?? 0;
          const memVal = stat?.memory_percent ?? 0;
          const memMb = stat?.memory_usage_mb ?? 0;
          const limitMb = stat?.memory_limit_mb ?? 0;
          const isSelected = selectedId === container.id;

          const cpuPoints = buildPolylinePoints(cpuSeries, 220, 44, 100);
          const memPoints = buildPolylinePoints(memSeries, 220, 44, 100);

          return (
            <button
              key={container.id}
              type="button"
              onClick={() => onSelect(container)}
              className={`card-interactive btn-tactile text-left rounded-lg p-4 border cursor-pointer relative overflow-hidden ${
                isSelected
                  ? 'bg-[#171A21] border-[#10B981]/60'
                  : 'bg-[#111318] border-[#222631]'
              }`}
            >
              {/* Subtle top state hairline */}
              <div
                className={`absolute inset-x-0 top-0 h-[1.5px] ${
                  cpuVal > 80 ? 'bg-[#EF4444]' : 'bg-[#10B981]/70'
                }`}
              />

              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2 shrink-0">
                      <span className="live-dot-ring absolute inline-flex h-full w-full rounded-full bg-[#10B981]" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-[#10B981]" />
                    </span>
                    <span className="text-sm font-semibold text-[#ECEFF4] truncate">
                      {container.name}
                    </span>
                  </div>
                  <div className="text-[11px] font-mono-tabular text-[#5B6476] mt-0.5 truncate">
                    {container.id} · {stat?.pids ?? '--'} PIDs
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div
                    className={`text-base font-semibold font-mono-tabular leading-none ${
                      cpuVal > 80 ? 'text-[#EF4444]' : 'text-[#ECEFF4]'
                    }`}
                  >
                    {cpuVal.toFixed(1)}%
                  </div>
                  <div className="text-[10px] font-mono-tabular text-[#5B6476] mt-1">CPU</div>
                </div>
              </div>

              {/* Dual Live Sparkline */}
              <div className="h-11 w-full bg-[#090A0C]/70 border border-[#1A1E28] rounded px-1.5 py-1 mb-3">
                <svg
                  viewBox="0 0 220 44"
                  preserveAspectRatio="none"
                  className="w-full h-full overflow-visible"
                >
                  <line x1="0" y1="22" x2="220" y2="22" stroke="#1A1E28" strokeDasharray="2 3" />
                  {memPoints && (
                    <polyline
                      fill="none"
                      stroke="#38BDF8"
                      strokeWidth="1.5"
                      strokeOpacity="0.85"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={memPoints}
                    />
                  )}
                  {cpuPoints && (
                    <polyline
                      fill="none"
                      stroke={cpuVal > 80 ? '#EF4444' : '#10B981'}
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      points={cpuPoints}
                    />
                  )}
                </svg>
              </div>

              <div className="flex items-center justify-between text-[11px] font-mono-tabular">
                <span className="text-[#8F99AD]">
                  RAM <span className="text-[#ECEFF4]">{memMb.toFixed(0)}</span>
                  <span className="text-[#5B6476]">/{limitMb > 0 ? limitMb.toFixed(0) : '--'} MB</span>
                </span>
                <span className="text-[#38BDF8]">{memVal.toFixed(1)}%</span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
