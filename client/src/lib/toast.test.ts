import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const success = vi.fn();
  const error = vi.fn();
  const info = vi.fn();
  const warning = vi.fn();
  const dismiss = vi.fn();
  const update = vi.fn();
  const promise = vi.fn();
  const gooeyToast = Object.assign(vi.fn(), { success, error, info, warning, dismiss, update, promise });
  return { gooeyToast, success, error, info, warning, dismiss, update, promise };
});

vi.mock("goey-toast", () => ({
  gooeyToast: mocks.gooeyToast,
  GooeyToaster: () => null
}));

async function freshToast() {
  vi.resetModules();
  Object.values(mocks)
    .filter((value) => typeof value === "function" && "mockClear" in value)
    .forEach((value) => value.mockClear());
  const module = await import("./toast");
  return module.default;
}

describe("toast", () => {
  it("queues a toast raised before the library arrives, then raises it", async () => {
    const toast = await freshToast();

    toast.success("Process restarted");
    expect(mocks.success).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledWith("Process restarted", undefined));

    // Once loaded, later calls go straight through.
    toast.success("Second");
    expect(mocks.success).toHaveBeenCalledTimes(2);
  });

  it("dispatches the calls in the order they were made", async () => {
    const toast = await freshToast();

    toast.info("first");
    toast.error("second");
    toast.warning("third");

    await vi.waitFor(() => expect(mocks.warning).toHaveBeenCalledWith("third", undefined));
    expect(mocks.info).toHaveBeenCalledWith("first", undefined);
    expect(mocks.error).toHaveBeenCalledWith("second", undefined);
  });

  it("keeps returning the caller's own promise, loaded or not", async () => {
    const toast = await freshToast();

    let settle = () => {};
    const work = new Promise((resolve) => {
      settle = resolve;
    });

    const returned = toast.promise(work, { success: "Deployed" });
    expect(returned).toBe(work);

    await vi.waitFor(() => expect(mocks.promise).toHaveBeenCalled());
    const [dispatched, messages] = mocks.promise.mock.calls[0];
    expect(dispatched).toBe(work);
    expect(messages.success).toBe("Deployed");
    expect(messages.loading).toBe("Working...");

    settle("done");
    await expect(returned).resolves.toBe("done");
  });

  it("passes options through untouched and turns failures into readable text", async () => {
    const toast = await freshToast();

    toast.error("Upload rejected", { description: "detail" });
    await vi.waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(mocks.error).toHaveBeenCalledWith("Upload rejected", { description: "detail" });

    // The promise toast's error text goes through the API normaliser, so a
    // server explanation wins over the transport wording.
    const { getErrorMessage } = await import("./toast");
    expect(getErrorMessage({ response: { status: 400, data: { error: "Port is already in use" } } })).toBe(
      "Port is already in use"
    );
    expect(getErrorMessage(new Error("Network Error"), "fallback")).toBe("Network Error");
  });
});
