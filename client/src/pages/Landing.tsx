// @ts-nocheck
import { Activity, ArrowRight, Bell, GitBranch, Radio, Rocket, Server, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";

const systemLanes = [
  {
    label: "Process control",
    value: "Start, stop, restart, reload",
    tone: "border-info-500/30 bg-info-500/10 text-info-300"
  },
  {
    label: "Release flow",
    value: "Deploy, rollback, inspect history",
    tone: "border-success-500/30 bg-success-500/10 text-success-300"
  },
  {
    label: "Operational signals",
    value: "Alerts, logs, reverse proxy state",
    tone: "border-warning-500/30 bg-warning-500/10 text-warning-300"
  }
];

const modules = [
  {
    title: "Control processes without hopping between terminals.",
    description: "See runtime state, restart history, and lifecycle actions in the same place you review logs.",
    icon: Server
  },
  {
    title: "Treat deploys like operational events, not shell rituals.",
    description: "Push a release, inspect build choices, and roll back with context still visible.",
    icon: Rocket
  },
  {
    title: "Keep support signals close to the service they belong to.",
    description: "Threshold alerts, Caddy routing, and runtime metadata stay attached to the application surface.",
    icon: Bell
  }
];

const feed = [
  { icon: Activity, label: "CPU / memory history", value: "Watch pressure before it becomes downtime." },
  { icon: GitBranch, label: "Deployment history", value: "Trace what changed and when." },
  { icon: Radio, label: "Live monitor stream", value: "Follow process state in real time." },
  { icon: ShieldCheck, label: "Safer operational actions", value: "Use guided controls instead of raw browser prompts." }
];

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[linear-gradient(180deg,rgb(8,13,23),rgb(11,18,32)_28%,rgb(14,22,38)_100%)] text-text-1">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-96 bg-[radial-gradient(circle_at_12%_10%,rgba(56,189,248,0.18),transparent_34%),radial-gradient(circle_at_88%_12%,rgba(99,102,241,0.2),transparent_30%)]" />
      <div className="pointer-events-none absolute left-[-8rem] top-40 h-72 w-72 rounded-full border border-white/8 bg-white/5 blur-3xl" />
      <div className="pointer-events-none absolute right-[-6rem] top-28 h-80 w-80 rounded-full border border-brand-500/20 bg-brand-500/10 blur-3xl" />

      <header className="relative z-10">
        <div className="mx-auto flex max-w-layout items-center justify-between gap-4 px-4 py-5 md:px-6">
          <Link to="/" className="flex items-center gap-3 text-text-1 no-underline">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold backdrop-blur">
              PM2
            </div>
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.28em] text-slate-400">Ops Surface</p>
              <p className="text-base font-semibold text-white">PM2 Manager</p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Button as={Link} to="/login" variant="secondary" className="h-10 min-w-[7rem] px-4">
              Login
            </Button>
            <Button as={Link} to="/dashboard" variant="primary" className="h-10 min-w-[8rem] px-4">
              Enter App
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto max-w-layout px-4 pb-14 pt-8 md:px-6 md:pb-20 md:pt-10">
          <div className="grid gap-8 xl:grid-cols-[1.15fr,0.85fr] xl:items-start">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-info-500/25 bg-info-500/10 px-3 py-1 text-xs uppercase tracking-[0.24em] text-info-300">
                <Radio size={14} />
                Built for PM2 operations, not generic SaaS dashboards
              </div>

              <h1 className="mt-6 max-w-4xl text-4xl font-semibold leading-tight tracking-[-0.04em] text-white md:text-6xl">
                The front door for teams that actually run Node services.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-300 md:text-lg">
                PM2 Manager puts deploys, logs, alerts, proxy routing, and runtime controls into one operational surface so the team stops living in split tabs and ad hoc shell commands.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button as={Link} to="/dashboard" variant="primary" className="h-11 min-w-[11rem] px-5">
                  Open Dashboard
                  <ArrowRight size={16} />
                </Button>
                <Button as={Link} to="/login" variant="secondary" className="h-11 min-w-[10rem] px-5">
                  Sign In
                </Button>
              </div>

              <div className="mt-10 grid gap-3 md:grid-cols-3">
                {systemLanes.map((lane) => (
                  <div key={lane.label} className="rounded-[1.2rem] border border-white/8 bg-white/[0.03] p-4 backdrop-blur-sm">
                    <p className="text-[0.68rem] uppercase tracking-[0.24em] text-slate-500">{lane.label}</p>
                    <p className="mt-3 text-sm leading-6 text-slate-200">{lane.value}</p>
                    <div className={`mt-4 inline-flex rounded-full border px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.18em] ${lane.tone}`}>
                      active
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative">
              <div className="absolute inset-x-8 top-8 h-full rounded-[1.6rem] border border-white/6 bg-white/[0.02]" />
              <div className="relative overflow-hidden rounded-[1.6rem] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-4 shadow-2xl shadow-black/30 backdrop-blur">
                <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-3">
                  <div>
                    <p className="text-[0.68rem] uppercase tracking-[0.24em] text-slate-500">Sample Control Deck</p>
                    <p className="mt-1 text-lg font-semibold text-white">Production cluster overview</p>
                  </div>
                  <div className="rounded-full border border-success-500/30 bg-success-500/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-success-300">
                    stable
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <PreviewMetric label="Online" value="18" helper="2 cluster groups" />
                  <PreviewMetric label="Alerts" value="03" helper="threshold crossings" />
                  <PreviewMetric label="Releases" value="07" helper="this week" />
                </div>

                <div className="mt-4 rounded-[1.2rem] border border-white/8 bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">Recent service feed</p>
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">live stream</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {feed.map(({ icon: Icon, label, value }) => (
                      <div key={label} className="flex items-start gap-3 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-3">
                        <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-white/5 text-info-300">
                          <Icon size={16} />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-100">{label}</p>
                          <p className="mt-1 text-sm leading-6 text-slate-400">{value}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <CommandTile command="pm2 save" description="Preserve current process state for restart recovery." />
                  <CommandTile command="git pull + deploy" description="Move from code update to process restart in one flow." />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-layout px-4 pb-16 md:px-6 md:pb-24">
          <div className="grid gap-4 lg:grid-cols-3">
            {modules.map(({ title, description, icon: Icon }) => (
              <article key={title} className="relative overflow-hidden rounded-[1.4rem] border border-white/8 bg-white/[0.03] p-5 backdrop-blur-sm">
                <div className="pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-full bg-brand-500/10 blur-2xl" />
                <div className="relative">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-brand-400">
                    <Icon size={20} />
                  </div>
                  <h2 className="mt-5 max-w-sm text-xl font-semibold leading-8 text-white">{title}</h2>
                  <p className="mt-3 text-sm leading-7 text-slate-400">{description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function PreviewMetric({ label, value, helper }) {
  return (
    <div className="rounded-[1.05rem] border border-white/8 bg-white/[0.03] px-3 py-3">
      <p className="text-[0.65rem] uppercase tracking-[0.22em] text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-white">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{helper}</p>
    </div>
  );
}

function CommandTile({ command, description }) {
  return (
    <div className="rounded-[1.05rem] border border-white/8 bg-white/[0.03] px-3 py-3">
      <p className="font-mono text-sm text-success-300">{command}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{description}</p>
    </div>
  );
}
