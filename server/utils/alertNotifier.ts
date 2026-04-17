const http = require("http");
const https = require("https");
const dns = require("dns");
const net = require("net");
const { URL } = require("url");
const {
  listAlertChannels,
  recordAlertChannelDelivery
} = require("./alertChannelsStore");
const { logger } = require("./logger");

const ALERT_TIMEOUT_MS = Number.isFinite(Number(process.env.ALERT_TIMEOUT_MS))
  ? Math.max(2000, Math.floor(Number(process.env.ALERT_TIMEOUT_MS)))
  : 8000;

const SEVERITY_ORDER = {
  info: 1,
  warning: 2,
  danger: 3
};

function parseIPv4(value) {
  const parts = String(value || "").trim().split(".");
  if (parts.length !== 4) {
    return null;
  }
  const octets = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return null;
    }
    const numeric = Number(part);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255) {
      return null;
    }
    octets.push(numeric);
  }
  return octets;
}

function isPrivateIPv4(ip) {
  const octets = parseIPv4(ip);
  if (!octets) {
    return false;
  }
  const [a, b] = octets;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a >= 224) {
    return true;
  }
  return false;
}

function isPrivateIPv6(ip) {
  const normalized = String(ip || "").toLowerCase().split("%")[0];
  if (!normalized) {
    return false;
  }
  if (normalized === "::1" || normalized === "::") {
    return true;
  }
  if (normalized.startsWith("fe80:")) {
    return true;
  }
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) {
    return true;
  }
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    return isPrivateIPv4(mapped);
  }
  return false;
}

function isBlockedIp(value) {
  const ipType = net.isIP(value);
  if (ipType === 4) {
    return isPrivateIPv4(value);
  }
  if (ipType === 6) {
    return isPrivateIPv6(value);
  }
  return false;
}

function isBlockedHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return normalized === "localhost" || normalized.endsWith(".localhost");
}

async function assertSafeAlertTarget(target) {
  if (isBlockedHostname(target.hostname) || isBlockedIp(target.hostname)) {
    throw new Error("Alert URL points to a restricted hostname");
  }

  const lookups = await dns.promises.lookup(target.hostname, {
    all: true,
    verbatim: true
  });
  if (!Array.isArray(lookups) || lookups.length === 0) {
    throw new Error("Alert URL hostname did not resolve");
  }

  for (const item of lookups) {
    if (isBlockedIp(item?.address)) {
      throw new Error("Alert URL resolved to a restricted network address");
    }
  }
}

function shouldSend(channel, alert) {
  const channelLevel = SEVERITY_ORDER[channel.minSeverity] || 2;
  const alertLevel = SEVERITY_ORDER[String(alert.severity || "warning")] || 2;
  return alertLevel >= channelLevel;
}

async function requestJson(urlString, body) {
  const target = new URL(urlString);
  const protocol = String(target.protocol || "").toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error("Alert URL must use http/https");
  }
  await assertSafeAlertTarget(target);

  return new Promise((resolve, reject) => {
    const isHttps = target.protocol === "https:";
    const payload = JSON.stringify(body);

    const options = {
      method: "POST",
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload)
      },
      timeout: ALERT_TIMEOUT_MS
    };

    const client = isHttps ? https : http;
    const req = client.request(options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const status = Number(res.statusCode || 0);
        if (status >= 200 && status < 300) {
          resolve({ status, body: Buffer.concat(chunks).toString("utf8") });
          return;
        }
        reject(new Error(`Alert request failed: ${status}`));
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Alert request timeout"));
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function toSlackText(alert) {
  const title = String(alert.title || "").trim();
  const message = String(alert.message || "").trim();

  if (title || message) {
    return [title || `PM2 alert: ${alert.processName || "unknown process"}`, message || null]
      .filter(Boolean)
      .join(" | ");
  }

  return `PM2 alert: ${alert.processName} ${alert.metric}=${alert.value} threshold=${alert.threshold} severity=${alert.severity}`;
}

async function sendAlertNotifications(alerts = []) {
  if (!Array.isArray(alerts) || alerts.length === 0) {
    return [];
  }

  const channels = (await listAlertChannels()).filter((item) => item.enabled);
  if (channels.length === 0) {
    return [];
  }

  const deliveries = [];

  for (const alert of alerts) {
    for (const channel of channels) {
      if (!shouldSend(channel, alert)) {
        continue;
      }

      let body;
      if (channel.type === "slack") {
        body = { text: toSlackText(alert) };
      } else {
        body = {
          event: alert.event || "pm2.alert.threshold",
          alert,
          sentAt: new Date().toISOString()
        };
      }

      try {
        await requestJson(channel.url, body);
        deliveries.push({ channelId: channel.id, success: true });
        await recordAlertChannelDelivery(channel.id, {
          success: true,
          ts: new Date().toISOString()
        }).catch(() => {
          // Best-effort stats update.
        });
      } catch (error) {
        deliveries.push({ channelId: channel.id, success: false, error: error.message });
        await recordAlertChannelDelivery(channel.id, {
          success: false,
          error: error.message,
          ts: new Date().toISOString()
        }).catch(() => {
          // Best-effort stats update.
        });
        logger.warn("alert_delivery_failed", {
          channelId: channel.id,
          type: channel.type,
          error: error.message
        });
      }
    }
  }

  return deliveries;
}

async function sendTestAlert(channel) {
  const alert = {
    ts: Date.now(),
    processName: "pm2-manager-test",
    metric: "cpu",
    value: 95,
    threshold: 80,
    severity: "warning"
  };

  if (channel.type === "slack") {
    await requestJson(channel.url, {
      text: toSlackText(alert)
    });
    return { success: true };
  }

  await requestJson(channel.url, {
    event: "pm2.alert.test",
    alert,
    sentAt: new Date().toISOString()
  });

  return { success: true };
}

module.exports = {
  sendAlertNotifications,
  sendTestAlert
};

