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

function PageSkeleton({ titleWidth = "w-40", blocks = 3 }) {
  return (
    <div className="space-y-4">
      <section className="page-panel page-intro space-y-3">
        <Skeleton className={`h-8 ${titleWidth}`} />
        <Skeleton className="h-4 w-80 max-w-full" />
      </section>
      <section className="page-panel space-y-3">
        {Array.from({ length: blocks }).map((_, index) => (
          <div key={index} className="rounded-lg border border-border/80 bg-surface-2/70 p-3">
            <Skeleton className="mb-2 h-4 w-32" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </section>
    </div>
  );
}

function LoginFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-8 shadow-2xl shadow-black/30">
        <div className="mb-6 space-y-3 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-border bg-surface-2">
            <Skeleton className="h-6 w-6 rounded-full" />
          </div>
          <Skeleton className="mx-auto h-8 w-40" />
          <Skeleton className="mx-auto h-4 w-56 max-w-full" />
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

function LayoutFallback({ children = <PageSkeleton /> }) {
  return (
    <div className="min-h-screen bg-bg text-text-1">
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-layout items-center justify-between px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-md md:hidden" />
            <div className="hidden h-8 w-8 rounded-full md:block">
              <Skeleton className="h-8 w-8 rounded-full" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-32" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-6 w-28 rounded-full" />
          </div>
        </div>
      </header>
      <div className="mx-auto flex w-full max-w-layout gap-4 px-4 py-4 md:px-6 md:py-6">
        <aside className="hidden w-64 shrink-0 rounded-xl border border-border bg-surface p-4 md:flex md:flex-col">
          <Skeleton className="mb-4 h-4 w-24" />
          <div className="space-y-2">
            {Array.from({ length: 7 }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
          <Skeleton className="mt-6 h-10 w-full" />
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function LazyRoute({ children, fallback }) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route
        path="/login"
        element={(
          <LazyRoute fallback={<LoginFallback />}>
            <Login />
          </LazyRoute>
        )}
      />

      <Route element={<RequireAuth />}>
        <Route
          path="/dashboard"
          element={(
            <LazyRoute fallback={<LayoutFallback />}>
              <Layout />
            </LazyRoute>
          )}
        >
          <Route
            index
            element={(
              <LazyRoute fallback={<PageSkeleton titleWidth="w-52" blocks={4} />}>
                <Dashboard />
              </LazyRoute>
            )}
          />
          <Route
            path="create"
            element={(
              <LazyRoute fallback={<PageSkeleton titleWidth="w-48" blocks={4} />}>
                <CreateProcess />
              </LazyRoute>
            )}
          />
          <Route
            path="notifications"
            element={(
              <LazyRoute fallback={<PageSkeleton titleWidth="w-44" blocks={4} />}>
                <Notifications />
              </LazyRoute>
            )}
          />
          <Route
            path="logs"
            element={(
              <LazyRoute fallback={<PageSkeleton titleWidth="w-24" blocks={2} />}>
                <Logs />
              </LazyRoute>
            )}
          />
          <Route
            path="settings"
            element={(
              <LazyRoute fallback={<PageSkeleton titleWidth="w-32" blocks={4} />}>
                <Settings />
              </LazyRoute>
            )}
          />
          <Route
            path="history"
            element={(
              <LazyRoute fallback={<PageSkeleton titleWidth="w-24" blocks={4} />}>
                <History />
              </LazyRoute>
            )}
          />
          <Route
            path="extensions"
            element={(
              <LazyRoute fallback={<PageSkeleton titleWidth="w-32" blocks={4} />}>
                <Extensions />
              </LazyRoute>
            )}
          />
          <Route
            path="caddy"
            element={(
              <LazyRoute fallback={<PageSkeleton titleWidth="w-48" blocks={3} />}>
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
