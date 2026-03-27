import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast, { getErrorMessage } from "../lib/toast";
import { processes } from "../api";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";

const defaultEnvRow = { key: "", value: "" };

export default function CreateProcess() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("simple");
  const [mode, setMode] = useState("script");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: "",
    script: "",
    project_path: "",
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

  const updateEnvRow = (index, key, value) => {
    const next = [...form.envRows];
    next[index] = { ...next[index], [key]: value };
    update("envRows", next);
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");

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

    const env = {};
    form.envRows.forEach((row) => {
      if (row.key.trim()) {
        env[row.key.trim()] = row.value;
      }
    });

    const payload = {
      name: form.name,
      script: mode === "script" ? form.script : undefined,
      project_path: mode === "project" ? form.project_path : undefined,
      start_script: mode === "project" ? form.start_script || "start" : undefined,
      install_dependencies: mode === "project" ? Boolean(form.install_dependencies) : undefined,
      run_build: mode === "project" ? Boolean(form.run_build) : undefined,
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
      navigate("/dashboard");
    } catch (err) {
      const message = getErrorMessage(err, "Failed to launch process");
      setError(message);
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <div className="page-panel">
        <div className="mb-4 flex flex-wrap gap-2">
          <ModeButton active={mode === "script"} onClick={() => setMode("script")}>Script Mode</ModeButton>
          <ModeButton active={mode === "project"} onClick={() => setMode("project")}>Project Directory Mode</ModeButton>
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
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-500"
                  checked={form.install_dependencies}
                  onChange={(e) => update("install_dependencies", e.target.checked)}
                />
                Run npm install before start
              </label>

              <label className="flex items-center gap-3 text-sm text-text-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-500"
                  checked={form.run_build}
                  onChange={(e) => update("run_build", e.target.checked)}
                />
                Run npm run build before start
              </label>
            </>
          )}

          <Field label="Port">
            <Input type="number" value={form.port} onChange={(e) => update("port", e.target.value)} />
          </Field>

          <label className="flex items-center gap-3 text-sm text-text-2">
            <input type="checkbox" className="h-4 w-4 accent-brand-500" checked={form.watch} onChange={(e) => update("watch", e.target.checked)} />
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

          <Button type="submit" variant="success" className="w-full">
            Launch Process
          </Button>
        </form>
      </div>
    </section>
  );
}

function ModeButton({ active, onClick, children }) {
  return (
    <Button
      type="button"
      variant={active ? "success" : "secondary"}
      onClick={onClick}
      className={active ? "shadow-sm shadow-success-500/30" : ""}
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
