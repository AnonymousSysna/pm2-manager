const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");
const PROJECTS_ROOT = path.resolve(process.env.PROJECTS_ROOT || process.cwd());
const TARGET_PATTERN = /^[A-Za-z0-9:_./@-]{1,120}$/;
const SIGNAL_PATTERN = /^SIG[A-Z0-9]+$/;
const FEATURE_NAME_PATTERN = /^[A-Za-z0-9:_./@-]{1,120}$/;
const MODULE_NAME_PATTERN = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]{1,120}$/;
const CONFIG_FILE_PATTERN = /^[A-Za-z0-9_./@-]{1,240}$/;
const ENVIRONMENT_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;
const CONFIG_KEY_PATTERN = /^[A-Za-z0-9_.:-]{1,160}$/;
const DEPLOY_ACTIONS = new Set(["setup", "update", "revert", "exec", "list"]);
const SIGNALS = ["SIGINT", "SIGTERM", "SIGUSR1", "SIGUSR2", "SIGHUP"];

const featureCategories = [
  {
    id: "observe",
    label: "Observe",
    summary: "Current state, raw JSON, process detail, PID, environment, PM2 config, and support reports."
  },
  {
    id: "lifecycle",
    label: "Lifecycle",
    summary: "Start, stop, restart, reload, graceful reload, reset counters, delete, send signal, trigger actions, and scale."
  },
  {
    id: "logs",
    label: "Logs",
    summary: "Tail, flush, and reopen PM2-managed stdout/stderr logs."
  },
  {
    id: "persistence",
    label: "Persistence",
    summary: "Save, resurrect, startup, unstartup, daemon update, and daemon kill flows."
  },
  {
    id: "ecosystem",
    label: "Ecosystem",
    summary: "Generate ecosystem files and run start-or-restart/reload/graceful-reload flows from config."
  },
  {
    id: "deploy",
    label: "Deploy",
    summary: "Expose PM2 deploy actions for existing ecosystem deployment blocks."
  },
  {
    id: "modules",
    label: "Modules",
    summary: "Install/uninstall PM2 modules and read/write module configuration values."
  }
];

