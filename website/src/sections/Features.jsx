import { createElement, useEffect, useRef, useState } from "react";
import { m as Motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown, ChevronLeft,
  Calendar as CalendarIcon, Clock, PencilLine, ArrowUp,
} from "lucide-react";

// ─── Scale wrapper ────────────────────────────────────────────
// Measures its container and scales children (written at 680px wide)
// to fill whatever space is available.
const APP_W = 680;

function ScaledApp({ children }) {
  const outerRef = useRef(null);
  const [scale, setScale] = useState(1);
  const [innerH, setInnerH] = useState(460);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => {
      const s = el.offsetWidth / APP_W;
      if (!s) return; // transient 0-width measurement (e.g. bfcache restore) — skip, keep last good scale
      setScale(s);
      setInnerH(el.offsetHeight / s);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      <div
        style={{
          width: APP_W,
          height: innerH,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          position: "absolute",
          top: 0,
          left: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          background: "var(--surface-raised)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ─── App titlebar ─────────────────────────────────────────────
function AppTitlebar() {
  return (
    <div
      className="flex items-center gap-[6px] flex-shrink-0"
      style={{
        padding: "10px 14px",
        background: "var(--surface-raised)",
        borderBottom: "1px solid var(--border-subtle)",
      }}
    >
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#FF5F57", display: "block" }} />
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#FEBC2E", display: "block" }} />
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#28C840", display: "block" }} />
      <span style={{ marginLeft: 12, fontSize: 12, color: "var(--fg-2)", fontFamily: "var(--font-sans)" }}>
        Steno
      </span>
    </div>
  );
}

// ─── Notes pane ───────────────────────────────────────────────
const NOTES_TEXT =
  "Marketing pilot running 3% over budget but signups ahead of plan. Decision: reallocate $40k from Q2 ops. Priya to update forecast before board review.";

function NotesPane() {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let timer = null;

    function start() {
      let idx = 0;
      setTyped("");
      timer = setInterval(() => {
        idx++;
        setTyped(NOTES_TEXT.slice(0, idx));
        if (idx >= NOTES_TEXT.length) {
          clearInterval(timer);
          timer = setTimeout(start, 2800);
        }
      }, 28);
    }

    const delay = setTimeout(start, 500);
    return () => { clearTimeout(delay); clearInterval(timer); };
  }, []);

  return (
    <div className="flex-1 min-w-0 overflow-hidden" style={{ background: "var(--page)" }}>
      <div style={{ padding: "28px 40px" }}>
        <div className="flex items-center gap-1 mb-5" style={{ fontSize: 13, color: "var(--fg-2)" }}>
          <ChevronLeft size={14} />
          Home
        </div>
        <div className="flex items-center gap-2 mb-4">
          <span className="rec-dot" />
          <span style={{ fontSize: 13, color: "var(--fg-2)", fontFamily: "var(--font-mono)" }}>
            Recording · 00:14:22
          </span>
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)", fontWeight: 400, fontSize: 34,
            lineHeight: 1.15, letterSpacing: "-0.02em", color: "var(--fg-1)", marginBottom: 10,
          }}
        >
          Q1 Budget Planning
        </div>
        <div className="flex flex-wrap items-center gap-1.5 mb-6">
          {[
            { icon: <CalendarIcon size={11} />, label: "Jun 29, 2026" },
            { icon: <Clock size={11} />, label: "Started 2:14 PM" },
          ].map((c) => (
            <span
              key={c.label}
              className="inline-flex items-center gap-1.5 rounded-full"
              style={{ padding: "3px 10px", background: "var(--surface-hover)", color: "var(--fg-2)", fontSize: 12 }}
            >
              {c.icon}
              {c.label}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1.5 mb-2" style={{ fontSize: 13, color: "var(--fg-2)" }}>
          <PencilLine size={13} />
          Notes
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.6, color: "var(--fg-1)", minHeight: 96, whiteSpace: "pre-line" }}>
          {typed}
          {typed.length < NOTES_TEXT.length && (
            <span
              className="animate-pulse"
              style={{ display: "inline-block", width: 2, height: 15, background: "var(--fg-1)", verticalAlign: "middle", marginLeft: 1 }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Card: Chat with your notes ───────────────────────────────
const CARD_CHAT_Q = "What were the key budget decisions?";
const CARD_CHAT_A =
  "Engineering headcount will increase by 20% and $40k has been reallocated from Q2 ops to the marketing pilot. Priya is actioned to update the Q1 forecast ahead of the board review.";

function FeatureThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 0.2, 0.4].map((delay, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: 5, height: 5,
            borderRadius: "50%",
            background: "var(--fg-2)",
            animation: `thinkingBounce 1.2s ease-in-out ${delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function ChatWithNotesImage() {
  const [inputText, setInputText] = useState("");
  const [phase, setPhase] = useState(0); // 0=typing, 1=thinking, 2=streaming
  const [typedA, setTypedA] = useState("");

  useEffect(() => {
    let qTimer, pauseHandle, thinkHandle, aTimer, restartHandle;

    function clear() {
      clearInterval(qTimer);
      clearTimeout(pauseHandle);
      clearTimeout(thinkHandle);
      clearInterval(aTimer);
      clearTimeout(restartHandle);
    }

    function start() {
      clear();
      setInputText("");
      setPhase(0);
      setTypedA("");

      let qIdx = 0;
      qTimer = setInterval(() => {
        qIdx++;
        setInputText(CARD_CHAT_Q.slice(0, qIdx));
        if (qIdx >= CARD_CHAT_Q.length) {
          clearInterval(qTimer);
          pauseHandle = setTimeout(() => {
            setInputText("");
            setPhase(1);
            thinkHandle = setTimeout(() => {
              setPhase(2);
              let aIdx = 0;
              aTimer = setInterval(() => {
                aIdx++;
                setTypedA(CARD_CHAT_A.slice(0, aIdx));
                if (aIdx >= CARD_CHAT_A.length) {
                  clearInterval(aTimer);
                  restartHandle = setTimeout(start, 3000);
                }
              }, 30);
            }, 700);
          }, 400);
        }
      }, 38);
    }

    const initDelay = setTimeout(start, 300);
    return () => { clearTimeout(initDelay); clear(); };
  }, []);

  const showPanel = phase >= 1;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "var(--surface-raised)" }}>
      <div
        style={{
          position: "absolute",
          top: 52, left: 52, right: 52, bottom: 36,
          overflow: "hidden",
          borderRadius: 10,
          boxShadow: "0 4px 24px rgba(27,27,25,0.12), 0 1px 4px rgba(27,27,25,0.06)",
          display: "flex", flexDirection: "column",
          justifyContent: "flex-end",
          background: "var(--page)",
        }}
      >
      {/* Faded background — meeting content */}
      <div
        style={{
          position: "absolute", top: 0, left: 0, right: 0,
          opacity: 0.25, pointerEvents: "none",
          padding: "16px 20px",
        }}
      >
        <div style={{ fontSize: 10, color: "var(--fg-2)", marginBottom: 6, display: "flex", alignItems: "center", gap: 2 }}>
          <ChevronLeft size={9} /> Work
        </div>
        <div style={{ fontFamily: "var(--font-serif)", fontSize: 18, color: "var(--fg-1)", marginBottom: 8, letterSpacing: "-0.02em" }}>
          Q1 Budget Planning
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[
            { icon: <CalendarIcon size={9} />, label: "Jun 29, 2026" },
            { icon: <Clock size={9} />, label: "28 min" },
          ].map((c) => (
            <span key={c.label} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", background: "var(--surface-hover)", borderRadius: 20, fontSize: 10, color: "var(--fg-2)" }}>
              {c.icon} {c.label}
            </span>
          ))}
        </div>
      </div>

      {/* Gradient fade above dock */}
      <div
        style={{
          position: "absolute",
          bottom: showPanel ? 148 : 56,
          left: 0, right: 0, height: 64,
          background: "linear-gradient(transparent, var(--page))",
          pointerEvents: "none",
          transition: "bottom 0.25s ease",
          zIndex: 1,
        }}
      />

      {/* Dock */}
      <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 6, position: "relative", zIndex: 2 }}>
        {/* Chat panel — fixed height so it doesn't grow as text streams in */}
        <AnimatePresence>
        {showPanel && (
          <Motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.22, ease: [0.33, 1, 0.68, 1] }}
            style={{
              background: "color-mix(in srgb, var(--surface-raised) 92%, transparent)",
              backdropFilter: "saturate(160%) blur(10px)",
              WebkitBackdropFilter: "saturate(160%) blur(10px)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 12,
              boxShadow: "var(--shadow-md)",
              overflow: "hidden",
              height: 148,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)", flexShrink: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-1)", flex: 1 }}>
                Q1 Budget Planning
                <ChevronDown size={10} style={{ display: "inline", marginLeft: 2, color: "var(--fg-2)", verticalAlign: "middle" }} />
              </span>
              <button style={{ border: "1px solid var(--border-subtle)", borderRadius: 5, padding: "1px 7px", fontSize: 10, color: "var(--fg-2)", background: "transparent", cursor: "default" }}>
                New chat
              </button>
            </div>
            <div style={{ flex: 1, overflow: "hidden", padding: "8px 12px 10px" }}>
              <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                <div
                  style={{
                    background: "var(--surface-hover)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "14px 14px 3px 14px",
                    padding: "5px 10px",
                    fontSize: 12, color: "var(--fg-1)",
                    maxWidth: "80%", lineHeight: 1.4,
                  }}
                >
                  {CARD_CHAT_Q}
                </div>
              </div>
              {phase === 1 && <FeatureThinkingDots />}
              {phase >= 2 && (
                <div style={{ fontSize: 12, lineHeight: 1.65, color: "var(--fg-1)" }}>
                  {typedA}
                </div>
              )}
            </div>
          </Motion.div>
        )}
        </AnimatePresence>

        {/* Input bar */}
        <div
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "6px 6px 6px 10px",
            background: "var(--surface-raised)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 12,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div
            style={{
              flex: 1, fontSize: 12, height: 26,
              display: "flex", alignItems: "center",
              color: inputText ? "var(--fg-1)" : "var(--fg-2)",
              overflow: "hidden", whiteSpace: "nowrap",
            }}
          >
            {inputText || (showPanel ? "Continue chat…" : "Ask anything about your notes…")}
            {phase === 0 && inputText.length > 0 && inputText.length < CARD_CHAT_Q.length && (
              <span style={{ display: "inline-block", width: 2, height: 12, background: "var(--fg-1)", marginLeft: 1, verticalAlign: "middle" }} />
            )}
          </div>
          <button
            style={{
              width: 26, height: 26, borderRadius: 999, border: 0,
              background: inputText ? "var(--fg-1)" : "var(--surface-active)",
              color: inputText ? "var(--fg-inverse)" : "var(--fg-2)",
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, cursor: "default",
            }}
          >
            <ArrowUp size={12} />
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

// ─── Card: AI notepad ─────────────────────────────────────────
function AiNotepadImage() {
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", background: "var(--surface-raised)" }}>
      <div
        style={{
          position: "absolute",
          top: 52, left: 52, right: 52, bottom: 36,
          overflow: "hidden",
          borderRadius: 10,
          boxShadow: "0 4px 24px rgba(27,27,25,0.12), 0 1px 4px rgba(27,27,25,0.06)",
        }}
      >
        <ScaledApp>
          <AppTitlebar />
          <div className="flex flex-1 overflow-hidden" style={{ height: 420 }}>
            <NotesPane />
          </div>
        </ScaledApp>
      </div>
    </div>
  );
}

// ─── Card: Sovereign AI ───────────────────────────────────────
// Literal "stack" cross-section — Audio → Transcript → Local model → Summary,
// all sealed inside one bordered box with a lock badge. A soft highlight
// sweeps top-to-bottom on loop, implying local processing that never leaves.
const STACK_LAYERS = [
  { label: "Audio", type: "audio", y: 50 },
  { label: "Transcript", type: "transcript", y: 100 },
  { label: "Local model", type: "model", y: 150 },
  { label: "Summary", type: "summary", y: 200 },
];

function StackIcon({ type }) {
  switch (type) {
    case "audio":
      return (
        <>
          <line x1="2" y1="6" x2="2" y2="12" />
          <line x1="6" y1="2" x2="6" y2="16" />
          <line x1="10" y1="4" x2="10" y2="14" />
          <line x1="14" y1="6" x2="14" y2="12" />
        </>
      );
    case "transcript":
      return (
        <>
          <line x1="1" y1="4" x2="17" y2="4" />
          <line x1="1" y1="9" x2="17" y2="9" />
          <line x1="1" y1="14" x2="11" y2="14" />
        </>
      );
    case "model":
      return (
        <>
          <rect x="4" y="4" width="10" height="10" rx="2" />
          <line x1="9" y1="0" x2="9" y2="4" />
          <line x1="9" y1="14" x2="9" y2="18" />
          <line x1="0" y1="9" x2="4" y2="9" />
          <line x1="14" y1="9" x2="18" y2="9" />
        </>
      );
    case "summary":
      return (
        <>
          <rect x="3" y="1" width="12" height="16" rx="2" />
          <line x1="6" y1="6" x2="12" y2="6" />
          <line x1="6" y1="9" x2="12" y2="9" />
          <line x1="6" y1="12" x2="10" y2="12" />
        </>
      );
    default:
      return null;
  }
}

function SovereignAiImage() {
  return (
    <svg
      viewBox="0 0 300 285"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id="stack-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--fg-1)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--fg-1)" stopOpacity="0.07" />
          <stop offset="100%" stopColor="var(--fg-1)" stopOpacity="0" />
        </linearGradient>
        <clipPath id="stack-clip">
          <rect x="48" y="34" width="204" height="218" rx="16" />
        </clipPath>
      </defs>

      {/* Stack container */}
      <rect x="48" y="34" width="204" height="218" rx="16" fill="var(--surface-raised)" stroke="var(--border)" strokeWidth="1.5" />

      {/* Layer bars */}
      {STACK_LAYERS.map(({ label, type, y }) => (
        <g key={label}>
          <rect x="64" y={y} width="172" height="36" rx="10" fill="var(--surface-hover)" stroke="var(--border-subtle)" strokeWidth="1" />
          <g transform={`translate(76,${y + 9})`} stroke="var(--fg-2)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none">
            <StackIcon type={type} />
          </g>
          <text x="104" y={y + 18} dominantBaseline="central" fontSize="13" fontWeight="500" fill="var(--fg-1)" fontFamily="var(--font-sans)">
            {label}
          </text>
        </g>
      ))}

      {/* Sweeping highlight — signals local processing without ever leaving the box */}
      <g clipPath="url(#stack-clip)">
        <rect x="48" y="-70" width="204" height="70" fill="url(#stack-glow)">
          <animate
            attributeName="y"
            values="-70;-70;252;252;-70"
            keyTimes="0;0.05;0.65;0.75;1"
            dur="4.5s"
            repeatCount="indefinite"
          />
        </rect>
      </g>

      {/* Re-stroke the border so it stays crisp above the sweep */}
      <rect x="48" y="34" width="204" height="218" rx="16" fill="none" stroke="var(--border)" strokeWidth="1.5" />

      {/* Lock badge — "you own the entire stack" */}
      <circle cx="252" cy="34" r="18" fill="var(--surface-raised)" />
      <circle cx="252" cy="34" r="15" fill="#1B1B19" />
      <g transform="translate(252,34)">
        <path d="M-4,-1 v-3 a4,4 0 0 1 8,0 v3" stroke="#EDEAE0" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <rect x="-6" y="-1" width="12" height="10" rx="2" fill="#EDEAE0" />
        <circle cx="0" cy="3.2" r="1.1" fill="#1B1B19" />
      </g>
    </svg>
  );
}

// ─── Card: No data leaves ─────────────────────────────────────
// Your device, centered, sealed inside a bubble that breathes with a slow
// glow — nothing crosses the boundary in either direction.
function NoDataLeavesImage() {
  return (
    <svg
      viewBox="0 0 300 285"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <defs>
        <radialGradient id="nodata-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--fg-1)" stopOpacity="0.1" />
          <stop offset="65%" stopColor="var(--fg-1)" stopOpacity="0.04" />
          <stop offset="100%" stopColor="var(--fg-1)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Slow breathing glow, sized to track the ring */}
      <circle cx="150" cy="140" r="88" fill="url(#nodata-glow)">
        <animate
          attributeName="r"
          values="60;92;60"
          dur="5s"
          calcMode="spline"
          keySplines="0.42 0 0.58 1;0.42 0 0.58 1"
          repeatCount="indefinite"
        />
      </circle>

      {/* Ring — slowly grows and shrinks around the icon */}
      <circle cx="150" cy="140" r="72" fill="none" stroke="var(--border-strong)" strokeWidth="1.2">
        <animate
          attributeName="r"
          values="56;80;56"
          dur="5s"
          calcMode="spline"
          keySplines="0.42 0 0.58 1;0.42 0 0.58 1"
          repeatCount="indefinite"
        />
        <animate
          attributeName="stroke-opacity"
          values="0.35;0.8;0.35"
          dur="5s"
          calcMode="spline"
          keySplines="0.42 0 0.58 1;0.42 0 0.58 1"
          repeatCount="indefinite"
        />
      </circle>

      {/* Steno icon, centered inside the ring */}
      <g transform="translate(150,140) scale(0.75)" stroke="var(--fg-1)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <g transform="translate(-32,-32)">
          <path d="M28 7 Q29 9.5 30 12.5" />
          <path d="M36 7 Q35 9.5 34 12.5" />
          <circle cx="32" cy="15" r="3.8" />
          <circle cx="30.5" cy="15" r="0.7" fill="var(--fg-1)" stroke="none" />
          <circle cx="33.5" cy="15" r="0.7" fill="var(--fg-1)" stroke="none" />
          <path d="M30 19 Q28 19 28 21 L28 50 L32 60 L36 50 L36 21 Q36 19 34 19 Z" />
          <line x1="28" y1="32" x2="36" y2="32" />
          <line x1="28" y1="38" x2="36" y2="38" />
          <line x1="28" y1="44" x2="36" y2="44" />
          <line x1="28" y1="50" x2="36" y2="50" />
          <path d="M28 22 C18 15 8 17 4 22 C10 28 20 28 28 27 Z" />
          <path d="M36 22 C46 15 56 17 60 22 C50 28 44 28 36 27 Z" />
          <path d="M28 28 C18 30 10 35 6 40 C14 39 22 36 28 33 Z" />
          <path d="M36 28 C46 30 54 35 58 40 C50 39 42 36 36 33 Z" />
        </g>
      </g>
    </svg>
  );
}

// ─── Card: 99 languages ───────────────────────────────────────
const LANG_ROWS = [
  ["English", "Español", "中文", "Français", "Deutsch", "Português", "日本語", "한국어", "Italiano", "Русский"],
  ["العربية", "Nederlands", "Polski", "Türkçe", "Українська", "Ελληνικά", "हिंदी", "Tiếng Việt", "Čeština", "Svenska"],
  ["Română", "Norsk", "Dansk", "Suomi", "Magyar", "Català", "Bahasa", "தமிழ்", "বাংলা", "Afrikaans"],
];
const ROW_SPEEDS = [45, 38, 52]; // seconds per full cycle

function NinetyNineLanguagesImage() {
  return (
    <div
      style={{
        width: "100%", height: "100%",
        display: "flex", flexDirection: "column",
        justifyContent: "center", gap: 10,
        overflow: "hidden",
      }}
    >
      {LANG_ROWS.map((langs, i) => {
        const rtl = i % 2 === 1;
        const doubled = [...langs, ...langs];
        return (
          <div
            key={i}
            style={{
              overflow: "hidden",
              maskImage: "linear-gradient(to right, transparent, black 16%, black 84%, transparent)",
              WebkitMaskImage: "linear-gradient(to right, transparent, black 16%, black 84%, transparent)",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
                width: "max-content",
                animation: `${rtl ? "marqueeRTL" : "marqueeLTR"} ${ROW_SPEEDS[i]}s linear infinite`,
              }}
            >
              {doubled.map((lang, j) => (
                <span
                  key={j}
                  style={{
                    display: "inline-block",
                    padding: "5px 14px",
                    borderRadius: 20,
                    background: "var(--surface-hover)",
                    border: "1px solid var(--border-subtle)",
                    fontSize: 12, fontWeight: 500,
                    color: "var(--fg-2)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {lang}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Card: AI agent ready ─────────────────────────────────────
// ─── Card: AI agent ready ─────────────────────────────────────
// Hub-and-spoke: Steno → Claude, ChatGPT, Gemini with a single flowing dot per line
// S-curve paths: cubic bezier with equal vertical tangents at both ends
// midY = (102 + 170) / 2 = 136
const AI_SPOKES = [
  { id: "spoke-claude",  d: "M150 102 C150 136, 65 136, 65 170",  delay: 0 },
  { id: "spoke-chatgpt", d: "M150 102 L150 170",                   delay: 0.8 },
  { id: "spoke-gemini",  d: "M150 102 C150 136, 235 136, 235 170", delay: 1.6 },
];
const AI_DOT_COLOR = "#8A8A83";

function AiAgentReadyImage() {
  return (
    <svg
      viewBox="0 0 300 285"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <defs>
        {AI_SPOKES.map(({ id, d }) => (
          <path key={id} id={id} d={d} fill="none" />
        ))}
        {/* Gemini gradient: blue → purple, objectBoundingBox so transform-safe */}
        <linearGradient id="gem-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4285F4" />
          <stop offset="100%" stopColor="#9B5CF6" />
        </linearGradient>
      </defs>

      {/* S-curve connection lines */}
      {AI_SPOKES.map(({ id, d }) => (
        <path key={id} d={d} stroke="var(--border)" strokeWidth="1.5" fill="none" />
      ))}

      {/* Flowing dots — one at a time per spoke, each line starts at a different offset */}
      {AI_SPOKES.map(({ id, delay }) => (
        <circle key={id} r="3" fill={AI_DOT_COLOR}>
          <animate
            attributeName="opacity"
            values="0;1;1;0"
            keyTimes="0;0.12;0.88;1"
            dur="2.4s"
            begin={`${delay}s`}
            repeatCount="indefinite"
          />
          <animateMotion dur="2.4s" begin={`${delay}s`} repeatCount="indefinite" calcMode="linear">
            <mpath href={`#${id}`} />
          </animateMotion>
        </circle>
      ))}

      {/* ── Steno icon — light rounded square, dark ink mic ── */}
      <rect x="120" y="40" width="60" height="60" rx="13" fill="var(--surface-raised)" stroke="var(--border)" strokeWidth="1" />
      <g
        transform="translate(150,70) scale(0.47)"
        stroke="var(--fg-1)"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <g transform="translate(-32,-32)">
          <path d="M28 7 Q29 9.5 30 12.5" />
          <path d="M36 7 Q35 9.5 34 12.5" />
          <circle cx="32" cy="15" r="3.8" />
          <circle cx="30.5" cy="15" r="0.7" fill="var(--fg-1)" stroke="none" />
          <circle cx="33.5" cy="15" r="0.7" fill="var(--fg-1)" stroke="none" />
          <path d="M30 19 Q28 19 28 21 L28 50 L32 60 L36 50 L36 21 Q36 19 34 19 Z" />
          <line x1="28" y1="32" x2="36" y2="32" />
          <line x1="28" y1="38" x2="36" y2="38" />
          <line x1="28" y1="44" x2="36" y2="44" />
          <line x1="28" y1="50" x2="36" y2="50" />
          <path d="M28 22 C18 15 8 17 4 22 C10 28 20 28 28 27 Z" />
          <path d="M36 22 C46 15 56 17 60 22 C50 28 44 28 36 27 Z" />
          <path d="M28 28 C18 30 10 35 6 40 C14 39 22 36 28 33 Z" />
          <path d="M36 28 C46 30 54 35 58 40 C50 39 42 36 36 33 Z" />
        </g>
      </g>

      {/* ── Claude — cream bg, official Claude sunburst mark ── */}
      {/* path from simpleicons.org/claude, viewBox 0 0 24 24, centered at (65,193) */}
      <rect x="42" y="170" width="46" height="46" rx="11" fill="#F0EEE6" />
      <g transform="translate(53,181)" fill="#D97757">
        <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
      </g>

      {/* ── ChatGPT / OpenAI — black bg, official OpenAI swirl ── */}
      {/* path from svgrepo.com openai icon, viewBox 0 0 24 24, centered at (150,193) */}
      <rect x="127" y="170" width="46" height="46" rx="11" fill="#111111" />
      <g transform="translate(138,181)" fill="white">
        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
      </g>

      {/* ── Google Gemini — white bg, official Gemini sparkle ── */}
      {/* path from simpleicons.org/googlegemini, viewBox 0 0 24 24, centered at (235,193) */}
      <rect x="212" y="170" width="46" height="46" rx="11" fill="var(--surface-raised)" stroke="var(--border)" strokeWidth="1" />
      <g transform="translate(223,181)">
        <path
          d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"
          fill="url(#gem-grad)"
        />
      </g>
    </svg>
  );
}

// ─── Card: Open source ────────────────────────────────────────
// A dark code panel with a real-looking snippet, scanned top-to-bottom by a
// magnifying glass on loop — "you can read exactly what this does."
const CODE_LINES = [
  { text: "def summarize(text):", y: 64, opacity: 0.92 },
  { text: "    # on-device only", y: 94, opacity: 0.4 },
  { text: "    model = load()", y: 124, opacity: 0.72 },
  { text: "    return model(text)", y: 154, opacity: 0.72 },
  { text: "# MIT licensed", y: 214, opacity: 0.4 },
];

function OpenSourceImage() {
  return (
    <svg
      viewBox="0 0 300 285"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}
    >
      <defs>
        <clipPath id="code-clip">
          <rect x="48" y="34" width="204" height="218" rx="16" />
        </clipPath>
      </defs>

      {/* Code panel — light terminal */}
      <rect x="48" y="34" width="204" height="218" rx="16" fill="var(--surface-hover)" stroke="var(--border)" strokeWidth="1.5" />

      {/* Snippet */}
      {CODE_LINES.map(({ text, y, opacity }) => (
        <text
          key={y}
          x="64" y={y}
          fontFamily="var(--font-mono)" fontSize="11.5"
          fill="var(--fg-1)" opacity={opacity}
        >
          {text}
        </text>
      ))}

      {/* Magnifying glass, scanning down the file on loop */}
      <g clipPath="url(#code-clip)">
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="150,55; 150,225; 150,55"
            keyTimes="0;0.5;1"
            dur="4.5s"
            repeatCount="indefinite"
          />
          <circle r="13" fill="rgba(27,27,25,0.05)" stroke="var(--fg-2)" strokeWidth="1.8" />
          <line x1="9.2" y1="9.2" x2="17" y2="17" stroke="var(--fg-2)" strokeWidth="1.8" strokeLinecap="round" />
        </g>
      </g>

      {/* Verified badge — dark on light, matching the lock/perimeter badges elsewhere in the grid */}
      <circle cx="252" cy="34" r="18" fill="var(--surface-raised)" />
      <circle cx="252" cy="34" r="15" fill="#1B1B19" />
      <path
        d="M247,34 L250.5,38 L257,30.5"
        stroke="#EDEAE0" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
    </svg>
  );
}

