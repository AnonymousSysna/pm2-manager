import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { processes } from "../api";

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
      const result = await processes.create(payload);
      if (!result.success) {
        throw new Error(result.error || "Unable to create process");
      }
      toast.success("Process launched");
      navigate("/dashboard");
    } catch (err) {
      const message = err?.response?.data?.error || err.message || "Failed to launch process";
      setError(message);
      toast.error(message);
    }
  };

  return (
    <div className="mx-auto max-w-3xl rounded-lg bg-slate-900 p-5">
      <div className="mb-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("script")}
          className={`rounded px-4 py-2 text-sm ${mode === "script" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-300"}`}
        >
          Script Mode
        </button>
        <button
          type="button"
          onClick={() => setMode("project")}
          className={`rounded px-4 py-2 text-sm ${mode === "project" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-300"}`}
        >
          Project Directory Mode
        </button>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setTab("simple")}
          className={`rounded px-4 py-2 text-sm ${tab === "simple" ? "bg-green-500/20 text-green-300" : "bg-slate-800 text-slate-300"}`}
        >
          Simple
        </button>
        <button
          type="button"
          onClick={() => setTab("advanced")}
          className={`rounded px-4 py-2 text-sm ${tab === "advanced" ? "bg-green-500/20 text-green-300" : "bg-slate-800 text-slate-300"}`}
        >
          Advanced
        </button>
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="Process Name" required>
          <input value={form.name} onChange={(e) => update("name", e.target.value)} className="input" />
        </Field>

        {mode === "script" && (
          <>
            <Field label="Script Path" required>
              <input
                value={form.script}
                onChange={(e) => update("script", e.target.value)}
                placeholder="app.js, npm, or /absolute/path/to/app.js"
                className="input"
              />
            </Field>

            <Field label="Arguments">
              <input value={form.args} onChange={(e) => update("args", e.target.value)} className="input" />
            </Field>

            <Field label="Working Directory">
              <input value={form.cwd} onChange={(e) => update("cwd", e.target.value)} className="input" />
            </Field>
          </>
        )}

        {mode === "project" && (
          <>
            <Field label="Project Directory" required>
              <input
                value={form.project_path}
                onChange={(e) => update("project_path", e.target.value)}
                placeholder="/root/my-app"
                className="input"
              />
            </Field>

            <Field label="Start Script">
              <input
                value={form.start_script}
                onChange={(e) => update("start_script", e.target.value)}
                placeholder="start"
                className="input"
              />
            </Field>

            <label className="flex items-center gap-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={form.install_dependencies}
                onChange={(e) => update("install_dependencies", e.target.checked)}
              />
              Run npm install before start
            </label>

            <label className="flex items-center gap-3 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={form.run_build}
                onChange={(e) => update("run_build", e.target.checked)}
              />
              Run npm run build before start
            </label>
          </>
        )}

        <Field label="Port">
          <input type="number" value={form.port} onChange={(e) => update("port", e.target.value)} className="input" />
        </Field>

        <label className="flex items-center gap-3 text-sm text-slate-200">
          <input type="checkbox" checked={form.watch} onChange={(e) => update("watch", e.target.checked)} />
          Watch Mode
        </label>

        {tab === "advanced" && (
          <>
            <Field label="Exec Mode">
              <select value={form.exec_mode} onChange={(e) => update("exec_mode", e.target.value)} className="input">
                <option value="fork">fork</option>
                <option value="cluster">cluster</option>
              </select>
            </Field>

            {form.exec_mode === "cluster" && (
              <Field label="Instances">
                <input type="number" value={form.instances} onChange={(e) => update("instances", e.target.value)} className="input" min={1} />
              </Field>
            )}

            <Field label="Max Memory Restart">
              <input value={form.max_memory_restart} onChange={(e) => update("max_memory_restart", e.target.value)} placeholder="500M" className="input" />
            </Field>

            <Field label="Node Args">
              <input value={form.node_args} onChange={(e) => update("node_args", e.target.value)} className="input" />
            </Field>

            <Field label="Interpreter">
              <input value={form.interpreter} onChange={(e) => update("interpreter", e.target.value)} className="input" />
            </Field>

            <Field label="Log Date Format">
              <input value={form.log_date_format} onChange={(e) => update("log_date_format", e.target.value)} className="input" />
            </Field>

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-200">Environment Variables</p>
              {form.envRows.map((row, index) => (
                <div key={`env-${index}`} className="grid grid-cols-[1fr,1fr,auto] gap-2">
                  <input
                    value={row.key}
                    onChange={(e) => updateEnvRow(index, "key", e.target.value)}
                    placeholder="KEY"
                    className="input"
                  />
                  <input
                    value={row.value}
                    onChange={(e) => updateEnvRow(index, "value", e.target.value)}
                    placeholder="VALUE"
                    className="input"
                  />
                  <button
                    type="button"
                    onClick={() => update("envRows", form.envRows.filter((_, i) => i !== index))}
                    className="rounded bg-rose-700 px-3 py-2 text-sm"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => update("envRows", [...form.envRows, { ...defaultEnvRow }])}
                className="rounded bg-slate-700 px-3 py-2 text-sm"
              >
                Add Variable
              </button>
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button type="submit" className="w-full rounded bg-green-600 px-4 py-3 font-medium text-white hover:bg-green-500">
          Launch Process
        </button>
      </form>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block space-y-1 text-sm text-slate-200">
      <span>
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}
