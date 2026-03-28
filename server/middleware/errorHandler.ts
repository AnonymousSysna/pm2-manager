// @ts-nocheck
const { logger, serializeError } = require("../utils/logger");

class AppError extends Error {
  constructor(message, status = 500, expose = false) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.expose = expose;
  }
}

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    data: null,
    error: `Route not found: ${req.method} ${req.originalUrl}`
  });
}

function errorHandler(error, req, res, _next) {
  const status = Number(error.status) || 500;
  const expose = Boolean(error.expose) || status < 500;
  const message = expose ? error.message : "Internal server error";

  logger.error("request_failed", {
    method: req.method,
    path: req.originalUrl,
    status,
    ip: req.ip,
    requestId: req.requestId || null,
    error: serializeError(error)
  });

  res.status(status).json({
    success: false,
    data: null,
    error: message
  });
}

module.exports = {
  AppError,
  errorHandler,
  notFoundHandler
};

