// @ts-nocheck
import { useEffect, useState } from "react";
import { DownloadCloud, PackageCheck, TerminalSquare } from "lucide-react";
import { caddy as caddyApi, processes as processApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";

export default function Extensions() {
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [interpreterState, setInterpreterState] = useState({
    loading: true,
    interpreters: [],
    totals: {
      supported: 0,
      installed: 0
    }
  });
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
    loadInterpreters();
  }, []);

  const loadInterpreters = async () => {
    try {
      setInterpreterState((prev) => ({ ...prev, loading: true }));
      const result = await processApi.interpreters();
      if (!result.success) {
        throw new Error(result.error || "Unable to detect interpreters");
      }
      setInterpreterState({
        loading: false,
        interpreters: Array.isArray(result.data?.interpreters) ? result.data.interpreters : [],
        totals: {
          supported: Number(result.data?.totals?.supported || 0),
          installed: Number(result.data?.totals?.installed || 0)
        }
      });
    } catch (error) {
      setInterpreterState((prev) => ({ ...prev, loading: false }));
      toast.error(getErrorMessage(error, "Unable to detect interpreters"));
    }
  };

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
      <PageIntro
        title="Extensions"
        description="Install and manage optional components from this dashboard."
      />

      <section className="page-panel">
        <PanelHeader title="Available Extensions" className="mb-3" />
        <div className="flex flex-wrap items-center gap-3">
          <div className="rounded-md border border-border bg-surface-2 p-2">
            <PackageCheck className="text-brand-400" size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="section-title">Caddy</h3>
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

      <section className="page-panel">
        <PanelHeader title="Runtime Interpreters" className="mb-3" />

        <div className="mb-3 flex items-center gap-3">
          <div className="rounded-md border border-border bg-surface-2 p-2">
            <TerminalSquare className="text-brand-400" size={22} />
          </div>
          <div className="text-sm text-text-3">
            PM2 can use interpreters installed on this server. Cluster mode is Node.js-focused.
            <div className="text-text-2">
              Installed: {interpreterState.totals.installed} / Supported presets: {interpreterState.totals.supported}
            </div>
          </div>
          <div className="ml-auto">
            <Button type="button" variant="outlineInfo" disabled={interpreterState.loading} onClick={loadInterpreters}>
              {interpreterState.loading ? "Detecting..." : "Rescan"}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {interpreterState.interpreters.map((item) => (
            <div key={item.key} className="rounded-md border border-border bg-surface-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-text-1">{item.displayName}</h4>
                <Badge tone={item.installed ? "success" : "warning"}>{item.installed ? "Installed" : "Not found"}</Badge>
                {item.clusterCapable ? <Badge tone="info">Cluster capable</Badge> : null}
                <span className="text-xs text-text-3">
                  PM2 interpreter: <span className="text-text-2">{item.interpreter || "-"}</span>
                </span>
              </div>
              <p className="mt-1 text-xs text-text-3">Version: <span className="text-text-2">{item.version || "-"}</span></p>
              <p className="mt-1 text-xs text-text-3">
                Checked commands: <span className="text-text-2">{Array.isArray(item.supportedCommands) ? item.supportedCommands.join(", ") : "-"}</span>
              </p>
            </div>
          ))}

          {!interpreterState.loading && interpreterState.interpreters.length === 0 ? (
            <div className="rounded-md border border-border bg-surface-2 p-3 text-sm text-text-3">
              No interpreter presets detected.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

