const express = require("express");
const { verifyToken } = require("../middleware/auth");
const { asyncHandler } = require("../middleware/asyncHandler");
const { readLimiter, writeLimiter } = require("../middleware/rateLimit");
const {
  listAlertChannels,
  upsertAlertChannel,
  removeAlertChannel
} = require("../utils/alertChannelsStore");
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

module.exports = router;
