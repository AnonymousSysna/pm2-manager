// @ts-nocheck
import { Activity, ArrowRight, Bell, Rocket, Server } from "lucide-react";
import { Link } from "react-router-dom";
import Button from "../components/ui/Button";

const highlights = [
  {
    title: "Live process health",
    description: "Track CPU, memory, uptime, and restarts from a single control surface.",
    icon: Activity
  },
  {
    title: "Safer release flow",
    description: "Create processes, inspect logs, and roll through deployments without losing context.",
    icon: Rocket
  },
  {
    title: "Operational signals",
    description: "Keep alerts, reverse proxy state, and runtime configuration visible to the team.",
    icon: Bell
  }
];

const stats = [
  { label: "Process control", value: "PM2 lifecycle actions" },
  { label: "Deployment visibility", value: "History, logs, and audit trails" },
  { label: "Infrastructure hooks", value: "Caddy and notification tooling" }
];

export default function Landing() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-bg text-text-1">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[radial-gradient(circle_at_top,rgba(99,102,241,0.2),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-24 mx-auto h-64 max-w-5xl rounded-full bg-brand-500/10 blur-3xl" />

      <header className="relative z-10 border-b border-border/80 bg-surface/80 backdrop-blur">
        <div className="mx-auto flex max-w-layout items-center justify-between gap-4 px-4 py-4 md:px-6">
          <Link to="/" className="flex items-center gap-3 text-text-1 no-underline">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 font-semibold text-bg shadow-lg shadow-brand-500/20">
              PM2
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-text-3">Operations Console</p>
              <p className="text-base font-semibold">PM2 Manager</p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Button as={Link} to="/login" variant="secondary" className="h-10 min-w-[7.5rem] px-4">
              Login
            </Button>
            <Button as={Link} to="/dashboard" variant="primary" className="h-10 min-w-[7.5rem] px-4">
              Get Started
            </Button>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto flex max-w-layout flex-col items-center px-4 pb-14 pt-14 text-center md:px-6 md:pb-20 md:pt-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-sm text-brand-400">
            <Server size={14} />
            Production process oversight built for PM2 environments
          </div>

          <h1 className="mt-6 max-w-4xl text-4xl font-semibold tracking-tight text-text-1 md:text-6xl">
            Operate PM2 workloads with a cleaner, faster front door.
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-text-2 md:text-lg">
            Centralize process health, deployments, notifications, and reverse proxy controls in one focused management surface.
          </p>

          <div className="mt-8 flex w-full flex-col items-stretch justify-center gap-3 sm:w-auto sm:flex-row sm:items-center">
            <Button as={Link} to="/dashboard" variant="primary" className="h-11 min-w-[10rem] px-5">
              Open Dashboard
              <ArrowRight size={16} />
            </Button>
            <Button as={Link} to="/login" variant="secondary" className="h-11 min-w-[10rem] px-5">
              Login
            </Button>
          </div>

          <div className="mt-10 grid w-full gap-3 text-left md:mt-14 md:grid-cols-3">
            {stats.map((stat) => (
              <div key={stat.label} className="page-panel border-border/80 bg-surface/90">
                <p className="meta-label">{stat.label}</p>
                <p className="mt-2 text-base font-medium text-text-1">{stat.value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-layout px-4 pb-16 md:px-6 md:pb-24">
          <div className="grid gap-4 lg:grid-cols-3">
            {highlights.map(({ title, description, icon: Icon }) => (
              <article key={title} className="page-panel h-full border-border/80 bg-gradient-to-br from-surface to-surface-2/80">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/15 text-brand-400">
                  <Icon size={20} />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-text-1">{title}</h2>
                <p className="mt-3 text-sm leading-6 text-text-2">{description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
