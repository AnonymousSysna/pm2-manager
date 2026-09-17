import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import GitPullConfirmToastBody from "./GitPullConfirmToastBody";

const data = {
  cwd: "/srv/apps/api",
  totalChanged: 4,
  changedFiles: [
    { status: "M", path: "src/routes/api.js" },
    { status: "??", path: "notes/todo.md" }
  ]
};

describe("GitPullConfirmToastBody", () => {
  it("shows the pending changes with design-system buttons", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const onAccept = vi.fn();

    render(<GitPullConfirmToastBody data={data} onCancel={onCancel} onAccept={onAccept} />);

    expect(screen.getByText("/srv/apps/api")).toBeInTheDocument();
    expect(screen.getByText(/M · src\/routes\/api\.js/)).toBeInTheDocument();
    expect(screen.getByText(/\?\? · notes\/todo\.md/)).toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();

    const cancel = screen.getByRole("button", { name: "Cancel" });
    const accept = screen.getByRole("button", { name: "Accept pull" });
    expect(cancel).toHaveClass("rounded-xl");
    expect(accept).toHaveClass("rounded-xl", "bg-brand-600");
    expect(cancel.className).not.toMatch(/gooey-actionButton|git-pull-toast-cancel/);

    await user.click(cancel);
    await user.click(accept);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("falls back to a plain message when there is nothing to list", () => {
    render(<GitPullConfirmToastBody onCancel={vi.fn()} onAccept={vi.fn()} />);

    expect(screen.getByText("Stash local changes before pulling latest code.")).toBeInTheDocument();
    expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
  });
});
