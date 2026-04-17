const fs = require("fs");
const path = require("path");
const { sanitizeProcessName } = require("./validation");

const DEFAULT_METRICS_PATH = path.resolve(__dirname, "../../logs/metrics-history.json");
const MAX_POINTS_PER_PROCESS = Number.isFinite(Number(process.env.METRICS_HISTORY_RETENTION_POINTS))
  ? Math.max(120, Math.floor(Number(process.env.METRICS_HISTORY_RETENTION_POINTS)))
  : Number.isFinite(Number(process.env.METRICS_HISTORY_MAX_POINTS))
    ? Math.max(120, Math.floor(Number(process.env.METRICS_HISTORY_MAX_POINTS)))
    : 4320;
const MAX_SAMPLE_AGE_MS = Number.isFinite(Number(process.env.METRICS_HISTORY_MAX_AGE_MS))
  ? Math.max(60_000, Math.floor(Number(process.env.METRICS_HISTORY_MAX_AGE_MS)))
  : 0;
const WRITE_THROTTLE_MS = Number.isFinite(Number(process.env.METRICS_HISTORY_WRITE_THROTTLE_MS))
  ? Math.max(200, Math.floor(Number(process.env.METRICS_HISTORY_WRITE_THROTTLE_MS)))
  : 1000;
const PROJECT_ROOT = path.resolve(__dirname, "../../");

const restartState = new Map();
const alertState = new Map();
let cache = null;
let writeTimer = null;
let writeInProgress = false;
let writeQueued = false;

function getMetricsPath() {
  const configured = String(process.env.METRICS_HISTORY_PATH || "").trim();
  if (!configured) {
    return DEFAULT_METRICS_PATH;
  }

  const defaultFileName = path.basename(DEFAULT_METRICS_PATH);
  if (configured === "." || configured === "./" || configured === ".\\") {
    return path.join(PROJECT_ROOT, defaultFileName);
  }

  const resolved = path.isAbsolute(configured)
    ? configured
    : path.resolve(PROJECT_ROOT, configured);

  try {
    if (fs.statSync(resolved).isDirectory()) {
      return path.join(resolved, defaultFileName);
    }
  } catch (_error) {
    // Path may not exist yet; treat as file path.
  }

  return resolved;
}

async function ensureDir() {
  const filePath = getMetricsPath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  return filePath;
}

function createEmptyStore() {
  return {
    history: {},
    healthHistory: {},
    config: {
      retentionPoints: MAX_POINTS_PER_PROCESS,
      maxAgeMs: MAX_SAMPLE_AGE_MS
    },
    updatedAt: new Date().toISOString()
  };
}

async function loadStore() {
  if (cache) {
    return cache;
  }

  const filePath = await ensureDir();
  let raw = "";

  try {
    raw = await fs.promises.readFile(filePath, "utf8");
  } catch (_error) {
    cache = { filePath, data: createEmptyStore() };
    return cache;
  }

  try {
    const parsed = JSON.parse(raw);
    cache = {
      filePath,
      data: {
        ...createEmptyStore(),
        ...(parsed && typeof parsed === "object" ? parsed : {}),
        history: parsed?.history && typeof parsed.history === "object" ? parsed.history : {},
        healthHistory: parsed?.healthHistory && typeof parsed.healthHistory === "object" ? parsed.healthHistory : {}
      }
    };
    return cache;
  } catch (_error) {
    cache = { filePath, data: createEmptyStore() };
    return cache;
  }
}

function prunePoints(points = [], now = Date.now()) {
  const maxAgeMs = Number(MAX_SAMPLE_AGE_MS || 0);
  const byAge = maxAgeMs > 0
    ? points.filter((point) => now - Number(point.ts || 0) <= maxAgeMs)
    : points;
  return byAge.slice(-MAX_POINTS_PER_PROCESS);
}

async function flushStore() {
  if (writeInProgress || !cache) {
    if (cache) {
      writeQueued = true;
    }
    return;
  }

  writeInProgress = true;
  writeQueued = false;
  try {
    const filePath = cache.filePath || (await ensureDir());
    const nextData = {
      ...cache.data,
      config: {
        retentionPoints: MAX_POINTS_PER_PROCESS,
        maxAgeMs: MAX_SAMPLE_AGE_MS
      },
      updatedAt: new Date().toISOString()
    };
    const tempPath = `${filePath}.tmp`;
    await fs.promises.writeFile(tempPath, JSON.stringify(nextData, null, 2), "utf8");
    await fs.promises.rename(tempPath, filePath);
    cache = { filePath, data: nextData };
  } finally {
    writeInProgress = false;
    if (writeQueued) {
      writeQueued = false;
      const timer = setTimeout(() => {
        flushStore().catch(() => {
          // Best-effort persistence.
        });
      }, 0);
      if (typeof timer.unref === "function") {
        timer.unref();
      }
    }
  }
}

