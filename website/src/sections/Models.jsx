import { useState } from "react";
import {
  Check, Lock, Cloud, KeyRound,
  ShieldCheck, WifiOff, Package, Zap,
  Sparkles, RefreshCw, ScrollText, TrendingUp,
} from "lucide-react";
import { motion as Motion, AnimatePresence } from "framer-motion";

// ── Brand icons ──────────────────────────────────────────────────────────────

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

const MetaIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path d="M2 12c0-3 1.8-6 4.5-6 1.8 0 3.3 1.6 4.8 4.2.3.5.5 1 .7 1.5.2-.5.4-1 .7-1.5C14.2 7.6 15.7 6 17.5 6 20.2 6 22 9 22 12s-1.8 6-4.5 6c-1.8 0-3.3-1.6-4.8-4.2-.3-.5-.5-1-.7-1.5-.2.5-.4 1-.7 1.5C9.8 16.4 8.3 18 6.5 18 3.8 18 2 15 2 12z" fill="#0082FB"/>
  </svg>
);

const QwenIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
    <circle cx="11" cy="11" r="7.5" stroke="#673DE6" strokeWidth="2.5"/>
    <line x1="16" y1="16" x2="20" y2="20" stroke="#673DE6" strokeWidth="2.5" strokeLinecap="round"/>
  </svg>
);

const OpenAIIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path fill="currentColor" d="M22.28 9.82a5.98 5.98 0 0 0-.52-4.91 6.05 6.05 0 0 0-6.51-2.9A6.07 6.07 0 0 0 4.98 4.18a5.98 5.98 0 0 0-3.99 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.9 6.05 6.05 0 0 0 6.51 2.9A5.98 5.98 0 0 0 13.26 24a6.06 6.06 0 0 0 5.77-4.21 5.99 5.99 0 0 0 3.99-2.9 6.06 6.06 0 0 0-.74-7.07zM13.26 22.44a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.78.78 0 0 0 .39-.68V11.8l2.02 1.17a.07.07 0 0 1 .04.05v5.58a4.5 4.5 0 0 1-4.49 4.84zM3.62 18.3a4.47 4.47 0 0 1-.53-3.01l.14.08 4.78 2.76a.78.78 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.12-1.65zM2.34 7.9A4.48 4.48 0 0 1 4.71 5.92V11.6a.77.77 0 0 0 .39.68l5.81 3.35-2.02 1.17a.08.08 0 0 1-.07 0L4.6 14.1A4.5 4.5 0 0 1 2.34 7.9zm16.6 3.86L13.1 8.36l2.02-1.17a.08.08 0 0 1 .07 0l4.83 2.79a4.49 4.49 0 0 1-.68 8.1V12.5a.77.77 0 0 0-.4-.74zm2.01-3.02-.14-.08-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.25V6.9a.08.08 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.31 12.86 6.29 11.7a.07.07 0 0 1-.04-.05V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.78.78 0 0 0-.39.68l-.01 6.72zm1.1-2.37 2.6-1.5 2.6 1.5v3l-2.6 1.5-2.6-1.5v-3z"/>
  </svg>
);

const AnthropicIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path fill="currentColor" fillRule="evenodd" clipRule="evenodd" d="M13.5 2.5h-3L2 21.5h4.5l1.5-4h8l1.5 4H22L13.5 2.5ZM12 8l2.5 7h-5L12 8Z"/>
  </svg>
);

const brandIcons = {
  google:    GoogleIcon,
  meta:      MetaIcon,
  qwen:      QwenIcon,
  openai:    OpenAIIcon,
  anthropic: AnthropicIcon,
};

// ── Data ──────────────────────────────────────────────────────────────────────

const localModels = [
  { id: "gemma4:e2b-it-qat",  label: "Gemma 4 E2B", detail: "2B · Light",          brand: "google" },
  { id: "gemma4:e4b-it-qat",  label: "Gemma 4 E4B", detail: "4B · Balanced",       brand: "google" },
  { id: "llama3.2:3b",        label: "Llama 3.2",   detail: "3B · Fast",           brand: "meta"   },
  { id: "qwen3.5:9b",         label: "Qwen 3.5",    detail: "9B · Smart",          brand: "qwen"   },
  { id: "gemma4:12b-it-qat",  label: "Gemma 4",     detail: "12B · Long meetings", brand: "google" },
  { id: "gpt-oss:20b",        label: "GPT-OSS",     detail: "20B · Capable",       brand: "openai" },
];

