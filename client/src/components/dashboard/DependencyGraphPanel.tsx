// @ts-nocheck
import Badge from "../ui/Badge";
import { PanelHeader } from "../ui/PageLayout";

export default function DependencyGraphPanel({ dependencyEdges = [] }) {
  return (
    <section className="rounded-[1.5rem] border border-border bg-surface p-4">
      <div className="space-y-3">
        <PanelHeader title="Dependency Graph" description="Declared startup and runtime relationships between services." />
        {dependencyEdges.length === 0 ? (
          <div className="rounded-[1.25rem] border border-dashed border-border bg-surface-2/70 px-4 py-6 text-center">
            <p className="text-sm text-text-3">No declared process dependencies.</p>
            <p className="mt-1 text-xs text-text-3">Add metadata links to turn this into a service flow map.</p>
          </div>
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {dependencyEdges.map((edge) => (
              <div
                key={`${edge.from}->${edge.to}`}
                className="relative overflow-hidden rounded-[1.1rem] border border-border bg-gradient-to-r from-surface-2 to-surface px-3 py-3 text-sm"
              >
                <div className="pointer-events-none absolute inset-y-0 left-0 w-1 bg-info-500/70" />
                <div className="ml-3 flex w-full items-center gap-3">
                  <Badge tone="info">{edge.from}</Badge>
                  <span className="text-xs uppercase tracking-[0.24em] text-text-3">depends on</span>
                  <div className="h-px flex-1 bg-border" />
                  <Badge tone="warning">{edge.to}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
