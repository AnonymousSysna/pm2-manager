// @ts-nocheck
import {
  Play,
  Square,
  RefreshCw,
  RotateCcw,
  Undo2,
  ScrollText,
  Trash2,
  Download,
  Hammer,
  Rocket,
  ListChecks,
  ExternalLink,
  Copy,
  AlarmClock
} from "lucide-react";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Checkbox from "../ui/Checkbox";
import Input from "../ui/Input";
import { PanelHeader } from "../ui/PageLayout";
import ProgressBar from "../ui/ProgressBar";

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
  npmCapabilitiesByProcess,
  loadingAction,
  callAction,
  onOpenLogs,
  onOpenApp,
  bytesToMB,
  durationLabel
}) {
  return (
    <section className="page-panel">
      <PanelHeader
        title="Process List"
        className="mb-4"
        actions={
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or status"
            className="w-full md:w-80"
          />
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-border bg-surface-2 p-2 text-xs text-text-2">
        <ListChecks size={14} />
        <span>{selectedCount} selected</span>
        <Button type="button" size="sm" variant="secondary" onClick={() => toggleSelectAllFiltered(true)}>
          Select filtered
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={() => toggleSelectAllFiltered(false)}>
          Clear
        </Button>
        <Button type="button" size="sm" variant="outlineSuccess" onClick={() => runBulkAction("start")} disabled={selectedCount === 0}>
          Start selected
        </Button>
        <Button type="button" size="sm" variant="outlineDanger" onClick={() => runBulkAction("stop")} disabled={selectedCount === 0}>
          Stop selected
        </Button>
        <Button type="button" size="sm" variant="outlineInfo" onClick={() => runBulkAction("restart")} disabled={selectedCount === 0}>
          Restart selected
        </Button>
      </div>

      <div className="space-y-3 md:hidden">
        {filtered.map((proc) => {
          const summary = monitoringSummary[proc.name] || {};
          const anomaly = summary.anomaly || { isAnomaly: false, score: 0 };
          const actionButtons = buildProcessActions({
            proc,
            loadingAction,
            callAction,
            onOpenLogs,
            onOpenApp,
            openMetaModal,
            openDotEnvModal,
            openDeployModal,
            openDeploymentHistoryForProcess,
            dotEnvByProcess,
            npmCapabilitiesByProcess
          });

          return (
            <article key={proc.name} className="rounded-xl border border-border bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
                  <Checkbox
                    checked={Boolean(selectedNames[proc.name])}
                    onChange={(e) => toggleSelected(proc.name, e.target.checked)}
                  />
                  <button
                    type="button"
                    className="whitespace-nowrap text-left font-semibold text-info-300 underline-offset-2 hover:underline"
                    onClick={() => openDetails(proc)}
                  >
                    {proc.name}
                  </button>
                </div>
                <StatusBadge status={proc.status} />
              </div>
              <div className="grid grid-cols-2 gap-2 overflow-x-auto text-xs text-text-3">
                <p className="whitespace-nowrap">CPU: {proc.cpu}%</p>
                <p className="whitespace-nowrap">Memory: {bytesToMB(proc.memory)}</p>
                <p className="whitespace-nowrap">Uptime: {durationLabel(summary.upMs || proc.uptime || 0)}</p>
                <p className="whitespace-nowrap">Restarts: {proc.restarts ?? 0}</p>
                <p className="whitespace-nowrap">Cron: {proc.cronRestart || "-"}</p>
                <p className="col-span-2 whitespace-nowrap">
                  Anomaly: {anomaly.isAnomaly ? `score ${anomaly.score}` : "-"}
                </p>
              </div>
              <div className="mt-3 flex gap-1 overflow-x-auto whitespace-nowrap pb-1">
                {actionButtons.map((action) => (
                  <ActionButton key={action.title} {...action} />
                ))}
              </div>
            </article>
          );
        })}
        {filtered.length === 0 && <p className="text-center text-base text-text-3">No processes found.</p>}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full text-sm">
          <thead className="text-left text-text-3">
            <tr>
              <th className="px-2 py-2">
                <Checkbox
                  checked={filtered.length > 0 && filtered.every((proc) => Boolean(selectedNames[proc.name]))}
                  onChange={(e) => toggleSelectAllFiltered(e.target.checked)}
                />
              </th>
              <th className="whitespace-nowrap px-2 py-2">ID</th>
              <th className="whitespace-nowrap px-2 py-2">Name</th>
              <th className="whitespace-nowrap px-2 py-2">Status</th>
              <th className="whitespace-nowrap px-2 py-2">CPU%</th>
              <th className="whitespace-nowrap px-2 py-2">Memory</th>
              <th className="whitespace-nowrap px-2 py-2">Uptime</th>
              <th className="whitespace-nowrap px-2 py-2">Downtime</th>
              <th className="whitespace-nowrap px-2 py-2">Restarts</th>
              <th className="whitespace-nowrap px-2 py-2">Anomaly</th>
              <th className="whitespace-nowrap px-2 py-2">Schedule</th>
              <th className="whitespace-nowrap px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((proc) => {
              const summary = monitoringSummary[proc.name] || {};
              const anomaly = summary.anomaly || { isAnomaly: false, score: 0 };
              const actionButtons = buildProcessActions({
                proc,
                loadingAction,
                callAction,
                onOpenLogs,
                onOpenApp,
                openMetaModal,
                openDotEnvModal,
                openDeployModal,
                openDeploymentHistoryForProcess,
                dotEnvByProcess,
                npmCapabilitiesByProcess
              });

              return (
                <tr key={proc.name} className="border-t border-border">
                  <td className="px-2 py-3">
                    <Checkbox
                      checked={Boolean(selectedNames[proc.name])}
                      onChange={(e) => toggleSelected(proc.name, e.target.checked)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-3">{proc.id ?? "-"}</td>
                  <td className="whitespace-nowrap px-2 py-3">
                    <button
                      type="button"
                      className="whitespace-nowrap font-medium text-info-300 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-300"
                      onClick={() => openDetails(proc)}
                    >
                      {proc.name}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-2 py-3">
                    <StatusBadge status={proc.status} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-3">
                    <div className="w-28">
                      <div className="mb-1 text-xs text-text-3">{proc.cpu}%</div>
                      <ProgressBar value={proc.cpu} tone="success" />
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-2 py-3">{bytesToMB(proc.memory)}</td>
                  <td className="whitespace-nowrap px-2 py-3">{durationLabel(summary.upMs || proc.uptime || 0)}</td>
                  <td className="whitespace-nowrap px-2 py-3">{durationLabel(summary.downMs || 0)}</td>
                  <td className="whitespace-nowrap px-2 py-3">{proc.restarts ?? 0}</td>
                  <td className="whitespace-nowrap px-2 py-3">
                    {anomaly.isAnomaly ? <Badge tone="warning">score {anomaly.score}</Badge> : <span className="text-xs text-text-3">-</span>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-3">
                    {proc.cronRestart ? <Badge tone="info">{proc.cronRestart}</Badge> : <span className="text-xs text-text-3">-</span>}
                  </td>
                  <td className="px-2 py-3">
                    <div className="flex gap-1 overflow-x-auto whitespace-nowrap pb-1">
                      {actionButtons.map((action) => (
                        <ActionButton key={action.title} {...action} />
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td className="px-2 py-8 text-center text-base text-text-3" colSpan={12}>
                  No processes found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function buildProcessActions({
  proc,
  loadingAction,
  callAction,
  onOpenLogs,
  onOpenApp,
  openMetaModal,
  openDotEnvModal,
  openDeployModal,
  openDeploymentHistoryForProcess,
  dotEnvByProcess,
  npmCapabilitiesByProcess
}) {
  return [
    { title: "Logs", variant: "secondary", onClick: () => onOpenLogs(proc.name), icon: <ScrollText size={14} /> },
    Number(proc.port) > 0
      ? { title: "Open App", variant: "info", onClick: () => onOpenApp(proc.port), icon: <ExternalLink size={14} /> }
      : null,
    { title: "Edit Meta", variant: "secondary", onClick: () => openMetaModal(proc), icon: <ListChecks size={14} /> },
    dotEnvByProcess[proc.name]
      ? { title: "Edit .env", variant: "secondary", onClick: () => openDotEnvModal(proc), icon: <ScrollText size={14} /> }
      : null,
    {
      title: "Start",
      variant: "success",
      disabled: proc.status === "online" || loadingAction[`${proc.name}:start`],
      onClick: () => callAction("start", proc.name),
      icon: <Play size={14} />
    },
    {
      title: "Stop",
      variant: "danger",
      disabled: proc.status === "stopped" || loadingAction[`${proc.name}:stop`],
      onClick: () => callAction("stop", proc.name),
      icon: <Square size={14} />
    },
    {
      title: "Restart",
      variant: "info",
      disabled: loadingAction[`${proc.name}:restart`],
      onClick: () => callAction("restart", proc.name),
      icon: <RefreshCw size={14} />
    },
    {
      title: "Reload",
      variant: "warning",
      disabled: proc.mode !== "cluster" || loadingAction[`${proc.name}:reload`],
      onClick: () => callAction("reload", proc.name),
      icon: <RotateCcw size={14} />
    },
    Boolean(npmCapabilitiesByProcess[proc.name]?.hasPackageJson)
      ? {
          title: "NPM Install",
          variant: "secondary",
          disabled: loadingAction[`${proc.name}:npmInstall`],
          onClick: () => callAction("npmInstall", proc.name),
          icon: <Download size={14} />
        }
      : null,
    Boolean(npmCapabilitiesByProcess[proc.name]?.hasBuildScript)
      ? {
          title: "NPM Build",
          variant: "secondary",
          disabled: loadingAction[`${proc.name}:npmBuild`],
          onClick: () => callAction("npmBuild", proc.name),
          icon: <Hammer size={14} />
        }
      : null,
    {
      title: "Schedule",
      variant: "secondary",
      disabled: loadingAction[`${proc.name}:schedule`],
      onClick: () => callAction("schedule", proc.name),
      icon: <AlarmClock size={14} />
    },
    {
      title: "Duplicate",
      variant: "secondary",
      disabled: loadingAction[`${proc.name}:duplicate`],
      onClick: () => callAction("duplicate", proc.name),
      icon: <Copy size={14} />
    },
    {
      title: "Deploy",
      variant: "info",
      disabled: loadingAction[`${proc.name}:deploy`],
      onClick: () => openDeployModal(proc),
      icon: <Rocket size={14} />
    },
    {
      title: "Deploy History",
      variant: "secondary",
      onClick: () => openDeploymentHistoryForProcess(proc.name),
      icon: <ListChecks size={14} />
    },
    {
      title: "Rollback",
      variant: "warning",
      disabled: loadingAction[`${proc.name}:rollback`],
      onClick: () => callAction("rollback", proc.name),
      icon: <Undo2 size={14} />
    },
    {
      title: "Git Pull",
      variant: "secondary",
      disabled: loadingAction[`${proc.name}:gitPull`],
      onClick: () => callAction("gitPull", proc.name),
      icon: <Download size={14} />
    },
    {
      title: "Delete",
      variant: "danger",
      disabled: loadingAction[`${proc.name}:delete`],
      onClick: () => callAction("delete", proc.name),
      icon: <Trash2 size={14} />
    }
  ].filter(Boolean);
}

function ActionButton({ title, icon, variant, onClick, disabled }) {
  const variantMap = {
    success: "outlineSuccess",
    danger: "outlineDanger",
    warning: "outlineWarning",
    info: "outlineInfo",
    secondary: "secondary"
  };

  return (
    <Button
      type="button"
      title={title}
      size="sm-icon"
      variant={variantMap[variant] || "secondary"}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </Button>
  );
}

function StatusBadge({ status }) {
  const map = {
    online: "success",
    stopped: "warning",
    errored: "danger"
  };

  return <Badge tone={map[status] || "neutral"}>{status || "unknown"}</Badge>;
}
