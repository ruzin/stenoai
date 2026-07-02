import { useState, useEffect } from "react";
import { Download, ShieldCheck, Lock, HandCoins } from "lucide-react";
import { AppWindowDemo } from "../components/AppWindowDemo";
import { HeroStatusPill } from "../components/HeroStatusPill";
import { m as Motion } from "framer-motion";
import { trackDownload } from "../analytics";

function AppleIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.029 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zm3.378-3.066c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701z" />
    </svg>
  );
}

function CtaIcon({ arch }) {
  if (arch === "arm64") return <AppleIcon size={15} />;
  return <Download size={15} aria-hidden="true" />;
}

const DOWNLOAD_ARM = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg";
const DOWNLOAD_WIN = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-windows-x64.exe";

const DL_MAC = { href: DOWNLOAD_ARM, arch: "arm64", label: "Download for macOS" };
const DL_WIN = { href: DOWNLOAD_WIN, arch: "win-x64", label: "Download for Windows (alpha)" };

// Best-effort client OS detection. Defaults to Mac (the primary, stable
// build) for the first paint and for any non-Windows/non-Mac visitor.
function detectOS() {
  if (typeof navigator === "undefined") return "mac";
  const hint = navigator.userAgentData?.platform || navigator.platform || "";
  const ua = navigator.userAgent || "";
  // Mobile/touch devices can't run the desktop app. iOS UAs contain
  // "like Mac OS X" (and iPadOS reports platform "MacIntel"), which would
  // otherwise match the mac check — guard them first and fall through to
  // "other" so phones/tablets see both CTAs rather than a bogus Mac-only one.
  const isIOS =
    /iphone|ipad|ipod/i.test(ua) ||
    (/mac/i.test(hint) && navigator.maxTouchPoints > 1);
  if (isIOS || /android/i.test(ua)) return "other";
  if (/win/i.test(hint) || /windows/i.test(ua)) return "windows";
  if (/mac/i.test(hint) || /mac os/i.test(ua)) return "mac";
  return "other";
}

export function Hero() {
  const [os, setOs] = useState("mac");

  useEffect(() => {
    setOs(detectOS());
  }, []);

  // Primary button follows the visitor's OS. When we're sure of the OS
  // (detected mac or windows) we show only that one button; when it's
  // unknown we offer both so the visitor can pick.
  const primary = os === "windows" ? DL_WIN : DL_MAC;
  const secondary = os === "windows" ? DL_MAC : DL_WIN;
  const showSecondary = os === "other";

  return (
    <section className="pt-[40px] pb-[56px] md:pt-[56px] md:pb-[80px]">
      <div className="container-site text-center">

        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-5 flex justify-center"
        >
          <HeroStatusPill />
        </Motion.div>

        <Motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 400,
            fontSize: "clamp(40px, 5.6vw, 68px)",
            lineHeight: 1.02,
            letterSpacing: "-0.025em",
            color: "var(--fg-1)",
            maxWidth: "36ch",
            margin: "0 auto",
          }}
        >
          AI for your confidential workflows.
        </Motion.h1>

        <Motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-fg-2 text-lg leading-[1.55] mt-6 mb-8 mx-auto"
          style={{ maxWidth: "64ch" }}
        >
          Steno is the AI powered intelligence layer for all your confidential workflows.
          No cloud, no usage limits and full control of your data.
        </Motion.p>

        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="flex gap-[10px] flex-wrap justify-center"
        >
          <a href={primary.href} onClick={() => trackDownload('hero', primary.arch)} className="btn-base btn-primary inline-flex items-center gap-2 no-underline hover:no-underline">
            <CtaIcon arch={primary.arch} /> {primary.label}
          </a>
          {showSecondary && (
            <a href={secondary.href} onClick={() => trackDownload('hero', secondary.arch)} className="btn-base btn-ghost inline-flex items-center gap-2 no-underline hover:no-underline">
              <CtaIcon arch={secondary.arch} /> {secondary.label}
            </a>
          )}
        </Motion.div>

        <Motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="flex gap-5 flex-wrap justify-center mt-6 mb-12"
        >
          <span className="inline-flex items-center gap-1.5 text-fg-2 text-[13px]">
            <ShieldCheck size={13} aria-hidden="true" /> Open source
          </span>
          <span className="inline-flex items-center gap-1.5 text-fg-2 text-[13px]">
            <Lock size={13} aria-hidden="true" /> No cloud. Models run locally.
          </span>
          <span className="inline-flex items-center gap-1.5 text-fg-2 text-[13px]">
            <HandCoins size={13} aria-hidden="true" /> Free forever
          </span>
        </Motion.div>

        <Motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.35 }}
          className="mx-auto"
          style={{ maxWidth: 960 }}
        >
          <AppWindowDemo />
        </Motion.div>

      </div>
    </section>
  );
}
