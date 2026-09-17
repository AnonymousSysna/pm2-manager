import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, Copy, KeyRound, Play, Send, ShieldCheck, TerminalSquare, Zap } from "lucide-react";
import { aiOperator, pm2Admin, processes as processApi } from "../api";
import toast, { getErrorMessage } from "../lib/toast";
import Badge from "../components/ui/Badge";
import Banner from "../components/ui/Banner";
import Button from "../components/ui/Button";
import Field from "../components/ui/Field";
import Input from "../components/ui/Input";
import InsetPanel from "../components/ui/InsetPanel";
import { ConfirmDialog } from "../components/ui/Modal";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import Select from "../components/ui/Select";
import Textarea from "../components/ui/Textarea";
import { Eyebrow, SupportingCopy } from "../components/ui/Typography";

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
  "Check why my apps are unstable and suggest the safest next action.",
  "Show me the logs for the most suspicious process first.",
  "Restart the crashed process only if it is clearly stopped.",
  "Save the current PM2 process list after checking status."
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
      <div className={`max-w-[88%] rounded-xl border px-3 py-2 text-sm ${mine ? "border-brand-500/40 bg-brand-500/15 text-text-1" : "border-border bg-surface-2/70 text-text-2"}`}>
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
          <p className="mt-1 text-xs text-text-3">{action.reason || "Prepared by the AI operator."}</p>
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
      {execution.reason ? <p className="text-xs text-text-3">{execution.reason}</p> : null}
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
      content: "Paste your AI provider URL, API key, and model. I can chat about PM2, prepare guarded actions, and execute read/write actions only when the selected mode allows it."
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

  const providerHelp = useMemo(() => {
    const found = providers.find((provider) => provider.id === settings.provider);
    return found?.notes || "Use any provider that matches the selected protocol.";
  }, [providers, settings.provider]);

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
    <div className="space-y-4">
      <PageIntro
        title="AI Operator"
        description="Chat with your preferred AI provider, let it inspect PM2 context, and run only guarded dashboard actions."
        actions={(
          <Button type="button" variant="secondary" onClick={copyTranscript}>
            <Copy size={14} />
            Copy chat
          </Button>
        )}
      />

      <Banner tone="warning" icon={<ShieldCheck size={16} />}>
        <strong className="text-text-1">Operator guardrails are on.</strong> API keys are sent only to your PM2 Manager backend for the current request. Critical PM2 actions still need a separate confirmation, and no raw shell prompt is exposed.
      </Banner>

      <section className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <section className="page-panel space-y-3">
            <PanelHeader title="AI connection" description="Use OpenAI-compatible gateways or Anthropic Claude." />
            <Field label="Provider">
              <Select value={settings.provider} onChange={(event) => changeProvider(event.target.value)}>
                <option value="openai-compatible">OpenAI compatible</option>
                <option value="anthropic">Anthropic Claude</option>
              </Select>
            </Field>
            <Field label="Provider URL" description={providerHelp}>
              <Input value={settings.baseUrl} onChange={(event) => updateSetting("baseUrl", event.target.value)} placeholder="https://api.openai.com/v1" />
            </Field>
            <Field label="Model">
              <Input value={settings.model} onChange={(event) => updateSetting("model", event.target.value)} placeholder="Use the exact model id from your provider" />
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
                Remember key in this browser
                <span className="mt-0.5 block text-xs text-text-3">Convenient, but less safe on a shared computer.</span>
              </span>
            </label>
            <Button type="button" variant="secondary" onClick={testConnection} disabled={testing || !settings.apiKey || !settings.model || !settings.baseUrl} className="w-full">
              <KeyRound size={14} />
              {testing ? "Testing..." : "Test connection"}
            </Button>
          </section>

          <section className="page-panel space-y-3">
            <PanelHeader title="Execution mode" description="Choose how much work the AI can run after it answers." />
            <Field label="Mode">
              <Select value={settings.executeMode} onChange={(event) => updateSetting("executeMode", event.target.value)}>
                <option value="plan">Plan only</option>
                <option value="read">Auto-run checks only</option>
                <option value="write">Auto-run checks + safe writes</option>
              </Select>
            </Field>
            <InsetPanel padding="sm" className="space-y-2 text-sm text-text-3">
              <div className="flex items-center gap-2 text-text-2"><ShieldCheck size={14} /> No arbitrary terminal</div>
              <div className="flex items-center gap-2 text-text-2"><AlertTriangle size={14} /> Critical actions always confirm</div>
              <div className="flex items-center gap-2 text-text-2"><TerminalSquare size={14} /> Uses the PM2 feature allowlist</div>
            </InsetPanel>
          </section>

          <section className="page-panel space-y-3">
            <PanelHeader title="Live context" />
            <div className="grid grid-cols-2 gap-2 text-sm">
              <InsetPanel padding="sm">
                <Eyebrow>Processes</Eyebrow>
                <p className="mt-1 text-xl font-semibold text-text-1">{processes.length}</p>
              </InsetPanel>
              <InsetPanel padding="sm">
                <Eyebrow>Provider</Eyebrow>
                <p className="mt-1 truncate text-sm font-semibold text-text-1">{settings.provider}</p>
              </InsetPanel>
            </div>
            {lastUsage ? (
              <Textarea readOnly value={stringifyOutput(lastUsage)} className="min-h-[90px] font-mono text-xs" />
            ) : (
              <SupportingCopy size="xs">Usage appears here when the provider returns token details.</SupportingCopy>
            )}
          </section>
        </aside>

        <section className="space-y-4">
          <section className="page-panel flex min-h-[560px] flex-col gap-3">
            <PanelHeader
              title="Operator terminal"
              description="Ask in plain language. The AI answers first, then prepares PM2 actions if useful."
              actions={<Badge tone={settings.executeMode === "plan" ? "neutral" : "warning"}>{settings.executeMode}</Badge>}
            />

            <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-border bg-bg/50 p-3">
              {messages.map((message, index) => <MessageBubble key={`${message.role}-${index}`} message={message} />)}
              {sending ? (
                <div className="flex items-center gap-2 text-sm text-text-3">
                  <Bot size={16} className="animate-pulse" />
                  AI operator is thinking through the safest PM2 path...
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              {suggestedPrompts.map((item) => (
                <button
                  key={item}
                  type="button"
                  className="rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs text-text-2 transition hover:bg-surface-3"
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
                placeholder="Example: check logs and restart only the stopped API process"
                className="min-h-[110px] resize-y"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-text-3">Provider keys are not written to server logs. Critical work stays behind confirmation.</p>
                <Button type="submit" disabled={!canSend}>
                  {settings.executeMode === "plan" ? <Send size={14} /> : <Zap size={14} />}
                  {sending ? "Working..." : settings.executeMode === "plan" ? "Ask AI" : "Ask + run guarded"}
                </Button>
              </div>
            </form>
          </section>

          {(lastActions.length > 0 || lastExecutions.length > 0) && (
            <section className="grid gap-4 lg:grid-cols-2">
              <div className="page-panel space-y-3">
                <PanelHeader title="Prepared actions" description="Review what the AI mapped to the PM2 allowlist." />
                {lastActions.length > 0 ? lastActions.map((action, index) => (
                  <PlannedActionCard key={`${action.actionId}-${index}`} action={action} onRun={runAction} running={runningActionId === action.actionId} />
                )) : <InsetPanel padding="sm" className="text-sm text-text-3">No PM2 actions prepared.</InsetPanel>}
              </div>

              <div className="page-panel space-y-3">
                <PanelHeader title="Execution log" description="Outputs are redacted and truncated before display." />
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
          description="This can disrupt running processes. Confirm only when the target and effect are exactly what you expect."
          confirmLabel="Run critical action"
          confirmVariant="danger"
          onConfirm={confirmCriticalAction}
          onClose={() => setPendingAction(null)}
        />
      )}
    </div>
  );
}
