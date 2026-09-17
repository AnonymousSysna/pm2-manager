const assert = require("node:assert/strict");

const {
  parseArgs,
  parseBoolean,
  sanitizeDomain,
  sanitizeUpstream,
  buildCaddyInstallCommands,
  getPublicUrl,
  getPublicOrigins,
  mergeOrigins,
  upsertEnvContent,
  needsGeneratedValue,
  needsStrongSecretGeneratedValue,
  buildAdminNextSteps,
  finalizeNetworkOptions,
  getCaddySiteAddress
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


runTest("getPublicUrl prefers HTTPS when a domain is configured", () => {
  assert.equal(getPublicUrl({ domain: "pm2.example.com", port: 8001, publicPort: 8000 }), "https://pm2.example.com:8000");
  assert.equal(getPublicUrl({ domain: "", port: 9000 }), "http://localhost:9000");
});

runTest("getPublicOrigins includes local and domain origins", () => {
  assert.deepEqual(getPublicOrigins({ domain: "pm2.example.com", port: 8001, publicPort: 8000 }), [
    "http://localhost:8001",
    "http://pm2.example.com:8000",
    "https://pm2.example.com:8000"
  ]);
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


runTest("installer recognizes .env.example placeholders as generated values", () => {
  assert.equal(needsGeneratedValue("replace_with_at_least_32_random_characters"), true);
  assert.equal(needsGeneratedValue("replace_with_admin_username"), true);
  assert.equal(needsGeneratedValue("$2a$10$replace_with_bcrypt_hash"), true);
  assert.equal(needsGeneratedValue("admin_abc123"), false);
});

runTest("installer regenerates missing, placeholder, or short production secrets", () => {
  assert.equal(needsStrongSecretGeneratedValue(""), true);
  assert.equal(needsStrongSecretGeneratedValue("replace_with_at_least_32_random_characters"), true);
  assert.equal(needsStrongSecretGeneratedValue("too-short"), true);
  assert.equal(needsStrongSecretGeneratedValue("a".repeat(64)), false);
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
  assert.match(steps[1], /--setup-ssl --install-caddy --domain pm2.example.com --public-port 8000 --app-port 8000/);
});

runTest("domain HTTPS keeps public port and moves internal app port", () => {
  const options = finalizeNetworkOptions({
    domain: "srv1986869.hstgr.cloud",
    port: 8000,
    publicPort: 8000,
    setupSsl: true,
    upstreamExplicit: false,
    appPortExplicit: false
  });

  assert.equal(options.port, 8001);
  assert.equal(options.publicPort, 8000);
  assert.equal(options.upstream, "127.0.0.1:8001");
  assert.equal(options.publicUrl, "https://srv1986869.hstgr.cloud:8000");
  assert.equal(getCaddySiteAddress(options), "https://srv1986869.hstgr.cloud:8000");
});

console.log("Installer helper checks completed.");
