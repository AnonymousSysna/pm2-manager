import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Clipboard, Code2, ExternalLink, Play, Power, RefreshCw, ShieldCheck, Smartphone, StopCircle, TerminalSquare } from "lucide-react";
import { jcode as jcodeApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import Select from "../components/ui/Select";
import StatusText from "../components/ui/StatusText";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import { Skeleton } from "../components/ui/Skeleton";
import { Eyebrow, SubsectionTitle, SupportingCopy } from "../components/ui/Typography";

const providerCommandByType = {
  openai: "jcode login --provider openai",
  claude: "jcode login --provider claude",
  gemini: "jcode login --provider gemini",
  copilot: "jcode login --provider copilot",
  "openai-compatible": "jcode login --provider openai-compatible",
  ollama: "jcode login --provider ollama",
  lmstudio: "jcode login --provider lmstudio"
};

function defaultGatewayUrl() {
  if (typeof window === "undefined") {
    return "http://localhost:7643";
  }
  return `${window.location.protocol}//${window.location.hostname}:7643`;
}

function socketBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }
  return import.meta.env.VITE_API_URL || window.location.origin;
}

function cleanTerminalChunk(value) {
  return String(value || "")
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B[()][A-Za-z0-9]/g, "")
    .replace(/\x00/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

async function copyToClipboard(value, label = "Command") {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch (_error) {
    toast.error("Copy failed");
  }
}

export default function JCode() {
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [status, setStatus] = useState(null);
  const [gatewayUrl, setGatewayUrl] = useState(defaultGatewayUrl);
  const [gatewayPort, setGatewayPort] = useState("7643");
  const [jcodeProvider, setJcodeProvider] = useState("openai-compatible");
  const [jcodeProviderUrl, setJcodeProviderUrl] = useState("");
  const [jcodeModel, setJcodeModel] = useState("");
  const [jcodeEnvName, setJcodeEnvName] = useState("JCODE_API_KEY");
  const [lastOutput, setLastOutput] = useState("");
  const [terminalState, setTerminalState] = useState("idle");
  const [terminalMeta, setTerminalMeta] = useState(null);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalInput, setTerminalInput] = useState("");
  const socketRef = useRef(null);
  const terminalRef = useRef(null);

  const installed = Boolean(status?.installed);
  const gatewayRunning = Boolean(status?.gateway?.running);
  const terminalRunning = terminalState === "running";
  const terminalConnecting = terminalState === "connecting";

  const jcodeProfileCommand = useMemo(() => {
    if (jcodeProvider !== "openai-compatible") {
      const baseCommand = providerCommandByType[jcodeProvider] || "jcode login";
      return jcodeModel.trim() ? `${baseCommand} && jcode --model ${jcodeModel.trim()} run "say hello"` : baseCommand;
    }

    const baseUrl = jcodeProviderUrl.trim() || "https://your-provider.example/v1";
    const model = jcodeModel.trim() || "your-model-id";
    const envName = jcodeEnvName.trim() || "JCODE_API_KEY";
    const continued = "\\";

    return [
      `export ${envName}="paste-key-here"`,
      `jcode provider add pm2-web ${continued}`,
      `  --base-url ${baseUrl} ${continued}`,
      `  --model ${model} ${continued}`,
      `  --api-key-env ${envName} ${continued}`,
      "  --set-default",
      "jcode --provider-profile pm2-web auth-test"
    ].join("\n");
  }, [jcodeEnvName, jcodeModel, jcodeProvider, jcodeProviderUrl]);

  const appendTerminalOutput = (chunk) => {
    const cleaned = cleanTerminalChunk(chunk);
    if (!cleaned) {
      return;
    }
    setTerminalOutput((prev) => `${prev}${cleaned}`.slice(-120000));
  };

  const loadStatus = async () => {
    try {
      setLoading(true);
      const result = await jcodeApi.status();
      if (!result.success) {
        throw new Error(result.error || "Unable to load JCode status");
      }
      const nextStatus = result.data || null;
      setStatus(nextStatus);
      setLastOutput(nextStatus?.lastOutput || "");
      if (nextStatus?.gateway?.url) {
        setGatewayUrl(nextStatus.gateway.url);
      }
      if (nextStatus?.gateway?.port) {
        setGatewayPort(String(nextStatus.gateway.port));
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to load JCode status"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalOutput]);

  useEffect(() => () => {
    if (socketRef.current) {
      socketRef.current.emit("jcode:terminal:stop");
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  const installJcode = async () => {
    if (!window.confirm("Install JCode on this server now?")) {
      return;
    }
    try {
      setInstalling(true);
      const result = await jcodeApi.install();
      if (!result.success) {
        throw new Error(result.error || "JCode install failed");
      }
      const nextStatus = result.data?.status || null;
      setStatus(nextStatus);
      setLastOutput(result.data?.output || nextStatus?.lastOutput || "");
      toast.success(result.data?.alreadyInstalled ? "JCode is already installed" : "JCode installed");
    } catch (error) {
      toast.error(getErrorMessage(error, "JCode install failed"));
    } finally {
      setInstalling(false);
      await loadStatus();
    }
  };

  const startTerminalSession = () => {
    if (!installed) {
      toast.error("Install JCode first");
      return;
    }
    if (socketRef.current) {
      socketRef.current.emit("jcode:terminal:start", { rows: 30, cols: 110, mode: "connect" });
      return;
    }

    setTerminalOutput("");
    setTerminalMeta(null);
    setTerminalState("connecting");
    const socket = io(socketBaseUrl(), {
      transports: ["websocket", "polling"],
      withCredentials: true
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setTerminalState("connecting");
      socket.emit("jcode:terminal:start", { rows: 30, cols: 110, mode: "connect" });
    });

    socket.on("connect_error", (error) => {
      setTerminalState("error");
      appendTerminalOutput(`\nConnection error: ${error?.message || "socket failed"}\n`);
    });

    socket.on("disconnect", (reason) => {
      if (socketRef.current === socket) {
        socketRef.current = null;
        setTerminalState("idle");
        setTerminalMeta(null);
        if (reason && reason !== "io client disconnect") {
          appendTerminalOutput(`\nSocket disconnected: ${reason}\n`);
        }
      }
    });

    socket.on("jcode:terminal:status", (payload) => {
      setTerminalMeta(payload || null);
      setTerminalState(payload?.running ? "running" : "idle");
    });

    socket.on("jcode:terminal:output", (payload) => {
      appendTerminalOutput(payload?.data || "");
    });

    socket.on("jcode:terminal:error", (payload) => {
      const message = payload?.error || "JCode terminal error";
      setTerminalState("error");
      appendTerminalOutput(`\n${message}\n`);
      toast.error(message);
    });

    socket.on("jcode:terminal:exit", (payload) => {
      const code = payload?.code ?? "";
      const signal = payload?.signal ? ` signal=${payload.signal}` : "";
      appendTerminalOutput(`\nJCode session ended${code !== "" && code !== null ? ` code=${code}` : ""}${signal}.\n`);
      setTerminalState("idle");
      setTerminalMeta(null);
      socket.disconnect();
      socketRef.current = null;
    });
  };

  const stopTerminalSession = () => {
    if (!socketRef.current) {
      setTerminalState("idle");
      setTerminalMeta(null);
      return;
    }
    socketRef.current.emit("jcode:terminal:stop");
    socketRef.current.disconnect();
    socketRef.current = null;
    setTerminalState("idle");
    setTerminalMeta(null);
  };

  const sendTerminalRaw = (data) => {
    if (!socketRef.current || !terminalRunning) {
      return;
    }
    socketRef.current.emit("jcode:terminal:input", { data });
  };

  const sendTerminalInput = (event?: FormEvent) => {
    event?.preventDefault();
    if (!terminalInput.trim()) {
      return;
    }
    sendTerminalRaw(`${terminalInput}\n`);
    setTerminalInput("");
  };

  const startGateway = async () => {
    try {
      setGatewayBusy(true);
      const result = await jcodeApi.startGateway({ port: Number(gatewayPort) || 7643 });
      if (!result.success) {
        throw new Error(result.error || "Unable to start JCode gateway");
      }
      const nextStatus = result.data?.status || null;
      setStatus(nextStatus);
      setLastOutput(nextStatus?.lastOutput || "");
      toast.success(result.data?.alreadyRunning ? "JCode gateway is already running" : "JCode gateway started");
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to start JCode gateway"));
    } finally {
      setGatewayBusy(false);
      await loadStatus();
    }
  };

  const stopGateway = async () => {
    try {
      setGatewayBusy(true);
      const result = await jcodeApi.stopGateway();
      if (!result.success) {
        throw new Error(result.error || "Unable to stop JCode gateway");
      }
      const nextStatus = result.data?.status || null;
      setStatus(nextStatus);
      setLastOutput(nextStatus?.lastOutput || "");
      toast.success(result.data?.stopped ? "JCode gateway stopped" : "JCode gateway was not running");
    } catch (error) {
      toast.error(getErrorMessage(error, "Unable to stop JCode gateway"));
    } finally {
      setGatewayBusy(false);
      await loadStatus();
    }
  };

  const runAction = async (action, label) => {
    try {
      setActionBusy(action);
      const result = await jcodeApi.runAction(action);
      if (!result.success) {
        throw new Error(result.error || `${label} failed`);
      }
      const output = result.data?.output || "";
      setLastOutput(output);
      setStatus(result.data?.status || status);
      toast.success(`${label} finished`);
    } catch (error) {
      toast.error(getErrorMessage(error, `${label} failed`));
    } finally {
      setActionBusy("");
      await loadStatus();
    }
  };

  return (
    <div className="compact-page-stack">
      <PageIntro
        title="JCode"
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={loadStatus}>
              <RefreshCw size={14} />
              Refresh
            </Button>
            <Button as="a" href="https://jcode.sh/docs" target="_blank" rel="noreferrer" variant="outlineInfo" size="sm">
              Docs
              <ExternalLink size={14} />
            </Button>
          </div>
        )}
      />

      <section className="page-panel p-3">
        <PanelHeader
          title="JCode terminal"
          className="mb-3"
          actions={loading ? <Skeleton className="h-7 w-24" /> : <Badge tone={installed ? "success" : "warning"}>{installed ? status?.version || "Installed" : "Not installed"}</Badge>}
        />

        <div className="jcode-terminal-layout">
          <InsetPanel padding="sm" className="jcode-extension-summary">
            <div className="jcode-icon-badge">
              <Code2 size={22} />
            </div>
            <div className="min-w-0">
              <SubsectionTitle>Start a real JCode session inside the dashboard</SubsectionTitle>
              <SupportingCopy>
                Press Start session to launch the JCode server, then attach the terminal client here. Nothing starts until you press the button.
              </SupportingCopy>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <Badge tone={installed ? "success" : "warning"}>{installed ? status?.version || "Installed" : "Needs install"}</Badge>
                <Badge tone={terminalRunning ? "success" : terminalConnecting ? "warning" : "neutral"}>{terminalRunning ? "Session live" : terminalConnecting ? "Connecting" : "No session"}</Badge>
                {terminalMeta?.pty ? <Badge tone="success">PTY</Badge> : null}
              </div>
            </div>
          </InsetPanel>

          <InsetPanel padding="sm" className="space-y-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="text-success-400" size={18} />
              <SubsectionTitle className="text-sm">Install first, then start a session</SubsectionTitle>
            </div>
            <p className="text-xs leading-5 text-text-3">
              Install runs only after confirmation. Start session starts the JCode server first, then connects the terminal below.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant={installed ? "secondary" : "primary"} size="sm" disabled={loading || installing || installed} onClick={installJcode}>
                <Power size={14} />
                {installed ? "Installed" : installing ? "Installing..." : "Install JCode"}
              </Button>
              <Button type="button" variant="primary" size="sm" disabled={!installed || terminalConnecting || terminalRunning} onClick={startTerminalSession}>
                <Play size={14} />
                {terminalConnecting ? "Connecting..." : "Start session"}
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={!terminalRunning && !terminalConnecting} onClick={stopTerminalSession}>
                <StopCircle size={14} />
                Stop session
              </Button>
            </div>
          </InsetPanel>
        </div>

        <div className="jcode-terminal-shell mt-3">
          <div className="jcode-terminal-toolbar">
            <span>{terminalMeta?.command || "jcode connect"}</span>
            <span>{terminalMeta?.socketPath || (terminalMeta?.pid ? `PID ${terminalMeta.pid}` : terminalState)}</span>
          </div>
          <div ref={terminalRef} className="jcode-terminal-screen" aria-live="polite">
            {terminalOutput ? (
              <pre>{terminalOutput}</pre>
            ) : (
              <div className="jcode-terminal-empty">
                Click Start session to open JCode here.
              </div>
            )}
          </div>
          <form className="jcode-terminal-input-row" onSubmit={sendTerminalInput}>
            <Input
              value={terminalInput}
              onChange={(event) => setTerminalInput(event.target.value)}
              placeholder={terminalRunning ? "Type to JCode and press Enter" : "Start a session first"}
              disabled={!terminalRunning}
            />
            <Button type="submit" variant="primary" size="sm" disabled={!terminalRunning || !terminalInput.trim()}>
              Send
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={!terminalRunning} onClick={() => sendTerminalRaw("\u0003")}>
              Ctrl+C
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={!terminalRunning} onClick={() => sendTerminalRaw("\u0004")}>
              Ctrl+D
            </Button>
          </form>
        </div>
      </section>

      <section className="jcode-control-grid">
        <InsetPanel padding="sm" className="space-y-3">
          <div>
            <SubsectionTitle>Gateway</SubsectionTitle>
            <SupportingCopy size="xs">Start JCode serve, open the gateway, or pair a device.</SupportingCopy>
          </div>

          <div className="grid gap-2 md:grid-cols-[1fr_140px]">
            <label className="jcode-compact-field">
              <span>Gateway URL</span>
              <Input value={gatewayUrl} onChange={(event) => setGatewayUrl(event.target.value)} placeholder="http://server-ip:7643" />
            </label>
            <label className="jcode-compact-field">
              <span>Port</span>
              <Input value={gatewayPort} onChange={(event) => setGatewayPort(event.target.value)} inputMode="numeric" placeholder="7643" />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={!installed || gatewayBusy || gatewayRunning} onClick={startGateway}>
              <Play size={14} />
              {gatewayBusy && !gatewayRunning ? "Starting..." : "Start gateway"}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={!installed || gatewayBusy || !gatewayRunning} onClick={stopGateway}>
              <StopCircle size={14} />
              {gatewayBusy && gatewayRunning ? "Stopping..." : "Stop gateway"}
            </Button>
            {installed ? (
              <Button as="a" href={gatewayUrl || defaultGatewayUrl()} target="_blank" rel="noreferrer" variant="secondary" size="sm">
                Open gateway
                <ExternalLink size={14} />
              </Button>
            ) : (
              <Button type="button" variant="secondary" size="sm" disabled>
                Open gateway
                <ExternalLink size={14} />
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" onClick={() => copyToClipboard(gatewayUrl || defaultGatewayUrl(), "Gateway URL")}>
              <Clipboard size={14} />
              Copy URL
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={!installed || actionBusy === "pair-device"} onClick={() => runAction("pair-device", "Pair device")}>
              <Smartphone size={14} />
              {actionBusy === "pair-device" ? "Pairing..." : "Pair device"}
            </Button>
          </div>
        </InsetPanel>

        <InsetPanel padding="sm" className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <SubsectionTitle>Provider access</SubsectionTitle>
              <SupportingCopy size="xs">Build the JCode login/provider command without saving secrets in PM2 Manager.</SupportingCopy>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => copyToClipboard(jcodeProfileCommand, "JCode login command")}>
              <Clipboard size={14} />
              Copy login
            </Button>
          </div>

          <div className="jcode-provider-grid">
            <label className="jcode-compact-field">
              <span>Provider</span>
              <Select value={jcodeProvider} onChange={(event) => setJcodeProvider(event.target.value)}>
                <option value="openai-compatible">OpenAI compatible</option>
                <option value="openai">OpenAI / ChatGPT</option>
                <option value="claude">Anthropic Claude</option>
                <option value="gemini">Google Gemini</option>
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
              <Input value={jcodeModel} onChange={(event) => setJcodeModel(event.target.value)} placeholder="model id" />
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
      </section>

      <section className="page-panel p-3">
        <PanelHeader
          title="Checks"
          className="mb-3"
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={!installed || actionBusy === "auth-test"} onClick={() => runAction("auth-test", "Auth test")}>
                <TerminalSquare size={14} />
                {actionBusy === "auth-test" ? "Checking..." : "Auth test"}
              </Button>
              <Button type="button" variant="secondary" size="sm" disabled={!installed || actionBusy === "smoke-test"} onClick={() => runAction("smoke-test", "Smoke test")}>
                <TerminalSquare size={14} />
                {actionBusy === "smoke-test" ? "Running..." : "Smoke test"}
              </Button>
            </div>
          )}
        />
        <div className="grid gap-2 md:grid-cols-4">
          <InsetPanel padding="sm">
            <Eyebrow>Status</Eyebrow>
            <p className="mt-1 text-sm text-text-2">
              <StatusText tone={installed ? "success" : "warning"}>{installed ? "Ready" : "Install needed"}</StatusText>
            </p>
          </InsetPanel>
          <InsetPanel padding="sm">
            <Eyebrow>Binary</Eyebrow>
            <p className="mt-1 truncate text-sm text-text-2">{status?.binaryPath || "-"}</p>
          </InsetPanel>
          <InsetPanel padding="sm">
            <Eyebrow>Runtime socket</Eyebrow>
            <p className="mt-1 truncate text-sm text-text-2" title={status?.runtime?.socketPath || ""}>
              {status?.runtime?.socketPath || "-"}
            </p>
          </InsetPanel>
          <InsetPanel padding="sm">
            <Eyebrow>Gateway PID</Eyebrow>
            <p className="mt-1 text-sm text-text-2">{status?.gateway?.pid || "-"}</p>
          </InsetPanel>
        </div>
        {lastOutput ? <pre className="jcode-command-preview mt-3">{lastOutput}</pre> : null}
      </section>
    </div>
  );
}
