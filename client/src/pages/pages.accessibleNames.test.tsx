import { cleanup, render } from "@testing-library/react";
import type { ElementType } from "react";
import { MemoryRouter } from "react-router-dom";
import { unnamedControls, visibleControls } from "../test/accessibleName";
import Logs from "./Logs";
import Settings from "./Settings";
import History from "./History";
import CreateProcess from "./CreateProcess";
import Caddy from "./Caddy";
import Extensions from "./Extensions";
import Notifications from "./Notifications";

// The same rule the overview is held to, applied to every other page: a control
// must have a name a screen reader can announce (see ../test/accessibleName).
//
// The pages are rendered against a stub API, so this covers the controls the
// page shell always shows: toolbars, filter rows, forms. Controls that only
// exist once data loads (table rows, channel lists) are covered by the
// per-page tests that supply real fixtures.
//
// `minControls` is a floor, not an exact count. It exists so that a page that
// silently stops rendering cannot pass this test by having nothing to check.
// PM2Features is absent because it renders nothing until the server reports
// which PM2 features exist; it needs its own fixture before it can be held to
// this rule.
const pages: Array<[string, ElementType, string, number]> = [
  ["Logs", Logs, "/dashboard/logs", 12],
  ["Settings", Settings, "/dashboard/settings", 19],
  ["History", History, "/dashboard/history", 15],
  ["Add process", CreateProcess, "/dashboard/create", 10],
  ["Caddy", Caddy, "/dashboard/caddy", 2],
  ["Extensions", Extensions, "/dashboard/extensions", 7],
  ["Notifications", Notifications, "/dashboard/notifications", 5]
];

const { apiStub } = vi.hoisted(() => {
  const empty = async () => ({ success: true, data: null, error: null });
  const data = async (value: unknown) => ({ success: true, data: value, error: null });
  const group = () => new Proxy({}, { get: () => async () => empty() });
  const groups: Record<string, unknown> = {
    auth: group(),
    processes: group(),
    system: group(),
    pm2Admin: group(),
    alerts: group(),
    jcode: group(),
    caddy: group()
  };
  Object.assign(groups, {
    pm2Admin: {
      info: () => data({ pm2Version: "5.4.0", nodeVersion: "v20.11.0", home: "/home/pm2" }),
      features: () => data([])
    },
    system: { readiness: () => data({ ready: true, checks: [] }) },
    alerts: { listChannels: () => data([]), history: () => data([]) }
  });
  return { apiStub: { ...groups, default: group() } };
});

const socketState = {
  logsByProcess: {},
  processes: [{ name: "api", status: "online", restarts: 0, pid: 101, cpu: 1, memory: 1024 }],
  alerts: [],
  notifications: [],
  createStepEvents: [],
  monitorError: "",
  connected: true,
  reconnecting: false
};

vi.mock("../hooks/useSocket", () => ({ useSocket: () => socketState }));
vi.mock("../api", () => apiStub);
vi.mock("../lib/toast", () => ({
  __esModule: true,
  default: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), promise: vi.fn((promise) => promise) },
  getErrorMessage: (error, fallback) => error?.message || fallback
}));

describe("Page accessible names", () => {
  afterEach(cleanup);

  it.each(pages)("%s names every control it renders", async (name, Page, path, minControls) => {
    const { container } = render(
      <MemoryRouter initialEntries={[path]}>
        <Page />
      </MemoryRouter>
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const controls = visibleControls(container);
    expect(controls.length, `${name} rendered ${controls.length} controls`).toBeGreaterThanOrEqual(minControls);
    expect(unnamedControls(container), `${name} controls with no accessible name`).toEqual([]);
  });
});
