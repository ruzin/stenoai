import { lazy, Suspense } from "react";
import { LazyMotion, domMax } from "framer-motion";
import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { TrustStrip } from "./sections/TrustStrip";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Below-the-fold sections: code-split out of the initial bundle so they
// don't compete with the hero for parse/eval time before first paint.
const HowItWorks = lazy(() => import("./sections/HowItWorks").then((m) => ({ default: m.HowItWorks })));
const Features = lazy(() => import("./sections/Features").then((m) => ({ default: m.Features })));
const Models = lazy(() => import("./sections/Models").then((m) => ({ default: m.Models })));
const Industries = lazy(() => import("./sections/Industries").then((m) => ({ default: m.Industries })));
const FAQ = lazy(() => import("./sections/FAQ").then((m) => ({ default: m.FAQ })));
const CTAFooter = lazy(() => import("./sections/CTAFooter").then((m) => ({ default: m.CTAFooter })));
const Footer = lazy(() => import("./sections/Footer").then((m) => ({ default: m.Footer })));

// Falls back here if a lazy section chunk fails to load (network blip, or a
// stale index.html referencing a chunk hash evicted by a redeploy) — keeps
// Nav/Hero/TrustStrip (outside this boundary) alive instead of a blank page.
function SectionsFallback() {
  return (
    <div className="container-site" style={{ padding: "80px 0", textAlign: "center" }}>
      <p style={{ color: "var(--fg-2)", marginBottom: 16 }}>
        Something went wrong loading the rest of the page.
      </p>
      <button type="button" className="btn-base btn-primary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

export default function App() {
  return (
    <LazyMotion features={domMax}>
      <Nav />
      <Hero />
      <TrustStrip />
      <ErrorBoundary fallback={<SectionsFallback />}>
        <Suspense fallback={null}>
          <HowItWorks />
          <Features />
          <Models />
          <Industries />
          <FAQ />
          <CTAFooter />
          <Footer />
        </Suspense>
      </ErrorBoundary>
    </LazyMotion>
  );
}
