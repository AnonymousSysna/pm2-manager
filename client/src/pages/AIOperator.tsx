import { useEffect, useState } from "react";
import { Bot, CheckCircle2, Copy, KeyRound, Play, Send, TerminalSquare, Wrench, Zap } from "lucide-react";
import { aiOperator, processes as processApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import Modal, { ConfirmDialog } from "../components/ui/Modal";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import Textarea from "../components/ui/Textarea";
import { Eyebrow } from "../components/ui/Typography";

const STORAGE_KEY = "pm2_ai_operator_settings";

const defaultSettings = {
  provider: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  model: "",
  apiKey: "",
  rememberKey: false,
  executeMode: "plan"
};

const providerBaseUrls = {
  "openai-compatible": "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com"
};

const suggestedPrompts = [
  "Fix the dashboard 404 after login",
  "Repair missing assets after deploy",
  "Find why PM2 keeps restarting",
  "Fix Git pull blocked by local changes"
];

const criticalActions = ["delete", "kill-daemon", "resurrect", "startup", "unstartup", "send-signal", "update-daemon"];

const riskTone = {
  read: "neutral",
  "sensitive-read": "warning",
  write: "info",
  critical: "danger",
  unknown: "danger"
};

const statusTone = {
  executed: "success",
  accepted: "success",
  planned: "neutral",
  needs_confirmation: "warning",
  rejected: "danger",
  failed: "danger",
  done: "success",
  running: "info",
  blocked: "warning"
};

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return defaultSettings;
    return {
      ...defaultSettings,
      ...parsed,
      apiKey: parsed.rememberKey ? parsed.apiKey || "" : ""
    };
  } catch (_error) {
    return defaultSettings;
  }
}

function saveSettings(settings) {
  const payload = {
    provider: settings.provider,
    baseUrl: settings.baseUrl,
    model: settings.model,
    executeMode: settings.executeMode,
    rememberKey: Boolean(settings.rememberKey),
    apiKey: settings.rememberKey ? settings.apiKey : ""
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function summarizeAction(action) {
  const payload = action?.payload && typeof action.payload === "object" ? action.payload : {};
  const entries = Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== null && String(value) !== "")
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return entries.length ? entries.join(" · ") : "Ready to run";
}

function stringifyOutput(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function formatStatus(value) {
  return String(value || "planned").replace(/_/g, " ");
}

function MessageBubble({ message }) {
  const mine = message.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`message-bubble ${mine ? "message-bubble-user" : "message-bubble-ai"}`}>
        <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
          {mine ? "You" : "Agent"}
        </div>
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
      </div>
    </div>
  );
}

function PlannedActionCard({ action, onRun, running }) {
  return (
    <InsetPanel padding="sm" className="ai-action-row">
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-text-1">{action.actionId}</p>
          <Badge tone="neutral">{action.confidence || "medium"}</Badge>
        </div>
        <p className="mt-1 truncate text-xs text-text-3">{action.reason || summarizeAction(action)}</p>
      </div>
      <Button type="button" size="sm" variant="outlinePrimary" onClick={() => onRun(action)} disabled={running} className="shrink-0">
        <Play size={13} />
        Run
      </Button>
    </InsetPanel>
  );
}

function ExecutionCard({ execution }) {
  return (
    <InsetPanel padding="sm" className="ai-execution-card">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Badge tone={statusTone[execution.status] || "neutral"}>{formatStatus(execution.status)}</Badge>
        <Badge tone={riskTone[execution.risk] || "neutral"}>{execution.risk || "unknown"}</Badge>
        <span className="min-w-0 truncate text-sm font-medium text-text-1">{execution.label || execution.actionId}</span>
      </div>
      {execution.command ? (
        <code className="block truncate rounded-md border border-border/70 bg-bg/50 px-2 py-1 text-[11px] text-text-3">{execution.command}</code>
      ) : null}
      {execution.output ? <Textarea readOnly value={execution.output} className="min-h-[74px] font-mono text-xs" /> : null}
    </InsetPanel>
  );
}

