import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import "../excalidraw-app/sentry";
import "./runtime/desktop";

import ExcalidrawApp from "./App";
import { supportsPWA } from "./runtime/platform";

window.__EXCALIDRAW_SHA__ = import.meta.env.VITE_APP_GIT_SHA;
const rootElement = document.getElementById("root")!;
const root = createRoot(rootElement);
if (supportsPWA()) {
  registerSW();
}
root.render(
  <StrictMode>
    <ExcalidrawApp />
  </StrictMode>,
);
