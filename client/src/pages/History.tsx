import { useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { processes as processApi } from "../api";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import Select from "../components/ui/Select";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import { Skeleton } from "../components/ui/Skeleton";

export default function History() {
  const [searchParams] = useSearchParams();
  const initialDeploymentProcess = String(searchParams.get("deploymentProcess") || "").trim();

  const [deploymentHistory, setDeploymentHistory] = useState([]);
  const [deploymentHistoryLoading, setDeploymentHistoryLoading] = useState(false);
  const [deploymentPage, setDeploymentPage] = useState(1);
  const [deploymentProcessFilter, setDeploymentProcessFilter] = useState(initialDeploymentProcess);
  const [deploymentPagination, setDeploymentPagination] = useState({
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 1
  });

  const [restartHistory, setRestartHistory] = useState([]);
  const [restartHistoryLoading, setRestartHistoryLoading] = useState(false);
  const [restartPage, setRestartPage] = useState(1);
  const [restartPagination, setRestartPagination] = useState({
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 1
  });

  const [auditHistory, setAuditHistory] = useState([]);
  const [auditHistoryLoading, setAuditHistoryLoading] = useState(false);
  const [auditPage, setAuditPage] = useState(1);
  const [auditActionPreset, setAuditActionPreset] = useState("");
  const [auditActionCustom, setAuditActionCustom] = useState("");
  const [auditPagination, setAuditPagination] = useState({
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 1
  });

  const auditActionFilter = auditActionPreset === "__custom__"
    ? auditActionCustom.trim()
    : auditActionPreset.trim();

  const formatTimestamp = (value) => {
    if (!value) {
      return "-";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "-";
    }
    return date.toLocaleString();
  };

  const loadDeploymentHistory = async (page = deploymentPage, { silent = false } = {}) => {
    if (!silent) {
      setDeploymentHistoryLoading(true);
    }
    try {
      const result = await processApi.deploymentHistoryPage(
        page,
        deploymentPagination.pageSize,
        deploymentProcessFilter.trim(),
        true
      );
      if (result.success && result.data?.pagination && Array.isArray(result.data?.items)) {
        setDeploymentHistory(result.data.items);
        setDeploymentPagination(result.data.pagination);
        setDeploymentPage(result.data.pagination.page);
      }
    } catch {} finally {
      if (!silent) {
        setDeploymentHistoryLoading(false);
      }
    }
  };

  const loadRestartHistory = async (page = restartPage, { silent = false } = {}) => {
    if (!silent) {
      setRestartHistoryLoading(true);
    }
    try {
      const result = await processApi.restartHistoryPage(page, restartPagination.pageSize, "", "", true);
      if (result.success && result.data?.pagination && Array.isArray(result.data?.items)) {
        setRestartHistory(result.data.items);
        setRestartPagination(result.data.pagination);
        setRestartPage(result.data.pagination.page);
      }
    } catch {} finally {
      if (!silent) {
        setRestartHistoryLoading(false);
      }
    }
  };

  const loadAuditHistory = async (page = auditPage, { silent = false } = {}) => {
    if (!silent) {
      setAuditHistoryLoading(true);
    }
    try {
      const result = await processApi.auditHistoryPage(
        page,
        auditPagination.pageSize,
        auditActionFilter.trim(),
        "",
        "",
        true
      );
      if (result.success && result.data?.pagination && Array.isArray(result.data?.items)) {
        setAuditHistory(result.data.items);
        setAuditPagination(result.data.pagination);
        setAuditPage(result.data.pagination.page);
      }
    } catch {} finally {
      if (!silent) {
        setAuditHistoryLoading(false);
      }
    }
  };

  useEffect(() => {
    loadDeploymentHistory(1);
    loadRestartHistory(1);
    loadAuditHistory(1);
  }, []);

  useEffect(() => {
    loadDeploymentHistory(1, { silent: true });
  }, [deploymentProcessFilter]);

  useEffect(() => {
    loadAuditHistory(1, { silent: true });
  }, [auditActionFilter]);

  return (
    <div className="space-y-4">
      <PageIntro
        title="History"
        description="Review deployments, restarts, and audit records, then filter down to one process or action."
      />

      <section className="page-panel">
        <PanelHeader
          title="Deployment History"
          className="mb-3"
          actions={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => loadDeploymentHistory(deploymentPage)}
              disabled={deploymentHistoryLoading}
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
          }
        />
        <div className="mb-2 grid gap-2 md:grid-cols-[1fr,auto] md:items-center">
          <Input
            value={deploymentProcessFilter}
            onChange={(event) => setDeploymentProcessFilter(event.target.value)}
            placeholder="Filter by process name"
          />
          {initialDeploymentProcess && (
            <span className="text-xs text-text-3">
              Opened from process: <span className="text-text-2">{initialDeploymentProcess}</span>
            </span>
          )}
        </div>
        <p className="mb-2 border-b border-border pb-2 text-xs text-text-3">
          Page {deploymentPagination.page} of {deploymentPagination.totalPages} ({deploymentPagination.totalItems} items)
        </p>
        <div className="max-h-60 space-y-2 overflow-y-auto text-base">
          {deploymentHistoryLoading && <HistoryListSkeleton showSteps />}
          {!deploymentHistoryLoading && deploymentHistory.length === 0 && <p className="text-text-3">No deployments yet.</p>}
          {deploymentHistory.map((item, idx) => (
            <InsetPanel key={`${item.ts}-${idx}`} padding="sm">
              <p className="text-text-1">
                {item.processName} {item.action === "rollback" ? "rollback" : "deployment"} by {item.actor || "unknown"} {item.success ? "succeeded" : "failed"}
              </p>
              <p className="text-xs text-text-3">
                {formatTimestamp(item.ts)} {item.branch ? `| branch: ${item.branch}` : ""}
              </p>
              {item.action === "rollback" && item.targetCommit && (
                <p className="text-xs text-text-3">target commit: {String(item.targetCommit).slice(0, 12)}</p>
              )}
              {!item.success && item.error && <p className="whitespace-pre-wrap text-xs text-danger-300">{item.error}</p>}
              {Array.isArray(item.steps) && item.steps.length > 0 && (
                <div className="mt-1 space-y-1 border-t border-border pt-1">
                  {item.steps.map((step, stepIndex) => (
                    <p key={`${item.ts}-${idx}-${step.label}-${stepIndex}`} className={`flex items-center gap-1 text-xs ${step.success ? "text-text-3" : "text-danger-300"}`}>
                      {step.success ? <CheckCircle2 size={12} aria-label="success" /> : <XCircle size={12} aria-label="failed" />}
                      {step.label}
                      {step.error ? `: ${step.error}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </InsetPanel>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={deploymentHistoryLoading || deploymentPagination.page <= 1}
            onClick={() => loadDeploymentHistory(deploymentPagination.page - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={deploymentHistoryLoading || deploymentPagination.page >= deploymentPagination.totalPages}
            onClick={() => loadDeploymentHistory(deploymentPagination.page + 1)}
          >
            Next
          </Button>
        </div>
      </section>

      <section className="page-panel">
        <PanelHeader
          title="Restart History"
          className="mb-3"
          actions={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => loadRestartHistory(restartPage)}
              disabled={restartHistoryLoading}
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
          }
        />
        <p className="mb-2 border-b border-border pb-2 text-xs text-text-3">
          Page {restartPagination.page} of {restartPagination.totalPages} ({restartPagination.totalItems} items)
        </p>
        <div className="max-h-60 space-y-2 overflow-y-auto text-base">
          {restartHistoryLoading && <HistoryListSkeleton />}
          {!restartHistoryLoading && restartHistory.length === 0 && <p className="text-text-3">No restart history yet.</p>}
          {restartHistory.map((item, idx) => (
            <InsetPanel key={`${item.ts}-${idx}`} padding="sm">
              <p className="text-text-1">
                {item.processName} {item.event || "event"} by {item.actor || "system"}
              </p>
              <p className="text-xs text-text-3">
                {formatTimestamp(item.ts)} | source: {item.source || "unknown"}
              </p>
              {(item.reason || item.exitCode !== null || item.signal) && (
                <p className="mt-1 text-xs text-warning-300">
                  reason: {item.reason || "-"}
                  {item.exitCode !== null && item.exitCode !== undefined ? ` | exit: ${item.exitCode}` : ""}
                  {item.signal ? ` | signal: ${item.signal}` : ""}
                </p>
              )}
            </InsetPanel>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={restartHistoryLoading || restartPagination.page <= 1}
            onClick={() => loadRestartHistory(restartPagination.page - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={restartHistoryLoading || restartPagination.page >= restartPagination.totalPages}
            onClick={() => loadRestartHistory(restartPagination.page + 1)}
          >
            Next
          </Button>
        </div>
      </section>

      <section className="page-panel">
        <PanelHeader
          title="Audit Trail"
          className="mb-3"
          actions={
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => loadAuditHistory(auditPage)}
              disabled={auditHistoryLoading}
            >
              <RefreshCw size={14} />
              Refresh
            </Button>
          }
        />
        <div className="mb-2 grid gap-2 md:grid-cols-[220px,1fr] md:items-center">
          <Select value={auditActionPreset} onChange={(event) => setAuditActionPreset(event.target.value)}>
            <option value="">All actions</option>
            <option value="process.deploy">process.deploy</option>
            <option value="process.rollback">process.rollback</option>
            <option value="process.dotenv.update">process.dotenv.update</option>
            <option value="process.start">process.start</option>
            <option value="process.stop">process.stop</option>
            <option value="process.restart">process.restart</option>
            <option value="__custom__">Custom...</option>
          </Select>
          <Input
            value={auditActionCustom}
            onChange={(event) => setAuditActionCustom(event.target.value)}
            placeholder="Custom action filter (e.g. auth.login)"
            disabled={auditActionPreset !== "__custom__"}
          />
        </div>
        <p className="mb-2 border-b border-border pb-2 text-xs text-text-3">
          Page {auditPagination.page} of {auditPagination.totalPages} ({auditPagination.totalItems} items)
        </p>
        <div className="max-h-72 space-y-2 overflow-y-auto text-base">
          {auditHistoryLoading && <HistoryListSkeleton />}
          {!auditHistoryLoading && auditHistory.length === 0 && <p className="text-text-3">No audit entries yet.</p>}
          {auditHistory.map((item, idx) => (
            <InsetPanel key={`${item.ts}-${idx}`} padding="sm">
              <p className="text-text-1">
                {item.action} {item.processName ? `(${item.processName})` : ""}
              </p>
              <p className="text-xs text-text-3">
                {formatTimestamp(item.ts)} | actor: {item.actor || "unknown"} | ip: {item.ip || "unknown"} | {item.success ? "success" : "failed"}
              </p>
              {!item.success && item.error && <p className="mt-1 whitespace-pre-wrap text-xs text-danger-300">{item.error}</p>}
            </InsetPanel>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={auditHistoryLoading || auditPagination.page <= 1}
            onClick={() => loadAuditHistory(auditPagination.page - 1)}
          >
            Previous
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={auditHistoryLoading || auditPagination.page >= auditPagination.totalPages}
            onClick={() => loadAuditHistory(auditPagination.page + 1)}
          >
            Next
          </Button>
        </div>
      </section>
    </div>
  );
}

function HistoryListSkeleton({ showSteps = false, count = 3 }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <InsetPanel key={index} padding="sm">
          <Skeleton className="mb-2 h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          {showSteps && (
            <div className="mt-2 space-y-1 border-t border-border pt-2">
              <Skeleton className="h-3 w-2/3" />
              <Skeleton className="h-3 w-3/5" />
            </div>
          )}
        </InsetPanel>
      ))}
    </div>
  );
}

