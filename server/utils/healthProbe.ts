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
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { toSpawnTarget, terminateChildTree } from "./commandSpawn";

const HEALTHCHECK_TIMEOUT_MS = Number.isFinite(Number(process.env.HEALTHCHECK_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.HEALTHCHECK_TIMEOUT_MS)))
  : 5000;

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

export { HEALTHCHECK_TIMEOUT_MS };
