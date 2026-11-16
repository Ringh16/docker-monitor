import { useEffect, useRef } from 'react';
import { Activity, Cpu, HardDrive, Radio, RefreshCw, Search, Terminal, X } from 'lucide-react';

function formatMemory(mb) {
  if (!mb || mb <= 0) return '0 MB';
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(0)} MB`;
}

function formatTickTime(isoString) {
  if (!isoString) return '--:--:--';
  try {
    return new Date(isoString).toLocaleTimeString('es-ES', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return '--:--:--';
  }
}

export function HostHeader({
  health,
  hostSummary,
  wsStatus,
  lastTickAt,
  simulatedMode,
  onToggleSimulated,
  statusFilter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  onRefresh,
}) {
  const searchInputRef = useRef(null);

  // Instant keyboard shortcuts: '/' to focus search, 'Escape' to clear/blur
  useEffect(() => {
    const handleKeyDown = (event) => {
      const activeTag = document.activeElement?.tagName;
      if (event.key === '/' && activeTag !== 'INPUT' && activeTag !== 'TEXTAREA') {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === 'Escape' && document.activeElement === searchInputRef.current) {
        if (searchQuery) {
          onSearchChange('');
        } else {
          searchInputRef.current?.blur();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchQuery, onSearchChange]);

  const wsBadge = {
    connected: {
      label: simulatedMode ? 'Simulación WS · 2.0s' : 'Socket WS · 2.0s',
      dotClass: 'bg-[#10B981]',
      ring: true,
    },
    connecting: {
      label: 'Conectando stream…',
      dotClass: 'bg-[#F59E0B]',
      ring: false,
    },
    reconnecting: {
      label: 'Reconectando…',
      dotClass: 'bg-[#F59E0B]',
      ring: false,
    },
    unavailable: {
      label: 'Daemon offline',
      dotClass: 'bg-[#EF4444]',
      ring: false,
    },
  }[wsStatus] || {
    label: 'Desconectado',
    dotClass: 'bg-[#5B6476]',
    ring: false,
  };

  const filterOptions = [
    { id: 'all', label: 'Todos', count: hostSummary.total_containers },
    { id: 'running', label: 'Activos', count: hostSummary.running },
    { id: 'paused', label: 'Pausados', count: hostSummary.paused },
    { id: 'stopped', label: 'Detenidos', count: hostSummary.stopped },
  ];

  const memPercent =
    hostSummary.aggregate_memory_limit_mb > 0
      ? Math.min(
          100,
          (hostSummary.aggregate_memory_mb / hostSummary.aggregate_memory_limit_mb) * 100
        )
      : 0;

  return (
    <header className="border-b border-[#222631] bg-[#090A0C]/95 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top Row: Identity, Socket Telemetry & Aggregate Host Load */}
        <div className="py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-[#1A1E28]">
          <div className="flex items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-9 h-9 rounded-md bg-[#111318] border border-[#222631] flex items-center justify-center text-[#ECEFF4] shrink-0">
                <Terminal className="w-4 h-4 text-[#10B981]" />
              </div>
              <div>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-[#ECEFF4]">
                    Docker Host Telemetry
                  </h1>
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#111318] border border-[#222631] text-[11px] font-mono-tabular text-[#8F99AD]">
                    <span className="relative flex h-2 w-2">
                      {wsBadge.ring && (
                        <span className="live-dot-ring absolute inline-flex h-full w-full rounded-full bg-[#10B981]" />
                      )}
                      <span className={`relative inline-flex rounded-full h-2 w-2 ${wsBadge.dotClass}`} />
                    </span>
                    {wsBadge.label}
                  </span>
                </div>
                <p className="text-xs text-[#8F99AD] mt-0.5 font-mono-tabular">
                  {simulatedMode
                    ? 'host: local-sandbox · 8 vCPU · cgroup v2'
                    : health?.docker_connected
                      ? `engine v${health.engine_version} · ${health.os_type}/${health.architecture} · ${health.cpus} vCPU · ${health.memory_total_gb ?? '--'} GB RAM`
                      : 'local socket: esperando conexión con Docker Engine'}
                </p>
              </div>
            </div>
          </div>

          {/* Aggregate Host Meters + Mode Controls */}
          <div className="flex flex-wrap items-center gap-3 sm:gap-5">
            <div className="flex items-center gap-5 px-3.5 py-2 rounded-md bg-[#111318] border border-[#222631]">
              <div className="flex items-center gap-2.5">
                <Cpu className="w-3.5 h-3.5 text-[#10B981]" />
                <div>
                  <div className="text-[10px] text-[#5B6476] leading-none">CPU Total</div>
                  <div className="text-sm font-semibold font-mono-tabular text-[#ECEFF4] mt-1">
                    {hostSummary.aggregate_cpu_percent.toFixed(1)}%
                  </div>
                </div>
              </div>

              <div className="h-6 w-px bg-[#222631]" />

              <div className="flex items-center gap-2.5">
                <HardDrive className="w-3.5 h-3.5 text-[#38BDF8]" />
                <div>
                  <div className="text-[10px] text-[#5B6476] leading-none">RAM Asignada</div>
                  <div className="text-sm font-semibold font-mono-tabular text-[#ECEFF4] mt-1">
                    {formatMemory(hostSummary.aggregate_memory_mb)}
                    <span className="text-[11px] font-normal text-[#5B6476] ml-1.5">
                      ({memPercent.toFixed(0)}%)
                    </span>
                  </div>
                </div>
              </div>

              <div className="hidden sm:block h-6 w-px bg-[#222631]" />

              <div className="hidden sm:flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-[#8F99AD]" />
                <div>
                  <div className="text-[10px] text-[#5B6476] leading-none">Último Tick</div>
                  <div className="text-xs font-medium font-mono-tabular text-[#8F99AD] mt-1">
                    {formatTickTime(lastTickAt)}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleSimulated(!simulatedMode)}
                className={`btn-tactile inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium border cursor-pointer ${
                  simulatedMode
                    ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[#10B981]'
                    : 'bg-[#111318] border-[#222631] text-[#8F99AD] hover:text-[#ECEFF4] hover:border-[#32394A]'
                }`}
                title="Alternar entre Docker Socket local y host simulado"
              >
                <Radio className="w-3.5 h-3.5" />
                {simulatedMode ? 'Modo Simulado' : 'Live Socket'}
              </button>

              <button
                type="button"
                onClick={onRefresh}
                className="btn-tactile p-2 rounded-md bg-[#111318] border border-[#222631] text-[#8F99AD] hover:text-[#ECEFF4] hover:border-[#32394A] cursor-pointer"
                title="Sincronizar inventario de contenedores"
                aria-label="Sincronizar inventario"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Bottom Row: Instant State Filter Tabs & Keyboard Search */}
        <div className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <nav className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0" aria-label="Filtros de estado">
            {filterOptions.map((opt) => {
              const active = statusFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => onFilterChange(opt.id)}
                  className={`btn-tactile inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium cursor-pointer shrink-0 ${
                    active
                      ? 'bg-[#171A21] text-[#ECEFF4] border border-[#2F3646]'
                      : 'bg-transparent text-[#8F99AD] border border-transparent hover:text-[#ECEFF4] hover:bg-[#111318]'
                  }`}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`font-mono-tabular text-[11px] px-1.5 py-0.5 rounded ${
                      active ? 'bg-[#222631] text-[#ECEFF4]' : 'text-[#5B6476]'
                    }`}
                  >
                    {opt.count}
                  </span>
                </button>
              );
            })}
          </nav>

          <div className="relative w-full sm:w-72">
            <Search className="w-3.5 h-3.5 text-[#5B6476] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Filtrar nombre, imagen o puerto…"
              className="w-full bg-[#111318] border border-[#222631] rounded-md pl-8 pr-12 py-1.5 text-xs text-[#ECEFF4] placeholder-[#5B6476] focus:outline-none focus:border-[#38BDF8]/60"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#5B6476] hover:text-[#ECEFF4] cursor-pointer"
                aria-label="Limpiar búsqueda"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <kbd className="hidden sm:inline-block absolute right-2.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-[10px] font-mono-tabular text-[#5B6476] bg-[#090A0C] border border-[#222631] rounded">
                /
              </kbd>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
