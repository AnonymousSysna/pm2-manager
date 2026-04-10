const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/asyncHandler");
const { readLimiter, writeLimiter } = require("../middleware/rateLimit");
const {
  listAlertChannels,
  upsertAlertChannel,
  removeAlertChannel
} = require("../utils/alertChannelsStore");
const {
  listNotifications,
  clearNotifications
} = require("../utils/notificationStore");
const { sendTestAlert } = require("../utils/alertNotifier");

const router = express.Router();

router.use(verifyToken);

router.get("/channels", readLimiter, asyncHandler(async (_req, res) => {
  const channels = await listAlertChannels();
  res.json({ success: true, data: channels, error: null });
}));

router.post("/channels", writeLimiter, asyncHandler(async (req, res) => {
  const channel = await upsertAlertChannel(req.body || {});
  res.json({ success: true, data: channel, error: null });
}));

router.delete("/channels/:id", writeLimiter, asyncHandler(async (req, res) => {
  const result = await removeAlertChannel(req.params.id);
  res.json({ success: true, data: result, error: null });
}));

router.post("/channels/:id/test", writeLimiter, asyncHandler(async (req, res) => {
  const channels = await listAlertChannels();
  const channel = channels.find((item) => item.id === req.params.id);
  if (!channel) {
    res.status(404).json({ success: false, data: null, error: "Channel not found" });
    return;
  }

  await sendTestAlert(channel);
  res.json({ success: true, data: { delivered: true }, error: null });
}));

router.get("/history", readLimiter, asyncHandler(async (req, res) => {
  const requested = Number(req.query.limit || 200);
  const limit = Number.isFinite(requested)
    ? Math.min(2000, Math.max(1, Math.floor(requested)))
    : 200;
  const items = await listNotifications(limit);
  res.json({ success: true, data: items, error: null });
}));

router.delete("/history", writeLimiter, asyncHandler(async (_req, res) => {
  const result = await clearNotifications();
  res.json({ success: true, data: result, error: null });
}));

module.exports = router;

