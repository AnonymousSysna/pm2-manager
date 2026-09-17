/**
 * Pre-flight validation for the fields the server also validates.
 *
 * Audit finding: the client validated some of these fields with its own copies of
 * the rules, and the copies had drifted. Git clone URLs used a looser SSH pattern
 * than `server/utils/validation.ts` (so `host:org/repo.git` passed the form and was
 * rejected with a 400 after submission), and the memory-restart pattern rejected
 * decimals the server accepts (`1.5G`). Process names were only checked for being
 * non-empty, so `my app` or the reserved name `catalog` cost a round trip and a
 * server error message.
 *
 * The rule sources below are the exact strings from `server/utils/validation.ts`.
 * `validation.test.ts` reads that file and fails if any of them drifts, so a change
 * on the server cannot silently desynchronize the form.
 *
 * Messages here are written for the person filling in the form, so they differ in
 * wording from the server's; only the rules are shared.
 */

export const PROCESS_NAME_PATTERN_SOURCE = "^[A-Za-z0-9:_-]{1,100}$";
export const ENV_KEY_PATTERN_SOURCE = "^[A-Za-z_][A-Za-z0-9_]*$";
export const GIT_CLONE_SSH_PATTERN_SOURCE = "^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\\s]+$";
export const MAX_MEMORY_RESTART_PATTERN_SOURCE = "^\\d+(?:\\.\\d+)?(?:K|M|G)$";
export const CRON_TOKEN_PATTERN_SOURCE = "^[A-Za-z0-9_*,?/-]+$";

export const PROCESS_NAME_PATTERN = new RegExp(PROCESS_NAME_PATTERN_SOURCE);
export const ENV_KEY_PATTERN = new RegExp(ENV_KEY_PATTERN_SOURCE);
export const GIT_CLONE_SSH_PATTERN = new RegExp(GIT_CLONE_SSH_PATTERN_SOURCE);
export const MAX_MEMORY_RESTART_PATTERN = new RegExp(MAX_MEMORY_RESTART_PATTERN_SOURCE, "i");
export const CRON_TOKEN_PATTERN = new RegExp(CRON_TOKEN_PATTERN_SOURCE);

export const RESERVED_PROCESS_NAMES = ["catalog", "interpreters"];
export const GIT_CLONE_PROTOCOLS = ["http:", "https:", "ssh:", "git:", "file:"];
export const CRON_MAX_LENGTH = 128;
export const CRON_MAX_TOKENS = 6;
export const GIT_CLONE_URL_MAX_LENGTH = 2048;

/** Returns an empty string when valid, otherwise a message to show in the form. */
export function validateProcessName(value: unknown, label = "Process Name"): string {
  const name = String(value ?? "").trim();
  if (!name) {
    return `${label} is required.`;
  }
  if (!PROCESS_NAME_PATTERN.test(name)) {
    return `${label} can only use letters, numbers, colon, underscore, and dash, up to 100 characters.`;
  }
  if (RESERVED_PROCESS_NAMES.includes(name.toLowerCase())) {
    return `${name} is reserved by the dashboard. Choose a different name.`;
  }
  return "";
}

export function validateScriptPath(value: unknown): string {
  const script = String(value ?? "").trim();
  if (!script) {
    return "Script Path is required.";
  }
  if (script.split(/[\\/]+/).includes("..")) {
    return "Script Path cannot contain traversal segments (..).";
  }
  return "";
}

export function validateEnvKey(value: unknown, label = "Environment variable name"): string {
  const key = String(value ?? "").trim();
  if (!key) {
    return `${label} is required.`;
  }
  if (!ENV_KEY_PATTERN.test(key)) {
    return `${label} must start with a letter or underscore and use only letters, numbers, and underscores (${key}).`;
  }
  return "";
}

export function validateMaxMemoryRestart(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (!MAX_MEMORY_RESTART_PATTERN.test(text)) {
    return "Format must match e.g. 256M, 1G, 512K.";
  }
  return "";
}

export function validateGitCloneUrl(value: unknown): string {
  const str = String(value ?? "").trim();
  if (!str) {
    return "Git clone URL is required in Git Clone Mode.";
  }
  if (str.length > GIT_CLONE_URL_MAX_LENGTH) {
    return `Git clone URL exceeds max length ${GIT_CLONE_URL_MAX_LENGTH}.`;
  }
  if (/\s/.test(str)) {
    return "Git clone URL cannot contain whitespace.";
  }

  if (GIT_CLONE_SSH_PATTERN.test(str)) {
    const remotePath = str.split(":").slice(1).join(":");
    if (!remotePath || !remotePath.includes("/")) {
      return "Git clone URL must be a valid git clone URL.";
    }
    return "";
  }

  let parsed: URL;
  try {
    parsed = new URL(str);
  } catch (_error) {
    return "Git clone URL must be a valid git clone URL.";
  }

  if (!GIT_CLONE_PROTOCOLS.includes(parsed.protocol)) {
    return "Git clone URL must use http, https, ssh, git, or file protocol.";
  }
  if (parsed.protocol !== "file:" && !parsed.hostname) {
    return "Git clone URL must include a hostname.";
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    return "Git clone URL must include a repository path.";
  }

  return "";
}

export function validateCronExpression(value: unknown, label = "Schedule"): string {
  const text = String(value ?? "").trim();
  if (!text) {
    return "";
  }
  if (text.length > CRON_MAX_LENGTH) {
    return `${label} exceeds max length ${CRON_MAX_LENGTH}.`;
  }
  // The server splits on whitespace and validates each field, so tabs and newlines
  // are rejected there instead of reaching PM2's scheduler.
  const tokens = text.split(/\s+/);
  if (tokens.length > CRON_MAX_TOKENS || tokens.some((token) => !CRON_TOKEN_PATTERN.test(token))) {
    return `${label} must be cron fields separated by single spaces, e.g. 0 3 * *.`;
  }
  return "";
}
