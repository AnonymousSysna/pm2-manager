// @ts-nocheck
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");

function createMockSpawn(behavior, calls) {
  return (command, args = []) => {
    calls.push({ command, args });

    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};

    process.nextTick(() => {
      const finish = (code, stderr = "", stdout = "") => {
        if (stdout) {
          child.stdout.write(stdout);
        }
        if (stderr) {
          child.stderr.write(stderr);
        }
        child.stdout.end();
        child.stderr.end();
        child.emit("close", code);
      };

      if (command === "where" || command === "which") {
        finish(args[0] === "caddy" ? 0 : 1, "", args[0] === "caddy" ? "caddy\n" : "");
        return;
      }

      if (command === "caddy" && args[0] === "validate") {
        finish(behavior.validateCode || 0, behavior.validateStderr || "", behavior.validateStdout || "");
        return;
      }

      if (command === "caddy" && args[0] === "reload") {
        finish(behavior.reloadCode || 0, behavior.reloadStderr || "", behavior.reloadStdout || "");
        return;
      }

      finish(0);
    });

    return child;
  };
}

function loadControllerWithMockedSpawn(behavior, envOverrides) {
  const childProcess = require("child_process");
  const originalSpawn = childProcess.spawn;
  const previousEnv = {
    CADDY_MANAGED_SITES_PATH: process.env.CADDY_MANAGED_SITES_PATH,
    CADDYFILE_PATH: process.env.CADDYFILE_PATH
  };
  const calls = [];

  childProcess.spawn = createMockSpawn(behavior, calls);
  process.env.CADDY_MANAGED_SITES_PATH = envOverrides.managedSitesPath;
  process.env.CADDYFILE_PATH = envOverrides.caddyfilePath;

  const controllerPath = require.resolve("../controllers/caddyController");
  delete require.cache[controllerPath];
  const controller = require("../controllers/caddyController");

  return {
    controller,
    calls,
    restore() {
      childProcess.spawn = originalSpawn;
      if (previousEnv.CADDY_MANAGED_SITES_PATH === undefined) {
        delete process.env.CADDY_MANAGED_SITES_PATH;
      } else {
        process.env.CADDY_MANAGED_SITES_PATH = previousEnv.CADDY_MANAGED_SITES_PATH;
      }
      if (previousEnv.CADDYFILE_PATH === undefined) {
        delete process.env.CADDYFILE_PATH;
      } else {
        process.env.CADDYFILE_PATH = previousEnv.CADDYFILE_PATH;
      }
      delete require.cache[controllerPath];
    }
  };
}

test("addReverseProxy restores managed files when validation fails", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pm2-manager-caddy-add-"));
  const managedSitesPath = path.join(tempRoot, "caddy-managed-sites.json");
  const caddyfilePath = path.join(tempRoot, "Caddyfile");
  const originalSites = {
    "old.example.com": "127.0.0.1:3000"
  };
  const originalCaddyfile = [
    "legacy.example.com {",
    "  reverse_proxy 127.0.0.1:8080",
    "}",
    "",
    "# BEGIN PM2-MANAGER CADDY",
    "old.example.com {",
    "  reverse_proxy 127.0.0.1:3000",
    "}",
    "# END PM2-MANAGER CADDY",
    ""
  ].join("\n");

  await fs.promises.writeFile(managedSitesPath, JSON.stringify(originalSites, null, 2), "utf8");
  await fs.promises.writeFile(caddyfilePath, originalCaddyfile, "utf8");

  const harness = loadControllerWithMockedSpawn(
    {
      validateCode: 1,
      validateStderr: "invalid config"
    },
    {
      managedSitesPath,
      caddyfilePath
    }
  );

  try {
    const result = await harness.controller.addReverseProxy({
      domain: "new.example.com",
      upstream: "127.0.0.1:5000"
    });

    assert.equal(result.success, false);
    assert.equal(result.error, "Caddy validate/reload failed");
    assert.match(result.data.validation.error, /invalid config/);
    assert.equal(result.data.reload.skipped, true);
    assert.equal(
      harness.calls.filter((entry) => entry.command === "caddy" && entry.args[0] === "reload").length,
      0
    );

    assert.equal(await fs.promises.readFile(managedSitesPath, "utf8"), JSON.stringify(originalSites, null, 2));
    assert.equal(await fs.promises.readFile(caddyfilePath, "utf8"), originalCaddyfile);
  } finally {
    harness.restore();
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});

test("deleteReverseProxy restores managed files when reload fails", async () => {
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pm2-manager-caddy-delete-"));
  const managedSitesPath = path.join(tempRoot, "caddy-managed-sites.json");
  const caddyfilePath = path.join(tempRoot, "Caddyfile");
  const originalSites = {
    "delete.example.com": "127.0.0.1:4000",
    "keep.example.com": "127.0.0.1:3000"
  };
  const originalCaddyfile = [
    "delete.example.com {",
    "  reverse_proxy 127.0.0.1:4000",
    "}",
    "",
    "# BEGIN PM2-MANAGER CADDY",
    "delete.example.com {",
    "  reverse_proxy 127.0.0.1:4000",
    "}",
    "",
    "keep.example.com {",
    "  reverse_proxy 127.0.0.1:3000",
    "}",
    "# END PM2-MANAGER CADDY",
    ""
  ].join("\n");

  await fs.promises.writeFile(managedSitesPath, JSON.stringify(originalSites, null, 2), "utf8");
  await fs.promises.writeFile(caddyfilePath, originalCaddyfile, "utf8");

  const harness = loadControllerWithMockedSpawn(
    {
      reloadCode: 1,
      reloadStderr: "reload failed"
    },
    {
      managedSitesPath,
      caddyfilePath
    }
  );

  try {
    const result = await harness.controller.deleteReverseProxy({
      domain: "delete.example.com"
    });

    assert.equal(result.success, false);
    assert.equal(result.error, "Caddy validate/reload failed");
    assert.equal(result.data.validation.success, true);
    assert.match(result.data.reload.error, /reload failed/);
    assert.equal(
      harness.calls.filter((entry) => entry.command === "caddy" && entry.args[0] === "reload").length,
      1
    );

    assert.equal(await fs.promises.readFile(managedSitesPath, "utf8"), JSON.stringify(originalSites, null, 2));
    assert.equal(await fs.promises.readFile(caddyfilePath, "utf8"), originalCaddyfile);
  } finally {
    harness.restore();
    await fs.promises.rm(tempRoot, { recursive: true, force: true });
  }
});
