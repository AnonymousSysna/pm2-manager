const pm2 = require("pm2");
const permissionHints = require("./permissionHints.js");
const withPermissionHint =
  typeof permissionHints?.withPermissionHint === "function"
    ? permissionHints.withPermissionHint
    : (message) => String(message || "Operation failed");

function withPM2(action) {
  return new Promise((resolve) => {
    pm2.connect((connectError) => {
      if (connectError) {
        resolve({ success: false, data: null, error: connectError.message });
        return;
      }

      const closeAndResolve = (result) => {
        pm2.disconnect();
        resolve(result);
      };

      Promise.resolve()
        .then(action)
        .then((data) => {
          closeAndResolve({ success: true, data, error: null });
        })
        .catch((error) => {
          const raw = error?.message || "Unknown PM2 error";
          closeAndResolve({
            success: false,
            data: null,
            error: withPermissionHint(raw)
          });
        });
    });
  });
}

module.exports = { withPM2 };

