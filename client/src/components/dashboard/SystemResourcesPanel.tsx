// @ts-nocheck
import { PanelHeader } from "../ui/PageLayout";

export default function SystemResourcesPanel({ systemResources, bytesToGB }) {
  return (
    <section className="page-panel">
      <PanelHeader title="System Resources" className="mb-2" />
      {!systemResources ? (
        <p className="text-sm text-text-3">Loading system resources...</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 text-sm md:grid-cols-3">
            <div className="rounded border border-border bg-surface-2 p-2">
              <p className="text-xs text-text-3">CPU</p>
              <p>{systemResources.cpu?.cores || 0} cores</p>
              <p className="text-xs text-text-3">load avg: {(systemResources.loadAverage || []).map((v) => Number(v).toFixed(2)).join(", ")}</p>
            </div>
            <div className="rounded border border-border bg-surface-2 p-2">
              <p className="text-xs text-text-3">Memory</p>
              <p>{bytesToGB(systemResources.memory?.usedBytes || 0)} / {bytesToGB(systemResources.memory?.totalBytes || 0)}</p>
              <p className="text-xs text-text-3">{Number(systemResources.memory?.usedPercent || 0).toFixed(1)}% used</p>
            </div>
            <div className="rounded border border-border bg-surface-2 p-2">
              <p className="text-xs text-text-3">Disk</p>
              <p>{bytesToGB(systemResources.disk?.usedBytes || 0)} / {bytesToGB(systemResources.disk?.totalBytes || 0)}</p>
              <p className="text-xs text-text-3">{Number(systemResources.disk?.usedPercent || 0).toFixed(1)}% used</p>
            </div>
          </div>
          {Array.isArray(systemResources.disk?.mounts) && systemResources.disk.mounts.length > 0 && (
            <div className="max-h-32 space-y-1 overflow-y-auto rounded border border-border bg-surface-2 p-2 text-xs text-text-3">
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
