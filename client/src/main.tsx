import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "goey-toast/styles.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { SocketProvider } from "./hooks/useSocket";
import { installGlobalErrorReporting } from "./lib/errorReporter";
import { loadToaster } from "./lib/toast";
import "./index.css";

// The toaster pulls in sonner and framer-motion: 263 kB minified, 72 kB
// gzipped. Nothing can raise a toast before the user interacts with the page,
// so it is fetched after the first paint instead of preloaded ahead of it.
const GooeyToaster = lazy(() => import("goey-toast").then((module) => ({ default: module.GooeyToaster })));

// Warm the fetch while the page is idle so the first interaction never waits
// for it, and so a toast raised immediately has a mounted toaster to land in.
const warmToaster = () => {
  loadToaster();
};
if (typeof window.requestIdleCallback === "function") {
  window.requestIdleCallback(warmToaster, { timeout: 2000 });
} else {
  window.setTimeout(warmToaster, 1000);
}

const preferredTheme = localStorage.getItem("pm2_theme") || "dark";
document.documentElement.setAttribute("data-theme", preferredTheme === "light" ? "light" : "dark");

installGlobalErrorReporting();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <ErrorBoundary variant="page" title="The app hit an unexpected error">
        <SocketProvider>
          <App />
        </SocketProvider>
      </ErrorBoundary>
      <Suspense fallback={null}>
        <GooeyToaster
          position="top-right"
          theme={preferredTheme === "light" ? "light" : "dark"}
          preset="smooth"
          showProgress
        />
      </Suspense>
    </BrowserRouter>
  </React.StrictMode>
);

