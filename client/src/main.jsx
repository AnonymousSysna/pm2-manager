import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { GooeyToaster } from "goey-toast";
import "goey-toast/styles.css";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
      <GooeyToaster position="top-right" theme="dark" preset="smooth" showProgress />
    </BrowserRouter>
  </React.StrictMode>
);