function scheduleFlush() {
  if (writeTimer) {
    return;
  }
  writeTimer = setTimeout(() => {
    writeTimer = null;
    flushStore().catch(() => {
      // Best-effort persistence.
    });
  }, WRITE_THROTTLE_MS);
  if (typeof writeTimer.unref === "function") {
    writeTimer.unref();
  }
}

function summarizeUptime(points = []) {
  if (points.length <= 1) {
    return { upMs: 0, downMs: 0 };
  }

  let upMs = 0;
  let downMs = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    const delta = Math.max(0, Number(current.ts || 0) - Number(prev.ts || 0));
    if (prev.status === "online") {
      upMs += delta;
    } else {
      downMs += delta;
    }
  }

  return { upMs, downMs };
}

function computeAnomaly(points = []) {
  if (points.length < 5) {
    return { score: 0, isAnomaly: false, baseline: 0, current: 0 };
  }

  const restartDeltas = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = Number(points[i - 1].restarts || 0);
    const current = Number(points[i].restarts || 0);
    restartDeltas.push(Math.max(0, current - prev));
  }

  const baselineWindow = restartDeltas.slice(0, -1);
  const current = restartDeltas[restartDeltas.length - 1] || 0;

  const mean = baselineWindow.reduce((sum, value) => sum + value, 0) / Math.max(1, baselineWindow.length);
  const variance =
    baselineWindow.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    Math.max(1, baselineWindow.length);
  const stddev = Math.sqrt(variance);
  const score = stddev > 0 ? (current - mean) / stddev : current > mean ? 3 : 0;

  return {
    score: Number(score.toFixed(2)),
    isAnomaly: score >= 2.5 || current >= 3,
    baseline: Number(mean.toFixed(2)),
    current
  };
}

function buildAlertKey(processName, metric) {
  return `${processName}:${metric}`;
}

function evaluateThresholdAlerts(processes, processMeta) {
  const events = [];

  for (const process of processes) {
    let processName;
    try {
      processName = sanitizeProcessName(process.name, "process name");
    } catch (_error) {
      continue;
    }
    const thresholds = processMeta[processName]?.alertThresholds || {};
    const metrics = {
      cpu: Number(process.cpu || 0),
      memoryMB: Number(process.memory || 0) / (1024 * 1024)
    };

    for (const metricName of ["cpu", "memoryMB"]) {
      const threshold = Number(thresholds[metricName]);
      if (!Number.isFinite(threshold) || threshold <= 0) {
        continue;
      }

      const key = buildAlertKey(processName, metricName);
      const nowAbove = metrics[metricName] >= threshold;
      const beforeAbove = alertState.get(key) === true;

      if (nowAbove && !beforeAbove) {
        events.push({
          ts: Date.now(),
          processName,
          metric: metricName,
          value: Number(metrics[metricName].toFixed(2)),
          threshold,
          severity: metricName === "cpu" ? "warning" : "danger"
        });
      }

      alertState.set(key, nowAbove);
    }
  }

  return events;
}

function summarizeHealthHistory(points = []) {
  const relevant = points.filter((point) => point && point.skipped !== true);
  const last = relevant[relevant.length - 1] || null;
  const totalChecks = relevant.length;
  const healthyChecks = relevant.filter((point) => point.healthy === true).length;
  const unhealthyChecks = relevant.filter((point) => point.healthy === false).length;
  const availabilityPct =
    totalChecks > 0 ? Number(((healthyChecks / totalChecks) * 100).toFixed(1)) : null;

  const incidents = [];
  let activeIncident = null;

  for (const point of relevant) {
    if (point.stableState === "unhealthy" && !activeIncident) {
      activeIncident = {
        startedAt: Number(point.stableSinceTs || point.ts || 0),
        endedAt: null,
        reason: point.reason || null
      };
      continue;
    }

    if (point.stableState === "healthy" && activeIncident) {
      const endedAt = Number(point.ts || activeIncident.startedAt);
      incidents.push({
        ...activeIncident,
        endedAt,
        durationMs: Math.max(0, endedAt - activeIncident.startedAt)
      });
      activeIncident = null;
    }
  }

  if (activeIncident) {
    incidents.push({
      ...activeIncident,
      endedAt: null,
      durationMs: Math.max(0, Date.now() - activeIncident.startedAt)
    });
  }

  const lastFailure = [...relevant].reverse().find((point) => point.healthy === false) || null;
  const lastSuccess = [...relevant].reverse().find((point) => point.healthy === true) || null;
  const currentState = String(last?.stableState || "unknown");
  const currentDowntimeMs =
    currentState === "unhealthy"
      ? Math.max(0, Date.now() - Number(last?.stableSinceTs || last?.ts || 0))
      : 0;

  return {
    currentState,
    totalChecks,
    healthyChecks,
    unhealthyChecks,
    availabilityPct,
    consecutiveFailures: Number(last?.consecutiveFailures || 0),
    consecutiveSuccesses: Number(last?.consecutiveSuccesses || 0),
    lastCheckedAt: last?.ts || null,
    lastFailureAt: lastFailure?.ts || null,
    lastSuccessAt: lastSuccess?.ts || null,
    lastLatencyMs: Number.isFinite(Number(last?.latencyMs)) ? Number(last.latencyMs) : null,
    lastStatusCode: Number.isFinite(Number(last?.statusCode)) ? Number(last.statusCode) : null,
    lastReason: last?.reason || null,
    currentDowntimeMs,
    incidents: incidents.slice(-10)
  };
}

