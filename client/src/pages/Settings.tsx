// @ts-nocheck
import { useEffect, useRef, useState } from "react";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { auth, pm2Admin, processes as processApi, alerts as alertsApi } from "../api";
import Button from "../components/ui/Button";
import Checkbox from "../components/ui/Checkbox";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import { PageIntro } from "../components/ui/PageLayout";

export default function Settings() {
  const [searchParams] = useSearchParams();
  const initialDeploymentProcess = String(searchParams.get("deploymentProcess") || "").trim();
  const [info, setInfo] = useState({ pm2Version: "-", nodeVersion: "-", pm2Home: "-" });
  const [pollSeconds, setPollSeconds] = useState(Number(localStorage.getItem("pm2_poll_interval_ms") || 2000) / 1000);
  const [autoScroll, setAutoScroll] = useState(localStorage.getItem("pm2_auto_scroll_logs") !== "false");
  const [theme, setTheme] = useState(localStorage.getItem("pm2_theme") || "dark");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [channels, setChannels] = useState([]);
  const [channelName, setChannelName] = useState("");
  const [channelType, setChannelType] = useState("webhook");
  const [channelUrl, setChannelUrl] = useState("");
  const [channelSeverity, setChannelSeverity] = useState("warning");
  const [channelEnabled, setChannelEnabled] = useState(true);
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
  const fileRef = useRef(null);

  const auditActionFilter = auditActionPreset === "__custom__"
    ? auditActionCustom.trim()
    : auditActionPreset.trim();

  const formatTimestamp = (value) => {
    if (!value) {
      return "—";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "—";
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
    pm2Admin
      .info()
      .then((result) => {
        if (result.success) {
          setInfo(result.data);
        }
      })
      .catch(() => {
        toast.error("Unable to fetch PM2 info");
      });

    alertsApi
      .listChannels()
      .then((result) => {
        if (result.success && Array.isArray(result.data)) {
          setChannels(result.data);
        }
      })
      .catch(() => {
        // Keep settings usable without channel list.
      });

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

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
  }, [theme]);

  const runAction = async (label, fn, confirmText) => {
    if (confirmText && !window.confirm(confirmText)) {
      return;
    }

    try {
      await toast.promise(
        fn().then((result) => {
          if (!result.success) {
            throw new Error(result.error || `${label} failed`);
          }
          return result;
        }),
        {
          loading: `${label} in progress...`,
          success: `${label} completed`,
          error: (error) => getErrorMessage(error, `${label} failed`)
        }
      );
    } catch (_error) {
      // Toast is handled by toast.promise.
    }
  };

  const saveDashboardSettings = () => {
    localStorage.setItem("pm2_poll_interval_ms", String(Math.max(1000, Math.min(10000, pollSeconds * 1000))));
    localStorage.setItem("pm2_auto_scroll_logs", autoScroll ? "true" : "false");
    localStorage.setItem("pm2_theme", theme);
    document.documentElement.setAttribute("data-theme", theme === "light" ? "light" : "dark");
    window.dispatchEvent(new Event("pm2:settings-updated"));
    toast.success("Dashboard settings saved");
  };

  const changePassword = async () => {
    if (!newPassword.trim()) {
      toast.error("New password cannot be empty");
      return;
    }

    if (newPassword !== confirmPassword) {
      toast.error("New password and confirm password must match");
      return;
    }

    try {
      await toast.promise(
        auth.changePassword(currentPassword, newPassword).then((result) => {
          if (!result.success) {
            throw new Error(result.error || "Password update failed");
          }
          return result;
        }),
        {
          loading: "Updating password...",
          success: "Password updated",
          error: (error) => getErrorMessage(error, "Password update failed")
        }
      );
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (_error) {
      // Toast is handled by toast.promise.
    }
  };

  const exportConfig = async () => {
    try {
      const result = await processApi.exportConfig();
      if (!result.success) {
        throw new Error(result.error || "Export failed");
      }
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `pm2-process-config-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Process config exported");
    } catch (error) {
      toast.error(getErrorMessage(error, "Export failed"));
    }
  };

  const onImportFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const result = await processApi.importConfig(payload);
      if (!result.success) {
        throw new Error(result.error || "Import failed");
      }
      toast.success(`Imported ${result.data.importedProcesses} processes`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Import failed"));
    } finally {
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  };

  const saveChannel = async () => {
    try {
      const result = await alertsApi.saveChannel({
        name: channelName || channelType,
        type: channelType,
        url: channelUrl,
        minSeverity: channelSeverity,
        enabled: channelEnabled
      });
      if (!result.success) {
        throw new Error(result.error || "Failed to save alert channel");
      }
      setChannelName("");
      setChannelUrl("");
      const channelsResult = await alertsApi.listChannels();
      if (channelsResult.success && Array.isArray(channelsResult.data)) {
        setChannels(channelsResult.data);
      }
      toast.success("Alert channel saved");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to save alert channel"));
    }
  };

  const removeChannel = async (id) => {
    try {
      const result = await alertsApi.deleteChannel(id);
      if (!result.success) {
        throw new Error(result.error || "Failed to delete channel");
      }
      setChannels((prev) => prev.filter((item) => item.id !== id));
      toast.success("Alert channel deleted");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete channel"));
    }
  };

  const testChannel = async (id) => {
    try {
      const result = await alertsApi.testChannel(id);
      if (!result.success) {
        throw new Error(result.error || "Test delivery failed");
      }
      toast.success("Test alert sent");
    } catch (error) {
      toast.error(getErrorMessage(error, "Test delivery failed"));
    }
  };

  const channelsWithFailures = channels.filter((channel) => Number(channel?.deliveryStats?.failedDeliveries || 0) > 0);

  return (
    <div className="space-y-4">
      <PageIntro
        title="Settings"
        description="Manage PM2 daemon controls, dashboard preferences, alert channels, and account security."
      />

      <section className="page-panel">
        <h2 className="section-title mb-3">PM2 Daemon Controls</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="info" onClick={() => runAction("Resurrect", pm2Admin.resurrect)}>
            Resurrect Saved Processes
          </Button>
          <Button variant="success" onClick={() => runAction("Save", pm2Admin.save)}>
            Save Current Process List
          </Button>
          <Button
            variant="danger"
            onClick={() => runAction("Kill PM2", pm2Admin.kill, "Kill PM2 daemon? This can stop all managed processes.")}
          >
            Kill PM2 Daemon
          </Button>
        </div>
        <div className="mt-4 grid gap-2 text-sm text-text-2 md:grid-cols-3">
          <p>PM2 Version: {info.pm2Version || "unknown"}</p>
          <p>Node Version: {info.nodeVersion || "unknown"}</p>
          <p>PM2 Home: {info.pm2Home || "unknown"}</p>
        </div>
      </section>

      <section className="page-panel">
        <h2 className="section-title mb-3">Dashboard Settings</h2>
        <div className="space-y-3 text-sm text-text-2">
          <label className="block">
            Poll interval: {pollSeconds}s
            <input
              type="range"
              min="1"
              max="10"
              value={pollSeconds}
              onChange={(e) => setPollSeconds(Number(e.target.value))}
              className="mt-2 w-full accent-brand-500"
            />
          </label>
          <label className="flex items-center gap-2">
            <Checkbox checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            Auto-scroll logs
          </label>
          <label className="flex items-center gap-2">
            <span>Theme</span>
            <Select value={theme} onChange={(e) => setTheme(e.target.value)} className="w-auto min-w-28">
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </Select>
          </label>
          <Button variant="secondary" onClick={saveDashboardSettings}>
            Save Dashboard Settings
          </Button>
        </div>
      </section>

      <section className="page-panel">
        <h2 className="section-title mb-3">Process Config Export / Import</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={exportConfig}>
            Export Config JSON
          </Button>
          <input ref={fileRef} type="file" accept="application/json" onChange={onImportFile} className="text-sm text-text-2" />
        </div>
      </section>

      <section className="page-panel">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="section-title">External Alert Channels</h2>
          {channelsWithFailures.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-warning-500/40 bg-warning-500/10 px-2 py-1 text-xs text-warning-300">
              <AlertTriangle size={12} />
              {channelsWithFailures.length} channel(s) have failed deliveries
            </span>
          )}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <Input value={channelName} onChange={(e) => setChannelName(e.target.value)} placeholder="Channel name" />
          <Input value={channelUrl} onChange={(e) => setChannelUrl(e.target.value)} placeholder="https://..." />
          <Select value={channelType} onChange={(e) => setChannelType(e.target.value)}>
            <option value="webhook">Webhook</option>
            <option value="slack">Slack Webhook</option>
          </Select>
          <Select value={channelSeverity} onChange={(e) => setChannelSeverity(e.target.value)}>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="danger">danger</option>
          </Select>
          <label className="flex items-center gap-2 text-sm text-text-2">
            <Checkbox checked={channelEnabled} onChange={(e) => setChannelEnabled(e.target.checked)} />
            Enabled
          </label>
        </div>
        <div className="mt-2">
          <Button variant="secondary" onClick={saveChannel}>
            Save Alert Channel
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {channels.length === 0 && <p className="text-sm text-text-3">No channels configured.</p>}
          {channels.map((channel) => (
            <div key={channel.id} className="page-panel flex flex-wrap items-center gap-2 p-2 text-sm">
              <span className="font-medium text-text-1">{channel.name}</span>
              <span className="text-text-3">{channel.type}</span>
              <span className="text-text-3">min:{channel.minSeverity}</span>
              {Number(channel?.deliveryStats?.failedDeliveries || 0) > 0 && (
                <span className="rounded border border-warning-500/40 bg-warning-500/10 px-1.5 py-0.5 text-xs text-warning-300">
                  failed: {Number(channel?.deliveryStats?.failedDeliveries || 0)}
                </span>
              )}
              {channel?.deliveryStats?.lastFailureAt && (
                <span className="text-xs text-warning-300">
                  last fail: {new Date(channel.deliveryStats.lastFailureAt).toLocaleString()}
                </span>
              )}
              <span className="truncate text-xs text-text-3">{channel.url}</span>
              <Button variant="secondary" onClick={() => testChannel(channel.id)}>
                Test
              </Button>
              <Button variant="danger" onClick={() => removeChannel(channel.id)}>
                Delete
              </Button>
            </div>
          ))}
        </div>
      </section>

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

      <section className="page-panel">
        <h2 className="section-title mb-3">Change Password</h2>
        <div className="grid gap-2 md:max-w-md">
          <Input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
          />
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="New password" />
          <Input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
          />
          <Button variant="success" onClick={changePassword}>
            Update Password
          </Button>
        </div>
      </section>
    </div>
  );
}

