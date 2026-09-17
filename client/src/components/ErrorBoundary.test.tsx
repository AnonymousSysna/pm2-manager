import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ErrorBoundary from "./ErrorBoundary";
import { errorReporter } from "../lib/errorReporter";

function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("kaboom");
  }
  return <p>recovered view</p>;
}

describe("ErrorBoundary", () => {
  let reportSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    reportSpy = vi.spyOn(errorReporter, "reportReactError").mockReturnValue(null);
  });

  afterEach(() => {
    reportSpy.mockRestore();
  });

  it("renders the fallback and reports the crash", () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/This screen stopped responding/)).toBeInTheDocument();
    expect(screen.getByText(/kaboom/)).toBeInTheDocument();
    expect(reportSpy).toHaveBeenCalledTimes(1);
  });

  it("recovers in place when the user retries", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ErrorBoundary>
        <Boom shouldThrow />
      </ErrorBoundary>
    );

    rerender(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>
    );

    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(screen.getByText("recovered view")).toBeInTheDocument();
  });

  it("clears the error when the route changes", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/dashboard">
        <Boom shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();

    rerender(
      <ErrorBoundary resetKey="/dashboard/settings">
        <Boom shouldThrow={false} />
      </ErrorBoundary>
    );

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("recovered view")).toBeInTheDocument();
  });

  it("renders children untouched while healthy", () => {
    render(
      <ErrorBoundary>
        <Boom shouldThrow={false} />
      </ErrorBoundary>
    );
    expect(screen.getByText("recovered view")).toBeInTheDocument();
    expect(reportSpy).not.toHaveBeenCalled();
  });
});
