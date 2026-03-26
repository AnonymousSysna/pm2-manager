const fs = require("fs");
const path = require("path");
const pm2 = require("pm2");

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
          closeAndResolve({
            success: false,
            data: null,
            error: error.message || "Unknown PM2 error"
          });
        });
    });
  });
}

function findPort(env = {}) {
  return env.PORT || env.port || env.PM2_PORT || null;
}

function formatUptime(proc) {
  const pm2Env = proc.pm2_env || {};
  if (!pm2Env.pm_uptime) {
    return 0;
  }
  return Date.now() - pm2Env.pm_uptime;
}

function formatProcess(proc) {
  const monit = proc.monit || {};
  const pm2Env = proc.pm2_env || {};
  const env = pm2Env.env || {};

  const rawMode = pm2Env.exec_mode || "fork";
  const mode = rawMode.includes("cluster") ? "cluster" : "fork";

  return {
    id: proc.pm_id,
    name: proc.name,
    pid: proc.pid,
    status: pm2Env.status || "unknown",
    cpu: monit.cpu || 0,
    memory: monit.memory || 0,
    uptime: formatUptime(proc),
    restarts: pm2Env.restart_time || 0,
    port: findPort(env),
    mode
  };
}

function listProcesses() {
  return withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.list((error, processes) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(processes.map(formatProcess));
        });
      })
  );
}

function startProcess(name) {
  return withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.start(name, (error, proc) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(proc);
        });
      })
  );
}

function stopProcess(name) {
  return withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.stop(name, (error, proc) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(proc);
        });
      })
  );
}

function restartProcess(name) {
  return withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.restart(name, (error, proc) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(proc);
        });
      })
  );
}

function deleteProcess(name) {
  return withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.delete(name, (error, proc) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(proc);
        });
      })
  );
}

function createProcess(config) {
  return withPM2(
    () =>
      new Promise((resolve, reject) => {
        const {
          name,
          script,
          port,
          instances,
          exec_mode,
          env,
          cwd,
          watch,
          args,
          max_memory_restart,
          node_args,
          interpreter,
          log_date_format
        } = config;

        const processConfig = {
          name,
          script,
          args,
          instances: instances || 1,
          exec_mode: exec_mode || "fork",
          cwd: cwd || process.cwd(),
          watch: Boolean(watch),
          env: {
            ...(env || {}),
            ...(port ? { PORT: String(port) } : {})
          },
          max_memory_restart,
          node_args,
          interpreter,
          log_date_format
        };

        pm2.start(processConfig, (error, proc) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(proc);
        });
      })
  );
}

function getProcessLogs(name, lines = 100) {
  return withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.describe(name, (error, description) => {
          if (error) {
            reject(error);
            return;
          }

          const proc = Array.isArray(description) ? description[0] : null;
          if (!proc) {
            resolve({ stdout: [], stderr: [] });
            return;
          }

          const env = proc.pm2_env || {};
          const stdoutPath = env.pm_out_log_path;
          const stderrPath = env.pm_err_log_path;

          const readTail = (filePath) => {
            if (!filePath || !fs.existsSync(filePath)) {
              return [];
            }
            const content = fs.readFileSync(filePath, "utf8");
            return content
              .split(/\r?\n/)
              .filter(Boolean)
              .slice(-Number(lines));
          };

          resolve({
            stdout: readTail(stdoutPath),
            stderr: readTail(stderrPath),
            paths: {
              stdout: stdoutPath ? path.resolve(stdoutPath) : null,
              stderr: stderrPath ? path.resolve(stderrPath) : null
            }
          });
        });
      })
  );
}

function reloadProcess(name) {
  return withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.reload(name, (error, proc) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(proc);
        });
      })
  );
}

function flushLogs(name) {
  return withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.flush(name, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve({ name, flushed: true });
        });
      })
  );
}

function getProcessDetails(name) {
  return withPM2(
    () =>
      new Promise((resolve, reject) => {
        pm2.describe(name, (error, description) => {
          if (error) {
            reject(error);
            return;
          }
          resolve((description || [])[0] || null);
        });
      })
  );
}

module.exports = {
  listProcesses,
  startProcess,
  stopProcess,
  restartProcess,
  deleteProcess,
  createProcess,
  getProcessLogs,
  reloadProcess,
  flushLogs,
  getProcessDetails
};
