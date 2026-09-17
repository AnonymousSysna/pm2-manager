import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import toast, { getErrorMessage } from "../lib/toast";
import { auth, pm2Admin, alerts as alertsApi, processes as processApi, system as systemApi } from "../api";
import Banner from "../components/ui/Banner";
import Button from "../components/ui/Button";
import Checkbox from "../components/ui/Checkbox";
import Field from "../components/ui/Field";
import FileInput from "../components/ui/FileInput";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import { ConfirmDialog } from "../components/ui/Modal";
import RangeInput from "../components/ui/RangeInput";
import Select from "../components/ui/Select";
import { Skeleton } from "../components/ui/Skeleton";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";

export default function Settings() {
  const [info, setInfo] = useState({ pm2Version: "-", nodeVersion: "-", pm2Home: "-" });
  const [pollSeconds, setPollSeconds] = useState(Number(localStorage.getItem("pm2_poll_interval_ms") || 2000) / 1000);
  const [autoScroll, setAutoScroll] = useState(localStorage.getItem("pm2_auto_scroll_logs") !== "false");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [channels, setChannels] = useState([]);
  const [channelName, setChannelName] = useState("");
  const [channelType, setChannelType] = useState("webhook");
  const [channelUrl, setChannelUrl] = useState("");
  const [channelSeverity, setChannelSeverity] = useState("warning");
  const [channelEnabled, setChannelEnabled] = useState(true);
  const [startupLoading, setStartupLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const fileRef = useRef(null);

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

    systemApi
      .readiness()
      .then((result) => {
        setReadiness(result.data || null);
      })
      .catch((error) => {
        setReadiness({
          ok: false,
          issues: [getErrorMessage(error, "Unable to read production readiness")],
          warnings: []
        });
      })
      .finally(() => setReadinessLoading(false));
  }, []);

  const executeAction = async (label, fn) => {
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
    } catch {}
  };

  const runAction = (label, fn, confirmText) => {
    if (confirmText) {
      setPendingAction({ label, fn, confirmText });
      return;
    }
    executeAction(label, fn);
  };

  const saveDashboardSettings = () => {
    localStorage.setItem("pm2_poll_interval_ms", String(Math.max(1000, Math.min(10000, pollSeconds * 1000))));
    localStorage.setItem("pm2_auto_scroll_logs", autoScroll ? "true" : "false");
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
    } catch {}
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

  const openStartupWizard = async () => {
    try {
      setStartupLoading(true);
      const result = await pm2Admin.startup();
      if (!result.success) {
        throw new Error(result.error || "Failed to prepare startup command");
      }

      if (result.data?.alreadyPersisted) {
        toast.success("Startup persistence is already enabled");
        localStorage.setItem("pm2_onboarding_startup_checked", "true");
        return;
      }

      if (result.data?.activated) {
        toast.success("Startup persistence enabled (`pm2 startup` + `pm2 save`)");
        localStorage.setItem("pm2_onboarding_startup_checked", "true");
        return;
      }

      const startupOutput = String(result.data?.startup?.output || "").trim();
      const hint = String(result.data?.instructionCommand || "").trim();
      const message = hint
        ? `Persist failed. Run manually: ${hint}`
        : result.error || "Persist on reboot failed";
      toast.error(message);
      if (startupOutput) {
        toast.info(`Startup output: ${startupOutput.slice(-220)}`);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Persist on reboot failed"));
    } finally {
      setStartupLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageIntro title="Settings" />

      <div className="ops-section-grid">
        <div className="dashboard-main-stack">
          <ProductionReadinessPanel readiness={readiness} loading={readinessLoading} />

          <section className="page-panel">
            <PanelHeader title="PM2 Daemon" className="mb-3" />
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <Button variant="outlineInfo" onClick={openStartupWizard} disabled={startupLoading}>
                {startupLoading ? "Preparing..." : "Persist"}
              </Button>
              <Button variant="info" onClick={() => runAction("Resurrect", pm2Admin.resurrect)}>
                Resurrect
              </Button>
              <Button variant="success" onClick={() => runAction("Save", pm2Admin.save)}>
                Save list
              </Button>
              <Button
                variant="danger"
                onClick={() => runAction("Kill PM2", pm2Admin.kill, "Kill PM2 daemon? This can stop all managed processes.")}
              >
                Kill daemon
              </Button>
            </div>
            <div className="mt-3 grid gap-2 text-sm text-text-2 md:grid-cols-3">
              <InsetPanel padding="sm">PM2: <span className="text-text-1">{info.pm2Version || "unknown"}</span></InsetPanel>
              <InsetPanel padding="sm">Node: <span className="text-text-1">{info.nodeVersion || "unknown"}</span></InsetPanel>
              <InsetPanel padding="sm" className="truncate">Home: <span className="text-text-1">{info.pm2Home || "unknown"}</span></InsetPanel>
            </div>
          </section>

          <section className="page-panel">
            <PanelHeader title="Alert Channels" className="mb-3" />
            {channelsWithFailures.length > 0 && (
              <Banner tone="warning" icon={<AlertTriangle size={14} />} className="mb-3">
                {channelsWithFailures.length} channel(s) have failed deliveries.
              </Banner>
            )}
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
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-surface-2/50 px-3 py-2 text-sm text-text-2">
                <Checkbox checked={channelEnabled} onChange={(e) => setChannelEnabled(e.target.checked)} />
                Enabled
              </label>
              <Button variant="secondary" onClick={saveChannel}>
                Save channel
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {channels.length === 0 && <p className="quiet-empty-state">No channels configured.</p>}
              {channels.map((channel) => (
                <InsetPanel key={channel.id} padding="sm" className="flex flex-wrap items-center gap-2 text-sm">
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
                  <span className="min-w-0 flex-1 truncate text-xs text-text-3">{channel.url}</span>
                  <Button size="sm" variant="secondary" onClick={() => testChannel(channel.id)}>
                    Test
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => removeChannel(channel.id)}>
                    Delete
                  </Button>
                </InsetPanel>
              ))}
            </div>
          </section>
        </div>

        <aside className="dashboard-side-stack">
          <section className="page-panel">
            <PanelHeader title="Dashboard" className="mb-3" />
            <div className="space-y-3 text-base text-text-2">
              <Field label={`Poll interval: ${pollSeconds}s`}>
                <RangeInput
                  min="1"
                  max="10"
                  value={pollSeconds}
                  onChange={(e) => setPollSeconds(Number(e.target.value))}
                />
              </Field>
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-surface-2/50 px-3 py-2 text-sm text-text-2">
                <Checkbox checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
                Auto-scroll logs
              </label>
              <Button variant="secondary" onClick={saveDashboardSettings} className="w-full">
                Save settings
              </Button>
            </div>
          </section>

          <section className="page-panel">
            <PanelHeader title="Process Config" className="mb-3" />
            <div className="space-y-2">
              <Button variant="secondary" onClick={exportConfig} className="w-full">
                Export JSON
              </Button>
              <FileInput ref={fileRef} accept="application/json" onChange={onImportFile} />
            </div>
          </section>

          <section className="page-panel">
            <PanelHeader title="Password" className="mb-3" />
            <div className="grid gap-2">
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
                Update password
              </Button>
            </div>
          </section>
        </aside>
      </div>

      {pendingAction && (
        <ConfirmDialog
          title={pendingAction.label}
          description={pendingAction.confirmText}
          confirmLabel={pendingAction.label}
          onClose={() => setPendingAction(null)}
          onConfirm={async () => {
            const action = pendingAction;
            setPendingAction(null);
            await executeAction(action.label, action.fn);
          }}
        />
      )}
    </div>
  );
}


