import { createErrorReporter, fingerprintReport, isErrorReportingEnabled } from "./errorReporter";

function createHarness(overrides: Partial<Parameters<typeof createErrorReporter>[0]> = {}) {
  const sent: unknown[] = [];
  let clock = 1_000_000;
  const reporter = createErrorReporter({
    enabled: true,
    send: (payload) => {
      sent.push(payload);
    },
    now: () => clock,
    environment: () => ({
      route: "/dashboard",
      url: "https://pm2.example.com/dashboard?token=abc",
      userAgent: "vitest",
      release: "1.0.57",
      sessionId: "session-1"
    }),
    ...overrides
  });
  return { reporter, sent, advance: (ms: number) => { clock += ms; } };
}

describe("errorReporter", () => {
  it("sends a report with route context", () => {
    const { reporter, sent } = createHarness();

    const fingerprint = reporter.report({ message: "boom", kind: "error" });

    expect(sent).toHaveLength(1);
    expect(fingerprint).toBeTruthy();
    expect(sent[0]).toMatchObject({
      message: "boom",
      kind: "error",
      route: "/dashboard",
      release: "1.0.57",
      sessionId: "session-1",
      severity: "error"
    });
  });

  it("collapses repeats of the same crash inside the dedupe window", () => {
    const { reporter, sent, advance } = createHarness();

    reporter.report({ message: "boom", stack: "Error: boom\n  at Card (app.js:1:1)" });
    reporter.report({ message: "boom", stack: "Error: boom\n  at Card (app.js:1:1)" });
    advance(30_000);
    reporter.report({ message: "boom", stack: "Error: boom\n  at Card (app.js:1:1)" });

    expect(sent).toHaveLength(1);
  });

  it("resends after the dedupe window elapses", () => {
    const { reporter, sent, advance } = createHarness();

    reporter.report({ message: "boom" });
    advance(120_000);
    reporter.report({ message: "boom" });

    expect(sent).toHaveLength(2);
  });

  it("never sends when reporting is disabled but still keeps a local buffer", () => {
    const { reporter, sent } = createHarness({ enabled: false });

    reporter.report({ message: "quiet" });

    expect(sent).toHaveLength(0);
    expect(reporter.getBuffer()).toHaveLength(1);
    expect(reporter.getBuffer()[0].input.message).toBe("quiet");
  });

  it("caps a burst of distinct errors", () => {
    const { reporter, sent } = createHarness({ maxSendsPerBurst: 2 });

    reporter.report({ message: "one" });
    reporter.report({ message: "two" });
    reporter.report({ message: "three" });

    expect(sent).toHaveLength(2);
  });

  it("caps total reports per session", () => {
    const { reporter, sent, advance } = createHarness({ maxReportsPerSession: 2, dedupeWindowMs: 0 });

    reporter.report({ message: "one" });
    advance(10);
    reporter.report({ message: "two" });
    advance(10);
    reporter.report({ message: "three" });

    expect(sent).toHaveLength(2);
  });

  it("captures window errors and unhandled rejections once installed", () => {
    const { reporter, sent } = createHarness();
    reporter.install();
    reporter.install();

    const error = new Error("window exploded");
    window.dispatchEvent(new ErrorEvent("error", { error, message: "window exploded" }));
    const rejection = new Event("unhandledrejection") as Event & { reason?: unknown };
    rejection.reason = "promise exploded";
    window.dispatchEvent(rejection);

    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ kind: "error", message: "window exploded" });
    expect(sent[1]).toMatchObject({ kind: "unhandledrejection", message: "promise exploded" });
  });

  it("groups reports from the same source frame", () => {
    const a = fingerprintReport({ message: "boom", source: "Card", stack: "Error: boom\n  at Card (app.js:1:1)" });
    const b = fingerprintReport({ message: "boom", source: "Card", stack: "Error: boom\n  at Card (app.js:1:1)" });
    const c = fingerprintReport({ message: "other", source: "Card", stack: "Error: other\n  at Card (app.js:1:1)" });
    const differentFrame = fingerprintReport({ message: "boom", source: "Card", stack: "Error: boom\n  at Other (app.js:9:9)" });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(differentFrame);
  });

  it("defaults reporting off in test/dev and on in production builds", () => {
    expect(isErrorReportingEnabled()).toBe(false);
  });
});
