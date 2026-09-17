import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileCog, History, MoreHorizontal, Play, RefreshCw, ScrollText, Square, Rocket, Settings2, TerminalSquare } from "lucide-react";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Checkbox from "../ui/Checkbox";
import Input from "../ui/Input";
import { processStatusTone } from "../ui/semanticTones";
import TextButton from "../ui/TextButton";

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

  const countLabel = `${items.length} ${items.length === 1 ? "process" : "processes"}`;

  return (
    <section ref={panelRef} className="process-main-card">
      <div className="process-main-card-topbar">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="panel-heading">Processes</h2>
            <Badge tone={selectedCount > 0 ? "info" : "neutral"}>{selectedCount > 0 ? `${selectedCount} selected` : countLabel}</Badge>
          </div>
        </div>

        <div className="process-main-card-actions">
          {selectedCount > 0 && (
            <div className="process-bulk-actions">
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
              <Button type="button" size="sm" variant="ghost" onClick={() => toggleSelectAllFiltered(false)}>
                Clear
              </Button>
            </div>
          )}
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search processes"
            className="process-search-input"
          />
        </div>
      </div>

      <div className="process-table-scroll">
        <div className="process-list-header" role="row">
          <div>
            <Checkbox checked={allSelected} onChange={(event) => toggleSelectAllFiltered(event.target.checked)} />
          </div>
          <div>Process</div>
          <div>Status</div>
          <div>CPU</div>
          <div>Memory</div>
          <div>Runtime</div>
          <div className="text-right">Actions</div>
        </div>

        <div className="process-one-line-list">
          {items.map((item) => (
            <ProcessRow
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
      </div>
    </section>
  );
}

function ProcessRow({
  item,
  controls,
  actionMenu,
  bytesToMB,
  durationLabel
}) {
  const { proc, summary, selected } = item;
  const anomaly = summary.anomaly || { isAnomaly: false, score: 0 };
  const health = summary.health || {};
  const uptime = durationLabel(summary.upMs || proc.uptime || 0);
  const downtime = summary.downMs ? `Down ${durationLabel(summary.downMs)}` : "Stable";

  return (
    <article className="process-one-line-row">
      <div className="process-select-cell">
        <Checkbox checked={selected} onChange={(event) => controls.toggleSelected(proc.name, event.target.checked)} />
      </div>

      <div className="process-name-cell">
        <TextButton type="button" className="process-name-button" onClick={() => controls.openDetails(proc)}>
          {proc.name}
        </TextButton>
        <div className="process-inline-badges">
          <Badge tone={proc.mode === "cluster" ? "info" : "neutral"}>{proc.mode || "fork"}</Badge>
          {proc.id !== undefined && <Badge tone="neutral">ID {proc.id}</Badge>}
          {proc.cronRestart && <Badge tone="warning">Cron</Badge>}
          {anomaly.isAnomaly && <Badge tone="warning">Anomaly</Badge>}
          {health.enabled && (
            <Badge tone={health.currentState === "healthy" ? "success" : health.currentState === "unhealthy" ? "danger" : "warning"}>
              Health {health.currentState || "pending"}
            </Badge>
          )}
        </div>
      </div>

      <div className="process-state-cell">
        <StatusBadge status={proc.status} />
      </div>

      <MetricCell value={`${proc.cpu}%`} tone={proc.cpu >= 80 ? "warning" : "neutral"} />
      <MetricCell value={bytesToMB(proc.memory)} />
      <div className="process-runtime-cell" title={downtime}>
        <span>{uptime}</span>
        <span className="text-text-3">↻ {proc.restarts ?? 0}</span>
      </div>

      <RowActions item={item} controls={controls} actionMenu={actionMenu} />
    </article>
  );
}

function MetricCell({ value, tone = "neutral" }) {
  return (
    <div className={`process-metric-cell ${tone === "warning" ? "process-metric-cell--warning" : ""}`}>
      {value}
    </div>
  );
}

function RowActions({ item, controls, actionMenu }) {
  const { proc, hasDotEnv } = item;
  const {
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
  const menuKey = `${proc.name}:row`;
  const isMenuOpen = actionMenu?.openActionMenu === menuKey;
  const closeMenu = () => actionMenu?.setOpenActionMenu?.("");
  const runAndClose = (fn) => {
    closeMenu();
    fn?.();
  };

  return (
    <div className="process-actions-cell action-menu-anchor">
      <Button
        type="button"
        size="sm"
        variant="outlineInfo"
        className="process-row-button"
        disabled={loadingAction[`${proc.name}:restart`]}
        onClick={() => callAction("restart", proc.name)}
      >
        <RefreshCw size={14} />
        Restart
      </Button>
      <Button
        type="button"
        size="sm"
        variant={isOnline ? "outlineDanger" : "outlineSuccess"}
        className="process-row-button"
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
        className="process-row-more"
        aria-expanded={isMenuOpen}
        onClick={() => actionMenu?.setOpenActionMenu?.(isMenuOpen ? "" : menuKey)}
      >
        <MoreHorizontal size={14} />
      </Button>

      {isMenuOpen && (
        <div className="action-menu action-menu-popover process-row-menu grid gap-1 sm:grid-cols-2">
          <ActionMenuItem icon={<Settings2 size={14} />} onClick={() => runAndClose(() => controls.openDetails(proc))}>
            Inspect
          </ActionMenuItem>
          <ActionMenuItem icon={<ScrollText size={14} />} onClick={() => runAndClose(() => onOpenLogs(proc.name))}>
            Logs
          </ActionMenuItem>
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
          <ActionMenuItem icon={null} onClick={() => runAndClose(() => openMetaModal(proc))}>
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
  return <p className="quiet-empty-state process-empty-state">No processes found.</p>;
}

function StatusBadge({ status }) {
  return <Badge tone={processStatusTone(status)}>{status || "unknown"}</Badge>;
}
