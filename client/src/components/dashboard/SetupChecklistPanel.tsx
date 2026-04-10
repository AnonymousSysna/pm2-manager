import Badge from "../ui/Badge";
import Button from "../ui/Button";
import { PanelHeader } from "../ui/PageLayout";

export default function SetupChecklistPanel({ checklistItems, checklistDoneCount, onDismiss, onNavigate }) {
  return (
    <section className="page-panel space-y-3">
      <PanelHeader
        title={`Operator Setup ${checklistDoneCount}/${checklistItems.length}`}
        description="Keep the instance usable before you scale process count or add more automation."
        actions={(
          <Button type="button" size="sm" variant="secondary" onClick={onDismiss}>
            Hide checklist
          </Button>
        )}
      />

      <div className="space-y-2">
        {checklistItems.map((item) => (
          <div key={item.key} className="rounded-lg border border-border/80 bg-surface-2/60 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={item.done ? "success" : "warning"}>{item.done ? "Ready" : "Pending"}</Badge>
                  <p className="text-sm font-medium text-text-1">{item.label}</p>
                </div>
              </div>
              {!item.done && (
                <Button type="button" size="sm" variant="outlineInfo" onClick={() => onNavigate(item.to)}>
                  Go there
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
