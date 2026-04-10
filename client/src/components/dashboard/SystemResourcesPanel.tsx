// @ts-nocheck
import { PanelHeader } from "../ui/PageLayout";
import ProgressBar from "../ui/ProgressBar";
import { Skeleton, SkeletonText } from "../ui/Skeleton";

export default function SystemResourcesPanel({ systemResources, bytesToGB }) {
  return (
    <section className="rounded-[1.5rem] border border-border bg-gradient-to-br from-surface via-surface to-surface-2 p-4">
      <PanelHeader title="Machine Readout" description="Host load, memory pressure, and mounted storage." className="mb-3" />
      {!systemResources ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {[0, 1, 2].map((item) => (
              <div key={item} className="rounded-2xl border border-border bg-bg/30 p-3">
                <Skeleton className="mb-2 h-3 w-20" />
                <Skeleton className="mb-2 h-7 w-24" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="mt-3 h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-border bg-bg/30 p-3">
            <SkeletonText lines={4} lineClassName="h-3" />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <ReadoutCard
              label="CPU"
              value={`${systemResources.cpu?.cores || 0} cores`}
              helper={`load avg ${formatLoadAverage(systemResources.loadAverage)}`}
              progressValue={Math.min(100, Math.round((Number(systemResources.loadAverage?.[0] || 0) / Math.max(1, Number(systemResources.cpu?.cores || 1))) * 100))}
              tone="info"
            />
            <ReadoutCard
              label="Memory"
              value={`${bytesToGB(systemResources.memory?.usedBytes || 0)} / ${bytesToGB(systemResources.memory?.totalBytes || 0)}`}
              helper={`${Number(systemResources.memory?.usedPercent || 0).toFixed(1)}% used`}
              progressValue={Number(systemResources.memory?.usedPercent || 0)}
              tone="warning"
            />
            <ReadoutCard
              label="Disk"
              value={`${bytesToGB(systemResources.disk?.usedBytes || 0)} / ${bytesToGB(systemResources.disk?.totalBytes || 0)}`}
              helper={`${Number(systemResources.disk?.usedPercent || 0).toFixed(1)}% used`}
              progressValue={Number(systemResources.disk?.usedPercent || 0)}
              tone="success"
            />
          </div>
          {Array.isArray(systemResources.disk?.mounts) && systemResources.disk.mounts.length > 0 && (
            <div className="rounded-[1.25rem] border border-border bg-bg/30 p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-xs uppercase tracking-[0.24em] text-text-3">Mounted Volumes</p>
                <p className="text-xs text-text-3">{systemResources.disk.mounts.length} detected</p>
              </div>
              <div className="max-h-40 space-y-3 overflow-y-auto pr-1">
                {systemResources.disk.mounts.slice(0, 12).map((mount) => (
                  <div key={`${mount.mount}-${mount.filesystem || ""}`} className="rounded-xl border border-border/70 bg-surface/80 px-3 py-2">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <p className="font-medium text-text-1">{mount.mount}</p>
                      <p className="text-text-3">{bytesToGB(mount.usedBytes || 0)} / {bytesToGB(mount.totalBytes || 0)}</p>
                    </div>
                    <ProgressBar className="mt-2 h-2" value={Number(mount.usedPercent || 0)} tone={Number(mount.usedPercent || 0) > 85 ? "danger" : "success"} />
                    <p className="mt-2 text-xs text-text-3">{Number(mount.usedPercent || 0).toFixed(1)}% in use</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function formatLoadAverage(loadAverage = []) {
  return (loadAverage || []).map((value) => Number(value).toFixed(2)).join(" / ");
}

function ReadoutCard({ label, value, helper, progressValue, tone }) {
  return (
    <div className="rounded-[1.25rem] border border-border bg-bg/30 p-3">
      <p className="text-[0.65rem] uppercase tracking-[0.24em] text-text-3">{label}</p>
      <p className="mt-3 text-2xl font-semibold text-text-1">{value}</p>
      <p className="mt-1 text-xs text-text-3">{helper}</p>
      <ProgressBar className="mt-4 h-2" value={progressValue} tone={tone} />
    </div>
  );
}
