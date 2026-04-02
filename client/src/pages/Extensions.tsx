// @ts-nocheck
import { useEffect, useState } from "react";
import { DownloadCloud, PackageCheck, TerminalSquare } from "lucide-react";
import { caddy as caddyApi, processes as processApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import Select from "../components/ui/Select";
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
  const [nodeRuntimeState, setNodeRuntimeState] = useState({
    loading: true,
    data: null
  });
  const [nodeInstallVersion, setNodeInstallVersion] = useState("");
  const [nodeInstallManager, setNodeInstallManager] = useState("");
  const [nodeInstalling, setNodeInstalling] = useState(false);
  const [installingInterpreterKey, setInstallingInterpreterKey] = useState("");
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
    loadNodeRuntime();
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

  const loadNodeRuntime = async () => {
    try {
      setNodeRuntimeState((prev) => ({ ...prev, loading: true }));
      const result = await processApi.nodeRuntimeStatus();
      if (!result.success) {
        throw new Error(result.error || "Unable to load Node runtime status");
      }
      setNodeRuntimeState({
        loading: false,
        data: result.data || null
      });
    } catch (error) {
      setNodeRuntimeState((prev) => ({ ...prev, loading: false }));
      toast.error(getErrorMessage(error, "Unable to load Node runtime status"));
    }
  };

  const installNodeVersion = async () => {
    const version = String(nodeInstallVersion || "").trim();
    if (!version) {
      toast.error("Node version is required");
      return;
    }
    try {
      setNodeInstalling(true);
      const result = await processApi.installNodeRuntime(version, nodeInstallManager);
      if (!result.success) {
        throw new Error(result.error || "Node install failed");
      }
      const installedVersion = result.data?.installed?.version || version;
      toast.success(`Node ${installedVersion} installed (${result.data?.installed?.manager || "runtime manager"})`);
      await loadNodeRuntime();
      await loadInterpreters();
    } catch (error) {
      toast.error(getErrorMessage(error, "Node install failed"));
    } finally {
      setNodeInstalling(false);
    }
  };

  const installInterpreter = async (key) => {
    const normalized = String(key || "").trim();
    if (!normalized) {
      return;
    }
    try {
      setInstallingInterpreterKey(normalized);
      const result = await processApi.installInterpreter(normalized);
      if (!result.success) {
        throw new Error(result.error || `Failed to install ${normalized}`);
      }
      toast.success(`${normalized} installed via ${result.data?.installResult?.manager || "package manager"}`);
      await loadInterpreters();
    } catch (error) {
      toast.error(getErrorMessage(error, `Failed to install ${normalized}`));
    } finally {
      setInstallingInterpreterKey("");
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
          <InsetPanel padding="sm">
            <PackageCheck className="text-brand-400" size={22} />
          </InsetPanel>
          <div className="min-w-0 flex-1">
            <h3 className="panel-heading">Caddy</h3>
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
          <InsetPanel className="mt-3 text-xs text-text-3">
            <p className="mb-1 text-text-2">Detected install command(s)</p>
            {status.installCommands.map((command) => (
              <pre key={command} className="overflow-x-auto whitespace-pre-wrap text-xs text-text-3">
                {command}
              </pre>
            ))}
          </InsetPanel>
        )}
      </section>

      <section className="page-panel">
        <PanelHeader title="Runtime Interpreters" className="mb-3" />

        <div className="mb-3 flex items-center gap-3">
          <InsetPanel padding="sm">
            <TerminalSquare className="text-brand-400" size={22} />
          </InsetPanel>
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
            <InsetPanel key={item.key}>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-semibold text-text-1">{item.displayName}</h4>
                <Badge tone={item.installed ? "success" : "warning"}>{item.installed ? "Installed" : "Not found"}</Badge>
                {item.clusterCapable ? <Badge tone="info">Cluster capable</Badge> : null}
                <span className="text-xs text-text-3">
                  PM2 interpreter: <span className="text-text-2">{item.interpreter || "-"}</span>
                </span>
                {!item.installed && item.installer?.supported && (
                  <div className="ml-auto">
                    <Button
                      type="button"
                      variant="outlineInfo"
                      size="sm"
                      disabled={Boolean(installingInterpreterKey) || !item.installer?.canInstall}
                      onClick={() => installInterpreter(item.key)}
                    >
                      {installingInterpreterKey === item.key ? "Installing..." : "Install"}
                    </Button>
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-text-3">Version: <span className="text-text-2">{item.version || "-"}</span></p>
              <p className="mt-1 text-xs text-text-3">
                Checked commands: <span className="text-text-2">{Array.isArray(item.supportedCommands) ? item.supportedCommands.join(", ") : "-"}</span>
              </p>
              {!item.installed && item.installer?.supported && (
                <div className="mt-1 text-xs text-text-3">
                  <p>
                    Install status:{" "}
                    <span className={item.installer?.canInstall ? "text-success-300" : "text-warning-300"}>
                      {item.installer?.canInstall ? "Ready" : "Blocked"}
                    </span>
                  </p>
                  {item.installer?.reason && (
                    <p className="text-warning-300">{item.installer.reason}</p>
                  )}
                  {Array.isArray(item.installer?.availableManagers) && item.installer.availableManagers.length > 0 && (
                    <p>
                      Managers: <span className="text-text-2">{item.installer.availableManagers.join(", ")}</span>
                    </p>
                  )}
                </div>
              )}
            </InsetPanel>
          ))}

          {!interpreterState.loading && interpreterState.interpreters.length === 0 ? (
            <InsetPanel className="text-sm text-text-3">
              No interpreter presets detected.
            </InsetPanel>
          ) : null}
        </div>

        <InsetPanel className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-text-1">Node Runtime Manager</p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={nodeRuntimeState.loading}
              onClick={loadNodeRuntime}
            >
              {nodeRuntimeState.loading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr,180px,auto]">
            <Input
              value={nodeInstallVersion}
              onChange={(event) => setNodeInstallVersion(event.target.value)}
              placeholder="Install Node version (e.g. 20, 20.12.2)"
            />
            <Select value={nodeInstallManager} onChange={(event) => setNodeInstallManager(event.target.value)}>
              <option value="">Auto manager</option>
              {Array.isArray(nodeRuntimeState.data?.managers) && nodeRuntimeState.data.managers.map((manager) => (
                <option key={manager.manager} value={manager.manager}>
                  {manager.displayName}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              variant="outlineInfo"
              disabled={nodeInstalling || !String(nodeInstallVersion || "").trim()}
              onClick={installNodeVersion}
            >
              {nodeInstalling ? "Installing..." : "Install Node"}
            </Button>
          </div>

          <div className="mt-3 space-y-2">
            <p className="text-xs text-text-3">
              Platform: <span className="text-text-2">{nodeRuntimeState.data?.platform || "-"}</span>{" "}
              | System Node: <span className="text-text-2">{nodeRuntimeState.data?.systemNode?.version || "-"}</span>
            </p>
            {Array.isArray(nodeRuntimeState.data?.managers) && nodeRuntimeState.data.managers.map((manager) => (
              <div key={manager.manager} className="rounded border border-border bg-surface p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-xs font-semibold text-text-2">{manager.displayName}</p>
                  <Badge tone={manager.installed ? "success" : "warning"}>
                    {manager.installed ? "Installed" : "Missing"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-text-3">
                  Installed versions:{" "}
                  <span className="text-text-2">
                    {Array.isArray(manager.versions) && manager.versions.length > 0
                      ? manager.versions.join(", ")
                      : "-"}
                  </span>
                </p>
                {!manager.installed && Array.isArray(manager.installCommands) && manager.installCommands.length > 0 && (
                  <div className="mt-1 text-xs text-text-3">
                    {manager.installCommands.map((command) => (
                      <pre key={command} className="overflow-x-auto whitespace-pre-wrap text-xs text-text-3">
                        {command}
                      </pre>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </InsetPanel>
      </section>
    </div>
  );
}

