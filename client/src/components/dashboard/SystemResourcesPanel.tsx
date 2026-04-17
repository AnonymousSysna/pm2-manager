import { PanelHeader } from "../ui/PageLayout";
import { Skeleton, SkeletonText } from "../ui/Skeleton";
import { InsetCard, StatCard } from "../ui/Surface";

export default function SystemResourcesPanel({ systemResources, bytesToGB }) {
  return (
    <section className="page-panel space-y-3">
      <PanelHeader
        title="Host Capacity"
        description="CPU, memory, disk, and mount usage on the machine running PM2."
      />
      {!systemResources ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <InsetCard key={item}>
                <Skeleton className="mb-2 h-3 w-16" />
                <Skeleton className="mb-2 h-5 w-24" />
                <Skeleton className="h-3 w-32" />
              </InsetCard>
            ))}
          </div>
          <InsetCard>
            <SkeletonText lines={4} lineClassName="h-3" />
          </InsetCard>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <StatCard
              label="CPU"
              value={`${systemResources.cpu?.cores || 0} cores`}
              note={`Load avg ${(systemResources.loadAverage || []).map((v) => Number(v).toFixed(2)).join(", ")}`}
            />
            <StatCard
              label="Memory"
              value={`${bytesToGB(systemResources.memory?.usedBytes || 0)} / ${bytesToGB(systemResources.memory?.totalBytes || 0)}`}
              note={`${Number(systemResources.memory?.usedPercent || 0).toFixed(1)}% used`}
            />
            <StatCard
              label="Disk"
              value={`${bytesToGB(systemResources.disk?.usedBytes || 0)} / ${bytesToGB(systemResources.disk?.totalBytes || 0)}`}
              note={`${Number(systemResources.disk?.usedPercent || 0).toFixed(1)}% used`}
            />
          </div>
          {Array.isArray(systemResources.disk?.mounts) && systemResources.disk.mounts.length > 0 && (
            <InsetCard className="max-h-40 space-y-1 overflow-y-auto text-xs text-text-3">
              {systemResources.disk.mounts.slice(0, 12).map((mount) => (
                <p key={`${mount.mount}-${mount.filesystem || ""}`}>
                  {mount.mount}: {bytesToGB(mount.usedBytes || 0)} / {bytesToGB(mount.totalBytes || 0)} ({Number(mount.usedPercent || 0).toFixed(1)}%)
                </p>
              ))}
            </InsetCard>
          )}
        </div>
      )}
    </section>
  );
}
