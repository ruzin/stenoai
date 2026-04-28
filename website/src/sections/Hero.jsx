import { useState, useEffect } from "react";
import { Download, ArrowRight, ShieldCheck, Lock, Cpu } from "lucide-react";
import { motion as Motion } from "framer-motion";
import { trackDownload } from "../analytics";

const DOWNLOAD_ARM = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg";

function fmt(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

export function Hero() {
  const [seconds, setSeconds] = useState(862);

  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="pt-[40px] pb-[56px] md:pt-[56px] md:pb-[80px]">
      <div className="container-site grid md:grid-cols-[1.1fr_1fr] gap-10 md:gap-16 items-center">

        {/* Copy */}
        <div>
          <Motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 400,
              fontSize: "clamp(44px, 6.2vw, 72px)",
              lineHeight: 1.02,
              letterSpacing: "-0.025em",
              color: "var(--fg-1)",
              maxWidth: "14ch",
            }}
          >
            AI that runs privately on your Mac.
          </Motion.h1>

          <Motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-fg-2 text-lg leading-[1.55] mt-7 mb-9"
            style={{ maxWidth: "44ch" }}
          >
            stenoAI records, transcribes, and summarizes every confidential interaction on-device.
            No cloud, no usage limits and no bots joining your calls.
          </Motion.p>

          <Motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15 }}
            className="flex gap-[10px] flex-wrap"
          >
            <a href="#download" onClick={() => trackDownload('hero', 'unknown')} className="btn-base btn-primary inline-flex items-center gap-2 no-underline hover:no-underline">
              <Download size={15} aria-hidden="true" /> Download for Mac
            </a>
            <a href="#how" className="btn-base btn-ghost inline-flex items-center gap-2 no-underline hover:no-underline">
              See how it works <ArrowRight size={15} aria-hidden="true" />
            </a>
          </Motion.div>

          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.25 }}
            className="flex gap-5 flex-wrap mt-7"
          >
            <span className="inline-flex items-center gap-1.5 text-fg-2 text-[13px]">
              <ShieldCheck size={13} aria-hidden="true" /> No network requests after install
            </span>
            <span className="inline-flex items-center gap-1.5 text-fg-2 text-[13px]">
              <Lock size={13} aria-hidden="true" /> Open source, verify it yourself
            </span>
          </Motion.div>
        </div>

        {/* Mock macOS window */}
        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="relative max-w-full overflow-x-auto"
        >
          <div
            className="rounded-[14px] overflow-hidden"
            style={{ background: "var(--surface-raised)", boxShadow: "var(--shadow-lg)" }}
          >
            {/* Title bar */}
            <div
              className="flex gap-[6px] items-center px-3 md:px-[14px] py-[10px]"
              style={{ background: "var(--surface-sunken)", borderBottom: "1px solid var(--border-subtle)" }}
            >
              <span className="w-[10px] h-[10px] rounded-full bg-[#FF5F57] block" />
              <span className="w-[10px] h-[10px] rounded-full bg-[#FEBC2E] block" />
              <span className="w-[10px] h-[10px] rounded-full bg-[#28C840] block" />
              <div className="ml-auto inline-flex items-center gap-[7px] text-fg-2 text-[12px] tabular-nums px-[10px] py-1 rounded-[6px]">
                <span className="rec-dot" />
                <span style={{ fontFamily: "var(--font-mono)" }}>Recording · {fmt(seconds)}</span>
              </div>
            </div>

            {/* Content */}
            <div className="px-4 sm:px-6 md:px-8 pt-7 pb-8">
              <div
                className="mb-1.5"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontWeight: 400,
                  fontSize: 26,
                  letterSpacing: "-0.015em",
                  color: "var(--fg-1)",
                }}
              >
                Q1 budget sync
              </div>
              <div className="text-fg-2 text-[13px] mb-5">Feb 15, 2026 · 42 min</div>
              <p className="text-sm leading-[1.6] text-fg-1 mb-6">
                The team reviewed Q1 variance. Engineering is 8% under plan; marketing is 3% over, driven by a paid pilot. Decision: reallocate $40k through March 31.
              </p>

              <div className="text-sm font-medium text-fg-1 mb-2.5">Key points</div>
              <ul className="list-none p-0 m-0 flex flex-col gap-2 mb-5">
                {[
                  "Engineering underspend: two hires slipped to March.",
                  "Paid pilot ahead of signups, over budget.",
                  "Reallocate $40k; revisit at next sync.",
                ].map((item) => (
                  <li key={item} className="flex gap-[10px] text-[13.5px] leading-[1.55] text-fg-1">
                    <span className="w-[3px] h-[3px] rounded-full bg-fg-2 flex-shrink-0 mt-[9px]" />
                    {item}
                  </li>
                ))}
              </ul>

              <div className="text-sm font-medium text-fg-1 mb-2.5">Action items</div>
              <ul className="list-none p-0 m-0 flex flex-col gap-2">
                {[
                  "Marcus to file reallocation request by Friday.",
                  "Priya to draft updated Q1 forecast.",
                ].map((item) => (
                  <li key={item} className="flex gap-[10px] text-[13.5px] leading-[1.55] text-fg-1">
                    <span className="w-[3px] h-[3px] rounded-full bg-fg-2 flex-shrink-0 mt-[9px]" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-1.5 text-fg-muted text-[12px]">
            <Cpu size={12} aria-hidden="true" />
            Summarized locally with{" "}
            <code style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>gemma3:4b</code>
          </div>
        </Motion.div>

      </div>
    </section>
  );
}
