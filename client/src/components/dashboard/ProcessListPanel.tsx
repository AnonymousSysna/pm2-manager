import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Download, ExternalLink, FileCog, Hammer, History, MoreHorizontal, Play, RefreshCw, ScrollText, Square, Rocket, Settings2, TerminalSquare } from "lucide-react";
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
      const target = event.target;
      if (target?.closest?.(".process-row-menu-portal")) {
        return;
      }
      if (!panelRef.current?.contains(target)) {
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
          {items.length > 0 && (
            <Button type="button" size="sm" variant="outlineInfo" className="process-restart-all-button" onClick={() => controls.openBulkActionConfirmation?.("restart", "all")}>
              <RefreshCw size={14} />
              Restart all
            </Button>
          )}
          {selectedCount > 0 && (
            <div className="process-bulk-actions">
              <Button type="button" size="sm" variant="outlineSuccess" onClick={() => (controls.openBulkActionConfirmation ? controls.openBulkActionConfirmation("start", "selected") : runBulkAction("start"))}>
                <Play size={14} />
                Start
              </Button>
              <Button type="button" size="sm" variant="outlineDanger" onClick={() => (controls.openBulkActionConfirmation ? controls.openBulkActionConfirmation("stop", "selected") : runBulkAction("stop"))}>
                <Square size={14} />
                Stop
              </Button>
              <Button type="button" size="sm" variant="outlineInfo" onClick={() => (controls.openBulkActionConfirmation ? controls.openBulkActionConfirmation("restart", "selected") : runBulkAction("restart"))}>
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
            aria-label="Search processes"
            className="process-search-input"
          />
        </div>
      </div>

      <div className="process-table-scroll">
        <div className="process-list-header" role="row">
          <div>
            <Checkbox
              checked={allSelected}
              aria-label="Select all processes"
              onChange={(event) => toggleSelectAllFiltered(event.target.checked)}
            />
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
        <Checkbox
          checked={selected}
          aria-label={`Select ${proc.name}`}
          onChange={(event) => controls.toggleSelected(proc.name, event.target.checked)}
        />
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
  const { proc, hasDotEnv, npmCapabilities = {} } = item;
  const actionCellRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState(null);
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
  const hasPackageJson = Boolean(npmCapabilities.hasPackageJson);
  const hasBuildScript = Boolean(npmCapabilities.hasBuildScript);
  const canOpenApp = Number(proc.port) > 0;
  const menuKey = `${proc.name}:row`;
  const isMenuOpen = actionMenu?.openActionMenu === menuKey;
  const closeMenu = () => actionMenu?.setOpenActionMenu?.("");
  const runAndClose = (fn) => {
    closeMenu();
    fn?.();
  };

  useEffect(() => {
    if (!isMenuOpen) {
      setMenuStyle(null);
      return undefined;
    }

    const updateMenuPosition = () => {
      const rect = actionCellRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const menuWidth = window.innerWidth >= 640 ? 344 : 268;
      const viewportPad = 12;
      const preferredLeft = rect.right - menuWidth;
      const left = Math.min(
        window.innerWidth - menuWidth - viewportPad,
        Math.max(viewportPad, preferredLeft)
      );
      const spaceBelow = window.innerHeight - rect.bottom - viewportPad;
      const spaceAbove = rect.top - viewportPad;

      if (spaceBelow < 220 && spaceAbove > spaceBelow) {
        const maxHeight = Math.max(180, Math.min(360, spaceAbove - 8));
        setMenuStyle({
          left,
          bottom: window.innerHeight - rect.top + 8,
          width: menuWidth,
          maxHeight
        });
        return;
      }

      setMenuStyle({
        left,
        top: rect.bottom + 8,
        width: menuWidth,
        maxHeight: Math.max(180, Math.min(360, spaceBelow))
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isMenuOpen]);

  const menu = isMenuOpen && menuStyle
    ? createPortal(
      <div className="action-menu process-row-menu process-row-menu-portal grid gap-1 sm:grid-cols-2" style={menuStyle}>
        <ActionMenuItem icon={<Settings2 size={14} />} onClick={() => runAndClose(() => controls.openDetails(proc))}>
          Inspect
        </ActionMenuItem>
        <ActionMenuItem icon={<ScrollText size={14} />} onClick={() => runAndClose(() => onOpenLogs(proc.name))}>
          Logs
        </ActionMenuItem>
        <ActionMenuItem
          icon={<Download size={14} />}
          disabled={!hasPackageJson || loadingAction[`${proc.name}:npmInstall`]}
          onClick={() => runAndClose(() => callAction("npmInstall", proc.name))}
        >
          Install
        </ActionMenuItem>
        <ActionMenuItem
          icon={<Hammer size={14} />}
          disabled={!hasBuildScript || loadingAction[`${proc.name}:npmBuild`]}
          onClick={() => runAndClose(() => callAction("npmBuild", proc.name))}
        >
          Build
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
      </div>,
      document.body
    )
    : null;

  return (
    <div ref={actionCellRef} className="process-actions-cell action-menu-anchor">
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
        aria-label={`More actions for ${proc.name}`}
        aria-expanded={isMenuOpen}
        onClick={() => actionMenu?.setOpenActionMenu?.(isMenuOpen ? "" : menuKey)}
      >
        <MoreHorizontal size={14} />
      </Button>

      {menu}
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
  return <p className="quiet-empty-state process-empty-state">No processes.</p>;
}

function StatusBadge({ status }) {
  return <Badge tone={processStatusTone(status)}>{status || "unknown"}</Badge>;
}