const providers = [
  { brand: "openai",    name: "OpenAI",    stub: "sk-proj-••••••••3f8a", connected: true  },
  { brand: "anthropic", name: "Anthropic", stub: "sk-ant-api••••4c2d",   connected: true  },
  { brand: "google",    name: "Gemini",    stub: null,                   connected: false },
  { brand: "meta",      name: "Meta AI",   stub: null,                   connected: false },
  { brand: "qwen",      name: "Qwen",      stub: null,                   connected: false },
];

const advantages = {
  local: [
    {
      Icon: ShieldCheck,
      title: "Fully private",
      desc:  "Recordings, transcripts, and summaries never leave your machine.",
    },
    {
      Icon: WifiOff,
      title: "Works offline",
      desc:  "No internet required. Works on planes, in basements, anywhere.",
    },
    {
      Icon: Zap,
      title: "No API costs",
      desc:  "Unlimited summaries after setup — no per-query fees, ever.",
    },
    {
      Icon: Package,
      title: "Five models included",
      desc:  "Everything bundled at install — no downloads, no configuration.",
    },
  ],
  remote: [
    {
      Icon: Sparkles,
      title: "Frontier models",
      desc:  "GPT-4o, Claude 3.5 Sonnet, Gemini — the most capable models available.",
    },
    {
      Icon: KeyRound,
      title: "Bring your own key",
      desc:  "Paste an API key per provider. Your data goes directly to them — no middleman.",
    },
    {
      Icon: RefreshCw,
      title: "Always up to date",
      desc:  "Latest model versions automatically — no app updates needed.",
    },
    {
      Icon: TrendingUp,
      title: "Higher capability",
      desc:  "Better for complex agendas, long meetings, and detailed action items.",
    },
  ],
};

// ── Animation helpers ─────────────────────────────────────────────────────────

