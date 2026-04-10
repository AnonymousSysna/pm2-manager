import { PanelHeader } from "../ui/PageLayout";
import { Skeleton, SkeletonText } from "../ui/Skeleton";

export default function SystemResourcesPanel({ systemResources, bytesToGB }) {
  return (
    <section className="page-panel space-y-3">
      <PanelHeader
        title="Host Capacity"
        description="Keep an eye on the machine before process-level symptoms show up."
      />
      {!systemResources ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-lg border border-border/80 bg-surface-2/70 p-3">
                <Skeleton className="mb-2 h-3 w-16" />
                <Skeleton className="mb-2 h-5 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            ))}
          </div>
          <div className="rounded-lg border border-border/80 bg-surface-2/70 p-3">
            <SkeletonText lines={4} lineClassName="h-3" />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <div className="rounded-lg border border-border/80 bg-surface-2/70 p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-text-3">CPU</p>
              <p className="mt-2 text-base font-semibold text-text-1">{systemResources.cpu?.cores || 0} cores</p>
              <p className="mt-1 text-xs text-text-3">Load avg {(systemResources.loadAverage || []).map((v) => Number(v).toFixed(2)).join(", ")}</p>
            </div>
            <div className="rounded-lg border border-border/80 bg-surface-2/70 p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-text-3">Memory</p>
              <p className="mt-2 text-base font-semibold text-text-1">{bytesToGB(systemResources.memory?.usedBytes || 0)} / {bytesToGB(systemResources.memory?.totalBytes || 0)}</p>
              <p className="mt-1 text-xs text-text-3">{Number(systemResources.memory?.usedPercent || 0).toFixed(1)}% used</p>
            </div>
            <div className="rounded-lg border border-border/80 bg-surface-2/70 p-3">
              <p className="text-[11px] uppercase tracking-[0.16em] text-text-3">Disk</p>
              <p className="mt-2 text-base font-semibold text-text-1">{bytesToGB(systemResources.disk?.usedBytes || 0)} / {bytesToGB(systemResources.disk?.totalBytes || 0)}</p>
              <p className="mt-1 text-xs text-text-3">{Number(systemResources.disk?.usedPercent || 0).toFixed(1)}% used</p>
            </div>
          </div>
          {Array.isArray(systemResources.disk?.mounts) && systemResources.disk.mounts.length > 0 && (
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border/80 bg-surface-2/70 p-3 text-xs text-text-3">
              {systemResources.disk.mounts.slice(0, 12).map((mount) => (
                <p key={`${mount.mount}-${mount.filesystem || ""}`}>
                  {mount.mount}: {bytesToGB(mount.usedBytes || 0)} / {bytesToGB(mount.totalBytes || 0)} ({Number(mount.usedPercent || 0).toFixed(1)}%)
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
