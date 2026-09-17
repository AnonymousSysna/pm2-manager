import { fireEvent, render, screen } from "@testing-library/react";
import MetricsHistoryPanel from "./MetricsHistoryPanel";

const baseProps = {
  chartProcess: "api",
  onChartProcessChange: vi.fn(),
  processes: [{ name: "api" }]
};

describe("MetricsHistoryPanel", () => {
  it("draws both trends when the samples loaded", () => {
    render(<MetricsHistoryPanel {...baseProps} historyPoints={[{ cpu: 12, memory: 1024 }]} />);

    expect(screen.getByText("CPU %")).toBeInTheDocument();
    expect(screen.getByText("Memory MB")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("replaces the charts with the failure so empty never means two different things", () => {
    const onRetry = vi.fn();

    render(<MetricsHistoryPanel {...baseProps} historyPoints={[]} metricsError="The server hit a problem." onRetry={onRetry} />);

    expect(screen.getByText("The server hit a problem.")).toBeInTheDocument();
    expect(screen.queryByText("CPU %")).not.toBeInTheDocument();
    expect(screen.queryByText("Memory MB")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
