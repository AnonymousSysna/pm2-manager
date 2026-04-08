// @ts-nocheck
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";
import { Skeleton } from "./components/ui/Skeleton";

const Layout = lazy(() => import("./components/Layout"));
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const CreateProcess = lazy(() => import("./pages/CreateProcess"));
const Logs = lazy(() => import("./pages/Logs"));
const Settings = lazy(() => import("./pages/Settings"));
const History = lazy(() => import("./pages/History"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Extensions = lazy(() => import("./pages/Extensions"));
const Caddy = lazy(() => import("./pages/Caddy"));

function LoginRouteFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-2xl shadow-black/30">
        <div className="mb-6 flex flex-col items-center gap-3">
          <Skeleton className="h-14 w-14 rounded-full" />
          <Skeleton className="h-8 w-40" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    </div>
  );
}

function DashboardPageFallback() {
  return (
    <div className="space-y-4">
      <section className="page-panel page-intro space-y-3">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </section>
      <section className="page-panel">
        <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-10 w-full md:w-80" />
        </div>
        <div className="space-y-3 md:hidden">
          {Array.from({ length: 3 }).map((_, index) => (
            <article key={index} className="rounded-xl border border-border bg-surface-2 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <Skeleton className="h-5 w-36" />
                <Skeleton className="h-5 w-20" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="mt-3 flex gap-1">
                <Skeleton className="h-7 w-7" />
                <Skeleton className="h-7 w-7" />
                <Skeleton className="h-7 w-7" />
                <Skeleton className="h-7 w-7" />
              </div>
            </article>
          ))}
        </div>
        <div className="hidden overflow-hidden md:block">
          <div className="grid grid-cols-[48px,72px,1fr,112px,128px,96px,110px,110px,90px,100px,120px,1fr] gap-2 border-b border-border pb-3">
            {Array.from({ length: 12 }).map((_, index) => (
              <Skeleton key={index} className="h-3 w-full" />
            ))}
          </div>
          <div className="space-y-3 pt-3">
            {Array.from({ length: 4 }).map((_, rowIndex) => (
              <div key={rowIndex} className="grid grid-cols-[48px,72px,1fr,112px,128px,96px,110px,110px,90px,100px,120px,1fr] items-center gap-2">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-5 w-16" />
                <Skeleton className="h-5 w-24" />
                <div className="flex gap-1">
                  <Skeleton className="h-7 w-7" />
                  <Skeleton className="h-7 w-7" />
                  <Skeleton className="h-7 w-7" />
                  <Skeleton className="h-7 w-7" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

function CreateProcessPageFallback() {
  return (
    <div className="space-y-4">
      <section className="page-panel page-intro space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </section>
      <section className="page-panel space-y-4">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-32" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-40" />
          </div>
        </div>
      </section>
    </div>
  );
}

function NotificationsPageFallback() {
  return (
    <div className="space-y-4">
      <section className="page-panel page-intro space-y-3">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </section>
      <section className="page-panel">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-40" />
            <Skeleton className="h-10 w-full sm:w-64" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-10 w-24" />
            <Skeleton className="h-10 w-28" />
          </div>
        </div>
      </section>
      <section className="page-panel space-y-3">
        <Skeleton className="h-6 w-36" />
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border bg-surface-2 p-3">
            <div className="flex items-start gap-2">
              <Skeleton className="mt-0.5 h-4 w-4 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-5/6" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function LogsPageFallback() {
  return (
    <div className="space-y-4">
      <section className="page-panel page-intro space-y-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </section>
      <section className="page-panel grid gap-2 md:grid-cols-2 xl:grid-cols-6">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full xl:col-span-2" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </section>
      <section className="h-log-viewer rounded-xl border border-border bg-surface p-3 sm:p-4">
        <Skeleton className="mb-3 h-6 w-32" />
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="flex items-center gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingsPageFallback() {
  return (
    <div className="space-y-4">
      <section className="page-panel page-intro space-y-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </section>
      {Array.from({ length: 5 }).map((_, index) => (
        <section key={index} className="page-panel space-y-3">
          <Skeleton className="h-6 w-44" />
          <div className="grid gap-2 md:grid-cols-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-10 w-40" />
        </section>
      ))}
    </div>
  );
}

function HistoryPageFallback() {
  return (
    <div className="space-y-4">
      <section className="page-panel page-intro space-y-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </section>
      {Array.from({ length: 3 }).map((_, index) => (
        <section key={index} className="page-panel space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-9 w-24" />
          </div>
          {index === 0 && <Skeleton className="h-10 w-full" />}
          <Skeleton className="h-3 w-56" />
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, itemIndex) => (
              <div key={itemIndex} className="rounded-md border border-border bg-surface-2 p-2">
                <Skeleton className="mb-2 h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function ExtensionsPageFallback() {
  return (
    <div className="space-y-4">
      <section className="page-panel page-intro space-y-3">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </section>
      <section className="page-panel space-y-3">
        <Skeleton className="h-6 w-44" />
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-44" />
          </div>
          <Skeleton className="h-10 w-36" />
        </div>
      </section>
      <section className="page-panel space-y-3">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-md border border-border bg-surface-2 p-3">
            <Skeleton className="mb-2 h-4 w-40" />
            <Skeleton className="mb-2 h-3 w-64" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
      </section>
    </div>
  );
}

function CaddyPageFallback() {
  return (
    <div className="space-y-4">
      <section className="page-panel page-intro space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </section>
      <section className="page-panel space-y-3">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-10 w-36" />
        <div className="grid gap-2 md:grid-cols-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-10 w-56" />
      </section>
      <section className="page-panel space-y-2">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-md border border-border bg-surface-2 p-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-14" />
                <Skeleton className="h-8 w-16" />
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

function LayoutRouteFallback() {
  return (
    <div className="min-h-screen bg-bg text-text-1">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-layout items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-md md:hidden" />
            <Skeleton className="hidden h-8 w-8 rounded-full md:block" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8" />
            <Skeleton className="h-6 w-28" />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-layout gap-4 px-4 py-4 md:px-6 md:py-6">
        <aside className="hidden w-64 shrink-0 rounded-xl border border-border bg-surface p-4 md:block">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="space-y-2">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
          <Skeleton className="mt-6 h-10 w-full" />
        </aside>
        <main className="min-w-0 flex-1">
          <DashboardPageFallback />
        </main>
      </div>
    </div>
  );
}

function LazyRoute({ children, fallback = <DashboardPageFallback /> }) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route
        path="/login"
        element={(
          <LazyRoute fallback={<LoginRouteFallback />}>
            <Login />
          </LazyRoute>
        )}
      />

      <Route element={<RequireAuth />}>
        <Route
        path="/dashboard"
        element={(
          <LazyRoute fallback={<LayoutRouteFallback />}>
            <Layout />
          </LazyRoute>
        )}
        >
          <Route
            index
            element={(
              <LazyRoute fallback={<DashboardPageFallback />}>
                <Dashboard />
              </LazyRoute>
            )}
          />
          <Route
            path="create"
            element={(
              <LazyRoute fallback={<CreateProcessPageFallback />}>
                <CreateProcess />
              </LazyRoute>
            )}
          />
          <Route
            path="notifications"
            element={(
              <LazyRoute fallback={<NotificationsPageFallback />}>
                <Notifications />
              </LazyRoute>
            )}
          />
          <Route
            path="logs"
            element={(
              <LazyRoute fallback={<LogsPageFallback />}>
                <Logs />
              </LazyRoute>
            )}
          />
          <Route
            path="settings"
            element={(
              <LazyRoute fallback={<SettingsPageFallback />}>
                <Settings />
              </LazyRoute>
            )}
          />
          <Route
            path="history"
            element={(
              <LazyRoute fallback={<HistoryPageFallback />}>
                <History />
              </LazyRoute>
            )}
          />
          <Route
            path="extensions"
            element={(
              <LazyRoute fallback={<ExtensionsPageFallback />}>
                <Extensions />
              </LazyRoute>
            )}
          />
          <Route
            path="caddy"
            element={(
              <LazyRoute fallback={<CaddyPageFallback />}>
                <Caddy />
              </LazyRoute>
            )}
          />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

