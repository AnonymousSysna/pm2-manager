const assert = require("node:assert/strict");

const {
  parseArgs,
  parseBoolean,
  sanitizeDomain,
  sanitizeUpstream,
  buildCaddyInstallCommands,
  mergeOrigins,
  upsertEnvContent,
  buildAdminNextSteps
} = require("./onetap");

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

runTest("parseArgs handles booleans, values, and positionals", () => {
  const parsed = parseArgs([
    "--setup-ssl",
    "--domain",
    "pm2.example.com",
    "--no-install-caddy",
    "D:\\pm2-manager"
  ]);

  assert.equal(parsed.flags["setup-ssl"], true);
  assert.equal(parsed.flags.domain, "pm2.example.com");
  assert.equal(parsed.flags["install-caddy"], false);
  assert.deepEqual(parsed.positionals, ["D:\\pm2-manager"]);
});

runTest("parseBoolean accepts common installer toggles", () => {
  assert.equal(parseBoolean("yes"), true);
  assert.equal(parseBoolean("0"), false);
  assert.equal(parseBoolean(""), undefined);
});

runTest("sanitizeDomain normalizes valid hostnames and rejects protocols", () => {
  assert.equal(sanitizeDomain("PM2.Example.com"), "pm2.example.com");
  assert.throws(() => sanitizeDomain("https://pm2.example.com"), /must not include protocol/);
});

runTest("sanitizeUpstream accepts host ports and rejects whitespace", () => {
  assert.equal(sanitizeUpstream("127.0.0.1:8000"), "127.0.0.1:8000");
  assert.throws(() => sanitizeUpstream("127.0.0.1: 8000"), /cannot contain spaces/);
});

runTest("buildCaddyInstallCommands prefers the detected package manager", () => {
  assert.deepEqual(
    buildCaddyInstallCommands("linux", { "apt-get": true }),
    ["apt-get update", "apt-get install -y caddy"]
  );
  assert.deepEqual(
    buildCaddyInstallCommands("windows", { winget: true, choco: true }),
    [
      "winget install --id CaddyServer.Caddy -e --source winget",
      "choco install caddy -y"
    ]
  );
});

runTest("mergeOrigins deduplicates existing and generated origins", () => {
  assert.equal(
    mergeOrigins("http://localhost:8000,https://pm2.example.com", [
      "http://localhost:8000",
      "http://pm2.example.com"
    ]),
    "http://localhost:8000,https://pm2.example.com,http://pm2.example.com"
  );
});

runTest("upsertEnvContent updates values and removes obsolete keys", () => {
  const next = upsertEnvContent(
    "PM2_USER=admin\nPM2_PASS_HASH=placeholder\nPORT=8000\n",
    {
      PM2_USER: "admin_123",
      PORT: "9000",
      TRUST_PROXY: "1"
    },
    ["PM2_PASS_HASH"]
  );

  assert.equal(
    next,
    "PM2_USER=admin_123\nPORT=9000\n\nTRUST_PROXY=1\n"
  );
});

runTest("buildAdminNextSteps includes an elevated rerun path", () => {
  const steps = buildAdminNextSteps({
    platform: "linux",
    appDir: "/opt/pm2-manager",
    domain: "pm2.example.com",
    port: 8000,
    caddyInstallCommands: ["apt-get update", "apt-get install -y caddy"],
    preferElevated: "sudo"
  });

  assert.match(steps[0], /sudo/);
  assert.match(steps[1], /--setup-ssl --install-caddy --domain pm2.example.com --port 8000/);
});

console.log("Installer helper checks completed.");
