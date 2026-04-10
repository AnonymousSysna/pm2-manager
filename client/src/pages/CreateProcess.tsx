import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { processes } from "../api";
import { useSocket } from "../hooks/useSocket";
import Button from "../components/ui/Button";
import Checkbox from "../components/ui/Checkbox";
import Field from "../components/ui/Field";
import Input from "../components/ui/Input";
import { ConfirmDialog } from "../components/ui/Modal";
import Modal from "../components/ui/Modal";
import Select from "../components/ui/Select";
import Textarea from "../components/ui/Textarea";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";
import { Skeleton } from "../components/ui/Skeleton";

const defaultEnvRow = { key: "", value: "" };
const TEMPLATE_STORAGE_KEY = "pm2_process_templates_v1";
const SENSITIVE_ENV_KEY_PATTERN = /(pass(word)?|secret|token|api[_-]?key|private|credential|auth|pwd)/i;
const GIT_CLONE_SSH_PATTERN = /^(?:ssh:\/\/)?(?:[^@\s]+@)?[^:/\s]+:[^:\s]+$/;
const GIT_CLONE_PROTOCOLS = new Set(["http:", "https:", "ssh:", "git:", "file:"]);

function isSensitiveEnvKey(key) {
  return SENSITIVE_ENV_KEY_PATTERN.test(String(key || ""));
}

function parseTemplateStore(raw) {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch (_error) {
    // Ignore invalid local storage payload.
  }
  return {};
}

function inferRepoName(gitUrl) {
  const cleaned = String(gitUrl || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "");
  const parts = cleaned.split("/");
  return (parts[parts.length - 1] || "app").replace(/[^A-Za-z0-9._-]/g, "-");
}

function validateGitCloneUrl(value) {
  const str = String(value || "").trim();
  if (!str) {
    return "Git clone URL is required in Git Clone Mode.";
  }
  if (str.length > 2048) {
    return "Git clone URL exceeds max length 2048.";
  }
  if (/\s/.test(str)) {
    return "Git clone URL cannot contain whitespace.";
  }

  if (GIT_CLONE_SSH_PATTERN.test(str)) {
    const remotePath = str.split(":").slice(1).join(":");
    if (!remotePath || !remotePath.includes("/")) {
      return "Git clone URL must be a valid git clone URL.";
    }
    return "";
  }

  let parsed;
  try {
    parsed = new URL(str);
  } catch (_error) {
    return "Git clone URL must be a valid git clone URL.";
  }

  if (!GIT_CLONE_PROTOCOLS.has(parsed.protocol)) {
    return "Git clone URL must use http, https, ssh, git, or file protocol.";
  }
  if (parsed.protocol !== "file:" && !parsed.hostname) {
    return "Git clone URL must include a hostname.";
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    return "Git clone URL must include a repository path.";
  }

  return "";
}