function buildHealthAlert(processName, severity, event, title, message, details = {}) {
  return {
    ts: Date.now(),
    category: "health",
    event,
    processName,
    severity,
    metric: "health",
    title,
    message,
    details
  };
}

async function appendHealthCheckSample(processName, sample = {}, config = {}) {
  const name = sanitizeProcessName(processName, "process name");
  const store = await loadStore();
  const now = Number(sample.ts || Date.now());
  const points = Array.isArray(store.data.healthHistory[name]) ? store.data.healthHistory[name] : [];

  if (sample.skipped) {
    points.push({
      ts: now,
      skipped: true,
      reason: sample.reason || "skipped",
      stableState: String(points[points.length - 1]?.stableState || "unknown")
    });
    store.data.healthHistory[name] = prunePoints(points, now);
    scheduleFlush();
    return {
      point: points[points.length - 1],
      summary: summarizeHealthHistory(store.data.healthHistory[name]),
      alerts: []
    };
  }

  const previous = points.filter((point) => point && point.skipped !== true).slice(-1)[0] || null;
  const healthy = Boolean(sample.healthy);
  const consecutiveFailures = healthy
    ? 0
    : Number(previous?.healthy === false ? previous?.consecutiveFailures || 0 : 0) + 1;
  const consecutiveSuccesses = healthy
    ? Number(previous?.healthy === true ? previous?.consecutiveSuccesses || 0 : 0) + 1
    : 0;
  const previousStableState = String(previous?.stableState || "unknown");
  let stableState = previousStableState;

  if (healthy && consecutiveSuccesses >= Math.max(1, Number(config.successThreshold) || 1)) {
    stableState = "healthy";
  }
  if (!healthy && consecutiveFailures >= Math.max(1, Number(config.failureThreshold) || 1)) {
    stableState = "unhealthy";
  }

  const stableSinceTs =
    stableState !== previousStableState
      ? now
      : Number(previous?.stableSinceTs || previous?.ts || now);

  const point = {
    ts: now,
    healthy,
    stableState,
    stableSinceTs,
    consecutiveFailures,
    consecutiveSuccesses,
    latencyMs: Number.isFinite(Number(sample.latencyMs)) ? Number(sample.latencyMs) : null,
    statusCode: Number.isFinite(Number(sample.statusCode)) ? Number(sample.statusCode) : null,
    reason: sample.reason || null,
    protocol: String(sample.protocol || config.protocol || "http"),
    port: Number.isFinite(Number(sample.port)) ? Number(sample.port) : null,
    path: sample.path ? String(sample.path) : null,
    processStatus: sample.processStatus ? String(sample.processStatus) : null
  };

  points.push(point);
  store.data.healthHistory[name] = prunePoints(points, now);
  scheduleFlush();

  const alerts = [];
  if (previousStableState !== "unhealthy" && stableState === "unhealthy") {
    alerts.push(
      buildHealthAlert(
        name,
        "danger",
        "pm2.alert.health.failed",
        `${name} health check failed`,
        point.reason
          ? `${name} failed health checks: ${point.reason}`
          : `${name} failed ${consecutiveFailures} health checks`,
        {
          protocol: point.protocol,
          port: point.port,
          path: point.path,
          consecutiveFailures,
          failureThreshold: Math.max(1, Number(config.failureThreshold) || 1),
          statusCode: point.statusCode,
          latencyMs: point.latencyMs,
          reason: point.reason
        }
      )
    );
  } else if (previousStableState === "unhealthy" && stableState === "healthy") {
    alerts.push(
      buildHealthAlert(
        name,
        "info",
        "pm2.alert.health.recovered",
        `${name} health recovered`,
        `${name} passed health checks again`,
        {
          protocol: point.protocol,
          port: point.port,
          path: point.path,
          consecutiveSuccesses,
          successThreshold: Math.max(1, Number(config.successThreshold) || 1),
          statusCode: point.statusCode,
          latencyMs: point.latencyMs
        }
      )
    );
  }

  return {
    point,
    summary: summarizeHealthHistory(store.data.healthHistory[name]),
    alerts
  };
}

