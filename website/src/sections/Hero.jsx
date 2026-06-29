import { useState, useEffect } from "react";
import { Download, ShieldCheck, Lock } from "lucide-react";
import { AppWindowDemo } from "../components/AppWindowDemo";
import { motion as Motion } from "framer-motion";
import { trackDownload } from "../analytics";

const DOWNLOAD_ARM = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg";
const DOWNLOAD_WIN = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-windows-x64.exe";

const DL_MAC = { href: DOWNLOAD_ARM, arch: "arm64", label: "Download for Mac" };
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
            maxWidth: "18ch",
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
          style={{ maxWidth: "48ch" }}
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
            <Download size={15} aria-hidden="true" /> {primary.label}
          </a>
          {showSecondary && (
            <a href={secondary.href} onClick={() => trackDownload('hero', secondary.arch)} className="btn-base btn-ghost inline-flex items-center gap-2 no-underline hover:no-underline">
              <Download size={15} aria-hidden="true" /> {secondary.label}
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
            <ShieldCheck size={13} aria-hidden="true" /> No network requests after install
          </span>
          <span className="inline-flex items-center gap-1.5 text-fg-2 text-[13px]">
            <Lock size={13} aria-hidden="true" /> Open source, verify it yourself
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
