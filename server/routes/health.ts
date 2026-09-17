/**
 * `/health` and `/ready`.
 *
 * Both endpoints answer with the same shape they always did, but neither can
 * hang: the PM2 probe is awaited inside a guard, because a rejected promise in an
 * `async` Express handler produces no response at all (Express 4 does not forward
 * it to the error handler). A probe that throws is an unhealthy answer, and the
 * caller gets a 503 it can act on.
 *
 * `probePm2Health`, `getEnvironmentReport`, and `getPM2QueueState` are injected so
 * the routes can be exercised without a pm2 daemon or a real environment.
 */

import { HEALTHCHECK_TIMEOUT_MS, probePm2Health } from "../utils/healthProbe";
import type { HealthCommandResult } from "../utils/healthProbe";

// Both modules are CommonJS, so their exports are typed here at the use site.
const { getEnvironmentReport } = require("../utils/envGuard") as {
  getEnvironmentReport: () => { ok: boolean };
};
const { getPM2QueueState } = require("../utils/pm2Client") as {
  getPM2QueueState: () => unknown;
};

export interface HealthRouteDeps {
  port?: number;
  probePm2Health?: () => Promise<HealthCommandResult>;
  getEnvironmentReport?: () => { ok: boolean };
  getPM2QueueState?: () => unknown;
}

function describeProbeFailure(probe: HealthCommandResult): string {
  if (probe.timedOut) {
    return `PM2 health probe timed out after ${HEALTHCHECK_TIMEOUT_MS}ms`;
  }
  return probe.output || "PM2 health probe failed";
}

export function registerHealthRoutes(app, deps: HealthRouteDeps = {}) {
  const probe = deps.probePm2Health || probePm2Health;
  const readEnvironment = deps.getEnvironmentReport || getEnvironmentReport;
  const readQueueState = deps.getPM2QueueState || getPM2QueueState;
  const port = deps.port ?? Number(process.env.PORT || 8000);

  async function runProbe(): Promise<HealthCommandResult> {
    try {
      return await probe();
    } catch (error) {
      return {
        ok: false,
        code: null,
        timedOut: false,
        output: `PM2 health probe failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  app.get("/health", async (_req, res) => {
    const pm2Probe = await runProbe();

    res.status(pm2Probe.ok ? 200 : 503).json({
      status: pm2Probe.ok ? "ok" : "degraded",
      pm2Connected: pm2Probe.ok,
      uptime: process.uptime(),
      port,
      timestamp: Date.now(),
      pm2Queue: readQueueState(),
      error: pm2Probe.ok ? null : describeProbeFailure(pm2Probe)
    });
  });

  app.get("/ready", async (_req, res) => {
    const config = readEnvironment();
    const pm2Probe = await runProbe();
    const ready = config.ok && pm2Probe.ok;

    res.status(ready ? 200 : 503).json({
      status: ready ? "ready" : "not_ready",
      pm2Connected: pm2Probe.ok,
      uptime: process.uptime(),
      pm2Queue: readQueueState(),
      timestamp: Date.now()
    });
  });
}
