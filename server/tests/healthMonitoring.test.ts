const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

test("process metadata persists normalized health check settings", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pm2-manager-meta-"));
  const metaPath = path.join(tempRoot, "process-meta.json");
  const previousPath = process.env.PROCESS_META_PATH;
  process.env.PROCESS_META_PATH = metaPath;

  clearModule("../utils/processMetaStore");
  const store = require("../utils/processMetaStore");

  try {
    const saved = await store.setProcessMeta("api", {
      healthCheck: {
        enabled: true,
        protocol: "tcp",
        port: "4010",
        path: "ignored",
        intervalSec: "12",
        timeoutMs: "3200",
        failureThreshold: "4",
        successThreshold: "2",
        gracePeriodSec: "9"
      }
    });

    assert.equal(saved.healthCheck.enabled, true);
    assert.equal(saved.healthCheck.protocol, "tcp");
    assert.equal(saved.healthCheck.port, 4010);
    assert.equal(saved.healthCheck.intervalSec, 12);
    assert.equal(saved.healthCheck.timeoutMs, 3200);
    assert.equal(saved.healthCheck.failureThreshold, 4);
    assert.equal(saved.healthCheck.successThreshold, 2);
    assert.equal(saved.healthCheck.gracePeriodSec, 9);
  } finally {
    clearModule("../utils/processMetaStore");
    if (previousPath === undefined) {
      delete process.env.PROCESS_META_PATH;
    } else {
      process.env.PROCESS_META_PATH = previousPath;
    }
  }
});

test("health samples emit failure and recovery alerts after threshold transitions", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pm2-manager-health-"));
  const metricsPath = path.join(tempRoot, "metrics-history.json");
  const previousPath = process.env.METRICS_HISTORY_PATH;
  process.env.METRICS_HISTORY_PATH = metricsPath;

  clearModule("../utils/metricsHistoryStore");
  const store = require("../utils/metricsHistoryStore");

  try {
    const config = {
      protocol: "http",
      path: "/health",
      port: 3000,
      failureThreshold: 2,
      successThreshold: 1
    };

    const first = await store.appendHealthCheckSample("api", {
      ts: 1_000,
      healthy: false,
      reason: "HTTP 500",
      statusCode: 500
    }, config);
    assert.equal(first.alerts.length, 0);

    const second = await store.appendHealthCheckSample("api", {
      ts: 2_000,
      healthy: false,
      reason: "HTTP 500",
      statusCode: 500
    }, config);
    assert.equal(second.alerts.length, 1);
    assert.equal(second.alerts[0].event, "pm2.alert.health.failed");
    assert.equal(second.summary.currentState, "unhealthy");
    assert.equal(second.summary.consecutiveFailures, 2);

    const third = await store.appendHealthCheckSample("api", {
      ts: 3_000,
      healthy: true,
      latencyMs: 40,
      statusCode: 200
    }, config);
    assert.equal(third.alerts.length, 1);
    assert.equal(third.alerts[0].event, "pm2.alert.health.recovered");
    assert.equal(third.summary.currentState, "healthy");

    const report = await store.getHealthReport("api", 20);
    assert.equal(report.points.length, 3);
    assert.equal(report.summary.unhealthyChecks, 2);
    assert.equal(report.summary.healthyChecks, 1);
    assert.equal(report.summary.incidents.length, 1);
  } finally {
    clearModule("../utils/metricsHistoryStore");
    if (previousPath === undefined) {
      delete process.env.METRICS_HISTORY_PATH;
    } else {
      process.env.METRICS_HISTORY_PATH = previousPath;
    }
  }
});
