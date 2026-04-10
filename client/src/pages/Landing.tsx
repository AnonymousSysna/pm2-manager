import {
  Activity,
  ArrowRight,
  BellRing,
  Blocks,
  GitBranch,
  HardDrive,
  Lock,
  Radio,
  Server,
  ShieldCheck
} from "lucide-react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";
import { cn } from "../lib/cn";

const operationalLanes = [
  {
    label: "Deploy rhythm",
    value: "Ship, verify, roll back",
    note: "History stays attached to each release."
  },
  {
    label: "Runtime control",
    value: "Restart with context",
    note: "Logs, health, and state live beside the action."
  },
  {
    label: "Signal flow",
    value: "Alerts route fast",
    note: "Thresholds, proxy routes, and support signals stay visible."
  }
];

const featureCards = [
  {
    title: "One place to operate a service after it goes live.",
    description:
      "PM2 actions, runtime metadata, logs, and reverse-proxy state stay on the same surface so operators do not lose context between tabs.",
    icon: Server
  },
  {
    title: "Deploy history reads like an incident timeline.",
    description:
      "Each rollout keeps the choices, timing, and rollback path visible instead of burying them in shell history and chat scrollback.",
    icon: GitBranch
  },
  {
    title: "Controls are opinionated enough to be safer.",
    description:
      "Guided actions reduce the chances of firing the right command in the wrong place when production is already noisy.",
    icon: ShieldCheck
  }
];

const boardEvents = [
  { time: "09:12", label: "api-prod", detail: "Deployment completed on commit `9f2c7a1`." },
  { time: "09:18", label: "billing-worker", detail: "Memory pressure crossed warning threshold." },
  { time: "09:21", label: "caddy", detail: "Proxy config reloaded after route update." }
];

const operatingPrinciples = [
  {
    title: "Fewer blind handoffs",
    copy: "Engineers can move from runtime health to action without rebuilding context from scratch.",
    icon: Blocks
  },
  {
    title: "Faster incident reading",
    copy: "The product surfaces state changes and historical actions where the service is already being inspected.",
    icon: Activity
  },
  {
    title: "Less terminal choreography",
    copy: "Operators stop stitching together PM2, logs, deploy notes, and proxy checks by hand.",
    icon: HardDrive
  }
];

const routePillars = [
  "Process lifecycle",
  "Metrics and logs",
  "Deployment history",
  "Notifications and alerts",
  "Caddy routing"
];

