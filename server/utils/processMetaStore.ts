const fs = require("fs");
const path = require("path");
const { sanitizeProcessName } = require("./validation");

const DEFAULT_STORE_PATH = path.resolve(__dirname, "../../logs/process-meta.json");

function getStorePath() {
  const configured = String(process.env.PROCESS_META_PATH || "").trim();
  return configured ? path.resolve(configured) : DEFAULT_STORE_PATH;
}

async function ensureDir() {
  const filePath = getStorePath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  return filePath;
}

function normalizeDependencies(dependencies) {
  if (!Array.isArray(dependencies)) {
    return [];
  }
  const cleaned = dependencies
    .map((item) => sanitizeProcessName(item, "dependency"))
    .filter(Boolean);
  return Array.from(new Set(cleaned));
}

function normalizeThresholds(input) {
  const source = input && typeof input === "object" ? input : {};
  const cpu = Number(source.cpu);
  const memoryMB = Number(source.memoryMB);

  return {
    cpu: Number.isFinite(cpu) ? Math.max(1, Math.min(100, Math.floor(cpu))) : null,
    memoryMB: Number.isFinite(memoryMB) ? Math.max(16, Math.floor(memoryMB)) : null
  };
}

function normalizeHealthPath(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "/";
  }
  const base = raw.startsWith("/") ? raw : `/${raw}`;
  return base.slice(0, 256);
}

function normalizePort(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 65535) {
    throw new Error("health check port must be an integer between 1 and 65535");
  }

  return numeric;
}

function normalizeHealthCheck(input) {
  const source = input && typeof input === "object" ? input : {};
  const intervalSec = Number(source.intervalSec);
  const timeoutMs = Number(source.timeoutMs);
  const failureThreshold = Number(source.failureThreshold);
  const successThreshold = Number(source.successThreshold);
  const gracePeriodSec = Number(source.gracePeriodSec);
  const protocol = String(source.protocol || "http").trim().toLowerCase();

  return {
    enabled: Boolean(source.enabled),
    protocol: protocol === "tcp" ? "tcp" : "http",
    port: normalizePort(source.port),
    path: normalizeHealthPath(source.path),
    intervalSec: Number.isFinite(intervalSec) ? Math.max(5, Math.min(3600, Math.floor(intervalSec))) : 30,
    timeoutMs: Number.isFinite(timeoutMs) ? Math.max(500, Math.min(30_000, Math.floor(timeoutMs))) : 5000,
    failureThreshold: Number.isFinite(failureThreshold)
      ? Math.max(1, Math.min(10, Math.floor(failureThreshold)))
      : 3,
    successThreshold: Number.isFinite(successThreshold)
      ? Math.max(1, Math.min(5, Math.floor(successThreshold)))
      : 1,
    gracePeriodSec: Number.isFinite(gracePeriodSec)
      ? Math.max(0, Math.min(600, Math.floor(gracePeriodSec)))
      : 15
  };
}

function normalizeProcessMeta(name, meta = {}) {
  const processName = sanitizeProcessName(name, "process name");
  const group = String(meta.group || "").trim().slice(0, 64);
  return {
    group,
    dependencies: normalizeDependencies(meta.dependencies).filter((item) => item !== processName),
    alertThresholds: normalizeThresholds(meta.alertThresholds),
    healthCheck: normalizeHealthCheck(meta.healthCheck)
  };
}

async function loadStore() {
  const filePath = await ensureDir();
  let raw = "";
  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (_error) {
    return { filePath, data: { processes: {}, groups: {} } };
  }

  try {
    const parsed = JSON.parse(raw);
    return {
      filePath,
      data: {
        processes: parsed.processes && typeof parsed.processes === "object" ? parsed.processes : {},
        groups: parsed.groups && typeof parsed.groups === "object" ? parsed.groups : {}
      }
    };
  } catch (_error) {
    return { filePath, data: { processes: {}, groups: {} } };
  }
}

async function saveStore(filePath, data) {
  const payload = JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      ...data
    },
    null,
    2
  );
  await fs.promises.writeFile(filePath, payload, "utf8");
}

