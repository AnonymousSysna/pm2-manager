const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
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

function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ code, stdout, stderr });
        return;
      }
      reject(
        new Error(
          `Command failed (${command} ${args.join(" ")}), exit code ${code}${
            stderr ? `: ${stderr.trim()}` : ""
          }`
        )
      );
    });
  });
}

function describeProcess(name) {
  return new Promise((resolve, reject) => {
    pm2.describe(name, (error, description) => {
      if (error) {
        reject(error);
        return;
      }
      const proc = Array.isArray(description) ? description[0] : null;
      resolve(proc || null);
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
  return withPM2(async () => {
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
      log_date_format,
      project_path,
      install_dependencies,
      run_build,
      start_script
    } = config;

    const rawScript = String(script || "").trim();
    let normalizedScript = rawScript;
    let normalizedCwd = cwd || process.cwd();

    // Allow users to paste a full absolute path and infer cwd automatically.
    if (rawScript && path.isAbsolute(rawScript)) {
      normalizedScript = path.basename(rawScript);
      if (!cwd) {
        normalizedCwd = path.dirname(rawScript);
      }
    }

    let finalScript = normalizedScript;
    let finalArgs = args;
    let finalCwd = normalizedCwd;

    const projectPathInput = String(project_path || "").trim();
    if (projectPathInput) {
      const projectDir = path.resolve(projectPathInput);
      const packageJsonPath = path.join(projectDir, "package.json");

      if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
        throw new Error(`Project path does not exist or is not a directory: ${projectDir}`);
      }

      if (!fs.existsSync(packageJsonPath)) {
        throw new Error(`package.json not found at: ${packageJsonPath}`);
      }

      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const scripts = packageJson.scripts || {};
      const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
      const startScriptName = String(start_script || "start").trim() || "start";

      if (install_dependencies) {
        await runCommand(npmCmd, ["install"], projectDir);
      }

      if (run_build) {
        if (!scripts.build) {
          throw new Error(`Missing "build" script in ${packageJsonPath}`);
        }
        await runCommand(npmCmd, ["run", "build"], projectDir);
      }

      if (!scripts[startScriptName]) {
        throw new Error(`Missing "${startScriptName}" script in ${packageJsonPath}`);
      }

      finalScript = npmCmd;
      finalArgs = `run ${startScriptName}`;
      finalCwd = projectDir;
    }

    if (!name || !String(name).trim()) {
      throw new Error("Process name is required");
    }

    if (!finalScript || !String(finalScript).trim()) {
      throw new Error("Script path is required");
    }

    const processConfig = {
      name,
      script: finalScript,
      args: finalArgs,
      instances: instances || 1,
      exec_mode: exec_mode || "fork",
      cwd: finalCwd,
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

    return new Promise((resolve, reject) => {
      pm2.start(processConfig, (error, proc) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(proc);
      });
    });
  });
}

function getProcessLogs(name, lines = 100) {
  return withPM2(
    () =>
      new Promise((resolve, reject) => {
        describeProcess(name)
          .then((proc) => {
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
          })
          .catch(reject);
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
  return withPM2(() => describeProcess(name));
}

function runNpmScriptForProcess(name, scriptName, args = []) {
  return withPM2(async () => {
    const proc = await describeProcess(name);
    if (!proc) {
      throw new Error(`Process not found: ${name}`);
    }

    const cwd = proc.pm2_env?.pm_cwd;
    if (!cwd || !fs.existsSync(cwd)) {
      throw new Error(`Cannot resolve process working directory for: ${name}`);
    }

    const packageJsonPath = path.join(cwd, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      throw new Error(`No package.json found in process directory: ${cwd}`);
    }

    const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

    if (scriptName === "install") {
      const result = await runCommand(npmCmd, ["install", ...args], cwd);
      return { command: "npm install", cwd, output: result.stdout.slice(-4000) };
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const scripts = packageJson.scripts || {};
    if (!scripts[scriptName]) {
      throw new Error(`Script "${scriptName}" not found in ${packageJsonPath}`);
    }

    const result = await runCommand(npmCmd, ["run", scriptName, ...args], cwd);
    return { command: `npm run ${scriptName}`, cwd, output: result.stdout.slice(-4000) };
  });
}

function npmInstall(name) {
  return runNpmScriptForProcess(name, "install");
}

function npmBuild(name) {
  return runNpmScriptForProcess(name, "build");
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
  getProcessDetails,
  npmInstall,
  npmBuild
};
