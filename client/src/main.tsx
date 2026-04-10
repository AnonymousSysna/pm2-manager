import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
import App from "./App";
import "./index.css";

const preferredTheme = localStorage.getItem("pm2_theme") || "dark";
document.documentElement.setAttribute("data-theme", preferredTheme === "light" ? "light" : "dark");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <GooeyToaster
        position="top-right"
        theme={preferredTheme === "light" ? "light" : "dark"}
        preset="smooth"
        showProgress
      />
    </BrowserRouter>
  </React.StrictMode>
);

