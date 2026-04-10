// @ts-nocheck
import StatusText from "../ui/StatusText";

export default function StatCardsSection({ stats = {} }) {
  const total = Number(stats.total ?? 0);
  const online = Number(stats.online ?? 0);
  const stopped = Number(stats.stopped ?? 0);
  const errored = Number(stats.errored ?? 0);
  const healthyPercent = total > 0 ? Math.round((online / total) * 100) : 0;

  return (
    <section className="grid grid-cols-1 gap-3 xl:grid-cols-12">
      <StatCard
        className="xl:col-span-5"
        eyebrow="Fleet"
        label="Process health at a glance"
        value={`${healthyPercent}%`}
        helper={`${online}/${total} processes online`}
        tone="neutral"
        accentClassName="from-brand-500/30 via-info-500/20 to-transparent"
      />
      <StatCard
        className="xl:col-span-2"
        eyebrow="Running"
        label="Online"
        value={online}
        helper={online === 1 ? "service active" : "services active"}
        tone="success"
        accentClassName="from-success-500/30 via-success-500/10 to-transparent"
      />
      <StatCard
        className="xl:col-span-2"
        eyebrow="Attention"
        label="Errored"
        value={errored}
        helper={errored > 0 ? "needs intervention" : "no critical faults"}
        tone="warning"
        accentClassName="from-warning-500/30 via-warning-500/10 to-transparent"
      />
      <StatCard
        className="xl:col-span-3"
        eyebrow="Idle"
        label="Stopped"
        value={stopped}
        helper={stopped > 0 ? "parked processes" : "nothing parked"}
        tone="danger"
        accentClassName="from-danger-500/30 via-danger-500/10 to-transparent"
      />
    </section>
  );
}

function StatCard({ eyebrow, label, value, helper, tone, className, accentClassName }) {
  return (
    <article className={`relative overflow-hidden rounded-[1.25rem] border border-border bg-surface px-4 py-4 ${className || ""}`}>
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-br ${accentClassName || "from-surface-2 to-transparent"}`} />
      <div className="pointer-events-none absolute right-4 top-4 h-14 w-14 rounded-full border border-white/10 bg-bg/30 blur-sm" />
      <div className="relative">
        <p className="text-[0.65rem] uppercase tracking-[0.28em] text-text-3">{eyebrow}</p>
        <div className="mt-6 flex items-end justify-between gap-3">
          <div>
            <p className="text-sm text-text-2">{label}</p>
            <StatusText tone={tone} className="mt-2 block text-4xl font-semibold leading-none">
              {value}
            </StatusText>
          </div>
          <div className="hidden h-16 w-px bg-border/70 sm:block" />
          <p className="max-w-[12rem] text-right text-xs text-text-3">{helper}</p>
        </div>
      </div>
    </article>
  );
}
