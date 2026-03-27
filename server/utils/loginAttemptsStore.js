const fs = require("fs");
const path = require("path");

const STORE_PATH = path.resolve(__dirname, "../../logs/login-attempts.json");
let cache = null;
let saveTimer = null;

function ensureLoaded() {
  if (cache) {
    return;
  }
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
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
      await fs.promises.mkdir(path.dirname(STORE_PATH), { recursive: true });
      await fs.promises.writeFile(STORE_PATH, JSON.stringify(cache), "utf8");
    } catch (_error) {
      // Best-effort persistence.
    }
  }, 250);
  saveTimer.unref();
}

function getAttempt(ip) {
  ensureLoaded();
  const entry = cache[ip];
  if (!entry) {
    return null;
  }
  return {
    count: Number(entry.count || 0),
    blockedUntil: Number(entry.blockedUntil || 0)
  };
}

function setAttempt(ip, value) {
  ensureLoaded();
  cache[ip] = {
    count: Number(value.count || 0),
    blockedUntil: Number(value.blockedUntil || 0)
  };
  scheduleSave();
}

function clearAttempt(ip) {
  ensureLoaded();
  if (cache[ip]) {
    delete cache[ip];
    scheduleSave();
  }
}

module.exports = {
  getAttempt,
  setAttempt,
  clearAttempt
};