const pm2Features = [
  {
    id: "status",
    category: "observe",
    label: "Status table",
    commandPreview: "pm2 status",
    risk: "read",
    fields: [],
    build: () => ["status"]
  },
  {
    id: "jlist",
    category: "observe",
    label: "Raw process JSON",
    commandPreview: "pm2 jlist",
    risk: "read",
    parseJson: true,
    fields: [],
    build: () => ["jlist"]
  },
  {
    id: "prettylist",
    category: "observe",
    label: "Pretty process list",
    commandPreview: "pm2 prettylist",
    risk: "read",
    fields: [],
    build: () => ["prettylist"]
  },
  {
    id: "describe",
    category: "observe",
    label: "Describe process",
    commandPreview: "pm2 describe <target>",
    risk: "read",
    fields: [targetField("Process name or id")],
    build: (payload) => ["describe", sanitizeTarget(payload.target, { allowAll: false })]
  },
  {
    id: "pid",
    category: "observe",
    label: "Show PID",
    commandPreview: "pm2 pid <target>",
    risk: "read",
    fields: [targetField("Process name, id, or all", "all")],
    build: (payload) => ["pid", sanitizeTarget(payload.target, { allowAll: true })]
  },
  {
    id: "env",
    category: "observe",
    label: "Show process env",
    commandPreview: "pm2 env <id|name>",
    risk: "sensitive-read",
    fields: [targetField("Process name or id")],
    outputLimit: 12_000,
    build: (payload) => ["env", sanitizeTarget(payload.target, { allowAll: false })]
  },
  {
    id: "conf",
    category: "observe",
    label: "PM2 config",
    commandPreview: "pm2 conf",
    risk: "read",
    fields: [],
    build: () => ["conf"]
  },
  {
    id: "report",
    category: "observe",
    label: "Support report",
    commandPreview: "pm2 report",
    risk: "sensitive-read",
    outputLimit: 16_000,
    fields: [],
    build: () => ["report"]
  },
  {
    id: "ping",
    category: "observe",
    label: "Ping daemon",
    commandPreview: "pm2 ping",
    risk: "read",
    fields: [],
    build: () => ["ping"]
  },
  {
    id: "version",
    category: "observe",
    label: "PM2 version",
    commandPreview: "pm2 -v",
    risk: "read",
    fields: [],
    build: () => ["-v"]
  },
  {
    id: "start-existing",
    category: "lifecycle",
    label: "Start stopped process",
    commandPreview: "pm2 start <target>",
    risk: "write",
    fields: [targetField("Process name or id")],
    build: (payload) => ["start", sanitizeTarget(payload.target, { allowAll: false })]
  },
  {
    id: "stop",
    category: "lifecycle",
    label: "Stop process",
    commandPreview: "pm2 stop <target>",
    risk: "write",
    fields: [targetField("Process name, id, or all", "all")],
    build: (payload) => ["stop", sanitizeTarget(payload.target, { allowAll: true })]
  },
  {
    id: "restart",
    category: "lifecycle",
    label: "Restart process",
    commandPreview: "pm2 restart <target>",
    risk: "write",
    fields: [targetField("Process name, id, or all", "all")],
    build: (payload) => ["restart", sanitizeTarget(payload.target, { allowAll: true })]
  },
  {
    id: "restart-update-env",
    category: "lifecycle",
    label: "Restart + update env",
    commandPreview: "pm2 restart <target> --update-env",
    risk: "write",
    fields: [targetField("Process name, id, or all", "all")],
    build: (payload) => ["restart", sanitizeTarget(payload.target, { allowAll: true }), "--update-env"]
  },
  {
    id: "reload",
    category: "lifecycle",
    label: "Zero-downtime reload",
    commandPreview: "pm2 reload <target>",
    risk: "write",
    fields: [targetField("Process name, id, or all", "all")],
    build: (payload) => ["reload", sanitizeTarget(payload.target, { allowAll: true })]
  },
  {
    id: "graceful-reload",
    category: "lifecycle",
    label: "Graceful reload",
    commandPreview: "pm2 gracefulReload <target>",
    risk: "write",
    fields: [targetField("Process name, id, or all", "all")],
    build: (payload) => ["gracefulReload", sanitizeTarget(payload.target, { allowAll: true })]
  },
  {
    id: "reset",
    category: "lifecycle",
    label: "Reset restart counter",
    commandPreview: "pm2 reset <target>",
    risk: "write",
    fields: [targetField("Process name, id, or all", "all")],
    build: (payload) => ["reset", sanitizeTarget(payload.target, { allowAll: true })]
  },
  {
    id: "delete",
    category: "lifecycle",
    label: "Delete from PM2 list",
    commandPreview: "pm2 delete <target>",
    risk: "critical",
    fields: [targetField("Process name, id, or all", "all")],
    build: (payload) => ["delete", sanitizeTarget(payload.target, { allowAll: true })]
  },
  {
    id: "scale",
    category: "lifecycle",
    label: "Scale cluster",
    commandPreview: "pm2 scale <app> <instances>",
    risk: "write",
    fields: [targetField("Cluster app name"), numberField("instances", "Instances", "2", { min: 0, max: 64 })],
    build: (payload) => ["scale", sanitizeTarget(payload.target, { allowAll: false }), String(readInteger(payload.instances, "instances", 0, 64))]
  },
  {
    id: "send-signal",
    category: "lifecycle",
    label: "Send signal",
    commandPreview: "pm2 sendSignal <signal> <target>",
    risk: "critical",
    fields: [selectField("signal", "Signal", SIGNALS, "SIGTERM"), targetField("Process name, id, or all", "all")],
    build: (payload) => ["sendSignal", sanitizeSignal(payload.signal), sanitizeTarget(payload.target, { allowAll: true })]
  },
  {
    id: "trigger",
    category: "lifecycle",
    label: "Trigger custom action",
    commandPreview: "pm2 trigger <process> <action> [params]",
    risk: "write",
    fields: [targetField("Process name", ""), textField("actionName", "Action name"), textField("params", "Optional params", "")],
    build: (payload) => {
      const args = ["trigger", sanitizeTarget(payload.target, { allowAll: false }), sanitizeFeatureName(payload.actionName, "action name")];
      const params = String(payload.params || "").trim();
      if (params) {
        args.push(sanitizeParams(params));
      }
      return args;
    }
  },
  {
    id: "tail-logs",
    category: "logs",
    label: "Tail logs once",
    commandPreview: "pm2 logs <target> --lines <n> --nostream",
    risk: "sensitive-read",
    fields: [targetField("Process name, id, or all", "all"), numberField("lines", "Lines", "100", { min: 1, max: 2000 })],
    outputLimit: 20_000,
    build: (payload) => ["logs", sanitizeTarget(payload.target, { allowAll: true }), "--lines", String(readInteger(payload.lines, "lines", 1, 2000)), "--nostream", "--raw"]
  },
  {
    id: "flush-logs",
    category: "logs",
    label: "Flush logs",
    commandPreview: "pm2 flush <target>",
    risk: "write",
    fields: [targetField("Process name, id, or all", "all")],
    build: (payload) => ["flush", sanitizeTarget(payload.target, { allowAll: true })]
  },
  {
    id: "reload-logs",
    category: "logs",
    label: "Reopen log files",
    commandPreview: "pm2 reloadLogs",
    risk: "write",
    fields: [],
    build: () => ["reloadLogs"]
  },
  {
    id: "save",
    category: "persistence",
    label: "Save current process list",
    commandPreview: "pm2 save",
    risk: "write",
    fields: [],
    build: () => ["save"]
  },
  {
    id: "resurrect",
    category: "persistence",
    label: "Resurrect saved process list",
    commandPreview: "pm2 resurrect",
    risk: "critical",
    fields: [],
    build: () => ["resurrect"]
  },
  {
    id: "startup",
    category: "persistence",
    label: "Generate startup command",
    commandPreview: "pm2 startup",
    risk: "critical",
    outputLimit: 12_000,
    fields: [],
    build: () => ["startup"]
  },
  {
    id: "unstartup",
    category: "persistence",
    label: "Remove startup hook",
    commandPreview: "pm2 unstartup",
    risk: "critical",
    outputLimit: 12_000,
    fields: [],
    build: () => ["unstartup"]
  },
  {
    id: "update-daemon",
    category: "persistence",
    label: "Update PM2 daemon",
    commandPreview: "pm2 update",
    risk: "critical",
    fields: [],
    build: () => ["update"]
  },
  {
    id: "kill-daemon",
    category: "persistence",
    label: "Kill PM2 daemon",
    commandPreview: "pm2 kill",
    risk: "critical",
    fields: [],
    build: () => ["kill"]
  },
  {
    id: "ecosystem-simple",
    category: "ecosystem",
    label: "Generate simple ecosystem file",
    commandPreview: "pm2 ecosystem simple",
    risk: "write",
    outputLimit: 12_000,
    fields: [],
    build: () => ["ecosystem", "simple"]
  },
  {
    id: "ecosystem-full",
    category: "ecosystem",
    label: "Generate ecosystem file",
    commandPreview: "pm2 ecosystem",
    risk: "write",
    outputLimit: 12_000,
    fields: [],
    build: () => ["ecosystem"]
  },
  {
    id: "start-or-restart",
    category: "ecosystem",
    label: "Start or restart config",
    commandPreview: "pm2 startOrRestart <ecosystem> [--env env]",
    risk: "write",
    fields: [configFileField(), textField("environment", "Environment", "production")],
    build: (payload) => withOptionalEnv(["startOrRestart", sanitizeConfigFile(payload.configFile)], payload.environment)
  },
  {
    id: "start-or-reload",
    category: "ecosystem",
    label: "Start or reload config",
    commandPreview: "pm2 startOrReload <ecosystem> [--env env]",
    risk: "write",
    fields: [configFileField(), textField("environment", "Environment", "production")],
    build: (payload) => withOptionalEnv(["startOrReload", sanitizeConfigFile(payload.configFile)], payload.environment)
  },
  {
    id: "start-or-graceful-reload",
    category: "ecosystem",
    label: "Start or graceful reload config",
    commandPreview: "pm2 startOrGracefulReload <ecosystem> [--env env]",
    risk: "write",
    fields: [configFileField(), textField("environment", "Environment", "production")],
    build: (payload) => withOptionalEnv(["startOrGracefulReload", sanitizeConfigFile(payload.configFile)], payload.environment)
  },
  {
    id: "deploy",
    category: "deploy",
    label: "Run PM2 deploy action",
    commandPreview: "pm2 deploy <ecosystem> <env> <action>",
    risk: "critical",
    outputLimit: 20_000,
    timeoutMs: 10 * 60 * 1000,
    fields: [configFileField(), textField("environment", "Environment", "production"), selectField("deployAction", "Deploy action", Array.from(DEPLOY_ACTIONS), "update")],
    build: (payload) => ["deploy", sanitizeConfigFile(payload.configFile), sanitizeEnvironment(payload.environment), sanitizeDeployAction(payload.deployAction)]
  },
  {
    id: "module-install",
    category: "modules",
    label: "Install PM2 module",
    commandPreview: "pm2 install <module>",
    risk: "critical",
    outputLimit: 20_000,
    timeoutMs: 10 * 60 * 1000,
    fields: [textField("moduleName", "Module name", "pm2-logrotate")],
    build: (payload) => ["install", sanitizeModuleName(payload.moduleName)]
  },
  {
    id: "module-uninstall",
    category: "modules",
    label: "Uninstall PM2 module",
    commandPreview: "pm2 uninstall <module>",
    risk: "critical",
    outputLimit: 12_000,
    fields: [textField("moduleName", "Module name", "pm2-logrotate")],
    build: (payload) => ["uninstall", sanitizeModuleName(payload.moduleName)]
  },
  {
    id: "config-get",
    category: "modules",
    label: "Get module config",
    commandPreview: "pm2 get <key>",
    risk: "sensitive-read",
    fields: [textField("configKey", "Config key", "pm2-logrotate:max_size")],
    build: (payload) => ["get", sanitizeConfigKey(payload.configKey)]
  },
  {
    id: "config-set",
    category: "modules",
    label: "Set module config",
    commandPreview: "pm2 set <key> <value>",
    risk: "critical",
    fields: [textField("configKey", "Config key", "pm2-logrotate:max_size"), textField("configValue", "Value", "10M")],
    build: (payload) => ["set", sanitizeConfigKey(payload.configKey), sanitizeConfigValue(payload.configValue)]
  }
];

