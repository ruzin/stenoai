import React from "react";
import { motion } from "framer-motion";
import { Mic, ShieldCheck, Zap, Sparkles, Cpu, FileText, Lock, Download, Github } from "lucide-react";

// Update with actual GitHub repo URL
const GITHUB_URL = "https://github.com/ruzin/stenoai";
const DISCORD_URL = "https://discord.gg/EHxvAdKf";

// Discord icon component (Lucide doesn't include Discord)
const DiscordIcon = ({ className }) => (
  <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
  </svg>
);

// Download URLs pointing to latest release assets
// GitHub's /latest/download/ automatically finds the correct versioned file
const DOWNLOAD_URL_MAC_SILICON = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg";
const DOWNLOAD_URL_MAC_INTEL = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-x64.dmg";

const features = [
  {
    icon: <Cpu className="w-6 h-6" aria-hidden="true" />,
    title: "Local Meeting Transcription",
    desc: "Blazing‑fast speech‑to‑text that runs entirely on your device. No uploads. No lag.",
    pill: "Private by design",
  },
  {
    icon: <FileText className="w-6 h-6" aria-hidden="true" />,
    title: "Local Summaries",
    desc: "Generate smart, on‑device bullet points and outlines for meetings and lectures.",
    pill: "Offline mode",
  },
  {
    icon: <Sparkles className="w-6 h-6" aria-hidden="true" />,
    title: "Multiple AI Models",
    desc: "Choose from open-source models like Qwen, Llama, DeepSeek & Gemma",
    pill: "Multi-Model Support",
  },
  {
    icon: <ShieldCheck className="w-6 h-6" aria-hidden="true" />,
    title: "Privacy First",
    desc: "All processing happens locally on your Mac. Your data never leaves your device.",
    pill: "100% Privacy",
  },
];

const faqs = [
  {
    q: "What's included for free?",
    a: "Unlimited local transcription and local summarisation on your device, with no account required.",
  },
  {
    q: "How do I install on macOS?",
    a: "(1) Download and open the DMG file, (2) Drag the app to Applications, (3) When you first launch the app, macOS may show a security warning, (4) To fix this: Go to System Settings > Privacy & Security, scroll down and click 'Open Anyway'. Alternatively, run in Terminal: 'xattr -cr /Applications/StenoAI.app' (5) The app will work normally on subsequent launches.",
  },
  {
    q: "What AI models are available?",
    a: "Choose from 4 cutting-edge open-source models: Llama 3.2 3B (fastest, default), Gemma 3 4B (efficient), Qwen 3 8B (best for structured notes), and DeepSeek-R1 8B (superior reasoning). All models run 100% locally on your Mac.",
  },
  {
    q: "Is my data private and secure?",
    a: "Absolutely. stenoAI runs 100% locally with zero cloud dependencies. Your meeting recordings and transcripts stay on your Mac and are never uploaded anywhere.",
  },
  {
    q: "How accurate is the meeting transcription?",
    a: "StenoAI uses OpenAI's Whisper model to generate accurate text from meeting recordings across accents and languages. Results depend on audio clarity — quiet rooms and good microphones produce the best outcomes.",
  },
  {
    q: "What platforms are supported?",
    a: "Currently macOS only (Apple Silicon & Intel). Performance on non M series Macs is limited due to lack of dedicated AI inference in older intel chips.",
  },
];

