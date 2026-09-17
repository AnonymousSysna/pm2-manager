const SENSITIVE_QUERY_KEYS = /(token|secret|password|pass|key|auth|session|cookie|jwt|credential)/i;
const URL_WITH_CREDENTIALS_PATTERN = /\b(https?:\/\/)([^\s/@:]+):([^\s/@]+)@/gi;
const SENSITIVE_ASSIGNMENT_PATTERN = /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASS|API_KEY|PRIVATE_KEY|CREDENTIAL|AUTH|JWT|COOKIE|SESSION)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi;

function normalizeOrigin(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch (_error) {
    return "";
  }
}

function redactSecretsFromText(value) {
  const raw = String(value || "");
  if (!raw) {
    return "";
  }

  return raw
    .replace(URL_WITH_CREDENTIALS_PATTERN, "$1[redacted]@")
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, key) => `${key}=[redacted]`);
}

function scrubUrl(value) {
  const raw = redactSecretsFromText(value);
  if (!raw) {
    return "";
  }

  const base = raw.startsWith("http://") || raw.startsWith("https://")
    ? undefined
    : "http://local.invalid";

  try {
    const parsed = new URL(raw, base);
    if (parsed.username || parsed.password) {
      parsed.username = "[redacted]";
      parsed.password = "";
    }
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (SENSITIVE_QUERY_KEYS.test(key)) {
        parsed.searchParams.set(key, "[redacted]");
      }
    }

    const pathname = parsed.pathname || "/";
    const query = parsed.searchParams.toString();
    const hash = parsed.hash ? "#..." : "";
    if (base) {
      return `${pathname}${query ? `?${query}` : ""}${hash}`;
    }
    return `${parsed.origin}${pathname}${query ? `?${query}` : ""}${hash}`;
  } catch (_error) {
    return raw.split("?")[0] || raw;
  }
}

module.exports = {
  normalizeOrigin,
  redactSecretsFromText,
  scrubUrl
};