// ─── Feature data ─────────────────────────────────────────────
const FEATURES = [
  {
    Image: ChatWithNotesImage,
    title: "Chat with your notes",
    body: "Ask questions across any note or recording. Surface decisions, action items, and key themes instantly.",
    wide: true,
  },
  {
    Image: AiNotepadImage,
    title: "AI notepad",
    body: "Jot notes during a recording. They're merged with the transcript to shape the AI summary.",
  },
  {
    Image: SovereignAiImage,
    title: "Sovereign AI",
    body: "You own the entire stack — models and data stay on your device or network, under your control. Works offline on planes, in hospitals, in restricted areas.",
  },
  {
    Image: NoDataLeavesImage,
    title: "No data leaves",
    body: "Zero network requests after install. Your device is functionally air-gapped from the moment you launch it.",
  },
  {
    Image: NinetyNineLanguagesImage,
    title: "99 languages",
    body: "Whisper auto-detects the language spoken. Works equally well across multilingual meetings.",
  },
  {
    Image: AiAgentReadyImage,
    title: "AI agent ready",
    body: "Summaries and notes save as plain Markdown. Pipe into any AI agent, vault, or workflow your team already runs.",
    wide: true,
  },
  {
    Image: OpenSourceImage,
    title: "Open source",
    body: "Every line of code is public. Audit it yourself, fork it, or verify our privacy claims — nothing is hidden behind a black box.",
  },
];

