/**
 * The PM2 reachability probe behind `/health` and `/ready`.
 *
 * The probe runs `npm exec pm2 -- jlist` as a short-lived child process. Two
 * things matter more than the result:
 *
 *   - it must always settle. `spawn` can throw before a child exists (EINVAL on
 *     Windows for a `.cmd` shim, ENOENT when npm is missing), and a promise that
 *     rejects here used to escape an `async` Express handler, which leaves the
 *     request open forever instead of answering 503. A health endpoint that hangs
 *     is worse than one that reports unhealthy: PM2 and the installer both poll it.
 *   - it must not swallow the process. The child is killed on timeout, so a wedged
 *     pm2 daemon costs one probe interval, not the dashboard.
 *   - it must not run once per poll. The probe costs a full `npm` startup (~1.4s
 *     measured), so a load balancer polling `/ready` every few seconds would pay
 *     that every time, and a burst of polls would start a burst of npm processes
 *     (measured: 10 concurrent polls reached 26 node processes). `createProbeCache`
 *     answers from the last result for a short window and shares one in-flight run
 *     between concurrent callers, which makes a poll cost nothing.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { toSpawnTarget, terminateChildTree } from "./commandSpawn";

const HEALTHCHECK_TIMEOUT_MS = Number.isFinite(Number(process.env.HEALTHCHECK_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.HEALTHCHECK_TIMEOUT_MS)))
  : 5000;

/**
 * How long a probe result may be reused. Short enough that a restarted or dead pm2
 * daemon is noticed within a poll or two, long enough that polling is free.
 */
const HEALTHCHECK_CACHE_MS = Number.isFinite(Number(process.env.HEALTHCHECK_CACHE_MS))
  ? Math.max(0, Math.floor(Number(process.env.HEALTHCHECK_CACHE_MS)))
  : 2000;

export interface HealthCommandOptions {
  cwd?: string;
  timeoutMs?: number;
}

export interface HealthCommandResult {
  ok: boolean;
  code: number | null;
  timedOut: boolean;
  output: string;
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function runHealthCommand(
  command: string,
  args: string[],
  options: HealthCommandOptions = {}
): Promise<HealthCommandResult> {
  const cwd = options.cwd || path.resolve(__dirname, "..", "..");
  const timeoutMs = options.timeoutMs || HEALTHCHECK_TIMEOUT_MS;

  return new Promise<HealthCommandResult>((resolve) => {
    let output = "";
    let finished = false;
    let timeout: { unref?: () => void } | null = null;

    const done = (result: { ok?: boolean; code?: number | null; timedOut?: boolean; output?: string }) => {
      if (finished) {
        return;
      }
      finished = true;
      if (timeout) {
        clearTimeout(timeout as ReturnType<typeof setTimeout>);
        timeout = null;
      }
      resolve({
        ok: Boolean(result.ok),
        code: result.code ?? null,
        timedOut: Boolean(result.timedOut),
        output: String(result.output ?? output).trim()
      });
    };

    // A spawn that throws never produces a child, so there is no `error` event to
    // wait for: without this the probe would never settle.
    let child;
    try {
      const target = toSpawnTarget(command, args);
      child = spawn(target.command, target.args, {
      windowsVerbatimArguments: target.windowsVerbatimArguments,
        cwd,
        env: process.env,
        windowsHide: true
      });
    } catch (error) {
      done({
        ok: false,
        output: `Failed to start ${command}: ${error instanceof Error ? error.message : String(error)}`
      });
      return;
    }

    timeout = setTimeout(() => {
      // The probe may be a process tree on Windows, and the whole tree has to
      // go: a wedged `pm2 jlist` left behind would outlive the request.
      terminateChildTree(child);
      done({ ok: false, timedOut: true });
    }, timeoutMs);
    if (typeof timeout.unref === "function") {
      timeout.unref();
    }

    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      done({ ok: false, code: null, output: `${output}${error.message}` });
    });
    child.on("close", (code) => {
      done({ ok: code === 0, code });
    });
  });
}

/** `pm2 jlist` from the repository root, so the local pm2 install is the one used. */
export function probePm2Health(options: HealthCommandOptions = {}): Promise<HealthCommandResult> {
  return runHealthCommand(npmCommand(), ["--prefix", "server", "exec", "pm2", "--", "jlist"], {
    cwd: options.cwd || path.resolve(__dirname, "..", ".."),
    timeoutMs: options.timeoutMs || HEALTHCHECK_TIMEOUT_MS
  });
}

export interface ProbeCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

export interface ProbeCache<T> {
  read: () => Promise<T>;
  /** When the cached answer was taken, or null before the first settled read. */
  takenAt: () => number | null;
}

/**
 * Reuse a settled probe result for `ttlMs`, and let concurrent callers share the
 * one run already in flight. Successes and failures are both cached: a broken
 * probe is exactly when hammering it with a new process per poll hurts most.
 */
export function createProbeCache<T>(probe: () => Promise<T>, options: ProbeCacheOptions = {}): ProbeCache<T> {
  const ttlMs = options.ttlMs ?? HEALTHCHECK_CACHE_MS;
  const now = options.now ?? Date.now;
  let settledAt: number | null = null;
  // The settled answer is kept as a replay thunk, so success and failure are stored
  // the same way and one expired window discards both.
  let replay: (() => Promise<T>) | null = null;
  let inFlight: Promise<T> | null = null;

  function stored(): Promise<T> | null {
    const fresh = settledAt !== null && now() - settledAt < ttlMs;
    if (!replay || !fresh) {
      return null;
    }
    return replay();
  }

  return {
    read() {
      const cached = stored();
      if (cached) {
        return cached;
      }
      if (inFlight) {
        return inFlight;
      }

      inFlight = probe().then(
        (value) => {
          replay = () => Promise.resolve(value);
          settledAt = now();
          inFlight = null;
          return value;
        },
        (error) => {
          replay = () => Promise.reject(error);
          settledAt = now();
          inFlight = null;
          throw error;
        }
      );
      return inFlight;
    },
    takenAt() {
      return settledAt;
    }
  };
}

export { HEALTHCHECK_TIMEOUT_MS, HEALTHCHECK_CACHE_MS };
