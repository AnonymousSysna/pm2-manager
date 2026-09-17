const pm2 = require("pm2");
const permissionHints = require("./permissionHints.js");
const { success, failure, failureFrom, unavailable } = require("./serviceResult");
const withPermissionHint =
  typeof permissionHints?.withPermissionHint === "function"
    ? permissionHints.withPermissionHint
    : (message) => String(message || "Operation failed");

const PM2_OPERATION_TIMEOUT_MS = Number.isFinite(Number(process.env.PM2_OPERATION_TIMEOUT_MS))
  ? Math.max(1000, Math.floor(Number(process.env.PM2_OPERATION_TIMEOUT_MS)))
  : 15000;
const PM2_OPERATION_QUEUE_MAX = Number.isFinite(Number(process.env.PM2_OPERATION_QUEUE_MAX))
  ? Math.max(1, Math.floor(Number(process.env.PM2_OPERATION_QUEUE_MAX)))
  : 50;

let operationChain = Promise.resolve();
let queuedOperations = 0;

function disconnectPM2() {
  try {
    pm2.disconnect();
  } catch (_error) {
    // PM2 disconnect is best-effort; another caller may already have closed it.
  }
}

function runPM2(action) {
  return new Promise((resolve) => {
    let settled = false;
    let connected = false;

    const finish = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(operationTimeout);
      if (connected) {
        disconnectPM2();
      }
      resolve(result);
    };

    const operationTimeout = setTimeout(() => {
      finish(
        failure(
          withPermissionHint(`PM2 operation timed out after ${PM2_OPERATION_TIMEOUT_MS}ms`),
          504,
          "pm2_timeout"
        )
      );
    }, PM2_OPERATION_TIMEOUT_MS);
    if (typeof operationTimeout.unref === "function") {
      operationTimeout.unref();
    }

    pm2.connect((connectError) => {
      if (connectError) {
        finish(unavailable(withPermissionHint(connectError.message), "pm2_unavailable"));
        return;
      }

      connected = true;
      Promise.resolve()
        .then(action)
        .then((data) => {
          finish(success(data));
        })
        .catch((error) => {
          // failureFrom keeps the status of a thrown ValidationError/ServiceError, so an
          // action that rejects bad input reports 400 instead of 500.
          const failed = failureFrom(error, 500, "Unknown PM2 error");
          finish({ ...failed, error: withPermissionHint(failed.error) });
        });
    });
  });
}

function enqueuePM2Operation(action) {
  if (queuedOperations >= PM2_OPERATION_QUEUE_MAX) {
    return Promise.resolve(
      unavailable("PM2 is busy. Please retry after the current operations finish.", "pm2_busy")
    );
  }

  queuedOperations += 1;
  const run = () => runPM2(action);
  const queued = operationChain.then(run, run);
  const settleQueue = () => {
    queuedOperations = Math.max(0, queuedOperations - 1);
  };
  // Settle both paths with then(settleQueue, settleQueue) instead of catch().finally():
  // the counter still decrements after a rejection, and the stored chain stays
  // Promise<void> rather than widening to Promise<unknown>.
  operationChain = queued.then(settleQueue, settleQueue);
  return queued;
}

function withPM2(action) {
  return enqueuePM2Operation(action);
}

function getPM2QueueState() {
  return {
    queuedOperations,
    maxQueuedOperations: PM2_OPERATION_QUEUE_MAX,
    timeoutMs: PM2_OPERATION_TIMEOUT_MS
  };
}

module.exports = { withPM2, getPM2QueueState };
