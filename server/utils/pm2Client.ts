const pm2 = require("pm2");
const permissionHints = require("./permissionHints.js");
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
      finish({
        success: false,
        data: null,
        error: withPermissionHint(`PM2 operation timed out after ${PM2_OPERATION_TIMEOUT_MS}ms`)
      });
    }, PM2_OPERATION_TIMEOUT_MS);
    if (typeof operationTimeout.unref === "function") {
      operationTimeout.unref();
    }

    pm2.connect((connectError) => {
      if (connectError) {
        finish({ success: false, data: null, error: withPermissionHint(connectError.message) });
        return;
      }

      connected = true;
      Promise.resolve()
        .then(action)
        .then((data) => {
          finish({ success: true, data, error: null });
        })
        .catch((error) => {
          const raw = error?.message || "Unknown PM2 error";
          finish({
            success: false,
            data: null,
            error: withPermissionHint(raw)
          });
        });
    });
  });
}

function enqueuePM2Operation(action) {
  if (queuedOperations >= PM2_OPERATION_QUEUE_MAX) {
    return Promise.resolve({
      success: false,
      data: null,
      error: "PM2 is busy. Please retry after the current operations finish."
    });
  }

  queuedOperations += 1;
  const run = () => runPM2(action);
  const queued = operationChain.then(run, run);
  operationChain = queued.catch(() => null).finally(() => {
    queuedOperations = Math.max(0, queuedOperations - 1);
  });
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
