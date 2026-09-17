import {
  MAX_ALERTS,
  MAX_CREATE_STEPS,
  MAX_LOG_ENTRIES_PER_PROCESS,
  MAX_NOTIFICATIONS,
  appendAlerts,
  appendCreateStep,
  appendLog,
  appendNotifications,
  applyDelta,
  applySnapshot,
  dropLogsFor
} from "./processStore";

const proc = (name: string, extra: Record<string, unknown> = {}) => ({ name, status: "online", ...extra });

describe("applySnapshot", () => {
  it("keeps named processes and drops anything else", () => {
    const result = applySnapshot([proc("api"), { status: "online" }, null, proc("worker")]);
    expect(result.map((item) => item.name)).toEqual(["api", "worker"]);
  });

  it("returns an empty list for a malformed payload instead of throwing", () => {
    expect(applySnapshot(undefined)).toEqual([]);
    expect(applySnapshot("nope")).toEqual([]);
  });
});

describe("applyDelta", () => {
  it("replaces an existing process in place so the list does not reshuffle", () => {
    const before = [proc("api", { cpu: 1 }), proc("worker", { cpu: 2 })];
    const after = applyDelta(before, { upserts: [proc("api", { cpu: 90 })], removed: [] });

    expect(after.map((item) => item.name)).toEqual(["api", "worker"]);
    expect(after[0].cpu).toBe(90);
  });

  it("appends new processes and removes deleted ones", () => {
    const before = [proc("api"), proc("worker")];
    const after = applyDelta(before, { upserts: [proc("cron")], removed: ["api"] });

    expect(after.map((item) => item.name)).toEqual(["worker", "cron"]);
  });

  it("ignores upserts without a name and tolerates missing fields", () => {
    const after = applyDelta([proc("api")], {
      upserts: [{ status: "errored" }, proc("api")],
      removed: undefined as unknown as string[]
    });

    expect(after.map((item) => item.name)).toEqual(["api"]);
  });
});

describe("log buffer", () => {
  it("appends per process without touching other processes", () => {
    const first = appendLog({}, { processName: "api", line: "a" });
    const second = appendLog(first, { processName: "worker", line: "b" });
    const third = appendLog(second, { processName: "api", line: "c" });

    expect(third.api.map((entry) => entry.line)).toEqual(["a", "c"]);
    expect(third.worker.map((entry) => entry.line)).toEqual(["b"]);
  });

  it("keeps only the newest entries", () => {
    let logs: Record<string, any[]> = {};
    for (let index = 0; index < MAX_LOG_ENTRIES_PER_PROCESS + 5; index += 1) {
      logs = appendLog(logs, { processName: "api", line: String(index) });
    }

    expect(logs.api).toHaveLength(MAX_LOG_ENTRIES_PER_PROCESS);
    expect(logs.api[0].line).toBe("5");
  });

  it("drops a deleted process's buffer and returns the same object when absent", () => {
    const logs = { api: [{ processName: "api" }] };
    expect(dropLogsFor(logs, "api")).toEqual({});
    expect(dropLogsFor(logs, "missing")).toBe(logs);
  });
});

describe("capped buffers", () => {
  it("caps alerts, notifications, and create steps", () => {
    expect(appendAlerts([], Array.from({ length: MAX_ALERTS + 10 }, (_, i) => ({ ts: i })))).toHaveLength(MAX_ALERTS);
    expect(
      appendNotifications([], Array.from({ length: MAX_NOTIFICATIONS + 10 }, (_, i) => ({ ts: i })))
    ).toHaveLength(MAX_NOTIFICATIONS);
    let steps: any[] = [];
    for (let index = 0; index < MAX_CREATE_STEPS + 10; index += 1) {
      steps = appendCreateStep(steps, {
        operationId: "op",
        stepId: `s${index}`,
        label: "l",
        status: "running"
      });
    }
    expect(steps).toHaveLength(MAX_CREATE_STEPS);
    expect(steps[0].stepId).toBe("s10");
  });

  it("keeps the newest items and drops the oldest when the cap is exceeded", () => {
    const alerts = Array.from({ length: MAX_ALERTS }, (_, i) => ({ ts: i }));
    const next = appendAlerts(alerts, [{ ts: "new" }]);

    expect(next).toHaveLength(MAX_ALERTS);
    expect(next[0].ts).toBe(1);
    expect(next[MAX_ALERTS - 1].ts).toBe("new");
  });
});
