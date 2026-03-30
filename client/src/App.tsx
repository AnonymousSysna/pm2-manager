// @ts-nocheck
import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import RequireAuth from "./components/RequireAuth";

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

function RouteFallback() {
  return (
    <div className="flex min-h-route-fallback items-center justify-center text-sm text-text-3">
      Loading...
    </div>
  );
}

function LazyRoute({ children }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route
        path="/login"
        element={(
          <LazyRoute>
            <Login />
          </LazyRoute>
        )}
      />

      <Route element={<RequireAuth />}>
        <Route
          path="/dashboard"
          element={(
            <LazyRoute>
              <Layout />
            </LazyRoute>
          )}
        >
          <Route
            index
            element={(
              <LazyRoute>
                <Dashboard />
              </LazyRoute>
            )}
          />
          <Route
            path="create"
            element={(
              <LazyRoute>
                <CreateProcess />
              </LazyRoute>
            )}
          />
          <Route
            path="notifications"
            element={(
              <LazyRoute>
                <Notifications />
              </LazyRoute>
            )}
          />
          <Route
            path="logs"
            element={(
              <LazyRoute>
                <Logs />
              </LazyRoute>
            )}
          />
          <Route
            path="settings"
            element={(
              <LazyRoute>
                <Settings />
              </LazyRoute>
            )}
          />
          <Route
            path="history"
            element={(
              <LazyRoute>
                <History />
              </LazyRoute>
            )}
          />
          <Route
            path="extensions"
            element={(
              <LazyRoute>
                <Extensions />
              </LazyRoute>
            )}
          />
          <Route
            path="caddy"
            element={(
              <LazyRoute>
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

