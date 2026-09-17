import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileCog, History, MoreHorizontal, Play, RefreshCw, ScrollText, Square, Rocket, Settings2, TerminalSquare } from "lucide-react";
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
  items,
  selection,
  controls,
  formatters
}) {
  const { allSelected, selectedCount } = selection;
  const { query, setQuery, toggleSelectAllFiltered, runBulkAction } = controls;
  const { bytesToMB, durationLabel } = formatters;
  const [openActionMenu, setOpenActionMenu] = useState("");
  const panelRef = useRef(null);
  const actionMenu = { openActionMenu, setOpenActionMenu };

  useEffect(() => {
    if (!openActionMenu) {
      return undefined;
    }

    const onPointerDown = (event) => {
      if (!panelRef.current?.contains(event.target)) {
        setOpenActionMenu("");
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpenActionMenu("");
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openActionMenu]);

  return (
    <section ref={panelRef} className="page-panel space-y-3">
      <PanelHeader
        title="Processes"
        description="Search, check load, then use the smallest safe action."
        actions={(
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search processes"
            className="w-full md:w-80"
          />
        )}
      />

      <InsetCard className="toolbar-strip" padding="sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-2">
            <Badge tone={selectedCount > 0 ? "info" : "neutral"}>{selectedCount} selected</Badge>
            <Button type="button" size="sm" variant="secondary" onClick={() => toggleSelectAllFiltered(true)}>
              Select filtered
            </Button>
            {selectedCount > 0 && (
              <Button type="button" size="sm" variant="secondary" onClick={() => toggleSelectAllFiltered(false)}>
                Clear
              </Button>
            )}
          </div>
          {selectedCount > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outlineSuccess" onClick={() => runBulkAction("start")}>
                <Play size={14} />
                Start
              </Button>
              <Button type="button" size="sm" variant="outlineDanger" onClick={() => runBulkAction("stop")}>
                <Square size={14} />
                Stop
              </Button>
              <Button type="button" size="sm" variant="outlineInfo" onClick={() => runBulkAction("restart")}>
                <RefreshCw size={14} />
                Restart
              </Button>
            </div>
          )}
        </div>
      </InsetCard>

      <div className="space-y-3 xl:hidden">
        {items.map((item) => (
          <ProcessCard
            key={item.proc.name}
            item={item}
            controls={controls}
            actionMenu={actionMenu}
            bytesToMB={bytesToMB}
            durationLabel={durationLabel}
          />
        ))}
        {items.length === 0 && <EmptyState />}
      </div>

      <div className="process-control-table hidden overflow-x-auto xl:block">
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
            {items.map((item) => {
              const { proc, summary, selected } = item;
              const health = summary.health || {};

              return (
                <tr key={proc.name} className="border-b border-border/60 align-top last:border-b-0 hover:bg-surface-2/25">
                  <td className="px-3 py-3">
                    <Checkbox
                      checked={selected}
                      onChange={(event) => controls.toggleSelected(proc.name, event.target.checked)}
                    />
                  </td>
                  <td className="px-3 py-3">
                    <ProcessIdentity item={item} controls={controls} />
                  </td>
                  <td className="px-3 py-3">
                    <div className="space-y-2">
                      <StatusBadge status={proc.status} />
                      <p className="text-xs text-text-3">
                        {health.enabled && health.currentState === "unhealthy"
                          ? `Health failing for ${durationLabel(health.currentDowntimeMs || 0)}`
                          : summary.downMs
                            ? `Down ${durationLabel(summary.downMs)}`
                            : "No recent downtime"}
                      </p>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <LoadSummary proc={proc} bytesToMB={bytesToMB} />
                  </td>
                  <td className="px-3 py-3">
                    <RuntimeSummary proc={proc} summary={summary} durationLabel={durationLabel} />
                  </td>
                  <td className="px-3 py-3 min-w-[18rem]">
                    <RowActions
                      item={item}
                      layout="table"
                      controls={controls}
                      actionMenu={actionMenu}
                    />
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td className="px-2 py-10" colSpan={6}>
                  <EmptyState />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProcessCard({
  item,
  controls,
  actionMenu,
  bytesToMB,
  durationLabel
}) {
  const { proc, summary } = item;

  return (
    <article className="compact-process-card">
      <ProcessIdentity item={item} controls={controls} showSelector showPortButton />

      <CompactMetrics proc={proc} summary={summary} bytesToMB={bytesToMB} durationLabel={durationLabel} />

      <div className="mt-3">
        <RowActions
          item={item}
          compact
          controls={controls}
          actionMenu={actionMenu}
        />
      </div>
    </article>
  );
}

function ProcessIdentity({ item, controls, showSelector = false, showPortButton = false }) {
  const { proc, summary, selected } = item;
  const anomaly = summary.anomaly || { isAnomaly: false, score: 0 };
  const health = summary.health || {};

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {showSelector ? (
            <Checkbox checked={selected} onChange={(event) => controls.toggleSelected(proc.name, event.target.checked)} />
          ) : null}
          <TextButton type="button" className="text-left text-base font-semibold" onClick={() => controls.openDetails(proc)}>
            {proc.name}
          </TextButton>
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <StatusBadge status={proc.status} />
          <Badge tone={proc.mode === "cluster" ? "info" : "neutral"}>{proc.mode || "fork"}</Badge>
          {proc.id !== undefined && <Badge tone="neutral">ID {proc.id}</Badge>}
          {proc.cronRestart && <Badge tone="warning">Restart {proc.cronRestart}</Badge>}
          {anomaly.isAnomaly && <Badge tone="warning">Anomaly {anomaly.score}</Badge>}
          {health.enabled && (
            <Badge tone={health.currentState === "healthy" ? "success" : health.currentState === "unhealthy" ? "danger" : "warning"}>
              Health {health.currentState || "pending"}
            </Badge>
          )}
        </div>
      </div>
      {showPortButton && Number(proc.port) > 0 ? (
        <Button type="button" size="sm" variant="secondary" onClick={() => controls.onOpenApp(proc.port)}>
          <ExternalLink size={14} />
          Port
        </Button>
      ) : null}
    </div>
  );
}

function LoadSummary({ proc, bytesToMB }) {
  return (
    <InsetCard tone="surface" padding="sm">
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

function CompactMetrics({ proc, summary, bytesToMB, durationLabel }) {
  return (
    <div className="metric-thread mt-3">
      <div className="metric-thread-item">
        <div className="mb-1 flex items-center justify-between gap-2">
          <SupportingCopy size="xs">CPU</SupportingCopy>
          <span className="font-semibold text-text-1">{proc.cpu}%</span>
        </div>
        <ProgressBar value={proc.cpu} tone={proc.cpu >= 80 ? "warning" : "success"} />
      </div>
      <MetricThreadItem label="Memory" value={bytesToMB(proc.memory)} />
      <MetricThreadItem label="Uptime" value={durationLabel(summary.upMs || proc.uptime || 0)} />
      <MetricThreadItem label="Restarts" value={proc.restarts ?? 0} />
    </div>
  );
}

function MetricThreadItem({ label, value }) {
  return (
    <div className="metric-thread-item">
      <SupportingCopy size="xs">{label}</SupportingCopy>
      <p className="mt-1 truncate font-semibold text-text-1">{value}</p>
    </div>
  );
}

function RuntimeSummary({ proc, summary, durationLabel }) {
  return (
    <InsetCard tone="surface" padding="sm">
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
  item,
  compact = false,
  layout = "default",
  controls,
  actionMenu
}) {
  const { proc, hasDotEnv } = item;
  const {
    openDetails,
    openMetaModal,
    openDotEnvModal,
    openDeployModal,
    openDeploymentHistoryForProcess,
    loadingAction,
    callAction,
    onOpenLogs,
    onOpenApp,
    onOpenPm2Features
  } = controls;
  const isOnline = proc.status === "online";
  const canOpenApp = Number(proc.port) > 0;
  const isTableLayout = layout === "table";
  const menuKey = `${proc.name}:${layout}`;
  const isMenuOpen = actionMenu?.openActionMenu === menuKey;
  const closeMenu = () => actionMenu?.setOpenActionMenu?.("");
  const runAndClose = (fn) => {
    closeMenu();
    fn?.();
  };

  return (
    <div className={`action-menu-anchor space-y-2 ${isTableLayout ? "min-w-[18rem]" : ""}`}>
      <div className={`flex flex-wrap ${isTableLayout ? "gap-1.5" : "gap-2"} ${compact ? "" : isTableLayout ? "" : "max-w-[38rem]"}`}>
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
        <Button
          type="button"
          size="sm"
          variant="secondary"
          aria-expanded={isMenuOpen}
          onClick={() => actionMenu?.setOpenActionMenu?.(isMenuOpen ? "" : menuKey)}
        >
          <MoreHorizontal size={14} />
          More
        </Button>
      </div>

      {isMenuOpen && (
        <div className="action-menu action-menu-popover grid gap-1 sm:grid-cols-2">
          <ActionMenuItem icon={<Rocket size={14} />} disabled={loadingAction[`${proc.name}:deploy`]} onClick={() => runAndClose(() => openDeployModal(proc))}>
            Deploy
          </ActionMenuItem>
          {hasDotEnv && (
            <ActionMenuItem icon={<FileCog size={14} />} onClick={() => runAndClose(() => openDotEnvModal(proc))}>
              Env file
            </ActionMenuItem>
          )}
          <ActionMenuItem icon={<History size={14} />} onClick={() => runAndClose(() => openDeploymentHistoryForProcess(proc.name))}>
            History
          </ActionMenuItem>
          <ActionMenuItem icon={<TerminalSquare size={14} />} onClick={() => runAndClose(() => onOpenPm2Features?.(proc.name))}>
            PM2 tools
          </ActionMenuItem>
          <ActionMenuItem onClick={() => runAndClose(() => openMetaModal(proc))}>
            Rules
          </ActionMenuItem>
          {canOpenApp && (
            <ActionMenuItem icon={<ExternalLink size={14} />} onClick={() => runAndClose(() => onOpenApp(proc.port))}>
              Open app
            </ActionMenuItem>
          )}
        </div>
      )}
    </div>
  );
}

function ActionMenuItem({ icon, children, disabled = false, onClick }) {
  return (
    <button type="button" className="action-menu-item" disabled={disabled} onClick={onClick}>
      {icon ? <span className="shrink-0 text-text-3">{icon}</span> : null}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

function EmptyState() {
  return <p className="quiet-empty-state">No processes found.</p>;
}

function StatusBadge({ status }) {
  return <Badge tone={processStatusTone(status)}>{status || "unknown"}</Badge>;
}