async function appendMetricsSample(processes = [], processMeta = {}) {
  const store = await loadStore();
  const now = Date.now();

  for (const process of processes) {
    let processName;
    try {
      processName = sanitizeProcessName(process.name, "process name");
    } catch (_error) {
      continue;
    }

    const points = Array.isArray(store.data.history[processName]) ? store.data.history[processName] : [];
    points.push({
      ts: now,
      cpu: Number(process.cpu || 0),
      memory: Number(process.memory || 0),
      status: String(process.status || "unknown"),
      restarts: Number(process.restarts || 0),
      uptime: Number(process.uptime || 0)
    });

    store.data.history[processName] = prunePoints(points, now);

    const state = restartState.get(processName) || {
      totalRestarts: Number(process.restarts || 0),
      crashes: 0,
      lastStatus: String(process.status || "unknown")
    };

    const previousRestarts = Number(state.totalRestarts || 0);
    const currentRestarts = Number(process.restarts || 0);
    if (currentRestarts > previousRestarts) {
      state.crashes += currentRestarts - previousRestarts;
      state.totalRestarts = currentRestarts;
    }

    state.lastStatus = String(process.status || "unknown");
    restartState.set(processName, state);
  }

  scheduleFlush();
  return evaluateThresholdAlerts(processes, processMeta);
}

async function getMetricsHistory(processName, limit = 120) {
  const name = sanitizeProcessName(processName, "process name");
  const store = await loadStore();
  const points = Array.isArray(store.data.history[name]) ? store.data.history[name] : [];
  return points.slice(-Math.max(10, Math.min(2000, Number(limit) || 120)));
}

async function getHealthHistory(processName, limit = 120) {
  const name = sanitizeProcessName(processName, "process name");
  const store = await loadStore();
  const points = Array.isArray(store.data.healthHistory[name]) ? store.data.healthHistory[name] : [];
  return points.slice(-Math.max(10, Math.min(2000, Number(limit) || 120)));
}

async function getHealthReport(processName, limit = 120) {
  const points = await getHealthHistory(processName, limit);
  return {
    points,
    summary: summarizeHealthHistory(points)
  };
}

async function getMonitoringSummary(processes = [], processMeta = {}) {
  const store = await loadStore();
  const summary = [];

  for (const process of processes) {
    let processName;
    try {
      processName = sanitizeProcessName(process.name, "process name");
    } catch (_error) {
      continue;
    }

    const points = Array.isArray(store.data.history[processName]) ? store.data.history[processName] : [];
    const healthPoints = Array.isArray(store.data.healthHistory[processName]) ? store.data.healthHistory[processName] : [];
    const uptime = summarizeUptime(points);
    const anomaly = computeAnomaly(points.slice(-40));
    const restartInfo = restartState.get(processName) || {
      crashes: Number(process.restarts || 0),
      totalRestarts: Number(process.restarts || 0)
    };
    const healthSummary = summarizeHealthHistory(healthPoints);
    const healthConfig = processMeta[processName]?.healthCheck || null;

    summary.push({
      name: processName,
      upMs: uptime.upMs,
      downMs: uptime.downMs,
      crashes: Number(restartInfo.crashes || 0),
      totalRestarts: Number(restartInfo.totalRestarts || process.restarts || 0),
      anomaly,
      health: {
        enabled: Boolean(healthConfig?.enabled),
        protocol: healthConfig?.protocol || null,
        port: healthConfig?.port ?? process.port ?? null,
        path: healthConfig?.protocol === "http" ? healthConfig?.path || "/" : null,
        ...healthSummary
      }
    });
  }

  return summary;
}

module.exports = {
  appendMetricsSample,
  appendHealthCheckSample,
  getMetricsHistory,
  getHealthHistory,
  getHealthReport,
  getMonitoringSummary
};

