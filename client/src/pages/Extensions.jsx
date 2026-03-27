import { useEffect, useState } from "react";
import { DownloadCloud, PackageCheck } from "lucide-react";
import { caddy as caddyApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Button from "../components/ui/Button";

export default function Extensions() {
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState({
    platform: "unknown",
    installed: false,
    available: false,
    version: null,
    installCommands: []
  });

  const loadStatus = async () => {
    try {
      setLoading(true);
      const result = await caddyApi.status();
      if (!result.success) {
        throw new Error(result.error || "Unable to load extensions");
      }
      setStatus((prev) => ({ ...prev, ...(result.data || {}) }));
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to load extensions"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  const installCaddy = async () => {
    try {
      setInstalling(true);
      const result = await caddyApi.install();
      if (!result.success) {
        throw new Error(result.error || "Caddy install failed");
      }
      toast.success(result.data?.alreadyInstalled ? "Caddy is already installed" : "Caddy installed successfully");
      await loadStatus();
    } catch (error) {
      toast.error(getErrorMessage(error, "Caddy install failed"));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="page-panel">
        <h2 className="section-title mb-1">Extensions</h2>
        <p className="text-sm text-text-3">Install and manage optional components from this dashboard.</p>
      </section>

      <section className="page-panel">
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-md border border-border bg-surface-2 p-2">
            <PackageCheck className="text-brand-400" size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-text-1">Caddy</h3>
            <p className="text-sm text-text-3">
              Platform: <span className="text-text-2">{status.platform || "unknown"}</span>
            </p>
            <p className="text-sm text-text-3">
              Status:{" "}
              <span className={status.installed ? "text-success-300" : "text-warning-300"}>
                {status.installed ? `Installed${status.version ? ` (${status.version})` : ""}` : "Not installed"}
              </span>
            </p>
          </div>
          <Button
            type="button"
            variant={status.installed ? "secondary" : "outlineInfo"}
            disabled={loading || installing || status.installed}
            onClick={installCaddy}
          >
            <DownloadCloud size={16} />
            {status.installed ? "Installed" : installing ? "Installing..." : "Install Caddy"}
          </Button>
        </div>

        {!status.installed && Array.isArray(status.installCommands) && status.installCommands.length > 0 && (
          <div className="mt-3 rounded-md border border-border bg-surface-2 p-3 text-xs text-text-3">
            <p className="mb-1 text-text-2">Detected install command(s)</p>
            {status.installCommands.map((command) => (
              <pre key={command} className="overflow-x-auto whitespace-pre-wrap text-xs text-text-3">
                {command}
              </pre>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