function makeCreateOperationId() {
  if (window?.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `create-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatCreateStepLabel(label) {
  return String(label || "")
    .split(":")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" / ");
}

const MAX_MEMORY_RESTART_PATTERN = /^\d+(M|G|K|m|g|k)$/;
const DEFAULT_RUNTIME_HINT = {
  interpreter: "node",
  execMode: "cluster",
  reason: "Node.js app detected"
};

function inferRuntimeHint(mode, form) {
  if (mode === "project" || mode === "git") {
    return DEFAULT_RUNTIME_HINT;
  }

  const script = String(form?.script || "").trim().toLowerCase();
  if (!script) {
    return { interpreter: "node", execMode: "fork", reason: "Set script path to detect runtime" };
  }

  if (/\.(mjs|cjs|js|ts)$/.test(script) || script === "npm" || script === "npm.cmd" || script.endsWith("/npm")) {
    return DEFAULT_RUNTIME_HINT;
  }
  if (script.endsWith(".py")) {
    return { interpreter: "python3", execMode: "fork", reason: "Python script detected" };
  }
  if (script.endsWith(".php")) {
    return { interpreter: "php", execMode: "fork", reason: "PHP script detected" };
  }
  if (script.endsWith(".rb")) {
    return { interpreter: "ruby", execMode: "fork", reason: "Ruby script detected" };
  }
  if (script.endsWith(".pl")) {
    return { interpreter: "perl", execMode: "fork", reason: "Perl script detected" };
  }
  if (script.endsWith(".sh")) {
    return { interpreter: "bash", execMode: "fork", reason: "Shell script detected" };
  }

  return { interpreter: "node", execMode: "fork", reason: "Unknown script type, using safe defaults" };
}

function validateDotEnvContent(content = "") {
  const lines = String(content || "").split(/\r?\n/);
  const errors = [];

  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const equalIndex = withoutExport.indexOf("=");
    if (equalIndex < 1) {
      errors.push({ line: lineNo, reason: "missing KEY=VALUE format" });
      return;
    }

    const key = withoutExport.slice(0, equalIndex).trim();
    const value = withoutExport.slice(equalIndex + 1);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      errors.push({ line: lineNo, reason: "invalid key name" });
      return;
    }

    const valueTrimmed = value.trim();
    if ((valueTrimmed.startsWith("\"") && !valueTrimmed.endsWith("\""))
      || (valueTrimmed.startsWith("'") && !valueTrimmed.endsWith("'"))) {
      errors.push({ line: lineNo, reason: "unclosed quote" });
    }
  });

  return errors;
}

export default function CreateProcess() {
  const navigate = useNavigate();
  const { createStepEvents } = useSocket();
  const [step, setStep] = useState(1);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [mode, setMode] = useState("script");
  const [templates, setTemplates] = useState({});
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [error, setError] = useState("");
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchStartedAt, setLaunchStartedAt] = useState(0);
  const [launchElapsedSec, setLaunchElapsedSec] = useState(0);
  const [createOperationId, setCreateOperationId] = useState("");
  const [revealSensitiveEnv, setRevealSensitiveEnv] = useState(false);
  const [templateDialog, setTemplateDialog] = useState(null);
  const [nodeRuntimeState, setNodeRuntimeState] = useState({
    loading: false,
    data: null
  });
  const [form, setForm] = useState({
    name: "",
    script: "",
    project_path: "",
    git_clone_url: "",
    git_branch: "",
    env_file_content: "",
    start_script: "start",
    install_dependencies: true,
    run_build: false,
    node_version: "",
    auto_install_node: true,
    args: "",
    port: "",
    cwd: "",
    watch: false,
    exec_mode: "fork",
    instances: 1,
    max_memory_restart: "",
    node_args: "",
    interpreter: "node",
    log_date_format: "",
    cron_restart: "",
    envRows: [defaultEnvRow]
  });

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const updateCloneUrl = (value) => {
    const gitUrl = String(value || "");
    const inferred = inferRepoName(gitUrl);
    setForm((prev) => {
      const previousInferred = inferRepoName(prev.git_clone_url);
      const next = { ...prev, git_clone_url: gitUrl };
      if (!String(prev.project_path || "").trim() || String(prev.project_path || "").trim() === previousInferred) {
        next.project_path = inferred;
      }
      if (!String(prev.name || "").trim() || String(prev.name || "").trim() === previousInferred) {
        next.name = inferred;
      }
      return next;
    });
  };

  useEffect(() => {
    setTemplates(parseTemplateStore(localStorage.getItem(TEMPLATE_STORAGE_KEY)));
  }, []);

  useEffect(() => {
    const loadRuntime = async () => {
      try {
        setNodeRuntimeState((prev) => ({ ...prev, loading: true }));
        const result = await processes.nodeRuntimeStatus();
        if (result.success) {
          setNodeRuntimeState({ loading: false, data: result.data || null });
          return;
        }
      } catch (_error) {
        // Optional runtime panel.
      }
      setNodeRuntimeState((prev) => ({ ...prev, loading: false }));
    };
    loadRuntime();
  }, []);

  useEffect(() => {
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(templates));
  }, [templates]);

  useEffect(() => {
    if (!isLaunching || !launchStartedAt) {
      setLaunchElapsedSec(0);
      return undefined;
    }

    const tick = () => {
      setLaunchElapsedSec(Math.max(0, Math.floor((Date.now() - launchStartedAt) / 1000)));
    };

    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isLaunching, launchStartedAt]);

  const templateNames = useMemo(() => Object.keys(templates).sort(), [templates]);
  const runtimeHint = useMemo(() => inferRuntimeHint(mode, form), [mode, form]);
  const maxMemoryRestartError = useMemo(() => {
    const value = String(form.max_memory_restart || "").trim();
    if (!value) {
      return "";
    }
    if (!MAX_MEMORY_RESTART_PATTERN.test(value)) {
      return "Format must match e.g. 256M, 1G, 512K.";
    }
    return "";
  }, [form.max_memory_restart]);
  const envFileValidationErrors = useMemo(
    () => validateDotEnvContent(form.env_file_content),
    [form.env_file_content]
  );
  const liveCreateSteps = useMemo(() => {
    if (!createOperationId) {
      return [];
    }

    const byStepId = new Map();
    const orderedStepIds = [];
    for (const item of createStepEvents) {
      if (String(item?.operationId || "") !== createOperationId) {
        continue;
      }
      const stepId = String(item?.stepId || "");
      if (!stepId) {
        continue;
      }
      if (!byStepId.has(stepId)) {
        orderedStepIds.push(stepId);
      }
      byStepId.set(stepId, item);
    }

    return orderedStepIds.map((stepId) => byStepId.get(stepId)).filter(Boolean);
  }, [createStepEvents, createOperationId]);

  const updateEnvRow = (index, key, value) => {
    const next = [...form.envRows];
    next[index] = { ...next[index], [key]: value };
    update("envRows", next);
  };

  const saveTemplate = () => {
    setTemplateDialog({
      mode: "save",
      value: selectedTemplate || form.name || ""
    });
  };

  const confirmSaveTemplate = () => {
    const templateName = String(templateDialog?.value || "").trim();
    if (!templateName) {
      return;
    }
    const templatePayload = {
      mode,
      showAdvanced,
      form
    };
    setTemplates((prev) => ({ ...prev, [templateName]: templatePayload }));
    setSelectedTemplate(templateName);
    setTemplateDialog(null);
    toast.success(`Saved template: ${templateName}`);
  };

  const loadTemplate = (templateName) => {
    const item = templates[templateName];
    if (!item) {
      return;
    }
    setMode(item.mode || "script");
    setShowAdvanced(Boolean(item.showAdvanced || item.tab === "advanced"));
    setForm((prev) => ({
      ...prev,
      ...item.form,
      envRows: Array.isArray(item.form?.envRows) && item.form.envRows.length > 0
        ? item.form.envRows
        : [{ ...defaultEnvRow }]
    }));
    setStep(1);
    setSelectedTemplate(templateName);
    toast.success(`Loaded template: ${templateName}`);
  };

  const deleteTemplate = () => {
    if (!selectedTemplate) {
      toast.error("Select a template to delete");
      return;
    }
    setTemplateDialog({ mode: "delete" });
  };

  const confirmDeleteTemplate = () => {
    setTemplates((prev) => {
      const next = { ...prev };
      delete next[selectedTemplate];
      return next;
    });
    setSelectedTemplate("");
    setTemplateDialog(null);
    toast.success("Template deleted");
  };

  const applyRuntimeHint = () => {
    setForm((prev) => ({
      ...prev,
      interpreter: runtimeHint.interpreter,
      exec_mode: runtimeHint.execMode,
      instances: runtimeHint.execMode === "cluster" ? Math.max(1, Number(prev.instances || 1)) : 1
    }));
  };

  const validateStepOne = () => {
    if (!form.name.trim()) {
      return "Process Name is required.";
    }
    if (mode === "script" && !form.script.trim()) {
      return "Script Path is required in Script Mode.";
    }
    if (mode === "project" && !form.project_path.trim()) {
      return "Project Directory is required in Project Mode.";
    }
    if (mode === "git") {
      const gitCloneUrlError = validateGitCloneUrl(form.git_clone_url);
      if (gitCloneUrlError) {
        return gitCloneUrlError;
      }
    }
    if (mode === "git" && !form.project_path.trim()) {
      return "Project Directory is required in Git Clone Mode.";
    }
    return "";
  };

  const validateSubmission = () => {
    if (!form.name.trim()) {
      return "Process Name is required.";
    }

    if (mode === "script" && !form.script.trim()) {
      return "Script Path is required in Script Mode.";
    }

    if (mode === "project" && !form.project_path.trim()) {
      return "Project Directory is required in Project Mode.";
    }

    if (mode === "git") {
      const gitCloneUrlError = validateGitCloneUrl(form.git_clone_url);
      if (gitCloneUrlError) {
        return gitCloneUrlError;
      }
    }

    if (mode === "git" && !form.project_path.trim()) {
      return "Project Directory is required in Git Clone Mode.";
    }
    if (showAdvanced && maxMemoryRestartError) {
      return maxMemoryRestartError;
    }
    if (mode === "git" && envFileValidationErrors.length > 0) {
      return `.env content has invalid lines: ${envFileValidationErrors.slice(0, 5).map((item) => item.line).join(", ")}`;
    }
    return "";
  };

  const validateStepTwo = () => {
    if (showAdvanced && maxMemoryRestartError) {
      return maxMemoryRestartError;
    }
    if (mode === "git" && envFileValidationErrors.length > 0) {
      return `.env content has invalid lines: ${envFileValidationErrors.slice(0, 5).map((item) => item.line).join(", ")}`;
    }
    return "";
  };

  const nextStep = () => {
    const validationError = step === 1 ? validateStepOne() : validateStepTwo();
    if (validationError) {
      setError(validationError);
      return;
    }
    setError("");
    setStep((prev) => Math.min(3, prev + 1));
  };

  const prevStep = () => {
    setError("");
    setStep((prev) => Math.max(1, prev - 1));
  };

  const buildPayload = () => {
    const env = {};
    form.envRows.forEach((row) => {
      if (row.key.trim()) {
        env[row.key.trim()] = row.value;
      }
    });

    return {
      name: form.name,
      script: mode === "script" ? form.script : undefined,
      project_path: mode === "project" || mode === "git" ? form.project_path : undefined,
      git_clone_url: mode === "git" ? form.git_clone_url : undefined,
      git_branch: mode === "git" ? form.git_branch || undefined : undefined,
      env_file_content: mode === "git" ? form.env_file_content : undefined,
      start_script: mode === "project" || mode === "git" ? form.start_script || "start" : undefined,
      install_dependencies: mode === "project" || mode === "git" ? Boolean(form.install_dependencies) : undefined,
      run_build: mode === "project" || mode === "git" ? Boolean(form.run_build) : undefined,
      node_version: mode === "project" || mode === "git" ? String(form.node_version || "").trim() || undefined : undefined,
      auto_install_node: mode === "project" || mode === "git"
        ? Boolean(form.auto_install_node && String(form.node_version || "").trim())
        : undefined,
      args: mode === "script" ? form.args || undefined : undefined,
      port: form.port || undefined,
      cwd: mode === "script" ? form.cwd || undefined : undefined,
      watch: form.watch,
      exec_mode: form.exec_mode,
      instances: form.exec_mode === "cluster" ? Number(form.instances || 1) : 1,
      max_memory_restart: showAdvanced ? form.max_memory_restart || undefined : undefined,
      node_args: showAdvanced ? form.node_args || undefined : undefined,
      interpreter: showAdvanced ? form.interpreter || undefined : undefined,
      log_date_format: showAdvanced ? form.log_date_format || undefined : undefined,
      cron_restart: showAdvanced ? String(form.cron_restart || "").trim() || undefined : undefined,
      env
    };
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (isLaunching) {
      return;
    }

    const validationError = validateSubmission();
    if (validationError) {
      setError(validationError);
      return;
    }

    const payload = buildPayload();

    try {
      setIsLaunching(true);
      setLaunchStartedAt(Date.now());
      const operationId = makeCreateOperationId();
      setCreateOperationId(operationId);
      const result = await toast.promise(
        processes.create({
          ...payload,
          create_operation_id: operationId
        }).then((result) => {
          if (!result.success) {
            throw new Error(result.error || "Unable to create process");
          }
          return result;
        }),
        {
          loading: "Launching process...",
          success: "Process launched",
          error: (error) => getErrorMessage(error, "Failed to launch process")
        }
      );
      sessionStorage.setItem(
        "pm2_last_create",
        JSON.stringify({
          processName: form.name,
          ts: Date.now(),
          details: result?.data || null
        })
      );
      navigate(`/dashboard/logs?process=${encodeURIComponent(form.name)}&source=create`);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to launch process");
      setError(message);
    } finally {
      setIsLaunching(false);
      setCreateOperationId("");
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <PageIntro
        title="Create Process"
        description="Define runtime mode, startup behavior, and environment settings with one consistent workflow."
      />

      <div className="page-panel">
        <PanelHeader title="Guided Setup" className="mb-3" />

        <div className="mb-4 grid gap-2 rounded border border-border bg-surface-2 p-3 md:grid-cols-[1fr,auto,auto]">
          <Select value={selectedTemplate} onChange={(e) => {
            const value = e.target.value;
            setSelectedTemplate(value);
            if (value) {
              loadTemplate(value);
            }
          }}>
            <option value="">Select process template</option>
            {templateNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
          <Button type="button" variant="secondary" onClick={saveTemplate}>Save Template</Button>
          <Button type="button" variant="danger" onClick={deleteTemplate} disabled={!selectedTemplate}>Delete Template</Button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <StepBadge active={step === 1} done={step > 1}>1. Source</StepBadge>
          <StepBadge active={step === 2} done={step > 2}>2. Runtime</StepBadge>
          <StepBadge active={step === 3}>3. Review</StepBadge>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {step === 1 && (
            <>
              <div className="rounded border border-border bg-surface-2 p-3">
                <p className="mb-2 text-sm font-medium text-text-2">Choose Source Type</p>
                <div className="flex flex-wrap gap-2">
                  <ModeButton active={mode === "script"} onClick={() => setMode("script")}>Script Path</ModeButton>
                  <ModeButton active={mode === "project"} onClick={() => setMode("project")}>Project Directory</ModeButton>
                  <ModeButton active={mode === "git"} onClick={() => setMode("git")}>Git Clone</ModeButton>
                </div>
              </div>

              <Field label="Process Name" required>
                <Input value={form.name} onChange={(e) => update("name", e.target.value)} placeholder="my-app" />
              </Field>

              {mode === "script" && (
                <Field label="Script Path" required>
                  <Input
                    value={form.script}
                    onChange={(e) => update("script", e.target.value)}
                    placeholder="app.js, npm, or /absolute/path/to/app.py"
                  />
                </Field>
              )}

              {mode === "project" && (
                <Field label="Project Directory" required>
                  <Input
                    value={form.project_path}
                    onChange={(e) => update("project_path", e.target.value)}
                    placeholder="/root/my-app"
                  />
                </Field>
              )}

              {mode === "git" && (
                <>
                  <Field label="Git Clone URL" required>
                    <Input
                      value={form.git_clone_url}
                      onChange={(e) => updateCloneUrl(e.target.value)}
                      placeholder="https://github.com/org/repo.git"
                    />
                  </Field>

                  <Field label="Git Branch (Optional)">
                    <Input
                      value={form.git_branch}
                      onChange={(e) => update("git_branch", e.target.value)}
                      placeholder="main"
                    />
                  </Field>

                  <Field label="Project Directory" required>
                    <Input
                      value={form.project_path}
                      onChange={(e) => update("project_path", e.target.value)}
                      placeholder="repo-name or relative/path/inside/allowed/root"
                    />
                  </Field>

                  <Field label=".env File Content (Optional)">
                    <Textarea
                      value={form.env_file_content}
                      onChange={(e) => update("env_file_content", e.target.value)}
                      placeholder={"NODE_ENV=production\nAPI_KEY=replace_me"}
                      className="min-h-32"
                    />
                    {envFileValidationErrors.length > 0 ? (
                      <p className="mt-1 text-xs text-danger-300">
                        Invalid `.env` syntax on line(s): {envFileValidationErrors.slice(0, 5).map((item) => item.line).join(", ")}.
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-text-3">Validated live while typing (`KEY=VALUE`).</p>
                    )}
                  </Field>
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <div className="rounded border border-border bg-surface-2 p-3">
                <p className="text-sm font-medium text-text-2">Recommended Runtime</p>
                <p className="text-sm text-text-3">
                  {runtimeHint.reason}
                  {" -> "}
                  interpreter <code>{runtimeHint.interpreter}</code>, mode <code>{runtimeHint.execMode}</code>
                </p>
                <div className="mt-2">
                  <Button type="button" variant="info" size="sm" onClick={applyRuntimeHint}>
                    Apply Recommendation
                  </Button>
                </div>
              </div>

              {mode === "script" && (
                <>
                  <Field label="Arguments">
                    <Input value={form.args} onChange={(e) => update("args", e.target.value)} />
                  </Field>
                  <Field label="Working Directory">
                    <Input value={form.cwd} onChange={(e) => update("cwd", e.target.value)} />
                  </Field>
                </>
              )}

              {(mode === "project" || mode === "git") && (
                <>
                  <Field label="Start Script">
                    <Input
                      value={form.start_script}
                      onChange={(e) => update("start_script", e.target.value)}
                      placeholder="start"
                    />
                  </Field>
                  <label className="flex items-center gap-3 text-sm text-text-2">
                    <Checkbox
                      checked={form.install_dependencies}
                      onChange={(e) => update("install_dependencies", e.target.checked)}
                    />
                    Run npm install before start
                  </label>
                  <label className="flex items-center gap-3 text-sm text-text-2">
                    <Checkbox
                      checked={form.run_build}
                      onChange={(e) => update("run_build", e.target.checked)}
                    />
                    Run npm run build before start
                  </label>
                  <Field label="Node Version (Optional)">
                    <Input
                      value={form.node_version}
                      onChange={(e) => update("node_version", e.target.value)}
                      placeholder="20, 20.12, or 20.12.2"
                    />
                    <p className="mt-1 text-xs text-text-3">
                      If set, install/build/start uses this Node runtime version (good for avoiding old-node build failures).
                    </p>
                  </Field>
                  {String(form.node_version || "").trim() && (
                    <label className="flex items-center gap-3 text-sm text-text-2">
                      <Checkbox
                        checked={form.auto_install_node}
                        onChange={(e) => update("auto_install_node", e.target.checked)}
                      />
                      Auto-install Node version if missing
                    </label>
                  )}
                  <div className="rounded border border-border bg-surface p-2 text-xs text-text-3">
                    {nodeRuntimeState.loading ? (
                      <div className="space-y-2" aria-hidden="true">
                        <Skeleton className="h-3 w-32" />
                        <Skeleton className="h-3 w-5/6" />
                      </div>
                    ) : (
                      <>
                        <p>
                          Host Node: <span className="text-text-2">{nodeRuntimeState.data?.systemNode?.version || "-"}</span>
                        </p>
                        <p className="mt-1">
                          Managers: {Array.isArray(nodeRuntimeState.data?.managers)
                            ? nodeRuntimeState.data.managers
                              .map((item) => `${item.displayName} (${item.installed ? "installed" : "missing"})`)
                              .join(", ")
                            : "-"}
                        </p>
                      </>
                    )}
                  </div>
                </>
              )}

              <Field label="Port">
                <Input type="number" value={form.port} onChange={(e) => update("port", e.target.value)} />
              </Field>

              <label className="flex items-center gap-3 text-sm text-text-2">
                <Checkbox checked={form.watch} onChange={(e) => update("watch", e.target.checked)} />
                Watch Mode
              </label>

              <Field label="Exec Mode">
                <Select value={form.exec_mode} onChange={(e) => update("exec_mode", e.target.value)}>
                  <option value="fork">fork</option>
                  <option value="cluster">cluster</option>
                </Select>
              </Field>

              {form.exec_mode === "cluster" && (
                <Field label="Instances">
                  <Input type="number" value={form.instances} onChange={(e) => update("instances", e.target.value)} min={1} />
                </Field>
              )}

              <div className="rounded border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-text-2">Advanced Settings</p>
                  <Button type="button" variant="secondary" size="sm" onClick={() => setShowAdvanced((prev) => !prev)}>
                    {showAdvanced ? "Hide Advanced" : "Show Advanced"}
                  </Button>
                </div>

                {showAdvanced && (
                  <div className="mt-3 space-y-3">
                    <Field label="Max Memory Restart">
                      <Input
                        value={form.max_memory_restart}
                        onChange={(e) => update("max_memory_restart", e.target.value)}
                        placeholder="500M"
                      />
                      {maxMemoryRestartError ? (
                        <p className="mt-1 text-xs text-danger-300">{maxMemoryRestartError}</p>
                      ) : (
                        <p className="mt-1 text-xs text-text-3">Format: number + `K`, `M`, or `G`.</p>
                      )}
                    </Field>

                    <Field label="Node Args">
                      <Input value={form.node_args} onChange={(e) => update("node_args", e.target.value)} />
                    </Field>

                    <Field label="Interpreter">
                      <Input value={form.interpreter} onChange={(e) => update("interpreter", e.target.value)} />
                    </Field>

                    <Field label="Log Date Format">
                      <Input value={form.log_date_format} onChange={(e) => update("log_date_format", e.target.value)} />
                    </Field>

                    <Field label="Cron Restart (optional)">
                      <Input
                        value={form.cron_restart}
                        onChange={(e) => update("cron_restart", e.target.value)}
                        placeholder="0 4 * * *"
                      />
                      <p className="mt-1 text-xs text-text-3">Leave blank to disable scheduled restart.</p>
                    </Field>

                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-text-2">Environment Variables</p>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => setRevealSensitiveEnv((prev) => !prev)}
                        >
                          {revealSensitiveEnv ? "Mask Sensitive Values" : "Reveal Sensitive Values"}
                        </Button>
                      </div>
                      {form.envRows.map((row, index) => (
                        <div key={`env-${index}`} className="grid grid-cols-[1fr,1fr,auto] gap-2">
                          <Input
                            value={row.key}
                            onChange={(e) => updateEnvRow(index, "key", e.target.value)}
                            placeholder="KEY"
                          />
                          <Input
                            type={isSensitiveEnvKey(row.key) && !revealSensitiveEnv ? "password" : "text"}
                            value={row.value}
                            onChange={(e) => updateEnvRow(index, "value", e.target.value)}
                            placeholder="VALUE"
                          />
                          <Button
                            type="button"
                            variant="danger"
                            onClick={() => update("envRows", form.envRows.filter((_, i) => i !== index))}
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => update("envRows", [...form.envRows, { ...defaultEnvRow }])}
                      >
                        Add Variable
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="rounded border border-border bg-surface-2 p-3">
                <p className="text-sm font-medium text-text-2">Review</p>
                <p className="text-sm text-text-3">Check generated config before launch.</p>
              </div>
              <pre className="max-h-96 overflow-auto rounded border border-border bg-surface-2 p-3 text-xs text-text-2">
                {JSON.stringify(buildPayload(), null, 2)}
              </pre>
            </div>
          )}

          {error && <p className="text-sm text-danger-300">{error}</p>}

          {isLaunching && (
            <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-sm text-text-2">
              Launch in progress. Keep this page open. Elapsed: {launchElapsedSec}s
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-2">
            <Button type="button" variant="secondary" onClick={prevStep} disabled={step === 1 || isLaunching}>
              Back
            </Button>
            {step < 3 ? (
              <Button type="button" variant="info" onClick={nextStep} disabled={isLaunching}>
                Continue
              </Button>
            ) : (
              <Button
                type="submit"
                variant="success"
                disabled={isLaunching || (showAdvanced && Boolean(maxMemoryRestartError)) || (mode === "git" && envFileValidationErrors.length > 0)}
              >
                {isLaunching ? "Launching..." : "Launch Process"}
              </Button>
            )}
          </div>
        </form>
      </div>

      {isLaunching && (
        <div className="surface-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-xl">
            <div className="mx-auto w-full max-w-xs space-y-2" aria-hidden="true">
              <Skeleton className="mx-auto h-3 w-20 rounded-full" />
              <Skeleton className="h-3 w-full" />
            </div>
            <p className="mt-3 text-center text-base font-semibold text-text-1">This may take a moment</p>
            <p className="mt-1 text-center text-sm text-text-3">
              Preparing process, installing dependencies, and starting services.
            </p>
            <p className="mt-1 text-center text-xs text-text-3">Elapsed: {launchElapsedSec}s</p>
            <div className="mt-4 rounded-md border border-border bg-surface-2 p-3">
              <p className="mb-2 text-xs font-semibold text-text-2">Live Steps</p>
              <div className="max-h-48 space-y-1 overflow-y-auto">
                {liveCreateSteps.length === 0 && (
                  <p className="text-xs text-text-3">Waiting for first server step...</p>
                )}
                {liveCreateSteps.map((step) => {
                  const status = String(step.status || "").trim();
                  const tone = status === "success"
                    ? "text-success-300"
                    : status === "error"
                      ? "text-danger-300"
                      : "text-warning-300";
                  const symbol = status === "success" ? "OK" : status === "error" ? "ERR" : "...";
                  return (
                    <div key={String(step.stepId || step.label || "")} className="rounded border border-border bg-surface px-2 py-1 text-xs">
                      <p className={`font-semibold ${tone}`}>
                        [{symbol}] {formatCreateStepLabel(step.label)}
                      </p>
                      {Number.isFinite(Number(step.durationMs)) && status !== "started" && (
                        <p className="text-text-3">Duration: {Math.max(0, Number(step.durationMs))}ms</p>
                      )}
                      {status === "error" && step.error && (
                        <p className="text-danger-300">{String(step.error)}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="mt-4 text-center">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => navigate(`/dashboard/logs?process=${encodeURIComponent(form.name || "")}`)}
                disabled={!String(form.name || "").trim()}
              >
                Open Logs
              </Button>
            </div>
          </div>
        </div>
      )}

      {templateDialog?.mode === "save" && (
        <Modal
          title="Save Template"
          description="Save the current create-process configuration as a reusable template."
          onClose={() => setTemplateDialog(null)}
          size="sm"
          actions={(
            <>
              <Button type="button" variant="secondary" onClick={() => setTemplateDialog(null)}>
                Cancel
              </Button>
              <Button type="button" variant="success" onClick={confirmSaveTemplate} disabled={!String(templateDialog?.value || "").trim()}>
                Save Template
              </Button>
            </>
          )}
        >
          <Field label="Template Name" required>
            <Input
              value={templateDialog.value}
              onChange={(event) => setTemplateDialog((prev) => ({ ...prev, value: event.target.value }))}
              placeholder="my-app-template"
            />
          </Field>
        </Modal>
      )}

      {templateDialog?.mode === "delete" && (
        <ConfirmDialog
          title="Delete Template"
          description={`Delete template "${selectedTemplate}"? This cannot be undone.`}
          confirmLabel="Delete Template"
          onClose={() => setTemplateDialog(null)}
          onConfirm={confirmDeleteTemplate}
        />
      )}
    </section>
  );
}

function ModeButton({ active, onClick, children }) {
  return (
    <Button
      type="button"
      variant={active ? "success" : "secondary"}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function StepBadge({ active, done, children }) {
  return (
    <span
      className={[
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
        active
          ? "bg-brand-500/20 text-brand-400"
          : done
            ? "bg-success-500/20 text-success-300"
            : "bg-surface-2 text-text-3"
      ].join(" ")}
    >
      {children}
    </span>
  );
}

