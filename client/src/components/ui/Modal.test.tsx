import { cleanup, render, screen } from "@testing-library/react";
import Modal from "./Modal";

describe("Modal", () => {
  afterEach(cleanup);

  it("renders the description and describes the dialog with it", () => {
    render(
      <Modal title="Delete process" description="This cannot be undone." onClose={() => {}}>
        <p>body</p>
      </Modal>
    );

    const dialog = screen.getByRole("dialog");
    const description = screen.getByText("This cannot be undone.");
    expect(dialog.getAttribute("aria-describedby")).toBe(description.id);
    expect(dialog.getAttribute("aria-labelledby")).toBe(screen.getByRole("heading").id);
  });

  it("leaves the dialog undescribed when no description is given", () => {
    render(
      <Modal title="Rename" onClose={() => {}}>
        <p>body</p>
      </Modal>
    );

    expect(screen.getByRole("dialog").getAttribute("aria-describedby")).toBeNull();
  });

  it("renders the description in the drawer variant too", () => {
    render(
      <Modal title="Settings" description="Applies to this process." position="right" onClose={() => {}}>
        <p>body</p>
      </Modal>
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-describedby")).toBe(screen.getByText("Applies to this process.").id);
  });
});
