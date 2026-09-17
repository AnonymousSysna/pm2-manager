/**
 * Typed service results.
 *
 * Controllers return `{ success, data, error }` envelopes so routes never have to
 * throw across the Express boundary. The problem this module solves: the envelope
 * carried no HTTP status, so routes inferred 400 vs 500 by regex-matching the error
 * message. Rewording a message silently changed the status code, and a leaked
 * internal error could be reported as a client mistake.
 *
 * Now the failure carries its own status and code, and `resultStatus` is the only
 * thing routes need to read.
 *
 *   throw new ValidationError("name must match /^[A-Za-z0-9:_-]{1,100}$/");
 *   return failure("Caddy is not installed", 503, "caddy_unavailable");
 *   res.status(resultStatus(result)).json(result);
 *
 * Constructor arguments are positional (message, status, code, expose) rather than
 * an options object: the server tsconfig infers an untyped `options = {}` parameter
 * as `{}`, which makes property access inside the class a compile error.
 */

const FALLBACK_STATUS = 500;
const MIN_STATUS = 400;
const MAX_STATUS = 599;

/** Clamp anything caller-supplied into a valid HTTP error status. */
function normalizeStatus(value, fallback = FALLBACK_STATUS) {
  const status = Number(value);
  if (!Number.isInteger(status) || status < MIN_STATUS || status > MAX_STATUS) {
    return fallback;
  }
  return status;
}

/**
 * An operational failure with an HTTP status attached.
 *
 * `expose` controls whether the message reaches the client. Defaults to true for
 * 4xx (the caller needs to know what to fix) and false for 5xx (the message may
 * contain paths or library internals).
 */
class ServiceError extends Error {
  status;
  code;
  expose;

  constructor(message, status, code, expose) {
    super(String(message || "Operation failed"));
    this.name = "ServiceError";
    this.status = normalizeStatus(status, FALLBACK_STATUS);
    this.code = typeof code === "string" && code ? code : null;
    this.expose = expose === undefined ? this.status < FALLBACK_STATUS : Boolean(expose);
  }
}

/** Invalid input from the caller: 400. */
class ValidationError extends ServiceError {
  constructor(message, code = "validation_error") {
    super(message, 400, code, true);
    this.name = "ValidationError";
  }
}

/** The request is valid but conflicts with current state: 409. */
class ConflictError extends ServiceError {
  constructor(message, code = "conflict") {
    super(message, 409, code, true);
    this.name = "ConflictError";
  }
}

/** The caller may not do this: 403. */
class ForbiddenError extends ServiceError {
  constructor(message, code = "forbidden") {
    super(message, 403, code, true);
    this.name = "ForbiddenError";
  }
}

/** The named resource does not exist: 404. */
class NotFoundError extends ServiceError {
  constructor(message, code = "not_found") {
    super(message, 404, code, true);
    this.name = "NotFoundError";
  }
}

/** A dependency is missing or down: 503. */
class UnavailableError extends ServiceError {
  constructor(message, code = "unavailable") {
    super(message, 503, code, true);
    this.name = "UnavailableError";
  }
}

function isServiceError(error) {
  return Boolean(error) && typeof error === "object" && "status" in error && "message" in error;
}

/** Read the status off anything error-like, including AppError and axios-style errors. */
function errorStatus(error, fallback = FALLBACK_STATUS) {
  return normalizeStatus(error?.status ?? error?.statusCode, fallback);
}

function errorCode(error) {
  return typeof error?.code === "string" && error.code ? error.code : null;
}

function success(data) {
  return { success: true, data, error: null };
}

/** Build a failure envelope with an explicit status. */
function failure(message, status = FALLBACK_STATUS, code = null) {
  const normalized = normalizeStatus(status);
  return {
    success: false,
    data: null,
    error: String(message || "Operation failed"),
    status: normalized,
    code: typeof code === "string" && code ? code : null
  };
}

/**
 * Build a failure envelope from a thrown value, honoring its status when it has one.
 * Use the fallback status for errors that carry no status (unexpected failures).
 */
function failureFrom(error, fallbackStatus = FALLBACK_STATUS, fallbackMessage = "Operation failed") {
  const message = error?.message ? String(error.message) : fallbackMessage;
  return failure(message, errorStatus(error, fallbackStatus), errorCode(error));
}

/** Convenience wrapper: `return invalid("...")` reads better than `failure(x, 400)`. */
function invalid(message, code = "validation_error") {
  return failure(message, 400, code);
}

function forbidden(message, code = "forbidden") {
  return failure(message, 403, code);
}

function unavailable(message, code = "unavailable") {
  return failure(message, 503, code);
}

function isFailure(result) {
  return Boolean(result) && result.success === false;
}

/**
 * The HTTP status for a service result.
 *
 * Results that predate typed statuses fall back to `fallbackStatus`, which is why
 * legacy managers (caddy, jcode) still need their own conversion.
 */
function resultStatus(result, successStatus = 200, fallbackStatus = FALLBACK_STATUS) {
  if (!isFailure(result)) {
    return successStatus;
  }
  return normalizeStatus(result.status, fallbackStatus);
}

module.exports = {
  ServiceError,
  ValidationError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnavailableError,
  isServiceError,
  errorStatus,
  errorCode,
  normalizeStatus,
  success,
  failure,
  failureFrom,
  invalid,
  forbidden,
  unavailable,
  isFailure,
  resultStatus
};
