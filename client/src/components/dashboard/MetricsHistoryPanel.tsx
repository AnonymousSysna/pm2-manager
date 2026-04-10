// @ts-nocheck
import Select from "../ui/Select";
import { PanelHeader } from "../ui/PageLayout";

function toPath(points, width, height, accessor) {
  if (!Array.isArray(points) || points.length === 0) {
    return "";
  }

  const values = points.map(accessor);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * width;
      const rawY = accessor(point);
      const y = height - ((rawY - min) / range) * height;
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

function SparkLine({ points, accessor, stroke }) {
  const width = 420;
  const height = 120;
  const path = toPath(points, width, height, accessor);

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="h-32 w-full rounded-[1.1rem] border border-border bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_45%),linear-gradient(180deg,rgba(7,12,22,0.9),rgba(16,24,39,0.95))]"
    >
      {Array.from({ length: 5 }).map((_, index) => {
        const y = (height / 4) * index;
        return <line key={index} x1="0" x2={width} y1={y} y2={y} stroke="rgba(148,163,184,0.12)" strokeWidth="1" />;
      })}
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

export default function MetricsHistoryPanel({ chartProcess, onChartProcessChange, processes = [], historyPoints = [] }) {
  const latestPoint = historyPoints[historyPoints.length - 1] || null;
  const peakCpu = historyPoints.length > 0 ? Math.max(...historyPoints.map((point) => Number(point.cpu || 0))) : 0;
  const peakMemory = historyPoints.length > 0 ? Math.max(...historyPoints.map((point) => Number(point.memory || 0) / 1024 / 1024)) : 0;

  return (
    <section className="rounded-[1.5rem] border border-border bg-surface p-4">
      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <PanelHeader title="Performance Trace" description="Recent CPU and memory pressure for the selected service." />
          <div className="w-full max-w-xs">
            <p className="mb-1 text-xs uppercase tracking-[0.24em] text-text-3">Trace target</p>
            <Select value={chartProcess} onChange={(e) => onChartProcessChange(e.target.value)} className="w-full">
              {processes.map((proc) => (
                <option key={proc.name} value={proc.name}>
                  {proc.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <MetricChip label="Current CPU" value={`${Number(latestPoint?.cpu || 0).toFixed(1)}%`} />
          <MetricChip label="Peak CPU" value={`${peakCpu.toFixed(1)}%`} />
          <MetricChip label="Peak Memory" value={`${peakMemory.toFixed(1)} MB`} />
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.24em] text-text-3">CPU %</p>
            <SparkLine points={historyPoints} accessor={(point) => Number(point.cpu || 0)} stroke="rgb(var(--color-brand-400))" />
          </div>
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.24em] text-text-3">Memory MB</p>
            <SparkLine
              points={historyPoints}
              accessor={(point) => Number(point.memory || 0) / 1024 / 1024}
              stroke="rgb(var(--color-info-300))"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricChip({ label, value }) {
  return (
    <div className="rounded-[1.1rem] border border-border bg-surface-2/70 px-3 py-3">
      <p className="text-[0.65rem] uppercase tracking-[0.24em] text-text-3">{label}</p>
      <p className="mt-2 text-xl font-semibold text-text-1">{value}</p>
    </div>
  );
}
