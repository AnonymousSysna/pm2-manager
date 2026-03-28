// @ts-nocheck
const http = require("http");
const https = require("https");
const { URL } = require("url");
const { listAlertChannels } = require("./alertChannelsStore");
const { logger } = require("./logger");

const ALERT_TIMEOUT_MS = Number.isFinite(Number(process.env.ALERT_TIMEOUT_MS))
  ? Math.max(2000, Math.floor(Number(process.env.ALERT_TIMEOUT_MS)))
  : 8000;

const SEVERITY_ORDER = {
  info: 1,
  warning: 2,
  danger: 3
};

function shouldSend(channel, alert) {
  const channelLevel = SEVERITY_ORDER[channel.minSeverity] || 2;
  const alertLevel = SEVERITY_ORDER[String(alert.severity || "warning")] || 2;
  return alertLevel >= channelLevel;
}

function requestJson(urlString, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(urlString);
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
          event: "pm2.alert.threshold",
          alert,
          sentAt: new Date().toISOString()
        };
      }

      try {
        await requestJson(channel.url, body);
        deliveries.push({ channelId: channel.id, success: true });
      } catch (error) {
        deliveries.push({ channelId: channel.id, success: false, error: error.message });
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

