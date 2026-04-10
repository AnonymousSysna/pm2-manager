import {
  Activity,
  ArrowRight,
  BellRing,
  Blocks,
  ChevronRight,
  GitBranch,
  HardDrive,
  Lock,
  Radio,
  Route,
  Server,
  ShieldCheck
} from "lucide-react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";

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
    <div className="min-h-screen overflow-hidden bg-[#0d1117] text-[#f4efe5]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.16),transparent_32%),radial-gradient(circle_at_80%_18%,rgba(45,212,191,0.14),transparent_26%),linear-gradient(180deg,rgba(255,255,255,0.03),transparent_34%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
      <div className="pointer-events-none absolute left-0 top-0 h-full w-full bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:72px_72px] opacity-[0.18]" />

      <header className="relative z-10">
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-5 py-5 md:px-8">
          <Link to="/" className="flex items-center gap-4 text-inherit no-underline">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#f59e0b]/30 bg-[#f59e0b]/12 text-sm font-semibold tracking-[0.2em] text-[#ffd58a]">
              PM2
            </div>
            <div>
              <p className="text-[0.68rem] uppercase tracking-[0.28em] text-[#c9bba3]">Operations Surface</p>
              <p className="text-lg font-semibold text-[#fff7eb]">PM2 Manager</p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Button
              as={Link}
              to="/login"
              variant="secondary"
              className="h-10 border-[#f4efe5]/20 bg-white/5 px-4 text-[#f4efe5] hover:bg-white/10"
            >
              Sign In
            </Button>
            <Button
              as={Link}
              to="/dashboard"
              variant="primary"
              className="h-10 bg-[#f59e0b] px-4 text-[#101418] hover:bg-[#ffb547]"
            >
              Open Dashboard
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid w-full max-w-[1280px] gap-10 px-5 pb-14 pt-8 md:px-8 md:pb-20 md:pt-12 xl:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)] xl:items-center">
          <div className="max-w-[680px]">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#f59e0b]/35 bg-[#f59e0b]/10 px-3 py-1.5 text-[0.72rem] uppercase tracking-[0.22em] text-[#ffd58a]">
              <Radio size={14} />
              Built for operators, not for generic dashboard screenshots
            </div>

            <h1 className="mt-7 text-5xl font-semibold leading-[0.96] tracking-[-0.05em] text-[#fff7eb] md:text-7xl">
              Run the service from the same screen where you notice it breaking.
            </h1>
            <p className="mt-6 max-w-[620px] text-base leading-8 text-[#d7cbb8] md:text-lg">
              PM2 Manager combines process control, deploy history, logs, alerts, and Caddy routing into one operating
              surface so production work stops feeling like tab roulette.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                as={Link}
                to="/dashboard"
                variant="primary"
                className="h-12 min-w-[12rem] bg-[#f59e0b] px-5 text-[#111417] hover:bg-[#ffb547]"
              >
                Enter Control Room
                <ArrowRight size={16} />
              </Button>
              <Button
                as={Link}
                to="/login"
                variant="secondary"
                className="h-12 min-w-[10rem] border-[#f4efe5]/18 bg-white/5 px-5 text-[#f4efe5] hover:bg-white/10"
              >
                Authenticate
              </Button>
            </div>

            <div className="mt-10 grid gap-3 md:grid-cols-3">
              {operationalLanes.map((lane) => (
                <div key={lane.label} className="rounded-[1.4rem] border border-white/10 bg-white/[0.045] p-4 backdrop-blur-sm">
                  <p className="text-[0.68rem] uppercase tracking-[0.22em] text-[#b6a690]">{lane.label}</p>
                  <p className="mt-3 text-lg font-semibold leading-6 text-[#fff4e4]">{lane.value}</p>
                  <p className="mt-3 text-sm leading-6 text-[#ccbda9]">{lane.note}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="relative">
            <div className="absolute -left-4 top-10 h-[86%] w-[86%] rounded-[2rem] border border-[#2dd4bf]/16 bg-[#2dd4bf]/8 blur-3xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#131922]/90 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.42)] backdrop-blur md:p-6">
              <div className="flex flex-col gap-4 border-b border-white/10 pb-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-[0.68rem] uppercase tracking-[0.24em] text-[#b6a690]">Live operations board</p>
                  <p className="mt-2 text-2xl font-semibold text-[#fff7eb]">Production cluster / Tokyo edge</p>
                  <p className="mt-2 max-w-md text-sm leading-6 text-[#c9bba3]">
                    Layout tuned around decisions an operator actually makes under pressure.
                  </p>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-[#2dd4bf]/30 bg-[#2dd4bf]/10 px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-[#7ee7d5]">
                  <Lock size={14} />
                  session safe
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <BoardMetric label="Online services" value="18" helper="2 clusters / 0 down" accent="text-[#7ee7d5]" />
                <BoardMetric label="Alerts today" value="03" helper="1 unresolved" accent="text-[#ffd58a]" />
                <BoardMetric label="Recent deploys" value="07" helper="2 pending review" accent="text-[#f6b0a9]" />
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr,0.9fr]">
                <div className="rounded-[1.4rem] border border-white/8 bg-[#0f141c] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-[#fff2dd]">Service activity</p>
                    <span className="text-[0.68rem] uppercase tracking-[0.2em] text-[#b6a690]">streaming</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {boardEvents.map((event) => (
                      <div key={event.time + event.label} className="grid grid-cols-[auto,1fr] gap-3 rounded-2xl border border-white/6 bg-white/[0.03] p-3">
                        <div className="rounded-xl border border-white/8 bg-white/[0.04] px-2 py-1 font-mono text-xs text-[#ffd58a]">
                          {event.time}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-[#fff7eb]">{event.label}</p>
                          <p className="mt-1 text-sm leading-6 text-[#c9bba3]">{event.detail}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.4rem] border border-white/8 bg-[#181f2a] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium text-[#fff2dd]">Control lanes</p>
                    <Route size={16} className="text-[#7ee7d5]" />
                  </div>
                  <div className="mt-4 space-y-2.5">
                    {routePillars.map((item) => (
                      <div key={item} className="flex items-center justify-between rounded-2xl border border-white/6 bg-white/[0.03] px-3 py-3">
                        <span className="text-sm text-[#efe2cd]">{item}</span>
                        <ChevronRight size={16} className="text-[#7ee7d5]" />
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 rounded-2xl border border-[#f59e0b]/20 bg-[#f59e0b]/10 p-3">
                    <p className="font-mono text-sm text-[#ffd58a]">pm2 restart api-prod --update-env</p>
                    <p className="mt-2 text-sm leading-6 text-[#e7d5bc]">
                      Trigger actions with enough surrounding state to understand the consequence before clicking.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-[1280px] px-5 pb-8 md:px-8 md:pb-10">
          <div className="grid gap-4 lg:grid-cols-[1.05fr,0.95fr,0.95fr]">
            {featureCards.map(({ title, description, icon: Icon }) => (
              <article key={title} className="rounded-[1.6rem] border border-white/10 bg-white/[0.045] p-6">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#2dd4bf]/25 bg-[#2dd4bf]/10 text-[#7ee7d5]">
                  <Icon size={20} />
                </div>
                <h2 className="mt-6 max-w-sm text-2xl font-semibold leading-8 tracking-[-0.03em] text-[#fff7eb]">{title}</h2>
                <p className="mt-4 text-sm leading-7 text-[#d0c2af]">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mx-auto grid w-full max-w-[1280px] gap-6 px-5 pb-16 md:px-8 md:pb-24 xl:grid-cols-[0.92fr,1.08fr]">
          <div className="rounded-[1.8rem] border border-white/10 bg-[#181f2a] p-6 md:p-7">
            <p className="text-[0.7rem] uppercase tracking-[0.24em] text-[#b6a690]">Day-one effect</p>
            <h2 className="mt-4 max-w-md text-3xl font-semibold leading-tight tracking-[-0.04em] text-[#fff7eb]">
              The interface should reduce operational friction, not decorate it.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-7 text-[#d0c2af]">
              The page now anchors every section to the same container width, keeps the hero content balanced on both
              axes, and uses denser visual groupings so the screen feels assembled with intent instead of auto-generated.
            </p>

            <div className="mt-8 space-y-3">
              {operatingPrinciples.map(({ title, copy, icon: Icon }) => (
                <div key={title} className="flex items-start gap-4 rounded-[1.35rem] border border-white/8 bg-white/[0.04] p-4">
                  <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-xl bg-[#f59e0b]/12 text-[#ffd58a]">
                    <Icon size={18} />
                  </div>
                  <div>
                    <p className="text-base font-semibold text-[#fff4e4]">{title}</p>
                    <p className="mt-1 text-sm leading-6 text-[#cabca8]">{copy}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.8rem] border border-white/10 bg-[#121821] p-6 md:p-7">
            <div className="flex flex-col gap-3 border-b border-white/10 pb-5 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-[0.7rem] uppercase tracking-[0.24em] text-[#b6a690]">Coverage map</p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#fff7eb]">What the product actually covers</h2>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs uppercase tracking-[0.18em] text-[#cdbda6]">
                <BellRing size={14} />
                signal-aware
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <CoverageCard icon={Radio} title="Live state" copy="Socket-backed monitoring keeps process status moving in real time." />
              <CoverageCard icon={Activity} title="Metrics view" copy="Resource history makes pressure visible before a restart becomes inevitable." />
              <CoverageCard icon={GitBranch} title="Deploy trace" copy="Release and rollback events stay attributable instead of anecdotal." />
              <CoverageCard icon={BellRing} title="Alert flow" copy="Threshold notifications remain near the service they describe." />
            </div>

            <div className="mt-5 rounded-[1.5rem] border border-[#2dd4bf]/18 bg-[#2dd4bf]/8 p-5">
              <p className="text-[0.7rem] uppercase tracking-[0.22em] text-[#9deee1]">Ready to use</p>
              <p className="mt-3 max-w-lg text-lg font-semibold leading-8 text-[#f4fffd]">
                Start with the dashboard, then move through logs, history, notifications, and routing without breaking
                the mental model.
              </p>
              <div className="mt-5 flex flex-col gap-3 sm:flex-row">
                <Button
                  as={Link}
                  to="/dashboard"
                  variant="primary"
                  className="h-11 min-w-[11rem] bg-[#f4efe5] px-5 text-[#111417] hover:bg-white"
                >
                  Launch App
                </Button>
                <Button
                  as={Link}
                  to="/login"
                  variant="secondary"
                  className="h-11 min-w-[9rem] border-white/20 bg-transparent px-5 text-[#f4fffd] hover:bg-white/10"
                >
                  Go to Login
                </Button>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function BoardMetric({
  label,
  value,
  helper,
  accent
}: {
  label: string;
  value: string;
  helper: string;
  accent: string;
}) {
  return (
    <div className="rounded-[1.2rem] border border-white/8 bg-white/[0.04] p-3.5">
      <p className="text-[0.68rem] uppercase tracking-[0.22em] text-[#b6a690]">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${accent}`}>{value}</p>
      <p className="mt-1 text-sm text-[#cabca8]">{helper}</p>
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
    <div className="rounded-[1.35rem] border border-white/8 bg-white/[0.035] p-4">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-white/[0.05] text-[#ffd58a]">
        <Icon size={18} />
      </div>
      <p className="mt-4 text-base font-semibold text-[#fff4e4]">{title}</p>
      <p className="mt-2 text-sm leading-6 text-[#cabca8]">{copy}</p>
    </div>
  );
}
