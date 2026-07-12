import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LazyMotion, domMax } from "framer-motion";
import "../index.css";
import { initAnalytics } from "../analytics";

// Shared bootstrap for the /enterprise/ entry points — mirrors main.jsx
// (idle-deferred analytics, LazyMotion so the reused Nav/CTAFooter `m`
// components animate).
export function mount(node) {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <LazyMotion features={domMax}>{node}</LazyMotion>
    </StrictMode>,
  );

  if ("requestIdleCallback" in window) {
    requestIdleCallback(initAnalytics);
  } else {
    setTimeout(initAnalytics, 1);
  }
}
