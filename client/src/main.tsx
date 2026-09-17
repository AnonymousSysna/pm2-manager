import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import { SocketProvider } from "./hooks/useSocket";
import { installGlobalErrorReporting } from "./lib/errorReporter";
import "./index.css";

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
      <GooeyToaster
        position="top-right"
        theme={preferredTheme === "light" ? "light" : "dark"}
        preset="smooth"
        showProgress
      />
    </BrowserRouter>
  </React.StrictMode>
);

