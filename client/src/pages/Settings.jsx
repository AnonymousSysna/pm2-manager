import { useEffect, useState } from "react";
import toast, { getErrorMessage } from "../lib/toast";
import { auth, pm2Admin } from "../api";

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
    <div className="space-y-6">
      <section className="rounded-lg bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-semibold">PM2 Daemon Controls</h3>
        <div className="flex flex-wrap gap-2">
          <button className="rounded bg-blue-600 px-3 py-2 text-sm" onClick={() => runAction("Resurrect", pm2Admin.resurrect)}>
            Resurrect Saved Processes
          </button>
          <button className="rounded bg-green-600 px-3 py-2 text-sm" onClick={() => runAction("Save", pm2Admin.save)}>
            Save Current Process List
          </button>
          <button
            className="rounded bg-rose-700 px-3 py-2 text-sm"
            onClick={() => runAction("Kill PM2", pm2Admin.kill, "Kill PM2 daemon? This can stop all managed processes.")}
          >
            Kill PM2 Daemon
          </button>
        </div>
        <div className="mt-4 grid gap-2 text-sm text-slate-300 md:grid-cols-3">
          <p>PM2 Version: {info.pm2Version || "unknown"}</p>
          <p>Node Version: {info.nodeVersion || "unknown"}</p>
          <p>PM2 Home: {info.pm2Home || "unknown"}</p>
        </div>
      </section>

      <section className="rounded-lg bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-semibold">Dashboard Settings</h3>
        <div className="space-y-3 text-sm">
          <label className="block">
            Poll interval: {pollSeconds}s
            <input
              type="range"
              min="1"
              max="10"
              value={pollSeconds}
              onChange={(e) => setPollSeconds(Number(e.target.value))}
              className="mt-2 w-full"
            />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            Auto-scroll logs
          </label>
          <button className="rounded bg-slate-700 px-3 py-2 text-sm" onClick={saveDashboardSettings}>
            Save Dashboard Settings
          </button>
        </div>
      </section>

      <section className="rounded-lg bg-slate-900 p-4">
        <h3 className="mb-3 text-lg font-semibold">Change Password</h3>
        <div className="grid gap-2 md:max-w-md">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Current password"
            className="rounded bg-slate-800 px-3 py-2"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            className="rounded bg-slate-800 px-3 py-2"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
            className="rounded bg-slate-800 px-3 py-2"
          />
          <button className="rounded bg-green-600 px-3 py-2 text-sm" onClick={changePassword}>
            Update Password
          </button>
        </div>
      </section>
    </div>
  );
}
