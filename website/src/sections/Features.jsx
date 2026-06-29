import { useEffect, useRef, useState } from "react";
import { motion as Motion } from "framer-motion";
import {
  Search, Settings, Home, ChevronDown, ChevronLeft,
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
        background: "var(--surface-sunken)",
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

// ─── Sidebar ──────────────────────────────────────────────────
const MEETINGS = [
  { id: 1, title: "Q1 Budget Planning",      date: "Jun 29, 2026" },
  { id: 2, title: "Product Roadmap Review",  date: "Jun 26, 2026" },
  { id: 3, title: "Investor Update Prep",    date: "Jun 24, 2026" },
  { id: 4, title: "Legal Review — Series B", date: "Jun 20, 2026" },
];

function AppSidebar({ recording = false }) {
  return (
    <div
      className="flex flex-col flex-shrink-0"
      style={{
        width: 210,
        background: "var(--surface-sunken)",
        borderRight: "1px solid var(--border-subtle)",
        overflow: "hidden",
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span style={{ fontFamily: "var(--font-serif)", fontSize: 17, letterSpacing: "-0.02em", color: "var(--fg-1)", lineHeight: 1 }}>
          Steno
        </span>
        <span style={{ width: 4, height: 4, borderRadius: "50%", background: "var(--fg-muted)", flexShrink: 0 }} />
      </div>

      {/* Search */}
      <div style={{ padding: "0 10px 8px" }}>
        <div
          className="flex items-center gap-1.5 px-2"
          style={{ height: 28, borderRadius: 6, fontSize: 12, background: "rgba(27,27,25,0.04)", color: "var(--fg-muted)" }}
        >
          <Search size={11} />
          Search
        </div>
      </div>

      {/* All meetings */}
      <div style={{ margin: "0 8px 4px" }}>
        <div
          className="flex items-center gap-2"
          style={{ padding: "5px 8px", borderRadius: 6, fontSize: 13, color: "var(--fg-1)" }}
        >
          <Home size={13} style={{ color: "var(--fg-2)", flexShrink: 0 }} />
          All meetings
        </div>
      </div>

      {/* Meetings list */}
      <div className="flex-1 overflow-hidden" style={{ padding: "4px 8px 0" }}>
        {recording && (
          <div
            className="flex items-center gap-2"
            style={{
              padding: "5px 8px", borderRadius: 6, marginBottom: 2,
              background: "var(--surface-raised)",
              boxShadow: "0 1px 2px rgba(27,27,25,0.04), 0 0 0 1px var(--border-subtle)",
              fontWeight: 500, fontSize: 12.5, color: "var(--fg-1)",
            }}
          >
            <span className="rec-dot flex-shrink-0" style={{ width: 6, height: 6 }} />
            Q1 Budget Planning
          </div>
        )}
        {MEETINGS.map((m) => {
          const active = !recording && m.id === 1;
          return (
            <div
              key={m.id}
              className="flex flex-col"
              style={{
                padding: "5px 8px", borderRadius: 6, marginBottom: 2,
                background: active ? "var(--surface-raised)" : "transparent",
                boxShadow: active ? "0 1px 2px rgba(27,27,25,0.04), 0 0 0 1px var(--border-subtle)" : "none",
              }}
            >
              <span style={{ fontSize: 12.5, color: "var(--fg-1)", fontWeight: active ? 500 : 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {m.title}
              </span>
              {!recording && (
                <span style={{ fontSize: 11, color: "var(--fg-2)" }}>{m.date}</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom */}
      <div
        className="flex items-center justify-between"
        style={{ padding: "8px 12px", borderTop: "1px solid var(--border-subtle)" }}
      >
        <Settings size={13} style={{ color: "var(--fg-2)" }} />
        <div
          className="flex items-center gap-1.5"
          style={{ padding: "4px 8px", borderRadius: 6, fontSize: 11.5, color: "var(--fg-2)", background: "var(--surface-hover)" }}
        >
          <span
            style={{ width: 16, height: 16, borderRadius: "50%", background: "var(--surface-active)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 600, color: "var(--fg-2)" }}
          >
            W
          </span>
          Will
        </div>
      </div>
    </div>
  );
}

// ─── Chat pane ────────────────────────────────────────────────
const CHAT_A =
  "Engineering headcount will increase by 20% and $40k has been reallocated from Q2 ops to the marketing pilot. Priya is actioned to update the Q1 forecast.";

function ChatPane() {
  return (
    <div className="flex flex-col flex-1 min-w-0 overflow-hidden" style={{ background: "var(--paper-0)" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between flex-shrink-0"
        style={{ padding: "8px 16px", borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-1.5" style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-1)" }}>
          Q1 Budget Planning
          <ChevronDown size={14} style={{ color: "var(--fg-2)" }} />
        </div>
        <button
          style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid var(--border-subtle)", background: "transparent", color: "var(--fg-2)", fontSize: 12, cursor: "default" }}
        >
          New chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden flex flex-col gap-3" style={{ padding: "12px 16px" }}>
        <div className="flex justify-end">
          <div
            style={{
              padding: "8px 14px",
              background: "var(--surface-hover)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "18px 18px 4px 18px",
              fontSize: 14, color: "var(--fg-1)", lineHeight: 1.5, maxWidth: "75%",
            }}
          >
            Key budget decisions?
          </div>
        </div>
        <div style={{ fontSize: 14, lineHeight: 1.7, color: "var(--fg-1)", maxWidth: "90%" }}>
          {CHAT_A}
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0" style={{ padding: "0 12px 12px" }}>
        <div
          className="flex items-center gap-2"
          style={{
            padding: "8px 8px 8px 12px",
            background: "var(--surface-raised)",
            border: "1px solid var(--border-subtle)",
            borderRadius: 14,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div
            style={{ flex: 1, fontSize: 14, fontWeight: 500, height: 32, display: "flex", alignItems: "center", color: "var(--fg-muted)", overflow: "hidden", whiteSpace: "nowrap" }}
          >
            Ask about your meetings…
          </div>
          <button
            style={{ width: 30, height: 30, borderRadius: "50%", background: "var(--surface-active)", border: "none", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, cursor: "default" }}
          >
            <ArrowUp size={14} style={{ color: "var(--fg-2)" }} />
          </button>
        </div>
      </div>
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
    <div className="flex-1 min-w-0 overflow-hidden" style={{ background: "var(--paper-0)" }}>
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
              }, 15);
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
    <div style={{ position: "relative", width: "100%", height: "100%", background: "var(--paper-3)" }}>
      <div
        style={{
          position: "absolute",
          top: 52, left: 52, right: 52, bottom: 36,
          overflow: "hidden",
          borderRadius: "8px 8px 0 0",
          display: "flex", flexDirection: "column",
          justifyContent: "flex-end",
          background: "var(--paper-0)",
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
          background: "linear-gradient(transparent, var(--paper-0))",
          pointerEvents: "none",
          transition: "bottom 0.25s ease",
          zIndex: 1,
        }}
      />

      {/* Dock */}
      <div style={{ padding: "0 14px 14px", display: "flex", flexDirection: "column", gap: 6, position: "relative", zIndex: 2 }}>
        {/* Chat panel */}
        {showPanel && (
          <div
            style={{
              background: "color-mix(in srgb, var(--surface-raised) 92%, transparent)",
              backdropFilter: "saturate(160%) blur(10px)",
              WebkitBackdropFilter: "saturate(160%) blur(10px)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 12,
              boxShadow: "var(--shadow-md)",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", borderBottom: "1px solid var(--border-subtle)" }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-1)", flex: 1 }}>
                Q1 Budget Planning
                <ChevronDown size={10} style={{ display: "inline", marginLeft: 2, color: "var(--fg-2)", verticalAlign: "middle" }} />
              </span>
              <button style={{ border: "1px solid var(--border-subtle)", borderRadius: 5, padding: "1px 7px", fontSize: 10, color: "var(--fg-2)", background: "transparent", cursor: "default" }}>
                New chat
              </button>
            </div>
            <div style={{ padding: "8px 12px 10px" }}>
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
                  {typedA.length < CARD_CHAT_A.length && (
                    <span style={{ display: "inline-block", width: 2, height: 12, background: "var(--fg-1)", verticalAlign: "middle", marginLeft: 1 }} />
                  )}
                </div>
              )}
            </div>
          </div>
        )}

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
    <ScaledApp>
      <AppTitlebar />
      <div className="flex flex-1 overflow-hidden" style={{ height: 420 }}>
        <AppSidebar recording />
        <NotesPane />
      </div>
    </ScaledApp>
  );
}

// ─── Card: Sovereign AI ───────────────────────────────────────
function SovereignAiImage() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 h-full" style={{ padding: 24 }}>
      <span style={{ fontSize: 44, lineHeight: 1 }}>🔒</span>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--fg-1)", marginBottom: 6 }}>
          Your stack. Your models.
        </div>
        <div style={{ fontSize: 13, color: "var(--fg-2)", lineHeight: 1.55, maxWidth: 180 }}>
          Models and data stay on your device or network. Works offline anywhere.
        </div>
      </div>
    </div>
  );
}

// ─── Card: No data leaves ─────────────────────────────────────
function NoDataLeavesImage() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 h-full" style={{ padding: 24 }}>
      <span style={{ fontSize: 72, fontWeight: 800, color: "var(--fg-1)", lineHeight: 1, letterSpacing: "-0.05em", fontVariantNumeric: "tabular-nums" }}>
        0
      </span>
      <div style={{ fontSize: 13, color: "var(--fg-2)", textAlign: "center", lineHeight: 1.5 }}>
        network requests ever leave your device
      </div>
      <div className="flex gap-1.5 flex-wrap justify-center" style={{ marginTop: 4 }}>
        {["verified open-source", "auditable"].map((t) => (
          <span key={t} style={{ fontSize: 10, padding: "2px 9px", borderRadius: 20, background: "rgba(27,27,25,0.06)", color: "var(--fg-2)" }}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Card: 99 languages ───────────────────────────────────────
const LANGS = [
  { text: "English",   pos: { top: "10%",    left: "3%"   }, delay: 0,   dur: 5.0 },
  { text: "Español",   pos: { top: "10%",    right: "3%"  }, delay: 1.3, dur: 5.4 },
  { text: "中文",      pos: { top: "38%",    left: "0"    }, delay: 0.7, dur: 4.9 },
  { text: "Français",  pos: { top: "38%",    right: "0"   }, delay: 2.0, dur: 5.6 },
  { text: "Deutsch",   pos: { bottom: "24%", left: "3%"   }, delay: 2.5, dur: 5.2 },
  { text: "日本語",    pos: { bottom: "24%", right: "3%"  }, delay: 1.0, dur: 5.0 },
  { text: "Português", pos: { bottom: "8%",  left: "15%"  }, delay: 1.8, dur: 5.3 },
  { text: "한국어",    pos: { bottom: "8%",  right: "15%" }, delay: 3.2, dur: 4.8 },
];

function NinetyNineLanguagesImage() {
  return (
    <div style={{ position: "relative", overflow: "hidden", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 72, fontWeight: 800, color: "var(--fg-1)", lineHeight: 1, letterSpacing: "-0.04em", position: "relative", zIndex: 2 }}>
        99
      </span>
      {LANGS.map(({ text, pos, delay, dur }) => (
        <Motion.span
          key={text}
          style={{
            position: "absolute",
            zIndex: 1,
            fontSize: 12, fontWeight: 500,
            color: "var(--fg-2)",
            background: "var(--surface-raised)",
            border: "1px solid var(--border-strong)",
            borderRadius: 20,
            padding: "5px 14px",
            whiteSpace: "nowrap",
            ...pos,
          }}
          animate={{ opacity: [0, 1, 1, 0], x: ["-20px", "0px", "0px", "20px"] }}
          transition={{ duration: dur, delay, repeat: Infinity, ease: "easeInOut" }}
        >
          {text}
        </Motion.span>
      ))}
    </div>
  );
}

// ─── Card: AI agent ready ─────────────────────────────────────
const MD_DOC = `# Q1 Budget Planning
Jun 29, 2026 · 28 min

## Summary
Engineering headcount will increase by 20% and $40k
has been reallocated from Q2 ops to the marketing pilot.

## Key Points
- Engineering underspend: two hires slipped to July
- Marketing pilot running 3% over, ahead on signups
- Reallocate $40k through end of Q2

## Action Items
- Priya: update Q1 forecast before board review
- Marcus: file reallocation request by Friday`;

function AiAgentReadyImage() {
  return (
    <div style={{ position: "relative", overflow: "hidden", width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <pre
        style={{
          position: "absolute", inset: 0,
          padding: "16px 20px",
          fontFamily: "var(--font-mono)", fontSize: 10, lineHeight: 1.8,
          color: "var(--fg-1)", opacity: 0.09,
          pointerEvents: "none", overflow: "hidden", zIndex: 1,
          margin: 0, whiteSpace: "pre",
        }}
      >
        {MD_DOC}
      </pre>
      <span
        style={{
          fontSize: 72, fontWeight: 800, color: "var(--fg-1)",
          letterSpacing: "-0.04em", fontFamily: "var(--font-mono)",
          lineHeight: 1, position: "relative", zIndex: 2,
        }}
      >
        .md
      </span>
    </div>
  );
}

// ─── Feature data ─────────────────────────────────────────────
const FEATURES = [
  {
    Image: ChatWithNotesImage,
    title: "Chat with your notes",
    body: "Ask questions across any note or recording. Surface decisions, action items, and key themes instantly.",
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
    body: "Zero network requests after install. Verified by inspectable, open-source code you can audit yourself.",
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
          {FEATURES.map(({ Image, title, body }, i) => {
            const isWide = i === 0;
            const growImage = i === 1; // matches row height of the wide card
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
                {/* Image zone */}
                <div
                  style={{
                    ...(growImage ? { flex: 1, minHeight: 0 } : { aspectRatio: isWide ? "16 / 9" : "4 / 3" }),
                    position: "relative",
                    overflow: "hidden",
                    background: "var(--paper-1)",
                  }}
                >
                  <Image />
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
