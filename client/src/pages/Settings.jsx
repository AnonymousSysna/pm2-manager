import { useEffect, useRef, useState } from "react";
import toast, { getErrorMessage } from "../lib/toast";
import { auth, pm2Admin, processes as processApi, alerts as alertsApi } from "../api";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import { PageIntro } from "../components/ui/PageLayout";

export default function Settings() {
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

    processApi
      .deploymentHistory(50)
      .then((result) => {
        if (result.success && Array.isArray(result.data)) {
          setDeploymentHistory(result.data);
        }
      })
      .catch(() => {
        // Optional panel.
      });
  }, []);

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
    toast.success("Dashboard settings saved");
  };

  const changePassword = async () => {
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
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
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
        <h2 className="section-title mb-3">External Alert Channels</h2>
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
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-500"
              checked={channelEnabled}
              onChange={(e) => setChannelEnabled(e.target.checked)}
            />
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
            <div key={channel.id} className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-sm">
              <span className="font-medium text-text-1">{channel.name}</span>
              <span className="text-text-3">{channel.type}</span>
              <span className="text-text-3">min:{channel.minSeverity}</span>
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
        <h2 className="section-title mb-3">Deployment History</h2>
        <div className="max-h-60 space-y-2 overflow-y-auto text-sm">
          {deploymentHistory.length === 0 && <p className="text-text-3">No deployments yet.</p>}
          {deploymentHistory
            .slice()
            .reverse()
            .map((item, idx) => (
              <div key={`${item.ts}-${idx}`} className="rounded border border-border p-2">
                <p className="text-text-1">
                  {item.processName} {item.action === "rollback" ? "rollback" : "deployment"} by {item.actor || "unknown"} {item.success ? "succeeded" : "failed"}
                </p>
                <p className="text-xs text-text-3">
                  {new Date(item.ts).toLocaleString()} {item.branch ? ` branch:${item.branch}` : ""}
                </p>
                {item.action === "rollback" && item.targetCommit && (
                  <p className="text-xs text-text-3">target commit: {String(item.targetCommit).slice(0, 12)}</p>
                )}
                {!item.success && item.error && <p className="text-xs text-danger-300">{item.error}</p>}
              </div>
            ))}
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