function CompactMetric({ label, value }) {
  return (
    <InsetPanel padding="sm" className="min-w-0">
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-1 truncate text-sm font-semibold text-text-1">{value}</p>
    </InsetPanel>
  );
}

function AgentThoughts({ thoughts = [] }) {
  return (
    <div className="ai-agent-stack">
      {thoughts.length ? thoughts.map((thought, index) => (
        <InsetPanel key={`${thought}-${index}`} padding="sm" className="ai-agent-thought-row">
          <CheckCircle2 size={14} className="shrink-0 text-success-500" />
          <span className="min-w-0 text-xs font-medium text-text-2">{thought}</span>
        </InsetPanel>
      )) : <InsetPanel padding="sm" className="text-sm text-text-3">No agent notes.</InsetPanel>}
    </div>
  );
}

function AgentLogs({ logs = [] }) {
  return (
    <div className="ai-agent-stack">
      {logs.length ? logs.map((log, index) => (
        <InsetPanel key={`${log.title || log.step || "log"}-${index}`} padding="sm" className="ai-agent-log-row">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge tone={statusTone[log.status] || (log.level === "error" ? "danger" : log.level === "warning" ? "warning" : "neutral")}>{log.status || log.level || "info"}</Badge>
            <span className="min-w-0 truncate text-sm font-semibold text-text-1">{log.title || log.step || "Agent log"}</span>
          </div>
          {log.message ? <p className="text-xs text-text-3">{log.message}</p> : null}
          {log.command ? <code className="block truncate rounded-md border border-border/70 bg-bg/50 px-2 py-1 text-[11px] text-text-3">{log.command}</code> : null}
          {log.output ? <Textarea readOnly value={log.output} className="min-h-[70px] font-mono text-xs" /> : null}
        </InsetPanel>
      )) : <InsetPanel padding="sm" className="text-sm text-text-3">No logs.</InsetPanel>}
    </div>
  );
}

