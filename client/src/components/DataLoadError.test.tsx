import { fireEvent, render, screen } from "@testing-library/react";
import DataLoadError from "./DataLoadError";

describe("DataLoadError", () => {
  it("shows the failure and offers the retry action", () => {
    const onRetry = vi.fn();

    render(<DataLoadError message="The server hit a problem." onRetry={onRetry} />);

    expect(screen.getByText("The server hit a problem.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("stays informative without an action when retrying is not possible", () => {
    render(<DataLoadError message="Your session expired. Sign in again to continue." />);

    expect(screen.getByText("Your session expired. Sign in again to continue.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
