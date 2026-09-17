/**
 * Wraps an async route handler so a rejected promise reaches Express's error
 * middleware instead of becoming an unhandled rejection.
 *
 * The wrapper returns the promise it creates. Express ignores a handler's return
 * value, so this changes nothing at runtime, but it makes the handler awaitable:
 * a caller that invokes the handler directly (the route tests, which mount no
 * server) can wait for the response instead of racing it. Without the return, the
 * tests observed `res` before the handler had written anything.
 */
function asyncHandler(fn) {
  return function wrappedAsyncHandler(req, res, next) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { asyncHandler };