export default function AIOperator() {
  const [settings, setSettings] = useState(loadSettings);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Describe the issue. I’ll spawn an agent run."
    }
  ]);
  const [prompt, setPrompt] = useState("");
  const [providers, setProviders] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [lastActions, setLastActions] = useState([]);
  const [lastExecutions, setLastExecutions] = useState([]);
  const [lastUsage, setLastUsage] = useState(null);
  const [lastSupportContext, setLastSupportContext] = useState(null);
  const [agentRun, setAgentRun] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [runningActionId, setRunningActionId] = useState("");
  const [spawning, setSpawning] = useState(false);
  const [testing, setTesting] = useState(false);
  const [connectionModalOpen, setConnectionModalOpen] = useState(false);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  useEffect(() => {
    let mounted = true;
    aiOperator.providers()
      .then((result) => {
        if (mounted) setProviders(result.data?.providers || []);
      })
      .catch(() => {
        if (mounted) setProviders([]);
      });
    processApi.list()
      .then((result) => {
        if (mounted) setProcesses(result.data || []);
      })
      .catch(() => {
        if (mounted) setProcesses([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const canSpawn = prompt.trim().length >= 8 && !spawning;
  const connected = Boolean(settings.baseUrl.trim() && settings.model.trim() && settings.apiKey.trim());

  const updateSetting = (name, value) => {
    setSettings((prev) => ({ ...prev, [name]: value }));
  };

  const changeProvider = (provider) => {
    setSettings((prev) => ({
      ...prev,
      provider,
      baseUrl: providerBaseUrls[provider] || prev.baseUrl
    }));
  };

  const copyTranscript = async () => {
    const text = messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join("\n\n");
    await navigator.clipboard.writeText(text);
    toast.success("Transcript copied");
  };

  const testConnection = async () => {
    setTesting(true);
    try {
      const result = await aiOperator.test(settings);
      toast.success(result.data?.message || "AI connection works");
    } catch (error) {
      toast.error(getErrorMessage(error, "AI connection failed"));
    } finally {
      setTesting(false);
    }
  };

  const spawnAgent = async (event) => {
    event?.preventDefault?.();
    const task = prompt.trim();
    if (spawning) return;
    if (task.length < 8) {
      toast.error("Explain the task first");
      return;
    }

    const userMessage = { role: "user", content: task };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setPrompt("");
    setSpawning(true);
    setLastActions([]);
    setLastExecutions([]);
    setAgentRun({
      status: "running",
      task,
      thoughts: ["Agent spawned from your request."],
      logs: [{ level: "info", title: "Starting", message: "Collecting dashboard evidence." }]
    });

    try {
      const result = await toast.promise(
        () => aiOperator.agentRun({
          task,
          provider: settings.provider,
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          model: settings.model,
          executeMode: settings.executeMode,
          messages: nextMessages.filter((message) => ["user", "assistant"].includes(message.role)),
          context: { processes }
        }),
        {
          loading: settings.executeMode === "write" ? "Agent working..." : settings.executeMode === "read" ? "Agent checking..." : "Agent planning...",
          success: "Agent finished",
          error: (error) => getErrorMessage(error, "Agent failed")
        }
      );
      const data = result.data || {};
      const assistantMessage = { role: "assistant", content: data.reply || "Agent run finished." };
      setMessages((prev) => [...prev, assistantMessage]);
      setLastActions(data.actions || []);
      setLastExecutions(data.executions || []);
      setLastUsage(data.usage || null);
      setLastSupportContext(data.supportContext || null);
      setAgentRun(data.agentRun || null);
    } catch (error) {
      const message = getErrorMessage(error, "Agent failed");
      setMessages((prev) => [...prev, { role: "assistant", content: message }]);
      setAgentRun((prev) => ({
        ...(prev || {}),
        status: "failed",
        thoughts: [...(prev?.thoughts || []), "Agent stopped because the request failed."],
        logs: [...(prev?.logs || []), { level: "error", title: "Agent failed", message }]
      }));
      toast.error(message);
    } finally {
      setSpawning(false);
    }
  };

  const runAction = async (action) => {
    if (criticalActions.includes(action.actionId)) {
      setPendingAction(action);
      return;
    }
    setRunningActionId(action.actionId);
    try {
      const result = await aiOperator.runAction(action.actionId, action.payload || {});
      if (result.data?.status === "needs_confirmation") {
        setPendingAction(action);
        return;
      }
      const executionStatus = result.data?.status || (result.success ? "executed" : "failed");
      setLastExecutions((prev) => [{ ...(result.data || {}), status: executionStatus, success: result.success }, ...prev]);
      if (!result.success || ["failed", "rejected"].includes(executionStatus)) {
        toast.error(`${action.actionId} failed`);
      } else {
        toast.success(`${action.actionId} ${executionStatus === "accepted" ? "accepted" : "completed"}`);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, `${action.actionId} failed`));
    } finally {
      setRunningActionId("");
    }
  };

  const confirmCriticalAction = async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    setPendingAction(null);
    setRunningActionId(action.actionId);
    try {
      const result = await aiOperator.runAction(action.actionId, action.payload || {}, action.actionId);
      const executionStatus = result.data?.status || (result.success ? "executed" : "failed");
      setLastExecutions((prev) => [{ ...(result.data || {}), status: executionStatus, success: result.success }, ...prev]);
      if (!result.success || ["failed", "rejected"].includes(executionStatus)) {
        toast.error(`${action.actionId} failed`);
      } else {
        toast.success(`${action.actionId} ${executionStatus === "accepted" ? "accepted" : "completed"}`);
      }
    } catch (error) {
      toast.error(getErrorMessage(error, `${action.actionId} failed`));
    } finally {
      setRunningActionId("");
    }
  };

  return (
    <div className="ai-page compact-page-stack">
      <PageIntro
        title="AI Operator"
        actions={(<>
          <Badge tone={connected ? "success" : "warning"}>{connected ? "Ready" : "Local agent"}</Badge>
          <Button type="button" size="sm" variant="outlinePrimary" onClick={() => setConnectionModalOpen(true)}>
            <KeyRound size={14} />
            Connection
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={copyTranscript} disabled={spawning}>
            <Copy size={14} />
            Copy
          </Button>
        </>)}
      />

      <section className="ai-connection-summary-card">
        <div className="ai-connection-summary-main">
          <div className="min-w-0">
            <Eyebrow>Agent mode</Eyebrow>
            <h2 className="panel-heading mt-1">Interactive worker</h2>
          </div>
          <div className="ai-connection-pills">
            <Badge tone={settings.executeMode === "write" ? "warning" : "neutral"}>{settings.executeMode}</Badge>
            <Badge tone="neutral">{settings.provider === "anthropic" ? "Claude" : "OpenAI"}</Badge>
            {settings.model ? <Badge tone="neutral">{settings.model}</Badge> : null}
          </div>
        </div>
        <div className="ai-connection-summary-actions">
          <Button type="button" size="sm" variant="outlinePrimary" onClick={() => setConnectionModalOpen(true)}>
            <KeyRound size={14} />
            Connection
          </Button>
        </div>
      </section>

      {connectionModalOpen ? (
        <Modal
          title="Connection"
          size="md"
          onClose={() => setConnectionModalOpen(false)}
          className="ai-connection-dialog"
          bodyClassName="ai-connection-modal-body"
        >
          <section className="ai-connection-modal-card">
            <div className="ai-connection-modal-status">
              <Badge tone={connected ? "success" : "warning"}>{connected ? "Ready" : "Local agent"}</Badge>
              <Badge tone="neutral">{settings.provider === "anthropic" ? "Claude" : "OpenAI"}</Badge>
              {settings.model ? <Badge tone="neutral">{settings.model}</Badge> : null}
            </div>

            <div className="ai-connection-compact-stack">
              <Field label="Provider" className="ai-provider-field ai-compact-field">
                <div className="ai-segmented-control ai-segmented-control-tight" role="group" aria-label="AI provider">
                  <button type="button" aria-pressed={settings.provider === "openai-compatible"} onClick={() => changeProvider("openai-compatible")}>OpenAI compatible</button>
                  <button type="button" aria-pressed={settings.provider === "anthropic"} onClick={() => changeProvider("anthropic")}>Anthropic Claude</button>
                </div>
              </Field>

              <div className="ai-connection-two-col">
                <Field label="Provider URL" className="ai-compact-field">
                  <Input className="ai-compact-input" value={settings.baseUrl} onChange={(event) => updateSetting("baseUrl", event.target.value)} placeholder="https://api.openai.com/v1" />
                </Field>
                <Field label="Model" className="ai-compact-field">
                  <Input className="ai-compact-input" value={settings.model} onChange={(event) => updateSetting("model", event.target.value)} placeholder="gpt-4o-mini" />
                </Field>
              </div>

              <Field label="API key" className="ai-compact-field">
                <Input className="ai-compact-input" type="password" value={settings.apiKey} onChange={(event) => updateSetting("apiKey", event.target.value)} placeholder="sk-..." autoComplete="off" />
              </Field>

              <Field label="Mode" className="ai-mode-field ai-compact-field">
                <div className="ai-segmented-control ai-segmented-control-three ai-segmented-control-tight" role="group" aria-label="AI run mode">
                  <button type="button" aria-pressed={settings.executeMode === "plan"} onClick={() => updateSetting("executeMode", "plan")}>Plan only</button>
                  <button type="button" aria-pressed={settings.executeMode === "read"} onClick={() => updateSetting("executeMode", "read")}>Auto checks</button>
                  <button type="button" aria-pressed={settings.executeMode === "write"} onClick={() => updateSetting("executeMode", "write")}>Safe writes</button>
                </div>
              </Field>

              <div className="ai-connection-action-row">
                <label className="ai-remember-key ai-remember-key-compact">
                  <input type="checkbox" checked={settings.rememberKey} onChange={(event) => updateSetting("rememberKey", event.target.checked)} />
                  <span>Remember key</span>
                </label>
                <Button type="button" size="sm" variant="outlinePrimary" onClick={testConnection} disabled={testing || !settings.apiKey || !settings.model || !settings.baseUrl}>
                  <KeyRound size={14} />
                  {testing ? "Testing" : "Test"}
                </Button>
              </div>
            </div>
          </section>
        </Modal>
      ) : null}

      <section className="ai-workspace ai-agent-workspace">
        <section className="ai-terminal-panel ai-agent-terminal-panel">
          <PanelHeader title="Agent task" actions={<Badge tone={settings.executeMode === "write" ? "warning" : "neutral"}>{settings.executeMode}</Badge>} />

          <div className="operator-messages ai-message-window">
            {messages.map((message, index) => <MessageBubble key={`${message.role}-${index}`} message={message} />)}
            {spawning ? (
              <div className="flex items-center gap-2 text-sm text-text-3">
                <Bot size={16} className="animate-pulse" />
                Agent running...
              </div>
            ) : null}
          </div>

          <div className="ai-prompt-strip">
            {suggestedPrompts.map((item) => (
              <button key={item} type="button" className="prompt-chip" onClick={() => setPrompt(item)} disabled={spawning}>{item}</button>
            ))}
          </div>

          <form onSubmit={spawnAgent} className="ai-prompt-form ai-agent-prompt-form">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Explain the error or task"
              className="ai-prompt-input resize-y"
            />
            <Button type="submit" disabled={!canSpawn} className="ai-send-button">
              <Zap size={14} />
              {spawning ? "Running" : "Spawn agent"}
            </Button>
          </form>
        </section>

        <aside className="ai-right-rail ai-agent-rail">
          <section className="ai-side-card">
            <PanelHeader title="Run state" />
            <div className="ai-context-grid">
              <CompactMetric label="Processes" value={processes.length} />
              <CompactMetric label="Issues" value={lastSupportContext?.issues?.length ?? "—"} />
              <CompactMetric label="Status" value={agentRun?.status || "Idle"} />
            </div>
          </section>

          <section className="ai-side-card ai-queue-card">
            <PanelHeader title="Thoughts" actions={<TerminalSquare size={15} className="text-text-3" />} />
            <AgentThoughts thoughts={agentRun?.thoughts || []} />
          </section>

          <section className="ai-side-card ai-queue-card">
            <PanelHeader title="Logs" actions={<Wrench size={15} className="text-text-3" />} />
            <AgentLogs logs={agentRun?.logs || []} />
          </section>

          {lastActions.length ? (
            <section className="ai-side-card ai-queue-card">
              <PanelHeader title="Manual actions" />
              <div className="ai-card-list">
                {lastActions.map((action, index) => (
                  <PlannedActionCard key={`${action.actionId}-${index}`} action={action} onRun={runAction} running={runningActionId === action.actionId} />
                ))}
              </div>
            </section>
          ) : null}

          {lastExecutions.length ? (
            <section className="ai-side-card ai-queue-card">
              <PanelHeader title="Execution" />
              <div className="ai-card-list">
                {lastExecutions.map((execution, index) => (
                  <ExecutionCard key={`${execution.actionId}-${index}`} execution={execution} />
                ))}
              </div>
            </section>
          ) : null}

          {lastUsage ? (
            <section className="ai-side-card">
              <PanelHeader title="Usage" />
              <Textarea readOnly value={stringifyOutput(lastUsage)} className="min-h-[72px] font-mono text-xs" />
            </section>
          ) : null}
        </aside>
      </section>

      {pendingAction && (
        <ConfirmDialog
          title={`Run critical action: ${pendingAction.actionId}?`}
          description="This can affect running apps."
          confirmLabel="Run critical action"
          confirmVariant="danger"
          onConfirm={confirmCriticalAction}
          onClose={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
