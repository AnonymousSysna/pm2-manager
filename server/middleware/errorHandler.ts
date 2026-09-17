const { logger, serializeError } = require("../utils/logger");
const { scrubUrl } = require("../utils/urlSafety");

class AppError extends Error {
  status: number;
  expose: boolean;

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
    error: `Route not found: ${req.method} ${scrubUrl(req.originalUrl)}`,
    requestId: req.requestId || null
  });
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    next(error);
    return;
  }
  const status = Number(error.status || error.statusCode) || 500;
  const expose = Boolean(error.expose) || status < 500;
  const message = expose ? error.message : "Internal server error";

  logger.error("request_failed", {
    method: req.method,
    path: scrubUrl(req.originalUrl),
    status,
    ip: req.ip,
    requestId: req.requestId || null,
    error: serializeError(error)
  });

  res.status(status).json({
    success: false,
    data: null,
    error: message,
    requestId: req.requestId || null
  });
}

module.exports = {
  AppError,
  errorHandler,
  notFoundHandler
};
