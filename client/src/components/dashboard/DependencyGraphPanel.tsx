import Badge from "../ui/Badge";
import { PanelHeader } from "../ui/PageLayout";

export default function DependencyGraphPanel({ dependencyEdges = [] }) {
  return (
    <section className="page-panel space-y-3">
      <PanelHeader
        title="Dependencies"
        description="Declared startup relationships that matter when you duplicate, deploy, or debug cascading failures."
      />
      {dependencyEdges.length === 0 ? (
        <p className="text-sm text-text-3">No declared process dependencies.</p>
      ) : (
        <div className="space-y-2">
          {dependencyEdges.map((edge) => (
            <div
              key={`${edge.from}->${edge.to}`}
              className="flex items-center gap-2 rounded-lg border border-border/80 bg-surface-2/60 px-3 py-2 text-sm"
            >
              <Badge tone="info">{edge.from}</Badge>
              <span className="text-text-3">depends on</span>
              <Badge tone="warning">{edge.to}</Badge>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