export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-slate-900 to-slate-900 text-slate-100">
      {/* Nav */}
      <header className="sticky top-0 z-30 backdrop-blur supports-[backdrop-filter]:bg-slate-950/50 border-b border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <a href="#" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="p-2 rounded-xl bg-slate-800 border border-white/10"><Mic className="w-5 h-5" aria-hidden="true" /></div>
            <span className="text-lg font-semibold tracking-tight">stenoAI</span>
          </a>
          <nav className="hidden md:flex items-center gap-6 text-sm text-slate-300">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#faq" className="hover:text-white">FAQ</a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-slate-300 hover:text-white">
              <Github className="w-4 h-4" aria-hidden="true" /> GitHub
            </a>
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-slate-300 hover:text-white">
              <DiscordIcon className="w-4 h-4" /> Discord
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="md:hidden inline-flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-sm hover:bg-white/5">
              <Github className="w-4 h-4" aria-hidden="true" /> GitHub
            </a>
            <a href="#download" className="hidden sm:inline-flex items-center gap-2 rounded-2xl border border-white/10 px-3 py-2 text-sm hover:bg-white/5">
              <Download className="w-4 h-4" aria-hidden="true" /> Download
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section id="cta" className="max-w-6xl mx-auto px-4 pt-16 pb-12 md:pt-24 md:pb-20">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <motion.h1 initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{duration:0.6}} className="text-4xl md:text-6xl font-extrabold leading-tight">
              Notes that write themselves.
              <span className="block bg-gradient-to-r from-indigo-400 via-sky-400 to-cyan-300 text-transparent bg-clip-text">Private. Fast. Accurate.</span>
            </motion.h1>
            <p className="mt-6 text-slate-300 text-lg leading-relaxed max-w-prose">
              StenoAI is an AI-powered meeting notes assistant that runs locally on your device. Engineered for privacy - your data never leaves your device. No cloud accounts, no bots joining calls, and free to use.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <a href="#download" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white text-slate-900 px-5 py-3 font-semibold hover:bg-slate-100">
                <Download className="w-5 h-5" aria-hidden="true" /> Download Free
              </a>
              </div>
            <div className="mt-6 flex items-center gap-4 text-sm text-slate-400">
              <div className="flex items-center gap-1"><Lock className="w-4 h-4" aria-hidden="true" /> Private by default</div>
              <div className="flex items-center gap-1"><Zap className="w-4 h-4" aria-hidden="true" /> Blazing fast summaries</div>
              <div className="flex items-center gap-1"><Sparkles className="w-4 h-4" aria-hidden="true" /> Smart highlights</div>
            </div>
          </div>
          <motion.div initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{duration:0.7, delay:0.1}} className="relative">
            <div className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-indigo-500/20 to-cyan-500/20 blur-2xl" />
            <div className="relative rounded-3xl border border-white/10 bg-slate-900/60 p-4 shadow-2xl">
              <div className="rounded-2xl bg-slate-800/60 border border-white/10 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                  <div className="flex items-center gap-2 text-sm text-slate-300"><Mic className="w-4 h-4" aria-hidden="true" /> Live Session</div>
                  <span className="text-xs text-slate-400">00:32:11</span>
                </div>
                <div className="grid md:grid-cols-2 gap-0">
                  <div className="p-4 md:p-6 space-y-3">
                    <div className="text-xs uppercase tracking-wider text-slate-400">Transcript</div>
                    <p className="text-sm leading-6 text-slate-200">
                      …and the key decision is to launch the beta on Friday. Sarah will own the onboarding flow, and Omar will prepare support macros. Let's review metrics Monday.
                    </p>
                  </div>
                  <div className="p-4 md:p-6 border-t md:border-t-0 md:border-l border-white/10 space-y-3 bg-slate-900/40">
                    <div className="text-xs uppercase tracking-wider text-slate-400">Summary</div>
                    <ul className="text-sm text-slate-200 list-disc ml-5 space-y-2">
                      <li>Beta launch on Friday</li>
                      <li>Owners: Sarah (onboarding), Omar (support)</li>
                      <li>Next checkpoint: Monday metrics review</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Feature grid */}
      <section id="features" className="max-w-6xl mx-auto px-4 py-12 md:py-20">
        <div className="text-center max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold">Built for focus, engineered for privacy</h2>
          <p className="mt-4 text-slate-300">Record, transcribe, and summarise your meetings without sending your data anywhere. Choose from 4 powerful AI models for deeper meeting insights.</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
          {features.map((f, i) => (
            <motion.div key={f.title} initial={{opacity:0, y:8}} whileInView={{opacity:1, y:0}} viewport={{once:true}} transition={{duration:0.4, delay:i*0.05}} className="rounded-3xl border border-white/10 bg-slate-900/50 p-5">
              <div className="flex items-center gap-2 text-slate-200">
                <div className="p-2 rounded-xl bg-slate-800 border border-white/10">{f.icon}</div>
                <h3 className="font-semibold">{f.title}</h3>
              </div>
              <p className="mt-3 text-sm text-slate-300">{f.desc}</p>
              <span className="inline-flex mt-4 text-xs rounded-full border border-white/10 px-2 py-1 text-slate-300">{f.pill}</span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-6xl mx-auto px-4 py-12 md:py-20">
        <div className="text-center max-w-2xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold">Frequently asked questions</h2>
          <p className="mt-4 text-slate-300">Everything you need to know about stenoAI.</p>
        </div>
        <div className="mt-10 grid md:grid-cols-2 gap-6">
          {faqs.map((f) => (
            <div key={f.q} className="rounded-3xl border border-white/10 bg-slate-900/50 p-6">
              <h3 className="font-semibold">{f.q}</h3>
              <p className="mt-2 text-slate-300 text-sm">{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA footer */}
      <section id="download" className="max-w-6xl mx-auto px-4 py-12 md:py-20">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-r from-indigo-600/20 via-sky-600/20 to-cyan-600/20 p-8 md:p-12 text-center">
          <h2 className="text-3xl md:text-4xl font-bold">Start capturing brilliant notes today</h2>
          <p className="mt-4 text-slate-200">Download the free app for macOS.</p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <a href={DOWNLOAD_URL_MAC_SILICON} className="inline-flex items-center gap-2 rounded-2xl bg-white text-slate-900 px-5 py-3 font-semibold hover:bg-slate-100"><Download className="w-5 h-5" aria-hidden="true" /> Apple Silicon (M1–M4)</a>
            <a href={DOWNLOAD_URL_MAC_INTEL} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-5 py-3 font-semibold hover:bg-white/5"><Download className="w-5 h-5" aria-hidden="true" /> Intel Macs</a>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-10 text-sm text-slate-400">
          <div className="flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-slate-300">
              <Mic className="w-4 h-4" aria-hidden="true" /> <span className="font-semibold">stenoAI</span>
            </div>
            <div className="flex gap-4">
              <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="hover:text-white">Discord</a>
              <a href="#" className="hover:text-white">Privacy</a>
              <a href="#" className="hover:text-white">Terms</a>
              <a href="#" className="hover:text-white">Contact</a>
            </div>
            <div>© 2026 stenoAI</div>
          </div>
          <div className="mt-6 text-center text-xs text-slate-500">
            <i>Disclaimer: This is an independent open-source project for meeting-notes productivity and is not affiliated with, endorsed by, or associated with any similarly named company.</i>
          </div>
        </div>
      </footer>
    </div>
  );
}
