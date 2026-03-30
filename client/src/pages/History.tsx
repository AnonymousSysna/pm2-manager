// @ts-nocheck
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { processes as processApi } from "../api";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import { PageIntro } from "../components/ui/PageLayout";

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
    } catch (_error) {
      // Optional panel.
    } finally {
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
    } catch (_error) {
      // Optional panel.
    } finally {
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
    } catch (_error) {
      // Optional panel.
    } finally {
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
        description="Review deployment, restart, and audit timelines."
      />

      <section className="page-panel">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="section-title">Deployment History</h2>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => loadDeploymentHistory(deploymentPage)}
              disabled={deploymentHistoryLoading}
            >
              <RefreshCw size={14} className={deploymentHistoryLoading ? "animate-spin" : ""} />
              Refresh
            </Button>
          </div>
        </div>
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
        <p className="mb-2 text-xs text-text-3">
          Page {deploymentPagination.page} of {deploymentPagination.totalPages} ({deploymentPagination.totalItems} items)
        </p>
        <div className="max-h-60 space-y-2 overflow-y-auto text-sm">
          {deploymentHistoryLoading && <p className="text-text-3">Loading deployment history...</p>}
          {!deploymentHistoryLoading && deploymentHistory.length === 0 && <p className="text-text-3">No deployments yet.</p>}
          {deploymentHistory.map((item, idx) => (
            <div key={`${item.ts}-${idx}`} className="page-panel p-2">
              <p className="text-text-1">
                {item.processName} {item.action === "rollback" ? "rollback" : "deployment"} by {item.actor || "unknown"} {item.success ? "succeeded" : "failed"}
              </p>
              <p className="text-xs text-text-3">
                {new Date(item.ts).toLocaleString()} {item.branch ? ` branch:${item.branch}` : ""}
              </p>
              {item.action === "rollback" && item.targetCommit && (
                <p className="text-xs text-text-3">target commit: {String(item.targetCommit).slice(0, 12)}</p>
              )}
              {!item.success && item.error && <p className="whitespace-pre-wrap text-xs text-danger-300">{item.error}</p>}
              {Array.isArray(item.steps) && item.steps.length > 0 && (
                <div className="mt-1 space-y-1 border-t border-border pt-1">
                  {item.steps.map((step, stepIndex) => (
                    <p key={`${item.ts}-${idx}-${step.label}-${stepIndex}`} className={`text-xs ${step.success ? "text-text-3" : "text-danger-300"}`}>
                      {step.success ? "ok" : "x"} {step.label}
                      {step.error ? `: ${step.error}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="section-title">Restart History</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => loadRestartHistory(restartPage)}
            disabled={restartHistoryLoading}
          >
            <RefreshCw size={14} className={restartHistoryLoading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
        <p className="mb-2 text-xs text-text-3">
          Page {restartPagination.page} of {restartPagination.totalPages} ({restartPagination.totalItems} items)
        </p>
        <div className="max-h-60 space-y-2 overflow-y-auto text-sm">
          {restartHistoryLoading && <p className="text-text-3">Loading restart history...</p>}
          {!restartHistoryLoading && restartHistory.length === 0 && <p className="text-text-3">No restart history yet.</p>}
          {restartHistory.map((item, idx) => (
            <div key={`${item.ts}-${idx}`} className="page-panel p-2">
              <p className="text-text-1">
                {item.processName} {item.event || "event"} by {item.actor || "system"}
              </p>
              <p className="text-xs text-text-3">
                {formatTimestamp(item.ts)} | source:{item.source || "unknown"}
              </p>
              {(item.reason || item.exitCode !== null || item.signal) && (
                <p className="mt-1 text-xs text-warning-300">
                  reason: {item.reason || "-"}
                  {item.exitCode !== null && item.exitCode !== undefined ? ` | exit:${item.exitCode}` : ""}
                  {item.signal ? ` | signal:${item.signal}` : ""}
                </p>
              )}
            </div>
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
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="section-title">Audit Trail</h2>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => loadAuditHistory(auditPage)}
            disabled={auditHistoryLoading}
          >
            <RefreshCw size={14} className={auditHistoryLoading ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
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
        <p className="mb-2 text-xs text-text-3">
          Page {auditPagination.page} of {auditPagination.totalPages} ({auditPagination.totalItems} items)
        </p>
        <div className="max-h-72 space-y-2 overflow-y-auto text-sm">
          {auditHistoryLoading && <p className="text-text-3">Loading audit trail...</p>}
          {!auditHistoryLoading && auditHistory.length === 0 && <p className="text-text-3">No audit entries yet.</p>}
          {auditHistory.map((item, idx) => (
            <div key={`${item.ts}-${idx}`} className="page-panel p-2">
              <p className="text-text-1">
                {item.action} {item.processName ? `(${item.processName})` : ""}
              </p>
              <p className="text-xs text-text-3">
                {formatTimestamp(item.ts)} | actor:{item.actor || "unknown"} | ip:{item.ip || "unknown"} | {item.success ? "success" : "failed"}
              </p>
              {!item.success && item.error && <p className="mt-1 whitespace-pre-wrap text-xs text-danger-300">{item.error}</p>}
            </div>
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

