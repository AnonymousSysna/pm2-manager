export default function StatCardsSection({ stats = {} }) {
  return (
    <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
      <StatCard label="Total Processes" value={stats.total ?? 0} tone="neutral" />
      <StatCard label="Online" value={stats.online ?? 0} tone="success" />
      <StatCard label="Stopped" value={stats.stopped ?? 0} tone="danger" />
      <StatCard label="Errored" value={stats.errored ?? 0} tone="warning" />
    </section>
  );
}

function StatCard({ label, value, tone }) {
  const toneClass = {
    success: "text-success-300",
    danger: "text-danger-300",
    warning: "text-warning-300",
    neutral: "text-text-1"
  };

  return (
    <div className="page-panel">
      <p className="text-sm text-text-3">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass[tone] || toneClass.neutral}`}>{value}</p>
    </div>
  );
}