async function listProcessMeta() {
  const { data } = await loadStore();
  const output = {};

  for (const [name, meta] of Object.entries(data.processes || {})) {
    try {
      output[sanitizeProcessName(name, "process name")] = normalizeProcessMeta(name, meta);
    } catch (_error) {
      // Ignore invalid persisted entries.
    }
  }

  return output;
}

async function setProcessMeta(name, patch = {}) {
  const processName = sanitizeProcessName(name, "process name");
  const { filePath, data } = await loadStore();
  const existing = data.processes[processName] || {};
  const next = normalizeProcessMeta(processName, { ...existing, ...patch });
  data.processes[processName] = next;
  await saveStore(filePath, data);
  return next;
}

async function clearProcessMeta(name) {
  const processName = sanitizeProcessName(name, "process name");
  const { filePath, data } = await loadStore();
  delete data.processes[processName];

  for (const [groupName, members] of Object.entries(data.groups || {})) {
    const nextMembers = Array.isArray(members)
      ? members.filter((member) => member !== processName)
      : [];
    if (nextMembers.length === 0) {
      delete data.groups[groupName];
    } else {
      data.groups[groupName] = nextMembers;
    }
  }

  await saveStore(filePath, data);
}

async function listGroups() {
  const { data } = await loadStore();
  const groups = {};

  for (const [groupName, members] of Object.entries(data.groups || {})) {
    const key = String(groupName || "").trim();
    if (!key) {
      continue;
    }

    const normalizedMembers = Array.isArray(members)
      ? Array.from(
          new Set(
            members
              .map((member) => {
                try {
                  return sanitizeProcessName(member, "group member");
                } catch (_error) {
                  return null;
                }
              })
              .filter(Boolean)
          )
        )
      : [];

    if (normalizedMembers.length > 0) {
      groups[key] = normalizedMembers;
    }
  }

  return groups;
}

async function setGroup(name, members = []) {
  const groupName = String(name || "").trim();
  if (!groupName || groupName.length > 64) {
    throw new Error("group name must be 1-64 characters");
  }

  const normalizedMembers = Array.from(
    new Set((members || []).map((member) => sanitizeProcessName(member, "group member")))
  );

  const { filePath, data } = await loadStore();
  if (normalizedMembers.length === 0) {
    delete data.groups[groupName];
  } else {
    data.groups[groupName] = normalizedMembers;
  }

  for (const member of normalizedMembers) {
    const current = data.processes[member] || {};
    data.processes[member] = normalizeProcessMeta(member, { ...current, group: groupName });
  }

  await saveStore(filePath, data);
  return { name: groupName, members: normalizedMembers };
}

async function getGroupMembers(groupName) {
  const groups = await listGroups();
  return groups[String(groupName || "").trim()] || [];
}

async function exportConfig() {
  const { data } = await loadStore();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    processes: await listProcessMeta(),
    groups: await listGroups(),
    raw: data
  };
}

async function importConfig(payload = {}) {
  const processes = payload.processes && typeof payload.processes === "object" ? payload.processes : {};
  const groups = payload.groups && typeof payload.groups === "object" ? payload.groups : {};

  const normalizedProcesses = {};
  for (const [name, meta] of Object.entries(processes)) {
    try {
      normalizedProcesses[sanitizeProcessName(name, "process name")] = normalizeProcessMeta(name, meta);
    } catch (_error) {
      // Skip invalid process entries.
    }
  }

  const normalizedGroups = {};
  for (const [name, members] of Object.entries(groups)) {
    const groupName = String(name || "").trim();
    if (!groupName) {
      continue;
    }
    const groupMembers = Array.isArray(members)
      ? members
          .map((member) => {
            try {
              return sanitizeProcessName(member, "group member");
            } catch (_error) {
              return null;
            }
          })
          .filter(Boolean)
      : [];

    if (groupMembers.length > 0) {
      normalizedGroups[groupName] = Array.from(new Set(groupMembers));
    }
  }

  const { filePath } = await loadStore();
  await saveStore(filePath, { processes: normalizedProcesses, groups: normalizedGroups });

  return {
    importedProcesses: Object.keys(normalizedProcesses).length,
    importedGroups: Object.keys(normalizedGroups).length
  };
}

module.exports = {
  listProcessMeta,
  setProcessMeta,
  clearProcessMeta,
  listGroups,
  setGroup,
  getGroupMembers,
  exportConfig,
  importConfig
};