function ProductionReadinessPanel({ readiness, loading }) {
  const issues = Array.isArray(readiness?.issues) ? readiness.issues : [];
  const warnings = Array.isArray(readiness?.warnings) ? readiness.warnings : [];
  const ok = Boolean(readiness?.ok) && issues.length === 0;

  return (
    <section className="page-panel compact-page-stack p-3">
      <PanelHeader
        title="Production Readiness"
        description="Configuration, secret, cookie, and runtime checks before exposing this dashboard."
      />
      {loading ? (
        <div className="grid gap-2 md:grid-cols-3" aria-hidden="true">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-3">
            <InsetPanel padding="sm">
              <p className="text-xs uppercase tracking-[0.16em] text-text-3">Config</p>
              <p className={`mt-1 text-sm font-semibold ${ok ? "text-success-300" : "text-danger-300"}`}>
                {ok ? "Ready" : "Needs attention"}
              </p>
            </InsetPanel>
            <InsetPanel padding="sm">
              <p className="text-xs uppercase tracking-[0.16em] text-text-3">Mode</p>
              <p className="mt-1 text-sm font-semibold text-text-1">
                {readiness?.production ? "Production" : "Development"}
              </p>
            </InsetPanel>
            <InsetPanel padding="sm">
              <p className="text-xs uppercase tracking-[0.16em] text-text-3">PM2 Queue</p>
              <p className="mt-1 text-sm font-semibold text-text-1">
                {Number(readiness?.pm2Queue?.queuedOperations || 0)} queued
              </p>
            </InsetPanel>
          </div>

          {issues.length > 0 && (
            <Banner tone="danger">
              <p className="font-semibold">Fix these before public production use:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                {issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            </Banner>
          )}

          {warnings.length > 0 && (
            <Banner tone="warning">
              <p className="font-semibold">Recommended hardening:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-xs">
                {warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </Banner>
          )}

          {ok && warnings.length === 0 && (
            <Banner tone="success">Core production checks passed.</Banner>
          )}
        </>
      )}
    </section>
  );
}
