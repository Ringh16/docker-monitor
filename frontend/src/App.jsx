import { useMemo, useState } from 'react';
import { AlertTriangle, Box, CheckCircle2, Play } from 'lucide-react';
import { ContainerRow } from './components/ContainerRow.jsx';
import { HostHeader } from './components/HostHeader.jsx';
import { InspectorDrawer } from './components/InspectorDrawer.jsx';
import { TelemetryRibbon } from './components/TelemetryRibbon.jsx';
import { useDockerTelemetry } from './hooks/useDockerTelemetry.js';

export default function App() {
  const {
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
  } = useDockerTelemetry();

  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  const filteredContainers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return containers.filter((container) => {
      const normalizedStatus = (container.status || '').toLowerCase();
      if (statusFilter === 'running' && normalizedStatus !== 'running') return false;
      if (statusFilter === 'paused' && normalizedStatus !== 'paused') return false;
      if (
        statusFilter === 'stopped' &&
        !['exited', 'created', 'dead'].includes(normalizedStatus)
      ) {
        return false;
      }

      if (!query) return true;
      const portsMatch = (container.ports || []).some(
        (p) =>
          String(p.private_port).includes(query) ||
          (p.public_port && String(p.public_port).includes(query))
      );

      return (
        container.name.toLowerCase().includes(query) ||
        container.id.toLowerCase().includes(query) ||
        container.image.toLowerCase().includes(query) ||
        portsMatch
      );
    });
  }, [containers, statusFilter, searchQuery]);

  const selectedContainer = useMemo(
    () => containers.find((c) => c.id === selectedId) || null,
    [containers, selectedId]
  );

  return (
    <div className="min-h-screen bg-[#090A0C] text-[#ECEFF4] flex flex-col">
      <HostHeader
        health={health}
        hostSummary={hostSummary}
        wsStatus={wsStatus}
        lastTickAt={lastTickAt}
        simulatedMode={simulatedMode}
        onToggleSimulated={setSimulatedMode}
        statusFilter={statusFilter}
        onFilterChange={setStatusFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onRefresh={refreshAll}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Diagnostic Banner when Docker Socket is offline */}
        {daemonError && !simulatedMode && (
          <div className="mb-6 rounded-lg bg-[#111318] border border-[#F59E0B]/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-[#F59E0B] shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-[#ECEFF4]">
                  No se detectó el daemon local de Docker
                </h2>
                <p className="text-xs text-[#8F99AD] mt-1 font-mono-tabular break-all">
                  {daemonError}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSimulatedMode(true)}
              className="btn-tactile inline-flex items-center gap-2 px-3.5 py-2 rounded-md bg-[#10B981]/15 border border-[#10B981]/40 text-[#10B981] hover:bg-[#10B981]/25 text-xs font-medium shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Activar Host Simulado en Vivo
            </button>
          </div>
        )}

        {/* Active Telemetry Strip */}
        <TelemetryRibbon
          containers={containers}
          liveStats={liveStats}
          history={history}
          selectedId={selectedId}
          onSelect={(c) => setSelectedId(c.id)}
        />

        {/* Operational Container Matrix */}
        <section
          aria-label="Inventario de contenedores"
          className="rounded-lg bg-[#111318] border border-[#222631] overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-[#222631] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4 text-[#8F99AD]" />
              <h2 className="text-xs font-medium text-[#ECEFF4]">
                Contenedores del Host
              </h2>
              <span className="text-xs font-mono-tabular text-[#5B6476]">
                ({filteredContainers.length} mostrados)
              </span>
            </div>
            <span className="text-[11px] font-mono-tabular text-[#5B6476]">
              Click en una fila para inspeccionar logs y trazas
            </span>
          </div>

          {isLoading ? (
            <div className="p-10 text-center text-xs font-mono-tabular text-[#8F99AD]">
              Sincronizando socket local de Docker…
            </div>
          ) : filteredContainers.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-sm text-[#ECEFF4] font-medium">
                No hay contenedores que coincidan con el filtro actual
              </p>
              <p className="text-xs text-[#5B6476] mt-1">
                Ajusta el estado seleccionado o presiona Escape para limpiar la búsqueda.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#222631] bg-[#0D0F13] text-[11px] font-medium text-[#5B6476]">
                    <th className="py-2.5 pl-4 pr-3 font-medium">Contenedor / Imagen</th>
                    <th className="py-2.5 px-3 font-medium">Estado</th>
                    <th className="py-2.5 px-3 font-medium hidden md:table-cell">Puertos</th>
                    <th className="py-2.5 px-3 font-medium">CPU en Vivo</th>
                    <th className="py-2.5 px-3 font-medium">Memoria RAM</th>
                    <th className="py-2.5 pl-3 pr-4 font-medium text-right">Control</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredContainers.map((container) => (
                    <ContainerRow
                      key={container.id}
                      container={container}
                      metric={liveStats[container.id]}
                      pendingAction={pendingActions[container.id]}
                      isSelected={selectedId === container.id}
                      onSelect={(c) => setSelectedId(c.id)}
                      onAction={executeAction}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {/* Slide-over Inspector Drawer */}
      <InspectorDrawer
        container={selectedContainer}
        metric={selectedContainer ? liveStats[selectedContainer.id] : null}
        historySamples={selectedContainer ? history[selectedContainer.id] : []}
        pendingAction={selectedContainer ? pendingActions[selectedContainer.id] : null}
        onClose={() => setSelectedId(null)}
        onAction={executeAction}
        fetchLogs={fetchLogs}
      />

      {/* Non-intrusive Action Feedback Toast */}
      {toast && (
        <div
          role="status"
          className={`toast-surface fixed bottom-5 right-5 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-lg border text-xs font-medium shadow-xl ${
            toast.tone === 'error'
              ? 'bg-[#171A21] border-[#EF4444]/50 text-[#EF4444]'
              : 'bg-[#171A21] border-[#10B981]/45 text-[#ECEFF4]'
          }`}
        >
          {toast.tone === 'error' ? (
            <AlertTriangle className="w-4 h-4 text-[#EF4444] shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-[#10B981] shrink-0" />
          )}
          <span className="font-mono-tabular">{toast.message}</span>
        </div>
      )}
    </div>
  );
}
