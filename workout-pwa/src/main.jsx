import React from "react";
import { createRoot } from "react-dom/client";
import App from "../../ppl-workout-tracker.jsx";
import { startShell, __shell } from "./shell.js";

window.__pplShell = __shell; // debugging / test hook

startShell(() => {
  const rootEl = document.getElementById("root");
  rootEl.textContent = "";
  createRoot(rootEl).render(<App />);
});
