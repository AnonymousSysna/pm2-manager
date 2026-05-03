const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { PassThrough } = require("stream");

function loadPm2RouteFresh() {
  const routePath = require.resolve("../routes/pm2");
  delete require.cache[routePath];
  return require("../routes/pm2");
}

function expectedNpmExecutable(platform = process.platform) {
  return platform === "win32" ? "npm.cmd" : "npm";
}

function expectedNpmArgs(pm2Args = []) {
  return ["--prefix", "server", "exec", "pm2", "--", ...pm2Args];
}

function createMockSpawn(behavior, calls) {
  return (command, args = [], options = {}) => {
    calls.push({ command, args, options });

    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};

    process.nextTick(() => {
      const result = typeof behavior === "function"
        ? behavior({ command, args, options, callIndex: calls.length - 1 })
        : behavior;

      if (result?.error) {
        child.emit("error", result.error instanceof Error ? result.error : new Error(String(result.error)));
        return;
      }

      if (result?.stdout) {
        child.stdout.write(result.stdout);
      }
      if (result?.stderr) {
        child.stderr.write(result.stderr);
      }
      child.stdout.end();
      child.stderr.end();
      child.emit("close", Object.prototype.hasOwnProperty.call(result || {}, "code") ? result.code : 0);
    });

    return child;
  };
}

function loadPm2RouteWithMockedSpawn(behavior) {
  const childProcess = require("child_process");
  const originalSpawn = childProcess.spawn;
  const calls = [];

  childProcess.spawn = createMockSpawn(behavior, calls);
  const route = loadPm2RouteFresh();

  return {
    route,
    calls,
    restore() {
      childProcess.spawn = originalSpawn;
      delete require.cache[require.resolve("../routes/pm2")];
    }
  };
}

