import { useState, useEffect } from "react";
import { m as Motion, AnimatePresence } from "framer-motion";
import { Loader2, Check } from "lucide-react";

const STEPS = [
  { key: "recording", label: "Recording", ms: 3000 },
  { key: "processing", label: "Processing", ms: 2200 },
  { key: "ready", label: "Summary ready", ms: 2200 },
];

function RecordingWave() {
  const delays = [0, 0.15, 0.3, 0.1, 0.25, 0.05, 0.2];
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", height: 14, gap: 2 }}>
      {delays.map((d, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: 2,
            height: "60%",
            minHeight: 2,
            background: "var(--recording)",
            borderRadius: 2,
            transformOrigin: "50% 100%",
            animation: `dockWave 1.1s ease-in-out ${d}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

function fmt(s) {
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

function StepContent({ step, seconds }) {
  if (step === "recording") {
    return (
      <>
        <RecordingWave />
        <span style={{ color: "var(--fg-2)" }}>Recording</span>
        <span style={{ fontFamily: "var(--font-mono)", color: "var(--fg-1)", fontVariantNumeric: "tabular-nums" }}>
          {fmt(seconds)}
        </span>
      </>
    );
  }
  if (step === "processing") {
    return (
      <>
        <Loader2 size={13} className="animate-spin" style={{ color: "var(--fg-2)", flexShrink: 0 }} />
        <span style={{ color: "var(--fg-2)" }}>Processing</span>
      </>
    );
  }
  return (
    <>
      <Check size={13} style={{ color: "var(--fg-1)", flexShrink: 0 }} />
      <span style={{ color: "var(--fg-1)" }}>Summary ready</span>
    </>
  );
}

export function HeroStatusPill() {
  const [stepIdx, setStepIdx] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const step = STEPS[stepIdx];

  useEffect(() => {
    const t = setTimeout(() => setStepIdx((i) => (i + 1) % STEPS.length), step.ms);
    return () => clearTimeout(t);
  }, [stepIdx, step.ms]);

  useEffect(() => {
    if (step.key !== "recording") return undefined;
    const ticker = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(ticker);
  }, [step.key]);

  useEffect(() => {
    if (step.key === "recording") setSeconds(0);
  }, [step.key]);

  return (
    <div
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 14px",
        borderRadius: 999,
        background: "var(--surface-raised)",
        border: "1px solid var(--border-subtle)",
        boxShadow: "var(--shadow-sm)",
        fontSize: 13,
        fontFamily: "var(--font-sans)",
        overflow: "hidden",
      }}
    >
      <AnimatePresence mode="wait">
        <Motion.span
          key={step.key}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.25 }}
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <StepContent step={step.key} seconds={seconds} />
        </Motion.span>
      </AnimatePresence>
    </div>
  );
}
