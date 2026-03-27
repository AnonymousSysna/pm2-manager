import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { processes } from "../api";
import Button from "../components/ui/Button";
import Checkbox from "../components/ui/Checkbox";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Textarea from "../components/ui/Textarea";
import { PageIntro, PanelHeader } from "../components/ui/PageLayout";

const defaultEnvRow = { key: "", value: "" };
const TEMPLATE_STORAGE_KEY = "pm2_process_templates_v1";
const DEFAULT_PROJECTS_ROOT = "/root/pm2-manager/apps/";

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

export default function CreateProcess() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("simple");
  const [mode, setMode] = useState("script");
  const [templates, setTemplates] = useState({});
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [error, setError] = useState("");
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchStartedAt, setLaunchStartedAt] = useState(0);
  const [launchElapsedSec, setLaunchElapsedSec] = useState(0);
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
    envRows: [defaultEnvRow]
  });

  const update = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const updateCloneUrl = (value) => {
    const gitUrl = String(value || "");
    const inferred = inferRepoName(gitUrl);
    setForm((prev) => {
      const next = { ...prev, git_clone_url: gitUrl };
      if (!String(prev.project_path || "").trim()) {
        next.project_path = `${DEFAULT_PROJECTS_ROOT}${inferred}`;
      }
      if (!String(prev.name || "").trim()) {
        next.name = inferred;
      }
      return next;
    });
  };

  useEffect(() => {
    setTemplates(parseTemplateStore(localStorage.getItem(TEMPLATE_STORAGE_KEY)));
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

  const updateEnvRow = (index, key, value) => {
    const next = [...form.envRows];
    next[index] = { ...next[index], [key]: value };
    update("envRows", next);
  };

  const saveTemplate = () => {
    const templateName = (window.prompt("Template name", selectedTemplate || form.name || "") || "").trim();
    if (!templateName) {
      return;
    }
    const templatePayload = {
      mode,
      tab,
      form
    };
    setTemplates((prev) => ({ ...prev, [templateName]: templatePayload }));
    setSelectedTemplate(templateName);
    toast.success(`Saved template: ${templateName}`);
  };

  const loadTemplate = (templateName) => {
    const item = templates[templateName];
    if (!item) {
      return;
    }
    setMode(item.mode || "script");
    setTab(item.tab || "simple");
    setForm((prev) => ({
      ...prev,
      ...item.form,
      envRows: Array.isArray(item.form?.envRows) && item.form.envRows.length > 0
        ? item.form.envRows
        : [{ ...defaultEnvRow }]
    }));
    setSelectedTemplate(templateName);
    toast.success(`Loaded template: ${templateName}`);
  };

  const deleteTemplate = () => {
    if (!selectedTemplate) {
      toast.error("Select a template to delete");
      return;
    }
    if (!window.confirm(`Delete template "${selectedTemplate}"?`)) {
      return;
    }
    setTemplates((prev) => {
      const next = { ...prev };
      delete next[selectedTemplate];
      return next;
    });
    setSelectedTemplate("");
    toast.success("Template deleted");
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");
    if (isLaunching) {
      return;
    }

    if (!form.name.trim()) {
      setError("Process Name is required.");
      return;
    }

    if (mode === "script" && !form.script.trim()) {
      setError("Script Path is required in Script Mode.");
      return;
    }

    if (mode === "project" && !form.project_path.trim()) {
      setError("Project Directory is required in Project Mode.");
      return;
    }

    if (mode === "git" && !form.git_clone_url.trim()) {
      setError("Git clone URL is required in Git Clone Mode.");
      return;
    }

    if (mode === "git" && !form.project_path.trim()) {
      setError("Project Directory is required in Git Clone Mode.");
      return;
    }

    const env = {};
    form.envRows.forEach((row) => {
      if (row.key.trim()) {
        env[row.key.trim()] = row.value;
      }
    });

    const payload = {
      name: form.name,
      script: mode === "script" ? form.script : undefined,
      project_path: mode === "project" || mode === "git" ? form.project_path : undefined,
      git_clone_url: mode === "git" ? form.git_clone_url : undefined,
      git_branch: mode === "git" ? form.git_branch || undefined : undefined,
      env_file_content: mode === "git" ? form.env_file_content : undefined,
      start_script: mode === "project" || mode === "git" ? form.start_script || "start" : undefined,
      install_dependencies: mode === "project" || mode === "git" ? Boolean(form.install_dependencies) : undefined,
      run_build: mode === "project" || mode === "git" ? Boolean(form.run_build) : undefined,
      args: mode === "script" ? form.args || undefined : undefined,
      port: form.port || undefined,
      cwd: mode === "script" ? form.cwd || undefined : undefined,
      watch: form.watch,
      exec_mode: form.exec_mode,
      instances: form.exec_mode === "cluster" ? Number(form.instances || 1) : 1,
      max_memory_restart: tab === "advanced" ? form.max_memory_restart || undefined : undefined,
      node_args: tab === "advanced" ? form.node_args || undefined : undefined,
      interpreter: tab === "advanced" ? form.interpreter || undefined : undefined,
      log_date_format: tab === "advanced" ? form.log_date_format || undefined : undefined,
      env
    };

    try {
      setIsLaunching(true);
      setLaunchStartedAt(Date.now());
      await toast.promise(
        processes.create(payload).then((result) => {
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
      navigate(`/dashboard/logs?process=${encodeURIComponent(form.name)}`);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to launch process");
      setError(message);
    } finally {
      setIsLaunching(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <PageIntro
        title="Create Process"
        description="Define runtime mode, startup behavior, and environment settings with one consistent workflow."
      />

      <div className="page-panel">
        <PanelHeader title="Templates & Mode" className="mb-3" />
        <div className="mb-4 grid gap-2 rounded border border-border bg-surface-2 p-3 md:grid-cols-[1fr,auto,auto,auto]">
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
          <Button type="button" variant="info" onClick={() => setMode("git")}>Git Clone Mode</Button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <ModeButton active={mode === "script"} onClick={() => setMode("script")}>Script Mode</ModeButton>
          <ModeButton active={mode === "project"} onClick={() => setMode("project")}>Project Directory Mode</ModeButton>
          <ModeButton active={mode === "git"} onClick={() => setMode("git")}>Git Clone Mode</ModeButton>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <ModeButton active={tab === "simple"} onClick={() => setTab("simple")}>Simple</ModeButton>
          <ModeButton active={tab === "advanced"} onClick={() => setTab("advanced")}>Advanced</ModeButton>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <Field label="Process Name" required>
            <Input value={form.name} onChange={(e) => update("name", e.target.value)} />
          </Field>

          {mode === "script" && (
            <>
              <Field label="Script Path" required>
                <Input
                  value={form.script}
                  onChange={(e) => update("script", e.target.value)}
                  placeholder="app.js, npm, or /absolute/path/to/app.js"
                />
              </Field>

              <Field label="Arguments">
                <Input value={form.args} onChange={(e) => update("args", e.target.value)} />
              </Field>

              <Field label="Working Directory">
                <Input value={form.cwd} onChange={(e) => update("cwd", e.target.value)} />
              </Field>
            </>
          )}

          {mode === "project" && (
            <>
              <Field label="Project Directory" required>
                <Input
                  value={form.project_path}
                  onChange={(e) => update("project_path", e.target.value)}
                  placeholder="/root/my-app"
                />
              </Field>

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
            </>
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
                  placeholder="/root/pm2-manager/apps/{auto-inferred-from-repo-name}"
                />
              </Field>

              <Field label=".env File Content (Optional)">
                <Textarea
                  value={form.env_file_content}
                  onChange={(e) => update("env_file_content", e.target.value)}
                  placeholder={"NODE_ENV=production\nAPI_KEY=replace_me"}
                  className="min-h-32"
                />
              </Field>

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
                Run npm install after clone
              </label>

              <label className="flex items-center gap-3 text-sm text-text-2">
                <Checkbox
                  checked={form.run_build}
                  onChange={(e) => update("run_build", e.target.checked)}
                />
                Run npm run build after clone
              </label>
            </>
          )}

          <Field label="Port">
            <Input type="number" value={form.port} onChange={(e) => update("port", e.target.value)} />
          </Field>

          <label className="flex items-center gap-3 text-sm text-text-2">
            <Checkbox checked={form.watch} onChange={(e) => update("watch", e.target.checked)} />
            Watch Mode
          </label>

          {tab === "advanced" && (
            <>
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

              <Field label="Max Memory Restart">
                <Input value={form.max_memory_restart} onChange={(e) => update("max_memory_restart", e.target.value)} placeholder="500M" />
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

              <div className="space-y-2">
                <p className="text-sm font-medium text-text-2">Environment Variables</p>
                {form.envRows.map((row, index) => (
                  <div key={`env-${index}`} className="grid grid-cols-[1fr,1fr,auto] gap-2">
                    <Input
                      value={row.key}
                      onChange={(e) => updateEnvRow(index, "key", e.target.value)}
                      placeholder="KEY"
                    />
                    <Input
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
            </>
          )}

          {error && <p className="text-sm text-danger-300">{error}</p>}

          <Button type="submit" variant="success" className="w-full" disabled={isLaunching}>
            {isLaunching ? "Launching..." : "Launch Process"}
          </Button>
        </form>
      </div>

      {isLaunching && (
        <div className="surface-overlay fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface p-5 text-center shadow-xl">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-border border-t-brand-500" />
            <p className="mt-3 text-base font-semibold text-text-1">This may take a moment</p>
            <p className="mt-1 text-sm text-text-3">
              Preparing process, installing dependencies, and starting services.
            </p>
            <p className="mt-1 text-xs text-text-3">Elapsed: {launchElapsedSec}s</p>
            <div className="mt-4">
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

function Field({ label, required, children }) {
  return (
    <label className="block space-y-1 text-sm text-text-2">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}
