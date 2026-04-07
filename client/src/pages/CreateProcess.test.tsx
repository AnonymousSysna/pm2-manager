import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CreateProcess from "./CreateProcess";

const nodeRuntimeStatusMock = vi.fn();

vi.mock("../hooks/useSocket", () => ({
  useSocket: () => ({
    createStepEvents: []
  })
}));

vi.mock("../api", () => ({
  processes: {
    nodeRuntimeStatus: (...args: unknown[]) => nodeRuntimeStatusMock(...args),
    create: vi.fn()
  }
}));

vi.mock("../lib/toast", () => ({
  __esModule: true,
  default: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    promise: vi.fn((promise: Promise<unknown>) => promise)
  },
  getErrorMessage: (error: Error | undefined, fallback: string) => error?.message || fallback
}));

describe("CreateProcess", () => {
  beforeEach(() => {
    nodeRuntimeStatusMock.mockReset();
    nodeRuntimeStatusMock.mockResolvedValue({ success: true, data: {}, error: null });
    localStorage.clear();
  });

  it("auto-fills a relative project path for git clone mode", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <CreateProcess />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(nodeRuntimeStatusMock).toHaveBeenCalled();
    });

    await user.click(screen.getByRole("button", { name: "Git Clone" }));
    await user.type(screen.getByLabelText("Git Clone URL *"), "https://github.com/acme/sample-app.git");

    expect(screen.getByLabelText("Process Name *")).toHaveValue("sample-app");
    expect(screen.getByLabelText("Project Directory *")).toHaveValue("sample-app");
  });
});
