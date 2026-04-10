import { ExternalLink, FileCog, History, Play, RefreshCw, ScrollText, Square, Rocket, Settings2 } from "lucide-react";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Checkbox from "../ui/Checkbox";
import Input from "../ui/Input";
import ProgressBar from "../ui/ProgressBar";
import { PanelHeader } from "../ui/PageLayout";
import { processStatusTone } from "../ui/semanticTones";
import { InsetCard } from "../ui/Surface";
import TextButton from "../ui/TextButton";
import { Eyebrow, SupportingCopy } from "../ui/Typography";

export default function ProcessListPanel({
  filtered,
  monitoringSummary,
  selectedNames,
  toggleSelected,
  toggleSelectAllFiltered,
  selectedCount,
  runBulkAction,
  query,
  setQuery,
  openDetails,
  openMetaModal,
  openDotEnvModal,
  openDeployModal,
  openDeploymentHistoryForProcess,
  dotEnvByProcess,
  loadingAction,
  callAction,
  onOpenLogs,
  onOpenApp,
  bytesToMB,
  durationLabel
}) {
  const allSelected = filtered.length > 0 && filtered.every((proc) => Boolean(selectedNames[proc.name]));

  return (
    <section className="page-panel space-y-4">
      <PanelHeader
        title="Process Control"
        description="The fastest route to inspect state, restart safely, jump into logs, and deploy with fewer clicks."
        actions={(
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter by process name or status"
            className="w-full md:w-80"
          />
        )}
      />

      <InsetCard className="rounded-xl bg-surface-2/50">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-2">
            <Badge tone={selectedCount > 0 ? "info" : "neutral"}>{selectedCount} selected</Badge>
            <Button type="button" size="sm" variant="secondary" onClick={() => toggleSelectAllFiltered(true)}>
              Select filtered
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={() => toggleSelectAllFiltered(false)}>
              Clear selection
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outlineSuccess" onClick={() => runBulkAction("start")} disabled={selectedCount === 0}>
              <Play size={14} />
              Start
            </Button>
            <Button type="button" size="sm" variant="outlineDanger" onClick={() => runBulkAction("stop")} disabled={selectedCount === 0}>
              <Square size={14} />
              Stop
            </Button>
            <Button type="button" size="sm" variant="outlineInfo" onClick={() => runBulkAction("restart")} disabled={selectedCount === 0}>
              <RefreshCw size={14} />
              Restart
            </Button>
          </div>
        </div>
      </InsetCard>

      <div className="space-y-3 xl:hidden">
        {filtered.map((proc) => {
          const summary = monitoringSummary[proc.name] || {};
          return (
            <ProcessCard
              key={proc.name}
              proc={proc}
              summary={summary}
              selected={Boolean(selectedNames[proc.name])}
              toggleSelected={toggleSelected}
              openDetails={openDetails}
              openMetaModal={openMetaModal}
              openDotEnvModal={openDotEnvModal}
              openDeployModal={openDeployModal}
              openDeploymentHistoryForProcess={openDeploymentHistoryForProcess}
              dotEnvByProcess={dotEnvByProcess}
              loadingAction={loadingAction}
              callAction={callAction}
              onOpenLogs={onOpenLogs}
              onOpenApp={onOpenApp}
              bytesToMB={bytesToMB}
              durationLabel={durationLabel}
            />
          );
        })}
        {filtered.length === 0 && <EmptyState />}
      </div>

      <InsetCard className="hidden overflow-x-auto rounded-xl bg-surface-2/50 p-0 xl:block">
        <table className="min-w-full text-sm">
          <thead className="meta-label border-b border-border/80 text-left">
            <tr>
              <th className="px-2 py-3">
                <Checkbox checked={allSelected} onChange={(event) => toggleSelectAllFiltered(event.target.checked)} />
              </th>
              <th className="px-2 py-3">Process</th>
              <th className="px-2 py-3">State</th>
              <th className="px-2 py-3">Load</th>
              <th className="px-2 py-3">Runtime</th>
              <th className="px-2 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((proc) => {
              const summary = monitoringSummary[proc.name] || {};
              const anomaly = summary.anomaly || { isAnomaly: false, score: 0 };

              return (
                <tr key={proc.name} className="border-b border-border/70 align-top last:border-b-0">
                  <td className="px-2 py-4">
                    <Checkbox
                      checked={Boolean(selectedNames[proc.name])}
                      onChange={(event) => toggleSelected(proc.name, event.target.checked)}
                    />
                  </td>
                  <td className="px-2 py-4">
                    <div className="min-w-[200px]">
                      <TextButton
                        type="button"
                        className="w-full justify-start px-0 py-0 text-left text-base font-semibold"
                        onClick={() => openDetails(proc)}
                      >
                        {proc.name}
                      </TextButton>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Badge tone={proc.mode === "cluster" ? "info" : "neutral"}>{proc.mode || "fork"}</Badge>
                        {proc.id !== undefined && <Badge tone="neutral">ID {proc.id}</Badge>}
                        {proc.cronRestart && <Badge tone="warning">Restart {proc.cronRestart}</Badge>}
                        {anomaly.isAnomaly && <Badge tone="warning">Anomaly {anomaly.score}</Badge>}
                      </div>
                    </div>
                  </td>
                  <td className="px-2 py-4">
                    <div className="space-y-2">
                      <StatusBadge status={proc.status} />
                      <p className="text-xs text-text-3">
                        {summary.downMs ? `Down ${durationLabel(summary.downMs)}` : "No recent downtime"}
                      </p>
                    </div>
                  </td>
                  <td className="px-2 py-4">
                    <LoadSummary proc={proc} bytesToMB={bytesToMB} />
                  </td>
                  <td className="px-2 py-4">
                    <RuntimeSummary proc={proc} summary={summary} durationLabel={durationLabel} />
                  </td>
                  <td className="px-2 py-4">
                    <RowActions
                      proc={proc}
                      openDetails={openDetails}
                      openMetaModal={openMetaModal}
                      openDotEnvModal={openDotEnvModal}
                      openDeployModal={openDeployModal}
                      openDeploymentHistoryForProcess={openDeploymentHistoryForProcess}
                      dotEnvByProcess={dotEnvByProcess}
                      loadingAction={loadingAction}
                      callAction={callAction}
                      onOpenLogs={onOpenLogs}
                      onOpenApp={onOpenApp}
                    />
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td className="px-2 py-10" colSpan={6}>
                  <EmptyState />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </InsetCard>
    </section>
  );
}

function ProcessCard({
  proc,
  summary,
  selected,
  toggleSelected,
  openDetails,
  openMetaModal,
  openDotEnvModal,
  openDeployModal,
  openDeploymentHistoryForProcess,
  dotEnvByProcess,
  loadingAction,
  callAction,
  onOpenLogs,
  onOpenApp,
  bytesToMB,
  durationLabel
}) {
  const anomaly = summary.anomaly || { isAnomaly: false, score: 0 };

  return (
    <InsetCard as="article" className="rounded-xl bg-surface-2/50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Checkbox checked={selected} onChange={(event) => toggleSelected(proc.name, event.target.checked)} />
            <TextButton
              type="button"
              className="min-w-0 flex-1 justify-start px-0 py-0 text-left text-base font-semibold"
              onClick={() => openDetails(proc)}
            >
              {proc.name}
            </TextButton>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={proc.status} />
            <Badge tone={proc.mode === "cluster" ? "info" : "neutral"}>{proc.mode || "fork"}</Badge>
            {proc.cronRestart && <Badge tone="warning">Restart {proc.cronRestart}</Badge>}
            {anomaly.isAnomaly && <Badge tone="warning">Anomaly {anomaly.score}</Badge>}
          </div>
        </div>
        {Number(proc.port) > 0 && (
          <Button type="button" size="sm" variant="secondary" onClick={() => onOpenApp(proc.port)}>
            <ExternalLink size={14} />
            Port
          </Button>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 sm:items-stretch">
        <LoadSummary proc={proc} bytesToMB={bytesToMB} />
        <RuntimeSummary proc={proc} summary={summary} durationLabel={durationLabel} />
      </div>

      <div className="mt-4">
        <RowActions
          proc={proc}
          compact
          openDetails={openDetails}
          openMetaModal={openMetaModal}
          openDotEnvModal={openDotEnvModal}
          openDeployModal={openDeployModal}
          openDeploymentHistoryForProcess={openDeploymentHistoryForProcess}
          dotEnvByProcess={dotEnvByProcess}
          loadingAction={loadingAction}
          callAction={callAction}
          onOpenLogs={onOpenLogs}
          onOpenApp={onOpenApp}
        />
      </div>
    </InsetCard>
  );
}

function LoadSummary({ proc, bytesToMB }) {
  return (
    <InsetCard tone="surface" className="h-full">
      <Eyebrow>Load</Eyebrow>
      <div className="mt-2 space-y-2">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-text-2">
            <span>CPU</span>
            <span>{proc.cpu}%</span>
          </div>
          <ProgressBar value={proc.cpu} tone={proc.cpu >= 80 ? "warning" : "success"} />
        </div>
        <div className="flex items-center justify-between text-xs text-text-2">
          <span>Memory</span>
          <span>{bytesToMB(proc.memory)}</span>
        </div>
      </div>
    </InsetCard>
  );
}

function RuntimeSummary({ proc, summary, durationLabel }) {
  return (
    <InsetCard tone="surface" className="h-full">
      <Eyebrow>Runtime</Eyebrow>
      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-2">
        <div>
          <SupportingCopy size="xs">Uptime</SupportingCopy>
          <p className="mt-1 font-medium text-text-1">{durationLabel(summary.upMs || proc.uptime || 0)}</p>
        </div>
        <div>
          <SupportingCopy size="xs">Restarts</SupportingCopy>
          <p className="mt-1 font-medium text-text-1">{proc.restarts ?? 0}</p>
        </div>
        <div>
          <SupportingCopy size="xs">Downtime</SupportingCopy>
          <p className="mt-1 font-medium text-text-1">{durationLabel(summary.downMs || 0)}</p>
        </div>
        <div>
          <SupportingCopy size="xs">PM2 ID</SupportingCopy>
          <p className="mt-1 font-medium text-text-1">{proc.id ?? "-"}</p>
        </div>
      </div>
    </InsetCard>
  );
}

function RowActions({
  proc,
  compact = false,
  openDetails,
  openMetaModal,
  openDotEnvModal,
  openDeployModal,
  openDeploymentHistoryForProcess,
  dotEnvByProcess,
  loadingAction,
  callAction,
  onOpenLogs,
  onOpenApp
}) {
  const isOnline = proc.status === "online";
  const canOpenApp = Number(proc.port) > 0;

  return (
    <div className="space-y-2">
      <div className={`flex flex-wrap gap-2 ${compact ? "" : "max-w-[38rem]"}`}>
        <Button type="button" size="sm" variant="outlineInfo" onClick={() => openDetails(proc)}>
          <Settings2 size={14} />
          Inspect
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outlineInfo"
          disabled={loadingAction[`${proc.name}:restart`]}
          onClick={() => callAction("restart", proc.name)}
        >
          <RefreshCw size={14} />
          Restart
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => onOpenLogs(proc.name)}>
          <ScrollText size={14} />
          Logs
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={loadingAction[`${proc.name}:deploy`]} onClick={() => openDeployModal(proc)}>
          <Rocket size={14} />
          Deploy
        </Button>
        {dotEnvByProcess[proc.name] && (
          <Button type="button" size="sm" variant="secondary" onClick={() => openDotEnvModal(proc)}>
            <FileCog size={14} />
            Env
          </Button>
        )}
        <Button type="button" size="sm" variant="secondary" onClick={() => openDeploymentHistoryForProcess(proc.name)}>
          <History size={14} />
          History
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={isOnline ? "outlineDanger" : "outlineSuccess"}
          disabled={loadingAction[`${proc.name}:${isOnline ? "stop" : "start"}`]}
          onClick={() => callAction(isOnline ? "stop" : "start", proc.name)}
        >
          {isOnline ? <Square size={14} /> : <Play size={14} />}
          {isOnline ? "Stop" : "Start"}
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => openMetaModal(proc)}>
          Rules
        </Button>
        {canOpenApp && (
          <Button type="button" size="sm" variant="secondary" onClick={() => onOpenApp(proc.port)}>
            <ExternalLink size={14} />
            Open app
          </Button>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return <p className="text-center text-sm text-text-3">No processes match the current filter.</p>;
}

function StatusBadge({ status }) {
  return <Badge tone={processStatusTone(status)}>{status || "unknown"}</Badge>;
}
