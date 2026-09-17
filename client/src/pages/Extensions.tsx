import { useEffect, useMemo, useState } from "react";
import { Clipboard, Code2, DownloadCloud, ExternalLink, PackageCheck, ShieldCheck, TerminalSquare } from "lucide-react";
import { caddy as caddyApi, processes as processApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Button from "../components/ui/Button";
import Badge from "../components/ui/Badge";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import Select from "../components/ui/Select";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import { Skeleton } from "../components/ui/Skeleton";
import StatusText from "../components/ui/StatusText";
import { InsetCard } from "../components/ui/Surface";
import { Eyebrow, SubsectionTitle, SupportingCopy } from "../components/ui/Typography";

const jcodeInstallCommands = [
  {
    label: "Linux / macOS",
    command: "curl -fsSL https://jcode.sh/install | bash"
  },
  {
    label: "Windows PowerShell",
    command: "irm https://jcode.sh/install.ps1 | iex"
  },
  {
    label: "Build from source",
    command: "git clone https://github.com/1jehuang/jcode.git && cd jcode && cargo build --release"
  }
];

const jcodeLoginCommands = [
  {
    label: "OpenAI / ChatGPT",
    command: "jcode login --provider openai"
  },
  {
    label: "Claude subscription",
    command: "jcode login --provider claude"
  },
  {
    label: "OpenAI-compatible API",
    command: "jcode login --provider openai-compatible"
  },
  {
    label: "Remote server mode",
    command: "jcode serve"
  }
];

const providerCommandByType = {
  openai: "jcode login --provider openai",
  claude: "jcode login --provider claude",
  "openai-compatible": "",
  ollama: "jcode login --provider ollama",
  lmstudio: "jcode login --provider lmstudio",
  copilot: "jcode login --provider copilot"
};

async function copyToClipboard(value, label = "Command") {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch (_error) {
    toast.error("Copy failed");
  }
}

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
  const [jcodeProvider, setJcodeProvider] = useState("openai-compatible");
  const [jcodeProviderUrl, setJcodeProviderUrl] = useState("");
  const [jcodeModel, setJcodeModel] = useState("");
  const [jcodeEnvName, setJcodeEnvName] = useState("JCODE_API_KEY");
  const [jcodeGatewayUrl, setJcodeGatewayUrl] = useState(() => {
    if (typeof window === "undefined") {
      return "http://localhost:7643";
    }
    return `${window.location.protocol}//${window.location.hostname}:7643`;
  });
  const [status, setStatus] = useState({
    platform: "unknown",
    installed: false,
    available: false,
    version: null,
    installCommands: []
  });

  const jcodeProfileCommand = useMemo(() => {
    if (jcodeProvider !== "openai-compatible") {
      const baseCommand = providerCommandByType[jcodeProvider] || "jcode login";
      return jcodeModel.trim() ? `${baseCommand} && jcode --model ${jcodeModel.trim()} run 'hello'` : baseCommand;
    }

    const baseUrl = jcodeProviderUrl.trim() || "https://your-provider.example/v1";
    const model = jcodeModel.trim() || "your-model-id";
    const envName = jcodeEnvName.trim() || "JCODE_API_KEY";
    const continued = "\\";

    return [
      `export ${envName}=\"paste-key-here\"`,
      `jcode provider add pm2-web ${continued}`,
      `  --base-url ${baseUrl} ${continued}`,
      `  --model ${model} ${continued}`,
      `  --api-key-env ${envName} ${continued}`,
      "  --set-default",
      "jcode --provider-profile pm2-web auth-test"
    ].join("\n");
  }, [jcodeEnvName, jcodeModel, jcodeProvider, jcodeProviderUrl]);

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
    <div className="compact-page-stack">
      <PageIntro title="Extensions" />

      <section id="jcode" className="page-panel p-3">
        <PanelHeader
          title="JCode"
          className="mb-3"
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="success">External agent</Badge>
              <Button as="a" href="https://jcode.sh/docs" target="_blank" rel="noreferrer" variant="outlineInfo" size="sm">
                Docs
                <ExternalLink size={14} />
              </Button>
            </div>
          )}
        />

        <div className="jcode-extension-grid">
          <InsetPanel padding="sm" className="jcode-extension-summary">
            <div className="jcode-icon-badge">
              <Code2 size={22} />
            </div>
            <div className="min-w-0">
              <SubsectionTitle>Use JCode instead of the old assistant tab</SubsectionTitle>
              <SupportingCopy>
                PM2 Manager keeps operations in this dashboard. JCode handles the coding-agent work, provider login, API keys, and agent sessions outside the dashboard shell.
              </SupportingCopy>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Badge tone="info">OpenAI compatible</Badge>
                <Badge tone="info">Claude</Badge>
                <Badge tone="info">OpenAI</Badge>
                <Badge tone="info">Local models</Badge>
              </div>
            </div>
          </InsetPanel>

          <InsetPanel padding="sm" className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="text-success-400" size={18} />
              <SubsectionTitle className="text-sm">Safe split</SubsectionTitle>
            </div>
            <p className="text-xs leading-5 text-text-3">
              This dashboard no longer stores provider keys or sends chat to an internal chat route. Configure JCode with OAuth, an API key env var, or its own provider profile.
            </p>
          </InsetPanel>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-2">
          <InsetPanel padding="sm" className="space-y-2">
            <SubsectionTitle className="text-sm">Install / launch</SubsectionTitle>
            <div className="grid gap-2">
              {jcodeInstallCommands.map((item) => (
                <CommandRow key={item.label} label={item.label} command={item.command} />
              ))}
            </div>
          </InsetPanel>

          <InsetPanel padding="sm" className="space-y-2">
            <SubsectionTitle className="text-sm">Provider login</SubsectionTitle>
            <div className="grid gap-2">
              {jcodeLoginCommands.map((item) => (
                <CommandRow key={item.label} label={item.label} command={item.command} />
              ))}
            </div>
          </InsetPanel>
        </div>

        <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <InsetPanel padding="sm" className="space-y-3">
            <div>
              <SubsectionTitle className="text-sm">Web gateway</SubsectionTitle>
              <SupportingCopy size="xs">After running `jcode serve`, open the gateway from here.</SupportingCopy>
            </div>
            <label className="jcode-compact-field">
              <span>Gateway URL</span>
              <Input
                value={jcodeGatewayUrl}
                onChange={(event) => setJcodeGatewayUrl(event.target.value)}
                placeholder="http://server-ip:7643"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button as="a" href={jcodeGatewayUrl || "http://localhost:7643"} target="_blank" rel="noreferrer" variant="primary" size="sm">
                Open gateway
                <ExternalLink size={14} />
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => copyToClipboard(jcodeGatewayUrl, "Gateway URL")}>
                <Clipboard size={14} />
                Copy URL
              </Button>
            </div>
          </InsetPanel>

          <InsetPanel padding="sm" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <SubsectionTitle className="text-sm">Provider command builder</SubsectionTitle>
                <SupportingCopy size="xs">Build a JCode command without saving secrets in PM2 Manager.</SupportingCopy>
              </div>
              <Button type="button" variant="secondary" size="sm" onClick={() => copyToClipboard(jcodeProfileCommand, "JCode setup command")}>
                <Clipboard size={14} />
                Copy setup
              </Button>
            </div>

            <div className="jcode-provider-grid">
            <label className="jcode-compact-field">
              <span>Provider</span>
              <Select value={jcodeProvider} onChange={(event) => setJcodeProvider(event.target.value)}>
                <option value="openai-compatible">OpenAI compatible</option>
                <option value="openai">OpenAI / ChatGPT</option>
                <option value="claude">Anthropic Claude</option>
                <option value="copilot">GitHub Copilot</option>
                <option value="ollama">Ollama</option>
                <option value="lmstudio">LM Studio</option>
              </Select>
            </label>
            <label className="jcode-compact-field">
              <span>Provider URL</span>
              <Input
                value={jcodeProviderUrl}
                onChange={(event) => setJcodeProviderUrl(event.target.value)}
                placeholder="https://provider.example/v1"
                disabled={jcodeProvider !== "openai-compatible"}
              />
            </label>
            <label className="jcode-compact-field">
              <span>Model</span>
              <Input
                value={jcodeModel}
                onChange={(event) => setJcodeModel(event.target.value)}
                placeholder="model id"
              />
            </label>
            <label className="jcode-compact-field">
              <span>API key env</span>
              <Input
                value={jcodeEnvName}
                onChange={(event) => setJcodeEnvName(event.target.value)}
                placeholder="JCODE_API_KEY"
                disabled={jcodeProvider !== "openai-compatible"}
              />
            </label>
          </div>

            <pre className="jcode-command-preview">{jcodeProfileCommand}</pre>
          </InsetPanel>
        </div>
      </section>

      <section className="extension-status-card">
        <PanelHeader title="Available Extensions" className="mb-3" />
        <div className="flex flex-wrap items-center gap-2">
          <InsetPanel padding="sm">
            <PackageCheck className="text-brand-400" size={22} />
          </InsetPanel>
          {loading ? (
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-44" />
            </div>
          ) : (
            <div className="min-w-0 flex-1">
              <SubsectionTitle>Caddy</SubsectionTitle>
              <SupportingCopy>
                Platform: <span className="text-text-2">{status.platform || "unknown"}</span>
              </SupportingCopy>
              <SupportingCopy>
                Status:{" "}
                <StatusText tone={status.installed ? "success" : "warning"}>
                  {status.installed ? `Installed${status.version ? ` (${status.version})` : ""}` : "Not installed"}
                </StatusText>
              </SupportingCopy>
            </div>
          )}
          {loading ? (
            <Skeleton className="h-10 w-36" />
          ) : (
            <Button
              type="button"
              variant={status.installed ? "secondary" : "outlineInfo"}
              disabled={loading || installing || status.installed}
              onClick={installCaddy}
            >
              <DownloadCloud size={16} />
              {status.installed ? "Installed" : installing ? "Installing..." : "Install Caddy"}
            </Button>
          )}
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

      <section className="page-panel p-3">
        <PanelHeader title="Runtime Interpreters" className="mb-3" />

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <InsetPanel padding="sm">
            <TerminalSquare className="text-brand-400" size={22} />
          </InsetPanel>
          <div className="text-sm text-text-2">
            Installed: {interpreterState.totals.installed} / Supported presets: {interpreterState.totals.supported}
          </div>
          <div className="ml-auto">
            <Button type="button" variant="outlineInfo" disabled={interpreterState.loading} onClick={loadInterpreters}>
              {interpreterState.loading ? "Detecting..." : "Rescan"}
            </Button>
          </div>
        </div>

        <div className="grid gap-2 xl:grid-cols-2">
          {interpreterState.loading && interpreterState.interpreters.length === 0 && (
            <InterpreterListSkeleton />
          )}
          {interpreterState.interpreters.map((item) => (
            <InsetPanel key={item.key} padding="sm" className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <SubsectionTitle className="text-sm">{item.displayName}</SubsectionTitle>
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
              <p className="extension-muted-line">Version: <span className="text-text-2">{item.version || "-"}</span> · Interpreter: <span className="text-text-2">{item.interpreter || "-"}</span></p>
              {!item.installed && item.installer?.supported && (
                <div className="mt-1 text-xs text-text-3">
                  <p>
                    Install status:{" "}
                    <StatusText as="span" tone={item.installer?.canInstall ? "success" : "warning"}>
                      {item.installer?.canInstall ? "Ready" : "Blocked"}
                    </StatusText>
                  </p>
                  {item.installer?.reason && (
                    <StatusText as="p" tone="warning">{item.installer.reason}</StatusText>
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
              No presets.
            </InsetPanel>
          ) : null}
        </div>

        <InsetPanel className="mt-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <SubsectionTitle className="text-sm">Node Runtime Manager</SubsectionTitle>
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

          <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
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

          <div className="mt-3 grid gap-2 xl:grid-cols-2">
            {nodeRuntimeState.loading ? (
              <NodeRuntimeSkeleton />
            ) : (
              <>
                <p className="text-xs text-text-3">
                  Platform: <span className="text-text-2">{nodeRuntimeState.data?.platform || "-"}</span>{" "}
                  | System Node: <span className="text-text-2">{nodeRuntimeState.data?.systemNode?.version || "-"}</span>
                </p>
                {Array.isArray(nodeRuntimeState.data?.managers) && nodeRuntimeState.data.managers.map((manager) => (
                  <InsetCard key={manager.manager} padding="sm" tone="surface">
                    <div className="flex flex-wrap items-center gap-2">
                      <Eyebrow>{manager.displayName}</Eyebrow>
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
                  </InsetCard>
                ))}
              </>
            )}
          </div>
        </InsetPanel>
      </section>
    </div>
  );
}

function CommandRow({ label, command }) {
  return (
    <div className="jcode-command-row">
      <div className="min-w-0">
        <p className="text-xs font-semibold text-text-2">{label}</p>
        <code className="command-chip block">{command}</code>
      </div>
      <Button type="button" variant="ghost" size="sm-icon" aria-label={`Copy ${label}`} onClick={() => copyToClipboard(command, label)}>
        <Clipboard size={14} />
      </Button>
    </div>
  );
}

function InterpreterListSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, index) => (
        <InsetPanel key={index}>
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
            <Skeleton className="h-3 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
        </InsetPanel>
      ))}
    </div>
  );
}

function NodeRuntimeSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <Skeleton className="h-3 w-56" />
      {Array.from({ length: 2 }).map((_, index) => (
        <InsetCard key={index} padding="sm" tone="surface">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-5 w-20" />
          </div>
          <Skeleton className="mt-2 h-3 w-48" />
          <Skeleton className="mt-2 h-10 w-full" />
        </InsetCard>
      ))}
    </div>
  );
}
