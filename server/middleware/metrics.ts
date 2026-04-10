const os = require("os");

const registry = {
  startAt: Date.now(),
  requestsTotal: new Map(),
  requestDurationMs: new Map(),
  activeSockets: 0,
  socketConnectionsTotal: 0,
  socketErrorsTotal: 0,
  pm2OperationsTotal: new Map()
};

function keyFromLabels(labels) {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
}

function incCounter(map, labels, value = 1) {
  const key = keyFromLabels(labels);
  map.set(key, (map.get(key) || 0) + value);
}

function observeDuration(map, labels, value) {
  const key = keyFromLabels(labels);
  const current = map.get(key) || { count: 0, sum: 0 };
  map.set(key, {
    count: current.count + 1,
    sum: current.sum + value
  });
}

function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    incCounter(registry.requestsTotal, {
      method: req.method,
      route: req.route?.path || req.path || req.originalUrl,
      status: String(res.statusCode)
    });
    observeDuration(registry.requestDurationMs, {
      method: req.method,
      route: req.route?.path || req.path || req.originalUrl
    }, elapsedMs);
  });
  next();
}

function trackPm2Operation(operation, success) {
  incCounter(registry.pm2OperationsTotal, {
    operation: String(operation || "unknown"),
    success: success ? "true" : "false"
  });
}

function onSocketConnected() {
  registry.activeSockets += 1;
  registry.socketConnectionsTotal += 1;
}

function onSocketDisconnected() {
  registry.activeSockets = Math.max(0, registry.activeSockets - 1);
}

function onSocketError() {
  registry.socketErrorsTotal += 1;
}

function mapToPromCounter(name, help, map) {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} counter`];
  for (const [labelString, value] of map.entries()) {
    lines.push(`${name}{${labelString}} ${value}`);
  }
  return lines.join("\n");
}

function mapToPromSummary(name, help, map) {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} summary`];
  for (const [labelString, value] of map.entries()) {
    lines.push(`${name}_count{${labelString}} ${value.count}`);
    lines.push(`${name}_sum{${labelString}} ${value.sum}`);
  }
  return lines.join("\n");
}

function renderMetrics() {
  const uptimeSeconds = Math.floor((Date.now() - registry.startAt) / 1000);

  const sections = [
    "# HELP process_uptime_seconds Node process uptime in seconds",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${uptimeSeconds}`,
    "# HELP process_resident_memory_bytes Resident memory size",
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${process.memoryUsage().rss}`,
    "# HELP node_load_average_1m One minute system load average",
    "# TYPE node_load_average_1m gauge",
    `node_load_average_1m ${os.loadavg()[0] || 0}`,
    mapToPromCounter(
      "http_requests_total",
      "Total number of completed HTTP requests",
      registry.requestsTotal
    ),
    mapToPromSummary(
      "http_request_duration_ms",
      "HTTP request duration in milliseconds",
      registry.requestDurationMs
    ),
    "# HELP socket_active_connections Number of active socket.io connections",
    "# TYPE socket_active_connections gauge",
    `socket_active_connections ${registry.activeSockets}`,
    "# HELP socket_connections_total Total socket.io connections",
    "# TYPE socket_connections_total counter",
    `socket_connections_total ${registry.socketConnectionsTotal}`,
    "# HELP socket_errors_total Total socket.io errors",
    "# TYPE socket_errors_total counter",
    `socket_errors_total ${registry.socketErrorsTotal}`,
    mapToPromCounter(
      "pm2_operations_total",
      "PM2 operations grouped by operation and success",
      registry.pm2OperationsTotal
    )
  ];

  return `${sections.join("\n")}\n`;
}

module.exports = {
  metricsMiddleware,
  renderMetrics,
  trackPm2Operation,
  onSocketConnected,
  onSocketDisconnected,
  onSocketError
};

