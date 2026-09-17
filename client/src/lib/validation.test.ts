import fs from "node:fs";
import path from "node:path";
import {
  CRON_MAX_LENGTH,
  CRON_MAX_TOKENS,
  CRON_TOKEN_PATTERN_SOURCE,
  ENV_KEY_PATTERN_SOURCE,
  GIT_CLONE_PROTOCOLS,
  GIT_CLONE_URL_MAX_LENGTH,
  GIT_CLONE_SSH_PATTERN_SOURCE,
  MAX_MEMORY_RESTART_PATTERN_SOURCE,
  PROCESS_NAME_PATTERN_SOURCE,
  RESERVED_PROCESS_NAMES,
  validateCronExpression,
  validateEnvKey,
  validateGitCloneUrl,
  validateMaxMemoryRestart,
  validateProcessName,
  validateScriptPath
} from "./validation";

const SERVER_VALIDATION_PATH = findRepoFile("server/utils/validation.ts");
const serverSource = fs.readFileSync(SERVER_VALIDATION_PATH, "utf8");
const cases = JSON.parse(
  fs.readFileSync(findRepoFile("server/tests/fixtures/validationCases.json"), "utf8")
);

/** Resolves a repo-relative file whether vitest runs from the client dir or the repo root. */
function findRepoFile(relativePath: string): string {
  let dir = process.cwd();
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = path.join(dir, relativePath);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    dir = path.dirname(dir);
  }
  throw new Error(`could not locate ${relativePath} from ${process.cwd()}`);
}

/** Anchored regex literals in a source file, with `\/` unescaped to `/`. */
function anchoredRegexSources(source: string): string[] {
  const found: string[] = [];
  const pattern = /\/(?![/*])((?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n])*)\/([a-z]*)/g;
  let match = pattern.exec(source);
  while (match) {
    if (match[1].startsWith("^")) {
      found.push(match[1].replace(/\\\//g, "/"));
    }
    match = pattern.exec(source);
  }
  return found;
}

/** String arrays passed to `new Set([...])` in a source file. */
function setLiterals(source: string): string[][] {
  const found: string[][] = [];
  const pattern = /new Set\(\[([^\]]*)\]\)/g;
  let match = pattern.exec(source);
  while (match) {
    found.push(
      match[1]
        .split(",")
        .map((item) => item.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean)
    );
    match = pattern.exec(source);
  }
  return found;
}

const MIRRORED_PATTERNS = [
  PROCESS_NAME_PATTERN_SOURCE,
  ENV_KEY_PATTERN_SOURCE,
  GIT_CLONE_SSH_PATTERN_SOURCE,
  MAX_MEMORY_RESTART_PATTERN_SOURCE,
  CRON_TOKEN_PATTERN_SOURCE
];

// Client-side only rule: the argument character set applies to command arguments,
// which the browser never collects.
const SERVER_ONLY_PATTERNS = ["^[A-Za-z0-9_./:=,@+\\-\\s]*$"];

const validators: Record<string, (value: unknown) => string> = {
  processName: (value) => validateProcessName(value),
  gitCloneUrl: (value) => validateGitCloneUrl(value),
  envKey: (value) => validateEnvKey(value),
  maxMemoryRestart: (value) => validateMaxMemoryRestart(value),
  cron: (value) => validateCronExpression(value)
};

describe("client validation mirrors the server rules", () => {
  it("mirrors every anchored pattern in server/utils/validation.ts", () => {
    const serverPatterns = anchoredRegexSources(serverSource);
    expect(serverPatterns.length).toBeGreaterThanOrEqual(6);

    for (const pattern of serverPatterns) {
      expect([...MIRRORED_PATTERNS, ...SERVER_ONLY_PATTERNS]).toContain(pattern);
    }
    for (const pattern of MIRRORED_PATTERNS) {
      expect(serverPatterns).toContain(pattern);
    }
  });

  it("mirrors the server's reserved names and clone protocols", () => {
    const serverSets = setLiterals(serverSource).map((items) => [...items].sort());
    expect(serverSets).toContainEqual([...RESERVED_PROCESS_NAMES].sort());
    expect(serverSets).toContainEqual([...GIT_CLONE_PROTOCOLS].sort());
  });

  it("mirrors the server's length and field limits", () => {
    expect(serverSource).toMatch(new RegExp(`CRON_MAX_LENGTH = ${CRON_MAX_LENGTH};`));
    expect(serverSource).toMatch(new RegExp(`CRON_MAX_TOKENS = ${CRON_MAX_TOKENS};`));
    expect(serverSource).toContain(`max length ${GIT_CLONE_URL_MAX_LENGTH}`);
  });

  it("checks the case fixture the server suite also runs", () => {
    expect(Object.keys(cases)).toEqual(
      expect.arrayContaining(["processName", "gitCloneUrl", "envKey", "maxMemoryRestart", "cron"])
    );
  });
});

describe("client validation agrees with the shared accept/reject cases", () => {
  for (const [field, list] of Object.entries(cases as Record<string, Array<{ value: string; valid: boolean; note?: string }>>)) {
    if (field.startsWith("_") || !validators[field]) {
      continue;
    }

    describe(field, () => {
      for (const item of list) {
        it(`${JSON.stringify(item.value).slice(0, 40)} -> ${item.valid ? "accepted" : "rejected"}`, () => {
          expect(validators[field](item.value) === "").toBe(item.valid);
        });
      }
    });
  }
});

describe("validation messages stay useful", () => {
  it("names the field and the reason", () => {
    expect(validateProcessName("my app", "Duplicate target name")).toBe(
      "Duplicate target name can only use letters, numbers, colon, underscore, and dash, up to 100 characters."
    );
    expect(validateProcessName("catalog")).toMatch(/reserved/);
    expect(validateScriptPath("app/../server.js")).toMatch(/traversal/);
    expect(validateEnvKey("MY-KEY")).toMatch(/must start with a letter/);
    expect(validateMaxMemoryRestart("256")).toMatch(/256M, 1G, 512K/);
    expect(validateCronExpression("0 3 * * *; rm -rf /")).toMatch(/single spaces/);
  });
});
