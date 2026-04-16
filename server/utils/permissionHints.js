function normalizeMessage(input) {
  return String(input || "").trim();
}

function isPermissionDeniedMessage(message) {
  const text = normalizeMessage(message);
  if (!text) {
    return false;
  }
  return /(eacces|eperm|permission denied|operation not permitted|access is denied|must be root|requires root|not authorized|authorization failed|insufficient privileges)/i.test(text);
}

function normalizeCommand(command = "", args = []) {
  const cmd = String(command || "").trim();
  if (!cmd) {
    return "";
  }
  const safeArgs = Array.isArray(args) ? args.map((item) => String(item || "").trim()).filter(Boolean) : [];
  return [cmd, ...safeArgs].join(" ").trim();
}

function maybePrefixElevated(commandLine = "") {
  const value = String(commandLine || "").trim();
  if (!value) {
    return "";
  }
  if (process.platform === "win32") {
    return value;
  }
  if (/^(sudo|doas)\s+/i.test(value)) {
    return value;
  }
  return `sudo ${value}`;
}

function withPermissionHint(message, options = {}) {
  const base = normalizeMessage(message) || "Operation failed";
  if (!isPermissionDeniedMessage(base)) {
    return base;
  }

  if (/permission hint:/i.test(base)) {
    return base;
  }

  const commandLine = normalizeCommand(options.command, options.args);
  const elevated = maybePrefixElevated(commandLine);

  if (process.platform === "win32") {
    if (elevated) {
      return `${base} | Permission hint: run this command from an elevated Administrator shell: ${elevated}`;
    }
    return `${base} | Permission hint: run the action from an elevated Administrator shell.`;
  }

  if (elevated) {
    return `${base} | Permission hint: retry with elevated privileges: ${elevated}`;
  }
  return `${base} | Permission hint: retry with elevated privileges (sudo).`;
}

module.exports = {
  isPermissionDeniedMessage,
  withPermissionHint,
  normalizeCommand
};
