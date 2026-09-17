import { useEffect, useState } from "react";
import { Bot, Copy, KeyRound, Play, Send, Zap } from "lucide-react";
import { aiOperator, pm2Admin, processes as processApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import { ConfirmDialog } from "../components/ui/Modal";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import Select from "../components/ui/Select";
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
  "Check unstable apps",
  "Open suspicious logs",
  "Restart stopped apps",
  "Save PM2 list"
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
  planned: "neutral",
  needs_confirmation: "warning",
  rejected: "danger",
  failed: "danger"
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
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`);
  return entries.length ? entries.join(" · ") : "No input";
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

function MessageBubble({ message }) {
  const mine = message.role === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`message-bubble ${mine ? "message-bubble-user" : "message-bubble-ai"}`}>
        <div className="mb-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-3">
          {mine ? "You" : "AI"}
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
        <Badge tone={statusTone[execution.status] || "neutral"}>{String(execution.status || "planned").replace(/_/g, " ")}</Badge>
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

export default function AIOperator() {
  const [settings, setSettings] = useState(loadSettings);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Connect a provider, then ask what to check or run."
    }
  ]);
  const [prompt, setPrompt] = useState("");
  const [providers, setProviders] = useState([]);
  const [processes, setProcesses] = useState([]);
  const [lastActions, setLastActions] = useState([]);
  const [lastExecutions, setLastExecutions] = useState([]);
  const [lastUsage, setLastUsage] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [runningActionId, setRunningActionId] = useState("");
  const [sending, setSending] = useState(false);
  const [testing, setTesting] = useState(false);

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

  const canSend = settings.baseUrl.trim() && settings.model.trim() && settings.apiKey.trim() && prompt.trim() && !sending;
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

  const sendPrompt = async (event) => {
    event?.preventDefault?.();
    if (!canSend) return;

    const userMessage = { role: "user", content: prompt.trim() };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setPrompt("");
    setSending(true);
    setLastActions([]);
    setLastExecutions([]);

    try {
      const result = await aiOperator.chat({
        provider: settings.provider,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        executeMode: settings.executeMode,
        messages: nextMessages.filter((message) => ["user", "assistant"].includes(message.role)),
        context: { processes }
      });
      const data = result.data || {};
      const assistantMessage = { role: "assistant", content: data.reply || "I prepared a response." };
      setMessages((prev) => [...prev, assistantMessage]);
      setLastActions(data.actions || []);
      setLastExecutions(data.executions || []);
      setLastUsage(data.usage || null);
      if ((data.executions || []).some((item) => item.status === "executed")) {
        toast.success("AI operator executed approved action(s)");
      }
    } catch (error) {
      const message = getErrorMessage(error, "AI request failed");
      setMessages((prev) => [...prev, { role: "assistant", content: message }]);
      toast.error(message);
    } finally {
      setSending(false);
    }
  };

  const runAction = async (action) => {
    if (criticalActions.includes(action.actionId)) {
      setPendingAction(action);
      return;
    }
    setRunningActionId(action.actionId);
    try {
      const result = await pm2Admin.runFeature(action.actionId, action.payload || {});
      setLastExecutions((prev) => [{ ...(result.data || {}), status: result.success ? "executed" : "failed", success: result.success }, ...prev]);
      toast.success(`${action.actionId} completed`);
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
      const result = await pm2Admin.runFeature(action.actionId, action.payload || {}, action.actionId);
      setLastExecutions((prev) => [{ ...(result.data || {}), status: result.success ? "executed" : "failed", success: result.success }, ...prev]);
      toast.success(`${action.actionId} completed`);
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
        actions={(
          <>
            <Badge tone={connected ? "success" : "warning"}>{connected ? "Ready" : "Setup needed"}</Badge>
            <Button type="button" size="sm" variant="secondary" onClick={copyTranscript}>
              <Copy size={14} />
              Copy
            </Button>
          </>
        )}
      />

      <section className="ai-setup-card">
        <div className="ai-setup-head">
          <div className="min-w-0">
            <Eyebrow>Connection</Eyebrow>
            <h2 className="panel-heading mt-1">Provider, key, and run mode</h2>
          </div>
          <div className="ai-setup-actions">
            <Button type="button" size="sm" variant="secondary" onClick={testConnection} disabled={testing || !settings.apiKey || !settings.model || !settings.baseUrl}>
              <KeyRound size={14} />
              {testing ? "Testing" : "Test"}
            </Button>
          </div>
        </div>

        <div className="ai-setup-grid">
          <Field label="Provider" className="ai-provider-field">
            <Select value={settings.provider} onChange={(event) => changeProvider(event.target.value)}>
              <option value="openai-compatible">OpenAI compatible</option>
              <option value="anthropic">Anthropic Claude</option>
            </Select>
          </Field>
          <Field label="Provider URL" className="ai-url-field">
            <Input value={settings.baseUrl} onChange={(event) => updateSetting("baseUrl", event.target.value)} placeholder="https://api.openai.com/v1" />
          </Field>
          <Field label="Model" className="ai-model-field">
            <Input value={settings.model} onChange={(event) => updateSetting("model", event.target.value)} placeholder="gpt-4o-mini" />
          </Field>
          <Field label="API key" className="ai-key-field">
            <Input type="password" value={settings.apiKey} onChange={(event) => updateSetting("apiKey", event.target.value)} placeholder="sk-..." autoComplete="off" />
          </Field>
          <Field label="Mode" className="ai-mode-field">
            <Select value={settings.executeMode} onChange={(event) => updateSetting("executeMode", event.target.value)}>
              <option value="plan">Plan only</option>
              <option value="read">Auto checks</option>
              <option value="write">Safe writes</option>
            </Select>
          </Field>
          <label className="ai-remember-key">
            <input
              type="checkbox"
              checked={settings.rememberKey}
              onChange={(event) => updateSetting("rememberKey", event.target.checked)}
            />
            <span>Remember key</span>
          </label>
        </div>
      </section>

      <section className="ai-workspace">
        <section className="ai-terminal-panel">
          <PanelHeader
            title="Terminal"
            actions={<Badge tone={settings.executeMode === "plan" ? "neutral" : "warning"}>{settings.executeMode}</Badge>}
          />

          <div className="operator-messages ai-message-window">
            {messages.map((message, index) => <MessageBubble key={`${message.role}-${index}`} message={message} />)}
            {sending ? (
              <div className="flex items-center gap-2 text-sm text-text-3">
                <Bot size={16} className="animate-pulse" />
                Working...
              </div>
            ) : null}
          </div>

          <div className="ai-prompt-strip">
            {suggestedPrompts.map((item) => (
              <button key={item} type="button" className="prompt-chip" onClick={() => setPrompt(item)}>
                {item}
              </button>
            ))}
          </div>

          <form onSubmit={sendPrompt} className="ai-prompt-form">
            <Textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask what to check or run"
              className="ai-prompt-input resize-y"
            />
            <Button type="submit" disabled={!canSend} className="ai-send-button">
              {settings.executeMode === "plan" ? <Send size={14} /> : <Zap size={14} />}
              {sending ? "Working" : settings.executeMode === "plan" ? "Ask" : "Ask + run"}
            </Button>
          </form>
        </section>

        <aside className="ai-right-rail">
          <section className="ai-side-card">
            <PanelHeader title="Context" />
            <div className="ai-context-grid">
              <CompactMetric label="Processes" value={processes.length} />
              <CompactMetric label="Providers" value={providers.length || 2} />
              <CompactMetric label="Mode" value={settings.executeMode} />
            </div>
          </section>

          <section className="ai-side-card ai-queue-card">
            <PanelHeader title="Prepared actions" />
            <div className="ai-card-list">
              {lastActions.length > 0 ? lastActions.map((action, index) => (
                <PlannedActionCard key={`${action.actionId}-${index}`} action={action} onRun={runAction} running={runningActionId === action.actionId} />
              )) : <InsetPanel padding="sm" className="text-sm text-text-3">No actions prepared.</InsetPanel>}
            </div>
          </section>

          <section className="ai-side-card ai-queue-card">
            <PanelHeader title="Execution log" />
            <div className="ai-card-list">
              {lastExecutions.length > 0 ? lastExecutions.map((execution, index) => (
                <ExecutionCard key={`${execution.actionId}-${index}`} execution={execution} />
              )) : <InsetPanel padding="sm" className="text-sm text-text-3">No actions executed.</InsetPanel>}
            </div>
          </section>

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
          description="This can disrupt running processes."
          confirmLabel="Run critical action"
          confirmVariant="danger"
          onConfirm={confirmCriticalAction}
          onClose={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
