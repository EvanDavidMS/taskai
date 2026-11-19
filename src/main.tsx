import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Aplica el tema ANTES del primer pintado, para que no haya destello oscuro en modo claro.
(() => {
  let pref = "system";
  try {
    pref = localStorage.getItem("taskai.theme") || "system";
  } catch {
    /* sin almacenamiento */
  }
  const light = window.matchMedia("(prefers-color-scheme: light)").matches;
  document.documentElement.dataset.theme = pref === "system" ? (light ? "light" : "dark") : pref;
})();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
