import React from "react";
import { motion } from "framer-motion";
import { Mic, ShieldCheck, Zap, Sparkles, Cpu, FileText, Lock, Download, Github } from "lucide-react";

// Update with actual GitHub repo URL
const GITHUB_URL = "https://github.com/ruzin/stenoai";

// Download URLs pointing to latest release assets
const DOWNLOAD_URL_MAC_SILICON = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg";
const DOWNLOAD_URL_MAC_INTEL = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-intel.dmg";

const features = [
  {
    icon: <Cpu className="w-6 h-6" aria-hidden="true" />,
    title: "Local Transcription",
    desc: "Blazing‑fast speech‑to‑text that runs entirely on your device. No uploads. No lag.",
    pill: "Private by design",
  },
  {
    icon: <FileText className="w-6 h-6" aria-hidden="true" />,
    title: "Local Summaries (Free)",
    desc: "Generate smart, on‑device bullet points and outlines for meetings, lectures, and podcasts.",
    pill: "Offline mode",
  },
  {
    icon: <Sparkles className="w-6 h-6" aria-hidden="true" />,
    title: "Pro Summaries (Cloud)",
    desc: "Bring your own model via API key (e.g., OpenAI or Anthropic). Only when you enable it.",
    pill: "Bring your Own AI Model",
  },
  {
    icon: <ShieldCheck className="w-6 h-6" aria-hidden="true" />,
    title: "End‑to‑End Control",
    desc: "Choose where your data is processed. Local by default. Cloud only with your consent.",
    pill: "Your data, your rules",
  },
];

const faqs = [
  {
    q: "What's included for free?",
    a: "Unlimited local transcription and local summarisation on your device, with no account required.",
  },
  {
    q: "What does Pro add?",
    a: "When available, stenoAI can send your notes to your chosen provider (e.g., OpenAI or Anthropic) using your own API key to generate richer executive summaries, action items, and sentiment tags — only when you explicitly enable it.",
  },
  {
    q: "Is my audio ever uploaded?",
    a: "Not for local features. Audio and text stay on your device by default. Cloud summaries are strictly opt‑in and send only the text you choose, secured in transit.",
  },
  {
    q: "What platforms are supported?",
    a: "Currently macOS (Apple Silicon & Intel). Windows, Linux, iOS, and Android are on our roadmap.",
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
      <section id="cta" className="max-w-6xl mx-auto px-4 pt-20 pb-16 md:pt-28 md:pb-24">
        <div className="grid md:grid-cols-2 gap-10 items-center">
          <div>
            <motion.h1 initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} transition={{duration:0.6}} className="text-4xl md:text-6xl font-extrabold leading-tight">
              Notes that write themselves.
              <span className="block bg-gradient-to-r from-indigo-400 via-sky-400 to-cyan-300 text-transparent bg-clip-text">Private. Fast. Accurate.</span>
            </motion.h1>
            <p className="mt-6 text-slate-300 text-lg leading-relaxed max-w-prose">
              stenoAI is an AI transcriber & stenographer app that runs locally. Get studio‑grade transcription and on‑device summaries for free. Pro cloud‑powered deep summaries with OpenAI or Anthropic are coming soon.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <a href="#download" className="inline-flex items-center justify-center gap-2 rounded-2xl bg-white text-slate-900 px-5 py-3 font-semibold hover:bg-slate-100">
                <Download className="w-5 h-5" aria-hidden="true" /> Download Free
              </a>
              </div>
            <div className="mt-6 flex items-center gap-4 text-sm text-slate-400">
              <div className="flex items-center gap-1"><Lock className="w-4 h-4" aria-hidden="true" /> Local by default</div>
              <div className="flex items-center gap-1"><Zap className="w-4 h-4" aria-hidden="true" /> Realtime captions</div>
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
      <section id="features" className="max-w-6xl mx-auto px-4 py-16 md:py-24">
        <div className="text-center max-w-3xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold">Built for focus, engineered for privacy</h2>
          <p className="mt-4 text-slate-300">Record, transcribe, and summarise without sending your audio anywhere. When you want deeper insights, Pro summaries will be available soon.</p>
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

      {/* Trust & privacy */}
      <section className="max-w-6xl mx-auto px-4 py-12">
        <div className="rounded-3xl border border-white/10 bg-slate-900/50 p-6 md:p-8 flex flex-col md:flex-row items-start md:items-center gap-6">
          <div className="p-3 rounded-2xl bg-slate-800 border border-white/10"><ShieldCheck className="w-6 h-6" aria-hidden="true" /></div>
          <div className="flex-1">
            <h3 className="text-xl font-semibold">Privacy first, always</h3>
            <p className="mt-2 text-slate-300 text-sm">stenoAI processes your recordings locally by default. Pro's cloud summaries (coming soon) will be strictly opt‑in and can be disabled at any time. We never sell your data.</p>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-6xl mx-auto px-4 py-16 md:py-24">
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
      <section id="download" className="max-w-6xl mx-auto px-4 py-16 md:py-24">
        <div className="rounded-3xl border border-white/10 bg-gradient-to-r from-indigo-600/20 via-sky-600/20 to-cyan-600/20 p-8 md:p-12 text-center">
          <h2 className="text-3xl md:text-4xl font-bold">Start capturing brilliant notes today</h2>
          <p className="mt-4 text-slate-200">Download the free app for macOS. Pro is coming soon.</p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <a href={DOWNLOAD_URL_MAC_SILICON} className="inline-flex items-center gap-2 rounded-2xl bg-white text-slate-900 px-5 py-3 font-semibold hover:bg-slate-100"><Download className="w-5 h-5" aria-hidden="true" /> Apple Silicon (M1–M4)</a>
            <a href={DOWNLOAD_URL_MAC_INTEL} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 px-5 py-3 font-semibold hover:bg-white/5"><Download className="w-5 h-5" aria-hidden="true" /> Intel Macs</a>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10">
        <div className="max-w-6xl mx-auto px-4 py-10 text-sm text-slate-400 flex flex-col md:flex-row gap-4 md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-slate-300">
            <Mic className="w-4 h-4" aria-hidden="true" /> <span className="font-semibold">stenoAI</span>
          </div>
          <div className="flex gap-4">
            <a href="#" className="hover:text-white">Privacy</a>
            <a href="#" className="hover:text-white">Terms</a>
            <a href="#" className="hover:text-white">Contact</a>
          </div>
          <div>© {new Date().getFullYear()} stenoAI</div>
        </div>
      </footer>
    </div>
  );
}
