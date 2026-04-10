const fs = require("fs");
const path = require("path");

let cache = null;
let saveTimer = null;

function getStorePath() {
  const configured = String(process.env.AUTH_SESSION_STORE_PATH || "").trim();
  if (!configured) {
    return path.resolve(__dirname, "../../logs/auth-sessions.json");
  }
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(__dirname, "../../", configured);
}

function ensureLoaded() {
  if (cache) {
    return;
  }
  try {
    const raw = fs.readFileSync(getStorePath(), "utf8");
    cache = JSON.parse(raw);
  } catch (_error) {
    cache = {};
  }
}

function scheduleSave() {
  if (saveTimer) {
    return;
  }
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      const storePath = getStorePath();
      await fs.promises.mkdir(path.dirname(storePath), { recursive: true });
      await fs.promises.writeFile(storePath, JSON.stringify(cache), "utf8");
    } catch (_error) {
      // Best-effort persistence.
    }
  }, 250);
  saveTimer.unref();
}

function normalizeVersion(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function getTokenVersion(username) {
  ensureLoaded();
  if (!username) {
    return 0;
  }
  return normalizeVersion(cache[username]?.tokenVersion);
}

function bumpTokenVersion(username) {
  ensureLoaded();
  if (!username) {
    return 0;
  }
  const nextVersion = getTokenVersion(username) + 1;
  cache[username] = {
    tokenVersion: nextVersion
  };
  scheduleSave();
  return nextVersion;
}

function resetAuthSessionStore() {
  cache = null;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
}

module.exports = {
  getTokenVersion,
  bumpTokenVersion,
  resetAuthSessionStore
};