// ─── Section ──────────────────────────────────────────────────
export function Features() {
  return (
    <section id="features" className="sect" style={{ background: "var(--surface-sunken)" }}>
      <div className="container-site">
        {/* Header */}
        <div className="mb-[48px] md:mb-[72px]" style={{ maxWidth: 640 }}>
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 400,
              fontSize: "clamp(34px, 4.6vw, 52px)",
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              color: "var(--fg-1)",
              margin: "0 0 18px",
            }}
          >
            Built for focus. Engineered for privacy.
          </h2>
          <p className="text-fg-2 text-lg leading-[1.55]" style={{ maxWidth: "56ch" }}>
            Every capability is designed around one principle: your audio never leaves your device.
          </p>
        </div>

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map(({ Image, title, body, wide }, i) => {
            const isWide = Boolean(wide);
            return (
              <Motion.div
                key={title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.06 }}
                className={`flex flex-col overflow-hidden${isWide ? " sm:col-span-2 lg:col-span-2" : ""}`}
                style={{
                  borderRadius: 14,
                  border: "1px solid var(--border)",
                  background: "var(--surface-raised)",
                }}
              >
                {/* Image zone — fixed height so title text aligns across all cards.
                    Fluid below the desktop size so a single mobile column doesn't
                    turn into a wall of oversized previews. */}
                <div
                  style={{
                    height: "clamp(180px, 45vw, 320px)",
                    position: "relative",
                    overflow: "hidden",
                    background: "var(--surface-raised)",
                  }}
                >
                  {createElement(Image)}
                </div>

                {/* Text */}
                <div style={{ padding: "24px 28px 28px" }}>
                  <h3
                    style={{ fontSize: 16, fontWeight: 600, color: "var(--fg-1)", margin: "0 0 8px" }}
                  >
                    {title}
                  </h3>
                  <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--fg-2)", margin: 0 }}>
                    {body}
                  </p>
                </div>
              </Motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
