import Button from "../ui/Button";

export default function GitPullConfirmToastBody({ data = {}, onCancel, onAccept }) {
  const dirtyFiles = Array.isArray(data.changedFiles) ? data.changedFiles : [];
  const totalChanged = Number(data.totalChanged || dirtyFiles.length || 0);
  const visibleFiles = dirtyFiles.slice(0, 5);
  const hiddenCount = Math.max(0, totalChanged - visibleFiles.length);

  return (
    <div className="grid w-full min-w-0 gap-2 text-xs text-text-2">
      <p>Stash local changes before pulling latest code.</p>
      {data.cwd ? (
        <code className="block w-full min-w-0 truncate rounded-lg border border-border/70 bg-surface-2/60 px-2 py-1 font-mono text-text-1">
          {data.cwd}
        </code>
      ) : null}
      {visibleFiles.length > 0 ? (
        <div className="grid w-full min-w-0 max-h-28 gap-1 overflow-auto rounded-lg border border-warning-500/25 bg-warning-500/10 px-2 py-1 font-mono">
          {visibleFiles.map((item, index) => (
            <span key={`${item?.path || item}-${index}`} className="block min-h-5 truncate leading-5">
              {item?.status ? `${item.status} · ` : ""}
              {item?.path || String(item)}
            </span>
          ))}
          {hiddenCount > 0 ? <span className="text-text-3">+{hiddenCount} more</span> : null}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="primary" size="sm" onClick={onAccept}>
          Accept pull
        </Button>
      </div>
    </div>
  );
}
