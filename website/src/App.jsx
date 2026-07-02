import { lazy, Suspense } from "react";
import { LazyMotion, domMax } from "framer-motion";
import { Nav } from "./sections/Nav";
import { Hero } from "./sections/Hero";
import { TrustStrip } from "./sections/TrustStrip";

// Below-the-fold sections: code-split out of the initial bundle so they
// don't compete with the hero for parse/eval time before first paint.
const HowItWorks = lazy(() => import("./sections/HowItWorks").then((m) => ({ default: m.HowItWorks })));
const Features = lazy(() => import("./sections/Features").then((m) => ({ default: m.Features })));
const Models = lazy(() => import("./sections/Models").then((m) => ({ default: m.Models })));
const Industries = lazy(() => import("./sections/Industries").then((m) => ({ default: m.Industries })));
const FAQ = lazy(() => import("./sections/FAQ").then((m) => ({ default: m.FAQ })));
const CTAFooter = lazy(() => import("./sections/CTAFooter").then((m) => ({ default: m.CTAFooter })));
const Footer = lazy(() => import("./sections/Footer").then((m) => ({ default: m.Footer })));

export default function App() {
  return (
    <LazyMotion features={domMax}>
      <Nav />
      <Hero />
      <TrustStrip />
      <Suspense fallback={null}>
        <HowItWorks />
        <Features />
        <Models />
        <Industries />
        <FAQ />
        <CTAFooter />
        <Footer />
      </Suspense>
    </LazyMotion>
  );
}
