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
    <svg viewBox={`0 0 ${width} ${height}`} className="h-28 w-full rounded border border-border bg-surface-2">
      <path d={path} fill="none" stroke={stroke} strokeWidth="2" />
    </svg>
  );
}

export default function MetricsHistoryPanel({ chartProcess, onChartProcessChange, processes = [], historyPoints = [] }) {
  return (
    <section>
      <div className="page-panel space-y-3">
        <PanelHeader title="CPU / Memory History" />
        <Select value={chartProcess} onChange={(e) => onChartProcessChange(e.target.value)} className="w-full">
          {processes.map((proc) => (
            <option key={proc.name} value={proc.name}>
              {proc.name}
            </option>
          ))}
        </Select>
        <div>
          <p className="mb-1 text-xs text-text-3">CPU %</p>
          <SparkLine points={historyPoints} accessor={(point) => Number(point.cpu || 0)} stroke="rgb(var(--color-brand-500))" />
        </div>
        <div>
          <p className="mb-1 text-xs text-text-3">Memory MB</p>
          <SparkLine
            points={historyPoints}
            accessor={(point) => Number(point.memory || 0) / 1024 / 1024}
            stroke="rgb(var(--color-info-500))"
          />
        </div>
      </div>
    </section>
  );
}