function createResponse() {
  return {
    statusCode: 200,
    payload: null,
    set() {
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

function getRouteHandler(router, method, routePath) {
  const layer = router.stack.find((entry) =>
    entry.route &&
    entry.route.path === routePath &&
    entry.route.methods[method]
  );

  assert.ok(layer, `Missing route ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

async function invokeRoute(router, method, routePath, reqOverrides = {}) {
  const handler = getRouteHandler(router, method, routePath);
  const res = createResponse();
  let nextError = null;

  await handler(
    {
      method: method.toUpperCase(),
      path: routePath,
      baseUrl: "",
      originalUrl: routePath,
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
      ...reqOverrides
    },
    res,
    (error) => {
      nextError = error;
    }
  );

  if (nextError) {
    throw nextError;
  }

  return res;
}

test("runCommand supports numeric timeouts and option objects", async () => {
  const { runCommand } = loadPm2RouteFresh();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-manager-run-command-"));

  try {
    const numericResult = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write('numeric-ok')"],
      2000
    );
    assert.equal(numericResult.code, 0);
    assert.equal(numericResult.timedOut, false);
    assert.equal(numericResult.stdout, "numeric-ok");

    const optionResult = await runCommand(
      process.execPath,
      ["-e", "process.stdout.write(process.cwd())"],
      { cwd: tempDir, timeoutMs: 2000 }
    );
    assert.equal(optionResult.code, 0);
    assert.equal(optionResult.timedOut, false);
    assert.equal(optionResult.stdout, tempDir);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("PM2 CLI helper builds npm exec invocations from the repo root", () => {
  const { createPm2CliInvocation } = loadPm2RouteFresh();

  const windowsInvocation = createPm2CliInvocation(["save"], "win32");
  assert.equal(windowsInvocation.executable, "npm.cmd");
  assert.equal(windowsInvocation.displayCommand, "npm");
  assert.deepEqual(windowsInvocation.args, expectedNpmArgs(["save"]));
  assert.equal(windowsInvocation.cwd, path.resolve(__dirname, "..", ".."));

  const linuxInvocation = createPm2CliInvocation(["jlist"], "linux");
  assert.equal(linuxInvocation.executable, "npm");
  assert.equal(linuxInvocation.displayCommand, "npm");
  assert.deepEqual(linuxInvocation.args, expectedNpmArgs(["jlist"]));
  assert.equal(linuxInvocation.cwd, path.resolve(__dirname, "..", ".."));
});

test("startup persistence verification rejects unsupported platforms even with dump.pm2 present", () => {
  const { isStartupPersistenceVerified } = loadPm2RouteFresh();
  const verified = isStartupPersistenceVerified(
    { supported: false, enabled: null, manager: null, service: null, output: "" },
    true
  );

  assert.equal(verified, false);
});

test("startup persistence verification requires both dump.pm2 and enabled startup detection", () => {
  const { isStartupPersistenceVerified } = loadPm2RouteFresh();

  assert.equal(
    isStartupPersistenceVerified(
      { supported: true, enabled: true, manager: "systemd", service: "pm2-user", output: "enabled" },
      true
    ),
    true
  );

  assert.equal(
    isStartupPersistenceVerified(
      { supported: true, enabled: false, manager: "systemd", service: "pm2-user", output: "" },
      true
    ),
    false
  );

  assert.equal(
    isStartupPersistenceVerified(
      { supported: true, enabled: true, manager: "systemd", service: "pm2-user", output: "enabled" },
      false
    ),
    false
  );
});

for (const routeCase of [
  { routePath: "/save", pm2Args: ["save"], flag: "saved" },
  { routePath: "/resurrect", pm2Args: ["resurrect"], flag: "resurrected" },
  { routePath: "/kill", pm2Args: ["kill"], flag: "killed" }
]) {
  test(`${routeCase.routePath} uses npm exec pm2 and returns action metadata`, async () => {
    const harness = loadPm2RouteWithMockedSpawn(({ args }) => ({
      code: 0,
      stdout: `ran ${args[args.length - 1]}`
    }));

    try {
      const response = await invokeRoute(harness.route, "post", routeCase.routePath);

      assert.equal(response.statusCode, 200);
      assert.equal(response.payload.success, true);
      assert.equal(response.payload.data?.[routeCase.flag], true);
      assert.equal(
        response.payload.data?.command,
        `npm ${expectedNpmArgs(routeCase.pm2Args).join(" ")}`
      );
      assert.equal(response.payload.data?.code, 0);
      assert.equal(response.payload.data?.timedOut, false);
      assert.match(response.payload.data?.output || "", new RegExp(routeCase.pm2Args[0]));

      assert.equal(harness.calls.length, 1);
      assert.equal(harness.calls[0].command, expectedNpmExecutable());
      assert.deepEqual(harness.calls[0].args, expectedNpmArgs(routeCase.pm2Args));
      assert.equal(harness.calls[0].options.cwd, path.resolve(__dirname, "..", ".."));
    } finally {
      harness.restore();
    }
  });
}

test("startup route preserves elevated instructions and does not run save when startup fails", async () => {
  const originalEnv = {
    PM2_HOME: process.env.PM2_HOME,
    USER: process.env.USER
  };
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pm2-manager-pm2-home-"));
  const instruction = "sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u tester --hp /home/tester";

  process.env.PM2_HOME = tempDir;
  process.env.USER = "tester";

  const harness = loadPm2RouteWithMockedSpawn(({ command, args }) => {
    if (command === "systemctl") {
      return { code: 1, stdout: "", stderr: "" };
    }

    if (
      command === expectedNpmExecutable() &&
      JSON.stringify(args) === JSON.stringify(expectedNpmArgs(["startup"]))
    ) {
      return {
        code: 1,
        stdout: instruction,
        stderr: "permission denied"
      };
    }

    return { code: 0, stdout: "" };
  });

  try {
    const response = await invokeRoute(harness.route, "post", "/startup");

    assert.equal(response.statusCode, 500);
    assert.equal(response.payload.success, false);
    assert.equal(response.payload.data?.command, `npm ${expectedNpmArgs(["startup"]).join(" ")}`);
    assert.equal(response.payload.data?.startup?.command, `npm ${expectedNpmArgs(["startup"]).join(" ")}`);
    assert.equal(response.payload.data?.instructionCommand, instruction);
    assert.equal(response.payload.data?.save, null);
    assert.match(response.payload.error || "", /Startup requires elevated command:/);

    assert.equal(
      harness.calls.some((entry) =>
        entry.command === expectedNpmExecutable() &&
        JSON.stringify(entry.args) === JSON.stringify(expectedNpmArgs(["save"]))
      ),
      false
    );
  } finally {
    harness.restore();
    fs.rmSync(tempDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("info route validates PM2 via CLI and returns the resolved PM2 home", async () => {
  const originalPm2Home = process.env.PM2_HOME;
  const customPm2Home = path.join(os.tmpdir(), "pm2-manager-custom-home");

  process.env.PM2_HOME = customPm2Home;

  const harness = loadPm2RouteWithMockedSpawn(({ command, args }) => {
    if (
      command === expectedNpmExecutable() &&
      JSON.stringify(args) === JSON.stringify(expectedNpmArgs(["jlist"]))
    ) {
      return {
        code: 0,
        stdout: "[]"
      };
    }

    return { code: 1, stderr: "unexpected command" };
  });

  try {
    const response = await invokeRoute(harness.route, "get", "/info");

    assert.equal(response.statusCode, 200);
    assert.equal(response.payload.success, true);
    assert.equal(response.payload.data?.pm2Home, path.resolve(customPm2Home));
    assert.notEqual(response.payload.data?.pm2Home, os.homedir());
    assert.equal(harness.calls.length, 1);
    assert.equal(harness.calls[0].command, expectedNpmExecutable());
    assert.deepEqual(harness.calls[0].args, expectedNpmArgs(["jlist"]));
    assert.equal(harness.calls[0].options.cwd, path.resolve(__dirname, "..", ".."));
  } finally {
    harness.restore();
    if (originalPm2Home === undefined) {
      delete process.env.PM2_HOME;
    } else {
      process.env.PM2_HOME = originalPm2Home;
    }
  }
});
