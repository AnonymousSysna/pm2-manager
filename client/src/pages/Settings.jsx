import { useEffect, useState } from "react";
import toast, { getErrorMessage } from "../lib/toast";
import { auth, pm2Admin } from "../api";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";

export default function Settings() {
  const [info, setInfo] = useState({ pm2Version: "-", nodeVersion: "-", pm2Home: "-" });
  const [pollSeconds, setPollSeconds] = useState(Number(localStorage.getItem("pm2_poll_interval_ms") || 2000) / 1000);
  const [autoScroll, setAutoScroll] = useState(localStorage.getItem("pm2_auto_scroll_logs") !== "false");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

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
  }, []);

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

  return (
    <div className="space-y-4">
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
          <Button variant="secondary" onClick={saveDashboardSettings}>
            Save Dashboard Settings
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
