const os = require("os");
const express = require("express");
const pm2 = require("pm2");
const pm2Package = require("pm2/package.json");
const { verifyToken } = require("../middleware/auth");

const router = express.Router();

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
        .then((data) => closeAndResolve({ success: true, data, error: null }))
        .catch((error) =>
          closeAndResolve({
            success: false,
            data: null,
            error: error.message || "PM2 command failed"
          })
        );
    });
  });
}

router.use(verifyToken);

router.post("/save", async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.dump((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ saved: true });
        });
      })
  );

  res.status(result.success ? 200 : 500).json(result);
});

router.post("/resurrect", async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.resurrect((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ resurrected: true });
        });
      })
  );

  res.status(result.success ? 200 : 500).json(result);
});

router.post("/kill", async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.killDaemon((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ killed: true });
        });
      })
  );

  res.status(result.success ? 200 : 500).json(result);
});

router.get("/info", async (_req, res) => {
  const result = await withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.list((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve({
            pm2Version: pm2Package.version || "unknown",
            nodeVersion: process.version,
            pm2Home: process.env.PM2_HOME || os.homedir()
          });
        });
      })
  );

  res.status(result.success ? 200 : 500).json(result);
});

module.exports = router;