const coverageNotes = [
  {
    command: "pm2 monit",
    coverage: "Covered by the dashboard monitoring panels instead of launching an interactive terminal UI."
  },
  {
    command: "pm2 web",
    coverage: "Not exposed as a one-click action because it starts a separate long-running API. Keep this dashboard as the authenticated web layer."
  },
  {
    command: "pm2 start <new script>",
    coverage: "Use Add Process. It collects script, cwd, env, interpreter, instances, cron restart, watch, node args, and memory restart safely."
  },
  {
    command: "pm2 logs --stream",
    coverage: "Use the Logs page for streaming/live log reading; the toolkit keeps one-shot log tails for safer command output."
  }
];

function targetField(label, defaultValue = "") {
  return {
    name: "target",
    label,
    type: "target",
    defaultValue,
    placeholder: "api, 0, or all"
  };
}

function textField(name, label, defaultValue = "") {
  return {
    name,
    label,
    type: "text",
    defaultValue,
    placeholder: defaultValue || label
  };
}

function numberField(name, label, defaultValue, limits) {
  return {
    name,
    label,
    type: "number",
    defaultValue,
    min: limits?.min,
    max: limits?.max
  };
}

function selectField(name, label, options, defaultValue) {
  return {
    name,
    label,
    type: "select",
    defaultValue,
    options: options.map((value) => ({ value, label: value }))
  };
}