export default function Landing() {
  return (
    <div className="marketing-shell">
      <div className="marketing-backdrop pointer-events-none absolute inset-0" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-border/80" />
      <div className="marketing-grid-overlay pointer-events-none absolute inset-0 opacity-20" />

      <header className="relative z-10">
        <div className="marketing-container flex items-center justify-between gap-4 py-5">
          <Link to="/" className="flex items-center gap-4 text-inherit no-underline">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-warning-500/30 bg-warning-500/10 text-sm font-semibold tracking-[0.2em] text-warning-300">
              PM2
            </div>
            <div>
              <p className="marketing-eyebrow text-warning-300">Operations Surface</p>
              <p className="text-lg font-semibold text-text-1">PM2 Manager</p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Button as={Link} to="/login" variant="marketingSecondary" className="h-10 px-4">
              Sign In
            </Button>
            <Button as={Link} to="/dashboard" variant="marketingPrimary" className="h-10 px-4">
              Open Dashboard
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="marketing-container grid gap-10 pb-14 pt-8 md:pb-20 md:pt-12 xl:grid-cols-2 xl:items-center">
          <div className="max-w-2xl">
            <div className="marketing-pill marketing-pill-warning">
              <Radio size={14} />
              Built for operators, not for generic dashboard screenshots
            </div>

            <h1 className="marketing-hero-title mt-7">
              Run the service from the same screen where you notice it breaking.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-8 text-text-2 md:text-lg">
              PM2 Manager combines process control, deploy history, logs, alerts, and Caddy routing into one operating
              surface so production work stops feeling like tab roulette.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button as={Link} to="/dashboard" variant="marketingPrimary" className="h-12 min-w-48 px-5">
                Enter Control Room
                <ArrowRight size={16} />
              </Button>
              <Button as={Link} to="/login" variant="marketingSecondary" className="h-12 min-w-40 px-5">
                Authenticate
              </Button>
            </div>

            <div className="mt-10 grid gap-3 md:grid-cols-3">
              {operationalLanes.map((lane) => (
                <article key={lane.label} className="marketing-stat-card backdrop-blur-sm">
                  <p className="marketing-eyebrow">{lane.label}</p>
                  <p className="mt-3 text-lg font-semibold text-text-1">{lane.value}</p>
                  <p className="mt-3 text-sm leading-6 text-text-2">{lane.note}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute left-0 top-10 h-4/5 w-4/5 rounded-full bg-success-500/10 blur-3xl" />
            <article className="marketing-surface relative overflow-hidden p-5 md:p-6">
              <div className="flex flex-col gap-4 border-b border-border/80 pb-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="marketing-eyebrow">Live operations board</p>
                  <h2 className="marketing-section-title mt-2">Production cluster / Tokyo edge</h2>
                  <p className="mt-2 max-w-md text-sm leading-6 text-text-2">
                    Layout tuned around decisions an operator actually makes under pressure.
                  </p>
                </div>
                <div className="marketing-pill marketing-pill-success">
                  <Lock size={14} />
                  Session safe
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <BoardMetric label="Online services" value="18" helper="2 clusters / 0 down" tone="success" />
                <BoardMetric label="Alerts today" value="03" helper="1 unresolved" tone="warning" />
                <BoardMetric label="Recent deploys" value="07" helper="2 pending review" tone="info" />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
                <section className="marketing-surface-muted p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="section-title">Service activity</h3>
                    <span className="marketing-eyebrow">Streaming</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {boardEvents.map((event) => (
                      <article key={event.time + event.label} className="grid grid-cols-[auto,1fr] gap-3 rounded-xl border border-border/60 bg-surface/60 p-3">
                        <div className="rounded-lg border border-warning-500/25 bg-warning-500/10 px-2 py-1 font-mono text-xs text-warning-300">
                          {event.time}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-text-1">{event.label}</p>
                          <p className="mt-1 text-sm leading-6 text-text-2">{event.detail}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="marketing-surface-muted p-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="section-title">Control lanes</h3>
                    <span className="marketing-eyebrow text-info-300">In view</span>
                  </div>
                  <ul className="mt-4 space-y-2.5">
                    {routePillars.map((item) => (
                      <li key={item} className="marketing-list-row">
                        <span className="marketing-list-dot" aria-hidden="true" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="marketing-code-callout mt-4">
                    <p className="font-mono text-sm text-warning-300">pm2 restart api-prod --update-env</p>
                    <p className="mt-2 text-sm leading-6 text-text-2">
                      Trigger actions with enough surrounding state to understand the consequence before clicking.
                    </p>
                  </div>
                </section>
              </div>
            </article>
          </div>
        </section>

        <section className="marketing-container pb-10">
          <div className="mb-6 max-w-2xl">
            <p className="marketing-eyebrow">Why it fits operations</p>
            <h2 className="marketing-section-title mt-3">Control, state, and release history stay in the same frame.</h2>
            <p className="marketing-body-secondary mt-3">
              The landing page now uses the same semantic tiers and tokenized surfaces as the app shell instead of a
              parallel set of one-off utilities.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {featureCards.map(({ title, description, icon: Icon }) => (
              <article key={title} className="marketing-feature-card">
                <div className="marketing-icon-chip h-12 w-12 rounded-2xl border-info-500/30 bg-info-500/10 text-info-300">
                  <Icon size={20} />
                </div>
                <h3 className="marketing-card-title mt-6 max-w-sm">{title}</h3>
                <p className="mt-4 text-sm leading-7 text-text-2">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="marketing-container grid gap-6 pb-16 md:pb-24 xl:grid-cols-[0.92fr,1.08fr]">
          <section className="marketing-surface-muted p-6 md:p-7">
            <p className="marketing-eyebrow">Day-one effect</p>
            <h2 className="marketing-section-title mt-4 max-w-md">
              The interface should reduce operational friction, not decorate it.
            </h2>
            <p className="marketing-body-secondary mt-4 max-w-xl">
              The page now anchors every section to the same container width, keeps the hero content balanced on both
              axes, and uses denser visual groupings so the screen feels assembled with intent instead of auto-generated.
            </p>

            <div className="mt-8 space-y-3">
              {operatingPrinciples.map(({ title, copy, icon: Icon }) => (
                <article key={title} className="flex items-start gap-4 rounded-xl border border-border/60 bg-surface/60 p-4">
                  <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-warning-500/10 text-warning-300">
                    <Icon size={18} />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-text-1">{title}</h3>
                    <p className="mt-1 text-sm leading-6 text-text-2">{copy}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="marketing-surface p-6 md:p-7">
            <div className="flex flex-col gap-3 border-b border-border/80 pb-5 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="marketing-eyebrow">Coverage map</p>
                <h2 className="marketing-section-title mt-3">What the product actually covers</h2>
              </div>
              <div className="marketing-pill marketing-pill-neutral">
                <BellRing size={14} />
                Signal-aware
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <CoverageCard icon={Radio} title="Live state" copy="Socket-backed monitoring keeps process status moving in real time." />
              <CoverageCard icon={Activity} title="Metrics view" copy="Resource history makes pressure visible before a restart becomes inevitable." />
              <CoverageCard icon={GitBranch} title="Deploy trace" copy="Release and rollback events stay attributable instead of anecdotal." />
              <CoverageCard icon={BellRing} title="Alert flow" copy="Threshold notifications remain near the service they describe." />
            </div>

            <div className="marketing-promo-panel mt-5">
              <p className="marketing-eyebrow text-info-300">Ready to use</p>
              <p className="mt-3 max-w-lg text-lg font-semibold leading-8 text-text-1">
                Start with the dashboard, then move through logs, history, notifications, and routing without breaking
                the mental model.
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Button as={Link} to="/dashboard" variant="marketingPrimary" className="h-11 min-w-44 px-5">
                  Launch App
                </Button>
                <Button as={Link} to="/login" variant="marketingSecondary" className="h-11 min-w-36 px-5">
                  Go to Login
                </Button>
              </div>
            </div>
          </section>
        </section>
      </main>
    </div>
  );
}

function BoardMetric({
  label,
  value,
  helper,
  tone
}: {
  label: string;
  value: string;
  helper: string;
  tone: "success" | "warning" | "info";
}) {
  const accentClass = {
    success: "text-success-300",
    warning: "text-warning-300",
    info: "text-info-300"
  } satisfies Record<"success" | "warning" | "info", string>;

  return (
    <div className="marketing-stat-card">
      <p className="marketing-eyebrow">{label}</p>
      <p className={cn("mt-2 text-3xl font-semibold", accentClass[tone])}>{value}</p>
      <p className="mt-1 text-sm text-text-2">{helper}</p>
    </div>
  );
}

function CoverageCard({
  icon: Icon,
  title,
  copy
}: {
  icon: typeof Activity;
  title: string;
  copy: string;
}) {
  return (
    <article className="rounded-xl border border-border/60 bg-surface/60 p-4">
      <div className="marketing-icon-chip border-warning-500/25 bg-warning-500/10 text-warning-300">
        <Icon size={18} />
      </div>
      <h3 className="mt-4 text-base font-semibold text-text-1">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-text-2">{copy}</p>
    </article>
  );
}