const fadeProps = {
  initial:    { opacity: 0, y: 6 },
  animate:    { opacity: 1, y: 0 },
  exit:       { opacity: 0, y: -6 },
  transition: { duration: 0.2 },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function Models() {
  const [mode, setMode] = useState("local");
  const [active, setActive] = useState(localModels[0].id);

  const handleModeChange = (newMode) => {
    setMode(newMode);
    if (newMode === "local") setActive(localModels[0].id);
  };

  return (
    <section id="models" className="sect">

      {/* ── Centered heading + toggle ── */}
      <Motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="container-site text-center"
        style={{ marginBottom: "3.5rem" }}
      >
        <h2
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 400,
            fontSize: "clamp(34px, 4.6vw, 52px)",
            lineHeight: 1.08,
            letterSpacing: "-0.02em",
            color: "var(--fg-1)",
            margin: "0 0 14px",
          }}
        >
          Your model, your choice.
        </h2>
        <p
          className="text-fg-2"
          style={{ fontSize: "clamp(16px, 1.4vw, 19px)", lineHeight: 1.5, margin: "0 0 28px" }}
        >
          Five models run entirely on your machine. Or connect to any major provider with your own key.
        </p>

        {/* Toggle */}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <div
            style={{
              display: "inline-flex",
              gap: 2,
              background: "var(--surface-sunken)",
              borderRadius: 10,
              padding: 3,
            }}
          >
            {[
              { key: "local",  Icon: Lock,  label: "Local"  },
              { key: "remote", Icon: Cloud, label: "Remote" },
            ].map(({ key, Icon, label }) => (
              <button
                key={key}
                onClick={() => handleModeChange(key)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  padding: "7px 18px",
                  borderRadius: 7,
                  border: 0,
                  background: mode === key ? "var(--surface-raised)" : "transparent",
                  boxShadow: mode === key ? "var(--shadow-sm)" : "none",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 500,
                  color: "var(--fg-1)",
                  transition: `background var(--dur-fast) var(--ease), box-shadow var(--dur-fast) var(--ease)`,
                }}
              >
                <Icon size={13} />
                {label}
              </button>
            ))}
          </div>
        </div>
      </Motion.div>

      {/* ── Two-column body ── */}
      <Motion.div
        initial={{ opacity: 0, y: 8 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.08 }}
        className="container-site grid md:grid-cols-2 gap-10 md:gap-16 items-center"
      >

        {/* Left: advantages */}
        <AnimatePresence mode="wait" initial={false}>
          <Motion.ul
            key={mode}
            {...fadeProps}
            style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "1.5rem" }}
          >
            {advantages[mode].map(({ Icon, title, desc }) => (
              <li key={title} style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    background: "var(--surface-sunken)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                    marginTop: 1,
                  }}
                >
                  <Icon size={16} style={{ color: "var(--fg-2)" }} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-1)", lineHeight: 1.4, marginBottom: 4 }}>
                    {title}
                  </div>
                  <div style={{ fontSize: 14, color: "var(--fg-2)", lineHeight: 1.6 }}>
                    {desc}
                  </div>
                </div>
              </li>
            ))}
          </Motion.ul>
        </AnimatePresence>

        {/* Right: model list or provider key panel */}
        <div
          style={{
            background: "var(--surface-raised)",
            borderRadius: 14,
            border: "1px solid var(--border-subtle)",
            overflow: "hidden",
            padding: "14px 10px",
          }}
        >
        <AnimatePresence mode="wait" initial={false}>
          {mode === "local" ? (
            <Motion.div key="local" {...fadeProps} className="flex flex-col gap-0.5">
              {localModels.map((m) => {
                const BrandIcon = brandIcons[m.brand];
                return (
                  <button
                    key={m.id}
                    onClick={() => setActive(m.id)}
                    className="flex items-center gap-3 px-4 py-[14px] rounded-[8px] border-0 bg-transparent cursor-pointer w-full text-left"
                    style={{
                      background: active === m.id ? "var(--surface-hover)" : "transparent",
                      transition: "background var(--dur-fast) var(--ease)",
                    }}
                  >
                    <BrandIcon />
                    <div className="flex flex-col gap-0.5 flex-1">
                      <span className="text-[15px] font-medium text-fg-1">{m.label}</span>
                      <code className="text-fg-2" style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                        {m.id}
                      </code>
                    </div>
                    <span className="text-fg-2 text-[13px] whitespace-nowrap">{m.detail}</span>
                    {active === m.id && <Check size={14} className="text-fg-1" aria-hidden="true" />}
                  </button>
                );
              })}
            </Motion.div>
          ) : (
            <Motion.div key="remote" {...fadeProps} className="flex flex-col gap-0.5">
              {providers.map((p) => {
                const BrandIcon = brandIcons[p.brand];
                return (
                  <div key={p.name} className="flex items-center gap-3 px-4 py-[14px] rounded-[8px]">
                    <BrandIcon />
                    <span
                      className="text-[15px] font-medium text-fg-1"
                      style={{ width: "7rem", flexShrink: 0 }}
                    >
                      {p.name}
                    </span>
                    <div
                      className="flex items-center gap-2 flex-1 min-w-0"
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        color: p.stub ? "var(--fg-2)" : "var(--fg-muted)",
                        background: "var(--surface-sunken)",
                        borderRadius: 6,
                        padding: "5px 10px",
                        overflow: "hidden",
                      }}
                    >
                      {!p.stub && <KeyRound size={11} style={{ flexShrink: 0, opacity: 0.5 }} />}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.stub ?? "Add API key…"}
                      </span>
                    </div>
                    {p.connected && (
                      <span style={{ fontSize: 12, fontWeight: 500, color: "var(--green-600)", flexShrink: 0 }}>
                        Connected
                      </span>
                    )}
                  </div>
                );
              })}
            </Motion.div>
          )}
        </AnimatePresence>
        </div>

      </Motion.div>
    </section>
  );
}
