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
  return entries.length ? entries.join(" · ") : "No extra input";
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
        <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-text-3">
          {mine ? "You" : "AI Operator"}
        </div>
        <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
      </div>
    </div>
  );
}

function PlannedActionCard({ action, onRun, running }) {
  return (
    <InsetPanel padding="sm" className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-text-1">{action.actionId}</p>
            <Badge tone="neutral">{action.confidence || "medium"}</Badge>
          </div>
          {action.reason ? <p className="mt-1 text-xs text-text-3">{action.reason}</p> : null}
        </div>
        <Button type="button" size="sm" variant="outlinePrimary" onClick={() => onRun(action)} disabled={running}>
          <Play size={13} />
          Run
        </Button>
      </div>
      <code className="block rounded-md border border-border bg-bg/60 px-2 py-1 text-xs text-text-3">
        {summarizeAction(action)}
      </code>
    </InsetPanel>
  );
}

function ExecutionCard({ execution }) {
  return (
    <InsetPanel padding="sm" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone[execution.status] || "neutral"}>{String(execution.status || "planned").replace(/_/g, " ")}</Badge>
        <Badge tone={riskTone[execution.risk] || "neutral"}>{execution.risk || "unknown"}</Badge>
        <span className="text-sm font-medium text-text-1">{execution.label || execution.actionId}</span>
      </div>
      {execution.command ? (
        <code className="block break-all rounded-md border border-border bg-bg/60 px-2 py-1 text-xs text-text-3">{execution.command}</code>
      ) : null}
      {execution.output ? <Textarea readOnly value={execution.output} className="min-h-[96px] font-mono text-xs" /> : null}
    </InsetPanel>
  );
}

export default function AIOperator() {
  const [settings, setSettings] = useState(loadSettings);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Add your provider details, then ask what to check or run."
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
    if (["delete", "kill-daemon", "resurrect", "startup", "unstartup", "send-signal", "update-daemon"].includes(action.actionId)) {
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
    <div className="compact-page-stack">
      <PageIntro
        title="AI Operator"
        actions={(
          <>
            <Badge tone="success">Guarded</Badge>
            <Button type="button" variant="secondary" onClick={copyTranscript}>
              <Copy size={14} />
              Copy chat
            </Button>
          </>
        )}
      />

      <section className="operator-layout">
        <aside className="operator-side-stack">
          <section className="operator-compact-panel">
            <PanelHeader title="AI connection" />
            <Field label="Provider">
              <Select value={settings.provider} onChange={(event) => changeProvider(event.target.value)}>
                <option value="openai-compatible">OpenAI compatible</option>
                <option value="anthropic">Anthropic Claude</option>
              </Select>
            </Field>
            <Field label="Provider URL">
              <Input value={settings.baseUrl} onChange={(event) => updateSetting("baseUrl", event.target.value)} placeholder="https://api.openai.com/v1" />
            </Field>
            <Field label="Model">
              <Input value={settings.model} onChange={(event) => updateSetting("model", event.target.value)} placeholder="gpt-4o-mini, claude-sonnet-4-5" />
            </Field>
            <Field label="API key">
              <Input type="password" value={settings.apiKey} onChange={(event) => updateSetting("apiKey", event.target.value)} placeholder="sk-..." autoComplete="off" />
            </Field>
            <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-2/60 p-2 text-sm text-text-2">
              <input
                type="checkbox"
                className="mt-1"
                checked={settings.rememberKey}
                onChange={(event) => updateSetting("rememberKey", event.target.checked)}
              />
              <span>
                Remember key
              </span>
            </label>
            <Button type="button" variant="secondary" onClick={testConnection} disabled={testing || !settings.apiKey || !settings.model || !settings.baseUrl} className="w-full">
              <KeyRound size={14} />
              {testing ? "Testing..." : "Test connection"}
            </Button>
          </section>

          <section className="operator-compact-panel">
            <PanelHeader title="Execution mode" />
            <Field label="Mode">
              <Select value={settings.executeMode} onChange={(event) => updateSetting("executeMode", event.target.value)}>
                <option value="plan">Plan only</option>
                <option value="read">Auto-run checks only</option>
                <option value="write">Auto-run checks + safe writes</option>
              </Select>
            </Field>
          </section>

          <section className="operator-compact-panel">
            <PanelHeader title="Live context" />
            <div className="operator-summary-grid">
              <InsetPanel padding="sm">
                <Eyebrow>Processes</Eyebrow>
                <p className="mt-1 text-xl font-semibold text-text-1">{processes.length}</p>
              </InsetPanel>
              <InsetPanel padding="sm">
                <Eyebrow>Provider</Eyebrow>
                <p className="mt-1 truncate text-sm font-semibold text-text-1">{settings.provider}</p>
              </InsetPanel>
              <InsetPanel padding="sm">
                <Eyebrow>Mode</Eyebrow>
                <p className="mt-1 truncate text-sm font-semibold text-text-1">{settings.executeMode}</p>
              </InsetPanel>
            </div>
            {lastUsage ? (
              <Textarea readOnly value={stringifyOutput(lastUsage)} className="min-h-[72px] font-mono text-xs" />
            ) : null}
          </section>
        </aside>

        <section className="compact-page-stack">
          <section className="operator-console">
            <PanelHeader
              title="Operator terminal"
              actions={<Badge tone={settings.executeMode === "plan" ? "neutral" : "warning"}>{settings.executeMode}</Badge>}
            />

            <div className="operator-messages">
              {messages.map((message, index) => <MessageBubble key={`${message.role}-${index}`} message={message} />)}
              {sending ? (
                <div className="flex items-center gap-2 text-sm text-text-3">
                  <Bot size={16} className="animate-pulse" />
                  Thinking...
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {suggestedPrompts.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="prompt-chip"
                  onClick={() => setPrompt(item)}
                >
                  {item}
                </button>
              ))}
            </div>

            <form onSubmit={sendPrompt} className="space-y-2">
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask what to check or run"
                className="min-h-[86px] resize-y"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button type="submit" disabled={!canSend}>
                  {settings.executeMode === "plan" ? <Send size={14} /> : <Zap size={14} />}
                  {sending ? "Working..." : settings.executeMode === "plan" ? "Ask AI" : "Ask + run guarded"}
                </Button>
              </div>
            </form>
          </section>

          {(lastActions.length > 0 || lastExecutions.length > 0) && (
            <section className="grid gap-3 lg:grid-cols-2">
              <div className="page-panel space-y-2 p-3">
                <PanelHeader title="Prepared actions" />
                {lastActions.length > 0 ? lastActions.map((action, index) => (
                  <PlannedActionCard key={`${action.actionId}-${index}`} action={action} onRun={runAction} running={runningActionId === action.actionId} />
                )) : <InsetPanel padding="sm" className="text-sm text-text-3">No PM2 actions prepared.</InsetPanel>}
              </div>

              <div className="page-panel space-y-2 p-3">
                <PanelHeader title="Execution log" />
                {lastExecutions.length > 0 ? lastExecutions.map((execution, index) => (
                  <ExecutionCard key={`${execution.actionId}-${index}`} execution={execution} />
                )) : <InsetPanel padding="sm" className="text-sm text-text-3">No actions executed yet.</InsetPanel>}
              </div>
            </section>
          )}
        </section>
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
