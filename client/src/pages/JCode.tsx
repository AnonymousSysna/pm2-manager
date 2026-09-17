import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { ExternalLink, Play, Power, RefreshCw, ShieldCheck, StopCircle } from "lucide-react";
import { jcode as jcodeApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Badge from "../components/ui/Badge";
import Banner from "../components/ui/Banner";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import { Skeleton } from "../components/ui/Skeleton";

function socketBaseUrl() {
  if (typeof window === "undefined") {
    return "";
  }
  return import.meta.env.VITE_API_URL || window.location.origin;
}

const sessionCommandOptions = {
  jcode: "jcode",
  "login-openai-compatible": "jcode login --provider openai-compatible",
  "login-openai": "jcode login --provider openai",
  "login-claude": "jcode login --provider claude",
  "auth-test": "jcode auth-test",
  custom: ""
};

export default function JCode() {
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState(null);
  const [lastOutput, setLastOutput] = useState("");
  const [terminalState, setTerminalState] = useState("idle");
  const [terminalMeta, setTerminalMeta] = useState(null);
  const [terminalInput, setTerminalInput] = useState("");
  const [sessionCommandPreset, setSessionCommandPreset] = useState("jcode");
  const [customSessionCommand, setCustomSessionCommand] = useState("jcode");
  const [sessionCwd, setSessionCwd] = useState("");
  const [terminalFocused, setTerminalFocused] = useState(false);
  const socketRef = useRef(null);
  const terminalHostRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const terminalInputDisposableRef = useRef(null);

  const installed = Boolean(status?.installed);
  const terminalRunning = terminalState === "running";
  const terminalConnecting = terminalState === "connecting";
  const operator = status?.operator || terminalMeta?.operator || null;
  const customTerminalAllowed = Boolean(operator?.customCommandsAllowed);
  const terminalCommand = useMemo(() => {
    if (sessionCommandPreset === "custom") {
      return customSessionCommand.trim() || "bash";
    }
    return sessionCommandOptions[sessionCommandPreset] || "jcode";
  }, [customSessionCommand, sessionCommandPreset]);

  const writeTerminalOutput = (chunk) => {
    const text = String(chunk || "");
    if (!text) {
      return;
    }
    // The server bridge normalizes line endings and forwards raw PTY bytes, so
    // writing verbatim keeps ANSI escapes and cursor moves intact.
    terminalRef.current?.write(text);
  };

  const fitTerminal = () => {
    try {
      fitAddonRef.current?.fit();
    } catch (_error) {
      // The terminal may not be visible yet.
    }
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
      setSessionCwd((current) => current || nextStatus?.operator?.cwd || "");
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
    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "'Cascadia Code', 'Fira Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.25,
      scrollback: 6000,
      theme: {
        background: "#05070a",
        foreground: "#d1fae5",
        cursor: "#86efac",
        selectionBackground: "#2563eb66"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    if (terminalHostRef.current) {
      terminal.open(terminalHostRef.current);
      fitTerminal();
    }

    const onResize = () => {
      fitTerminal();
      if (socketRef.current && terminalRef.current) {
        socketRef.current.emit("jcode:terminal:resize", {
          rows: terminalRef.current.rows,
          cols: terminalRef.current.cols
        });
      }
    };

    // The panel is resizable (and collapses on small screens), so a ResizeObserver
    // keeps the PTY dimensions in sync with what xterm actually renders.
    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(() => onResize())
      : null;
    if (resizeObserver && terminalHostRef.current) {
      resizeObserver.observe(terminalHostRef.current);
    }
    window.addEventListener("resize", onResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
      terminalInputDisposableRef.current?.dispose?.();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

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

  const estimateTerminalSize = () => {
    fitTerminal();
    if (terminalRef.current?.rows && terminalRef.current?.cols) {
      return { rows: terminalRef.current.rows, cols: terminalRef.current.cols };
    }
    const element = terminalHostRef.current;
    const cols = Math.max(60, Math.min(180, Math.floor((element?.clientWidth || 935) / 8.5)));
    const rows = Math.max(16, Math.min(60, Math.floor((element?.clientHeight || 520) / 18)));
    return { rows, cols };
  };

  const focusTerminal = () => {
    window.requestAnimationFrame(() => {
      terminalRef.current?.focus();
    });
  };

  const startTerminalSession = () => {
    if (!installed) {
      toast.error("Install JCode first");
      return;
    }
    if (sessionCommandPreset === "custom" && !customTerminalAllowed) {
      toast.error("Custom commands need PM2 Manager running as root or JCODE_ALLOW_CUSTOM_TERMINAL=1");
      return;
    }
    if (socketRef.current) {
      focusTerminal();
      return;
    }

    const terminalSize = estimateTerminalSize();
    terminalRef.current?.reset();
    setTerminalMeta(null);
    setTerminalState("connecting");
    const socket = io(socketBaseUrl(), {
      transports: ["websocket", "polling"],
      withCredentials: true
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setTerminalState("connecting");
      socket.emit("jcode:terminal:start", {
        ...terminalSize,
        mode: "command",
        command: terminalCommand,
        cwd: sessionCwd.trim() || undefined
      });
      focusTerminal();
    });

    socket.on("connect_error", (error) => {
      setTerminalState("error");
      writeTerminalOutput(`\r\nConnection error: ${error?.message || "socket failed"}\r\n`);
    });

    socket.on("disconnect", (reason) => {
      if (socketRef.current === socket) {
        socketRef.current = null;
        setTerminalState("idle");
        setTerminalMeta(null);
        if (reason && reason !== "io client disconnect") {
          writeTerminalOutput(`\r\nSocket disconnected: ${reason}\r\n`);
        }
      }
    });

    socket.on("jcode:terminal:status", (payload) => {
      setTerminalMeta(payload || null);
      setTerminalState(payload?.running ? "running" : "idle");
      if (payload?.running) {
        // Fit and report the real geometry once the PTY is live, so jcode lays the
        // TUI out for the exact panel size the user is looking at.
        window.requestAnimationFrame(() => {
          fitTerminal();
          if (terminalRef.current) {
            socket.emit("jcode:terminal:resize", {
              rows: terminalRef.current.rows,
              cols: terminalRef.current.cols
            });
          }
          focusTerminal();
        });
      }
    });

    socket.on("jcode:terminal:output", (payload) => {
      writeTerminalOutput(payload?.data || "");
    });

    socket.on("jcode:terminal:error", (payload) => {
      const message = payload?.error || "JCode terminal error";
      setTerminalState("error");
      writeTerminalOutput(`\r\n${message}\r\n`);
      toast.error(message);
    });

    socket.on("jcode:terminal:exit", (payload) => {
      const code = payload?.code ?? "";
      const signal = payload?.signal ? ` signal=${payload.signal}` : "";
      writeTerminalOutput(`\r\nJCode session ended${code !== "" && code !== null ? ` code=${code}` : ""}${signal}.\r\n`);
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

  useEffect(() => {
    terminalInputDisposableRef.current?.dispose?.();
    terminalInputDisposableRef.current = null;
    if (terminalRunning && terminalRef.current) {
      terminalInputDisposableRef.current = terminalRef.current.onData((data) => {
        socketRef.current?.emit("jcode:terminal:input", { data });
      });
    }
    return () => {
      terminalInputDisposableRef.current?.dispose?.();
      terminalInputDisposableRef.current = null;
    };
  }, [terminalRunning]);

  const sendTerminalInput = (event?: FormEvent) => {
    event?.preventDefault();
    if (!terminalInput.trim()) {
      return;
    }
    sendTerminalRaw(`${terminalInput}\r`);
    setTerminalInput("");
    focusTerminal();
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
          actions={loading ? <Skeleton className="h-7 w-24" /> : (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <Badge tone={installed ? "success" : "warning"}>{installed ? status?.version || "Installed" : "Not installed"}</Badge>
              <Badge tone={terminalRunning ? "success" : terminalConnecting ? "warning" : "neutral"}>{terminalRunning ? "Session live" : terminalConnecting ? "Connecting" : "No session"}</Badge>
              {terminalMeta?.pty ? <Badge tone="success">{terminalMeta?.backend || "PTY"}</Badge> : null}
            </div>
          )}
        />

        <div className="space-y-3">
          <div className="jcode-session-grid">
            <label className="jcode-compact-field">
              <span>Start command</span>
              <Select value={sessionCommandPreset} onChange={(event) => setSessionCommandPreset(event.target.value)} disabled={terminalRunning || terminalConnecting}>
                <option value="jcode">JCode agent</option>
                <option value="login-openai-compatible">Login: OpenAI compatible</option>
                <option value="login-openai">Login: OpenAI / ChatGPT</option>
                <option value="login-claude">Login: Anthropic Claude</option>
                <option value="auth-test">Auth test</option>
                {customTerminalAllowed ? <option value="custom">Custom command</option> : null}
              </Select>
            </label>
            <label className="jcode-compact-field">
              <span>Working folder</span>
              <Input value={sessionCwd} onChange={(event) => setSessionCwd(event.target.value)} placeholder={operator?.cwd || "/root/pm2-manager"} disabled={terminalRunning || terminalConnecting} />
            </label>
            {sessionCommandPreset === "custom" ? (
              <label className="jcode-compact-field">
                <span>Custom command</span>
                <Input value={customSessionCommand} onChange={(event) => setCustomSessionCommand(event.target.value)} placeholder="bash" disabled={terminalRunning || terminalConnecting} />
              </label>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant={installed ? "secondary" : "primary"} size="sm" disabled={loading || installing || installed} onClick={installJcode}>
              <Power size={14} />
              {installed ? "Installed" : installing ? "Installing..." : "Install JCode"}
            </Button>
            <Button type="button" variant="primary" size="sm" disabled={!installed || terminalConnecting || terminalRunning || (sessionCommandPreset === "custom" && !customTerminalAllowed)} onClick={startTerminalSession}>
              <Play size={14} />
              {terminalConnecting ? "Connecting..." : "Start session"}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={!terminalRunning && !terminalConnecting} onClick={stopTerminalSession}>
              <StopCircle size={14} />
              Stop session
            </Button>
          </div>
          {lastOutput ? <pre className="jcode-command-preview">{lastOutput}</pre> : null}
        </div>

        {status && status.terminal?.ptySupported === false ? (
          <Banner tone="warning" icon={<ShieldCheck size={16} />} className="mt-3">
            No pseudo-terminal on this server, so interactive JCode prompts such as <code>/login</code> cannot
            receive keystrokes. Install the server dependency with{" "}
            <code>npm --prefix server install node-pty</code> and restart PM2 Manager.
            {status.terminal?.error ? ` (${status.terminal.error})` : ""}
          </Banner>
        ) : null}

        <div className={`jcode-terminal-shell mt-3 ${terminalFocused ? "is-focused" : ""}`}>
          <div className="jcode-terminal-toolbar">
            <span>{terminalMeta?.command || terminalCommand}</span>
            <span>{terminalMeta?.cwd || sessionCwd || terminalState}</span>
            <span>{terminalMeta?.socketPath || (terminalMeta?.pid ? `PID ${terminalMeta.pid}` : terminalState)}</span>
            {operator?.isRoot ? <span>root</span> : null}
          </div>
          <div
            ref={terminalHostRef}
            className="jcode-terminal-screen"
            onFocus={() => setTerminalFocused(true)}
            onBlur={() => setTerminalFocused(false)}
            onClick={focusTerminal}
            role="application"
            aria-label="JCode interactive terminal"
          />
          <form className="jcode-terminal-input-row" onSubmit={sendTerminalInput}>
            <Input
              value={terminalInput}
              onChange={(event) => setTerminalInput(event.target.value)}
              placeholder={terminalRunning ? "Quick send" : "No session"}
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
    </div>
  );
}
