import Badge from "../ui/Badge";
import { PanelHeader } from "../ui/PageLayout";

export default function DependencyGraphPanel({ dependencyEdges = [] }) {
  return (
    <section>
      <div className="page-panel space-y-3">
        <PanelHeader title="Dependency Graph" />
        {dependencyEdges.length === 0 ? (
          <p className="text-sm text-text-3">No declared process dependencies.</p>
        ) : (
          <div className="space-y-2">
            {dependencyEdges.map((edge) => (
              <div
                key={`${edge.from}->${edge.to}`}
                className="flex items-center gap-2 rounded-md border border-border bg-surface-2 px-3 py-2 text-sm"
              >
                <Badge tone="info">{edge.from}</Badge>
                <span className="text-text-3">depends on</span>
                <Badge tone="warning">{edge.to}</Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
