import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

/**
 * How to launch a command on the current platform.
 *
 * Since Node 20.12 (the Windows `.bat`/`.cmd` command-injection fix), spawning a
 * `.cmd` shim such as `npm.cmd` directly throws `EINVAL` on Windows. The throw
 * comes from `spawn()` itself rather than from the child's `error` event, so a
 * caller that only listens for `error` never hears about it and simply waits
 * forever.
 *
 * The shim is therefore handed to `cmd.exe` instead. `shell: true` would do the
 * same thing, but Node deprecates it when an argv list is passed (DEP0190):
 * with the shell, the arguments are concatenated rather than escaped. Quoting the
 * tokens here keeps the argv boundary explicit, and the tokens are fixed strings
 * from the caller, never user input.
 *
 * Every npm invocation on Windows goes through `npm.cmd`, so this decides whether
 * the PM2 CLI actions, `npm install`/`npm run` process commands, and the health
 * probe work at all on Windows.
 */

export interface SpawnTarget {
  command: string;
  args: string[];
  /** The command line as a human would type it, for logs and error messages. */
  display: string;
  /**
   * Pass this as `windowsVerbatimArguments`. When the shim is wrapped, `args` is a
   * finished `cmd.exe` command line, and Node's own argument escaping would destroy
   * it: Node escapes the inner quotes with backslashes, which `cmd.exe` does not
   * read as escapes. Measured against a shim in a directory whose name contains a
   * space: with the escaping left on, `cmd.exe` answers "The network path was not
   * found."; verbatim, it runs.
   */
  windowsVerbatimArguments: boolean;
}

/** True when `command` is a Windows shim that has to run through `cmd.exe`. */
export function windowsShellRequired(command: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== "win32") {
    return false;
  }
  return /\.(cmd|bat)$/i.test(String(command || "").trim());
}

/** Wrap a token for `cmd.exe`, which only needs quoting for spaces and quotes. */
export function quoteForCmd(token: string): string {
  const text = String(token ?? "");
  if (text.length === 0) {
    return '""';
  }
  if (!/[\s"^&|<>]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

export function commandLineFor(command: string, args: string[] = []): string {
  return [quoteForCmd(command), ...args.map(quoteForCmd)].join(" ");
}

function windowsCommandInterpreter(): string {
  return process.env.ComSpec || "cmd.exe";
}

/**
 * The command line to hand to `spawn`. On Windows a `.cmd`/`.bat` is wrapped in
 * `cmd.exe /d /s /c`; everywhere else the command and its argv list pass through.
 */
export function toSpawnTarget(
  command: string,
  args: string[] = [],
  platform: NodeJS.Platform = process.platform,
  comspec: string = windowsCommandInterpreter()
): SpawnTarget {
  const display = commandLineFor(command, args);
  if (!windowsShellRequired(command, platform)) {
    return { command, args, display, windowsVerbatimArguments: false };
  }

  // `cmd /c` strips the outer pair of quotes only when `/s` is set and the string
  // starts and ends with one. The extra pair is what keeps a program path with a
  // space intact: without it `cmd` sees `"C:\Program Files\nodejs\npm.cmd"` inside a
  // line it has already started parsing and reports "is not recognized".
  return {
    command: comspec,
    args: ["/d", "/s", "/c", `"${display}"`],
    display,
    windowsVerbatimArguments: true
  };
}

export interface ResolveExecutableOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (candidate: string) => boolean;
}

/**
 * The absolute path of a bare command name, or null when it is not on PATH.
 *
 * Windows is the reason this exists. `child_process.spawn` does not apply
 * `PATHEXT`: `spawn("npm")` fails with ENOENT even though `npm.cmd` is on PATH, and
 * `spawn("scoop")` fails the same way, so a package-manager fallback such as the
 * scoop install of caddy could never run. Resolving the name to its real file first
 * turns it into a path (a `.cmd` or `.bat` then goes through the shell rule above).
 *
 * A command that already names a path, or already carries an extension, is
 * returned untouched: the caller has said what it wants. Everywhere except Windows
 * the operating system resolves bare names itself, so nothing is looked up.
 *
 * Null is a "look it up yourself" answer, not a verdict that the command is
 * missing, so callers must fall back to the bare name. Not every Windows
 * executable is a file on PATH: `winget` is an App Execution Alias under
 * `%LOCALAPPDATA%\Microsoft\WindowsApps` whose reparse point `existsSync` cannot
 * see, and the bare name still starts. Measured on this machine: `winget` resolves
 * to null, runs bare, and exits 0.
 */
export function resolveExecutable(
  command: string,
  options: ResolveExecutableOptions = {}
): string | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const exists = options.exists ?? existsSync;
  const name = String(command || "").trim();
  if (!name) {
    return null;
  }
  const hasPathSegment = name.includes("/") || name.includes("\\");
  if (platform !== "win32" || hasPathSegment || path.extname(name) !== "") {
    return name;
  }

  const extensions = String(env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  const directories = String(env.PATH || "")
    .split(";")
    .map((directory) => directory.trim())
    .filter(Boolean);

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      if (exists(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

export interface TerminationPlan {
  /** `taskkill` kills the whole tree; `signal` kills the direct child. */
  method: "taskkill" | "signal";
  pid: number | null;
  signal: string;
}

/**
 * How to stop a child that has stopped responding.
 *
 * A command run through the shell is a tree: `cmd.exe` owns `npm.cmd`, which owns
 * the node process doing the work. Killing the direct child leaves the rest of
 * the tree running, which on Windows means a wedged `pm2 jlist` outlives the
 * request that started it. `taskkill /t` is the only way to take the tree down.
 */
export function terminationPlan(
  child: { pid?: number },
  platform: NodeJS.Platform = process.platform,
  signal = "SIGTERM"
): TerminationPlan {
  const pid = typeof child?.pid === "number" && child.pid > 0 ? child.pid : null;
  if (platform === "win32" && pid !== null) {
    return { method: "taskkill", pid, signal };
  }
  return { method: "signal", pid, signal };
}

export function terminateChildTree(
  child: { pid?: number; kill: (signal?: string) => boolean },
  platform: NodeJS.Platform = process.platform
): void {
  const plan = terminationPlan(child, platform);
  try {
    if (plan.method === "taskkill" && plan.pid !== null) {
      spawnSync("taskkill", ["/pid", String(plan.pid), "/t", "/f"], { stdio: "ignore" });
      return;
    }
    child.kill(plan.signal);
  } catch (_error) {
    // Best effort: the process may already have exited.
  }
}