function configFileField() {
  return {
    name: "configFile",
    label: "Ecosystem file",
    type: "text",
    defaultValue: "ecosystem.config.js",
    placeholder: "ecosystem.config.js"
  };
}

function sanitizeTarget(value, options = {}) {
  const allowAll = options.allowAll !== false;
  const target = String(value || "").trim();
  if (!target) {
    throw new Error("target is required");
  }
  if (target === "all") {
    if (!allowAll) {
      throw new Error("target cannot be all for this action");
    }
    return target;
  }
  if (target.startsWith("-")) {
    throw new Error("target cannot start with '-'");
  }
  if (!TARGET_PATTERN.test(target)) {
    throw new Error("target contains invalid characters");
  }
  return target;
}

function sanitizeSignal(value) {
  const signal = String(value || "").trim().toUpperCase();
  if (!SIGNAL_PATTERN.test(signal) || !SIGNALS.includes(signal)) {
    throw new Error("signal is not allowed");
  }
  return signal;
}

function sanitizeFeatureName(value, fieldName) {
  const name = String(value || "").trim();
  if (!FEATURE_NAME_PATTERN.test(name) || name.startsWith("-")) {
    throw new Error(`${fieldName || "name"} contains invalid characters`);
  }
  return name;
}

function sanitizeParams(value) {
  const params = String(value || "").trim();
  if (params.length > 500) {
    throw new Error("params exceeds 500 characters");
  }
  if (/[`$;&|<>\\]/.test(params)) {
    throw new Error("params contains unsupported shell-like characters");
  }
  return params;
}

function readInteger(value, fieldName, min, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${fieldName} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function sanitizeConfigFile(value) {
  const raw = String(value || "ecosystem.config.js").trim();
  if (!CONFIG_FILE_PATTERN.test(raw) || raw.startsWith("-")) {
    throw new Error("ecosystem file contains invalid characters");
  }

  const resolved = path.resolve(PROJECT_ROOT, raw);
  const relToProject = path.relative(PROJECT_ROOT, resolved);
  const relToProjects = path.relative(PROJECTS_ROOT, resolved);
  const insideProject = relToProject === "" || (!relToProject.startsWith("..") && !path.isAbsolute(relToProject));
  const insideProjects = relToProjects === "" || (!relToProjects.startsWith("..") && !path.isAbsolute(relToProjects));
  if (!insideProject && !insideProjects) {
    throw new Error("ecosystem file must stay inside the dashboard project or PROJECTS_ROOT");
  }

  return path.relative(PROJECT_ROOT, resolved) || path.basename(resolved);
}

function sanitizeEnvironment(value) {
  const env = String(value || "production").trim();
  if (!ENVIRONMENT_PATTERN.test(env) || env.startsWith("-")) {
    throw new Error("environment contains invalid characters");
  }
  return env;
}

function withOptionalEnv(args, environment) {
  const env = String(environment || "").trim();
  if (!env) {
    return args;
  }
  return [...args, "--env", sanitizeEnvironment(env)];
}

function sanitizeDeployAction(value) {
  const action = String(value || "update").trim();
  if (!DEPLOY_ACTIONS.has(action)) {
    throw new Error("deploy action is not allowed");
  }
  return action;
}

function sanitizeModuleName(value) {
  const name = String(value || "").trim();
  if (!MODULE_NAME_PATTERN.test(name) || name.startsWith("-") || name.includes("..")) {
    throw new Error("module name contains invalid characters");
  }
  return name;
}

function sanitizeConfigKey(value) {
  const key = String(value || "").trim();
  if (!CONFIG_KEY_PATTERN.test(key) || key.startsWith("-")) {
    throw new Error("config key contains invalid characters");
  }
  return key;
}

function sanitizeConfigValue(value) {
  const next = String(value || "").trim();
  if (!next) {
    throw new Error("config value is required");
  }
  if (next.length > 500 || /[\r\n`$;&|<>\\]/.test(next)) {
    throw new Error("config value contains unsupported characters");
  }
  return next;
}

function getPm2FeatureCatalog() {
  return {
    categories: featureCategories,
    features: pm2Features.map(({ build, ...feature }) => feature),
    coverageNotes
  };
}

function buildPm2FeatureInvocation(actionId, payload = {}) {
  const feature = pm2Features.find((item) => item.id === actionId);
  if (!feature) {
    throw new Error("Unsupported PM2 feature action");
  }

  const args = feature.build(payload || {});
  return {
    id: feature.id,
    label: feature.label,
    category: feature.category,
    risk: feature.risk,
    args,
    parseJson: Boolean(feature.parseJson),
    outputLimit: feature.outputLimit,
    timeoutMs: feature.timeoutMs
  };
}

function requiresCriticalAcknowledgement(feature) {
  return feature?.risk === "critical";
}

module.exports = {
  getPm2FeatureCatalog,
  buildPm2FeatureInvocation,
  requiresCriticalAcknowledgement,
  sanitizeTarget,
  sanitizeConfigFile
};
