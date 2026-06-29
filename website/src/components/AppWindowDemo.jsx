import { useState, useEffect, useRef, useCallback } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import {
  Search, Settings, Home, ChevronDown, ChevronLeft,
  Calendar as CalendarIcon, Clock, PencilLine, ArrowUp, FolderPlus,
} from "lucide-react";

const SCREENS = ["notes", "summary", "chat"];
const ADVANCE_MS = 6000;

const MEETINGS = [
  { id: 1, title: "Q1 Budget Planning", date: "Today" },
  { id: 2, title: "Product Roadmap Review", date: "Jun 27" },
  { id: 3, title: "Investor Update Prep", date: "Jun 25" },
  { id: 4, title: "Series B Legal Review", date: "Jun 22" },
];

const NOTES_TEXT =
  "- Engineering headcount +20%\n- Marketing flat vs last year\n- Reallocate $40k from Q2 ops\n- Revisit at next quarterly sync";

const SUMMARY_INTRO =
  "The team aligned on Q1 budget priorities. Engineering headcount will grow by 20% with two new hires planned for March. Marketing spend stays flat, with $40k reallocated from Q2 ops to fund the paid pilot running ahead of targets.";

const KEY_POINTS = [
  "Engineering headcount up 20% — two hires planned for March.",
  "Marketing budget held flat; paid pilot running ahead of targets.",
  "$40k reallocation from Q2 ops approved through March 31.",
];

const ACTION_ITEMS = [
  "Marcus to file reallocation request by Friday.",
  "Priya to update Q1 forecast and share with board.",
];

const CHAT_Q = "What were the key budget decisions?";
const CHAT_A =
  "Engineering headcount will increase by 20% and $40k has been reallocated from Q2 ops to the marketing pilot. Priya is actioned to update the Q1 forecast ahead of the board review.";

const CHAT_SUGGESTIONS = ["Key budget decisions?", "Who needs to follow up?", "Action items"];

function fmt(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

// ─── Sidebar ──────────────────────────────────────────────────────

function AppSidebar({ activeScreen }) {
  const meetingActive = activeScreen === "summary" || activeScreen === "chat";

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
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 17,
            letterSpacing: "-0.02em",
            color: "var(--fg-1)",
            lineHeight: 1,
          }}
        >
          Steno
        </span>
        <span
          className="w-1 h-1 rounded-full flex-shrink-0"
          style={{ background: "var(--fg-muted)" }}
        />
      </div>

      {/* Search */}
      <div className="px-2.5 pb-2">
        <div
          className="flex items-center gap-1.5 px-2 rounded-[6px] text-[12px]"
          style={{
            height: 28,
            background: "rgba(27,27,25,0.04)",
            color: "var(--fg-muted)",
          }}
        >
          <Search size={11} />
          Search
        </div>
      </div>

      {/* All Meetings nav row */}
      <div className="px-2 pb-1">
        <div
          className="flex items-center gap-2 px-2 rounded-[6px] text-[13px]"
          style={{
            padding: "5px 8px",
            background: meetingActive ? "var(--surface-raised)" : "transparent",
            boxShadow: meetingActive
              ? "0 1px 2px rgba(27,27,25,0.04), 0 0 0 1px var(--border-subtle)"
              : "none",
            color: "var(--fg-1)",
            fontWeight: meetingActive ? 500 : 400,
          }}
        >
          <Home size={13} style={{ color: "var(--fg-2)", flexShrink: 0 }} />
          All meetings
        </div>
      </div>

      {/* Meeting list */}
      <div className="flex-1 overflow-hidden px-2 pt-1">
        {/* Recording new-note row */}
        {activeScreen === "notes" && (
          <div
            className="flex items-center gap-2 rounded-[6px] mb-0.5 text-[13px]"
            style={{
              padding: "5px 8px",
              background: "var(--surface-raised)",
              boxShadow: "0 1px 2px rgba(27,27,25,0.04), 0 0 0 1px var(--border-subtle)",
              fontWeight: 500,
              color: "var(--fg-1)",
            }}
          >
            <span className="rec-dot flex-shrink-0" style={{ width: 6, height: 6 }} />
            <span className="truncate flex-1">Q1 Budget Planning</span>
          </div>
        )}

        {MEETINGS.map((m) => {
          const active = meetingActive && m.id === 1;
          return (
            <div
              key={m.id}
              className="flex flex-col rounded-[6px] mb-0.5"
              style={{
                padding: "5px 8px",
                background: active ? "var(--surface-raised)" : "transparent",
                boxShadow: active
                  ? "0 1px 2px rgba(27,27,25,0.04), 0 0 0 1px var(--border-subtle)"
                  : "none",
              }}
            >
              <span
                className="truncate text-[12.5px]"
                style={{ color: "var(--fg-1)", fontWeight: active ? 500 : 400 }}
              >
                {m.title}
              </span>
              <span className="text-[11px]" style={{ color: "var(--fg-2)" }}>
                {m.date}
              </span>
            </div>
          );
        })}
      </div>

      {/* Bottom */}
      <div
        className="flex items-center justify-between px-3 py-2"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <Settings size={13} style={{ color: "var(--fg-2)" }} />
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] text-[11.5px]"
          style={{ background: "var(--surface-hover)", color: "var(--fg-2)" }}
        >
          <span
            className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-semibold"
            style={{ background: "var(--surface-active)", color: "var(--fg-2)" }}
          >
            W
          </span>
          Will
        </div>
      </div>
    </div>
  );
}

// ─── Screen: Notes (Recording view) ───────────────────────────────

function NotesScreen() {
  const [typedNotes, setTypedNotes] = useState("");
  const [seconds, setSeconds] = useState(862);

  useEffect(() => {
    setTypedNotes("");
    let innerTimer = null;

    const startDelay = setTimeout(() => {
      let idx = 0;
      innerTimer = setInterval(() => {
        idx++;
        setTypedNotes(NOTES_TEXT.slice(0, idx));
        if (idx >= NOTES_TEXT.length) clearInterval(innerTimer);
      }, 28);
    }, 500);

    const ticker = setInterval(() => setSeconds((s) => s + 1), 1000);

    return () => {
      clearTimeout(startDelay);
      clearInterval(innerTimer);
      clearInterval(ticker);
    };
  }, []);

  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto scrollbar-hide"
      style={{ background: "var(--page)" }}
    >
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 40px 40px" }}>
        <button
          className="mb-5 inline-flex items-center gap-1 border-0 bg-transparent cursor-default"
          style={{ fontSize: 13, color: "var(--fg-2)" }}
        >
          <ChevronLeft size={14} />
          Home
        </button>

        <div className="flex items-center gap-2 mb-4">
          <span className="rec-dot" />
          <span
            className="tabular-nums"
            style={{ fontSize: 13, color: "var(--fg-2)", fontFamily: "var(--font-mono)" }}
          >
            Recording · {fmt(seconds)}
          </span>
        </div>

        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 400,
            fontSize: 34,
            lineHeight: 1.15,
            letterSpacing: "-0.02em",
            color: "var(--fg-1)",
            marginBottom: 10,
          }}
        >
          Q1 Budget Planning
        </div>

        <div className="flex flex-wrap items-center gap-1.5 mb-6">
          {[
            { icon: <CalendarIcon size={11} />, label: "Jun 29, 2026" },
            { icon: <Clock size={11} />, label: "Started 2:14 PM" },
          ].map((chip) => (
            <span
              key={chip.label}
              className="inline-flex items-center gap-1.5 rounded-full text-[12px]"
              style={{ padding: "3px 10px", background: "var(--surface-hover)", color: "var(--fg-2)" }}
            >
              {chip.icon}
              {chip.label}
            </span>
          ))}
          <span
            className="inline-flex items-center gap-1.5 rounded-full text-[12px]"
            style={{ padding: "3px 10px", color: "var(--fg-2)", border: "1px dashed var(--border-subtle)" }}
          >
            <FolderPlus size={11} />
            Add to folder
          </span>
        </div>

        <div
          className="flex items-center gap-1.5 mb-2"
          style={{ fontSize: 13, color: "var(--fg-2)" }}
        >
          <PencilLine size={13} />
          Notes
        </div>

        <div
          style={{ fontSize: 15, lineHeight: 1.6, color: "var(--fg-1)", whiteSpace: "pre-line", minHeight: 96 }}
        >
          {typedNotes}
          {typedNotes.length < NOTES_TEXT.length && (
            <span
              className="inline-block align-middle animate-pulse ml-px"
              style={{ width: 2, height: 15, background: "var(--fg-1)", verticalAlign: "middle" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Screen: Summary (MeetingDetail view) ─────────────────────────

function SummaryScreen() {
  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto scrollbar-hide"
      style={{ background: "var(--page)" }}
    >
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "28px 40px 40px" }}>
        <button
          className="mb-4 inline-flex items-center gap-1 border-0 bg-transparent cursor-default"
          style={{ fontSize: 12.5, color: "var(--fg-2)" }}
        >
          <ChevronLeft size={14} />
          All meetings
        </button>

        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontWeight: 400,
            fontSize: 36,
            lineHeight: 1.1,
            letterSpacing: "-0.025em",
            color: "var(--fg-1)",
            margin: "0 0 10px",
          }}
        >
          Q1 Budget Planning
        </h1>

        <div
          className="flex flex-wrap items-center gap-1.5 pb-5 mb-5"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          {[
            { icon: <CalendarIcon size={11} />, label: "Jun 29, 2026" },
            { icon: <Clock size={11} />, label: "28 min" },
          ].map((chip) => (
            <span
              key={chip.label}
              className="inline-flex items-center gap-1.5 rounded-full text-[12px]"
              style={{ padding: "3px 10px", background: "var(--surface-hover)", color: "var(--fg-2)" }}
            >
              {chip.icon}
              {chip.label}
            </span>
          ))}
        </div>

        <p
          style={{ fontSize: 15.5, lineHeight: 1.65, color: "var(--fg-1)", margin: "0 0 20px", maxWidth: "64ch" }}
        >
          {SUMMARY_INTRO}
        </p>

        <div className="mb-5">
          <h3
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.01em",
              color: "var(--fg-2)",
              margin: "0 0 10px",
              fontFamily: "var(--font-sans)",
            }}
          >
            KEY POINTS
          </h3>
          <ul className="list-none p-0 m-0 space-y-2">
            {KEY_POINTS.map((pt) => (
              <li
                key={pt}
                className="relative pl-[18px]"
                style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--fg-1)" }}
              >
                <span
                  className="absolute rounded-full"
                  style={{ left: 4, top: 9, width: 4, height: 4, background: "var(--fg-2)" }}
                />
                {pt}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3
            style={{
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "0.01em",
              color: "var(--fg-2)",
              margin: "0 0 10px",
              fontFamily: "var(--font-sans)",
            }}
          >
            ACTION ITEMS
          </h3>
          <ul className="list-none p-0 m-0 space-y-2">
            {ACTION_ITEMS.map((ai) => (
              <li
                key={ai}
                className="relative pl-[18px]"
                style={{ fontSize: 14.5, lineHeight: 1.55, color: "var(--fg-1)" }}
              >
                <span
                  className="absolute rounded-full"
                  style={{ left: 4, top: 9, width: 4, height: 4, background: "var(--fg-2)" }}
                />
                {ai}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── Screen: Chat ─────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1 py-1">
      {[0, 0.2, 0.4].map((delay, i) => (
        <span
          key={i}
          style={{
            display: "inline-block",
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "var(--fg-2)",
            animation: `thinkingBounce 1.2s ease-in-out ${delay}s infinite`,
          }}
        />
      ))}
    </div>
  );
}

function ChatScreen() {
  const [inputText, setInputText] = useState("");
  const [phase, setPhase] = useState(0); // 0=typing-in-bar, 1=thinking, 2=streaming
  const [typedA, setTypedA] = useState("");

  useEffect(() => {
    setInputText("");
    setPhase(0);
    setTypedA("");

    let qTimer = null;
    let pauseHandle = null;
    let thinkHandle = null;
    let aTimer = null;

    const startDelay = setTimeout(() => {
      let qIdx = 0;
      qTimer = setInterval(() => {
        qIdx++;
        setInputText(CHAT_Q.slice(0, qIdx));
        if (qIdx >= CHAT_Q.length) {
          clearInterval(qTimer);
          pauseHandle = setTimeout(() => {
            setInputText("");
            setPhase(1);
            thinkHandle = setTimeout(() => {
              setPhase(2);
              let aIdx = 0;
              aTimer = setInterval(() => {
                aIdx++;
                setTypedA(CHAT_A.slice(0, aIdx));
                if (aIdx >= CHAT_A.length) clearInterval(aTimer);
              }, 15);
            }, 700);
          }, 400);
        }
      }, 38);
    }, 300);

    return () => {
      clearTimeout(startDelay);
      clearInterval(qTimer);
      clearTimeout(pauseHandle);
      clearTimeout(thinkHandle);
      clearInterval(aTimer);
    };
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--page)" }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: "var(--fg-1)" }}>
          Q1 Budget Planning
          <ChevronDown size={14} style={{ color: "var(--fg-2)" }} />
        </div>
        <button
          className="border-0 cursor-default text-[12px] rounded-[6px]"
          style={{
            padding: "3px 10px",
            border: "1px solid var(--border-subtle)",
            background: "transparent",
            color: "var(--fg-2)",
          }}
        >
          New chat
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-hidden px-4 py-3 space-y-3">
        {phase >= 1 && (
          <Motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="flex justify-end"
          >
            <div
              className="text-[14px] max-w-[75%]"
              style={{
                padding: "8px 14px",
                background: "var(--surface-hover)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "18px 18px 4px 18px",
                color: "var(--fg-1)",
                lineHeight: 1.5,
              }}
            >
              {CHAT_Q}
            </div>
          </Motion.div>
        )}

        {phase === 1 && <ThinkingDots />}

        {phase === 2 && (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15 }}
            className="text-[14px]"
            style={{ lineHeight: 1.7, color: "var(--fg-1)", maxWidth: "90%" }}
          >
            {typedA}
            {typedA.length < CHAT_A.length && (
              <span
                className="inline-block align-middle animate-pulse"
                style={{ width: 2, height: 14, background: "var(--fg-1)", marginLeft: 1 }}
              />
            )}
          </Motion.div>
        )}
      </div>

      {/* Ask bar */}
      <div className="px-3 pb-3 flex-shrink-0">
        {phase === 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {CHAT_SUGGESTIONS.map((s) => (
              <span
                key={s}
                className="text-[12px] rounded-[8px] cursor-default"
                style={{ padding: "3px 10px", border: "1px solid var(--border-subtle)", color: "var(--fg-2)" }}
              >
                {s}
              </span>
            ))}
          </div>
        )}

        <div
          className="flex items-center gap-2 rounded-[14px]"
          style={{
            padding: "8px 8px 8px 12px",
            background: "var(--surface-raised)",
            border: "1px solid var(--border-subtle)",
            boxShadow: "var(--shadow-sm)",
          }}
        >
          <div
            className="flex-1 text-[14px] font-medium"
            style={{
              height: 32,
              display: "flex",
              alignItems: "center",
              color: inputText ? "var(--fg-1)" : "var(--fg-2)",
              minWidth: 0,
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {inputText || "Ask about your meetings…"}
            {phase === 0 && inputText.length > 0 && inputText.length < CHAT_Q.length && (
              <span
                className="inline-block align-middle ml-px flex-shrink-0"
                style={{ width: 2, height: 14, background: "var(--fg-1)" }}
              />
            )}
          </div>
          <button
            className="flex items-center justify-center flex-shrink-0 rounded-full border-0 cursor-default"
            style={{
              width: 30,
              height: 30,
              background: inputText ? "var(--fg-1)" : "var(--surface-active)",
              color: inputText ? "var(--fg-inverse)" : "var(--fg-2)",
            }}
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────

export function AppWindowDemo() {
  const [screenIdx, setScreenIdx] = useState(0);
  const timerRef = useRef(null);

  const startTimer = useCallback(() => {
    clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setScreenIdx((i) => (i + 1) % SCREENS.length);
    }, ADVANCE_MS);
  }, []);

  const goTo = useCallback(
    (idx) => {
      setScreenIdx(idx);
      startTimer();
    },
    [startTimer]
  );

  useEffect(() => {
    startTimer();
    return () => clearInterval(timerRef.current);
  }, [startTimer]);

  const screen = SCREENS[screenIdx];

  return (
    <div className="relative max-w-full overflow-x-auto">
      <div
        className="rounded-[14px] overflow-hidden"
        style={{ background: "var(--surface-raised)", boxShadow: "var(--shadow-lg)" }}
      >
        {/* Title bar */}
        <div
          className="flex items-center gap-[6px] px-[14px] py-[10px] flex-shrink-0"
          style={{ background: "var(--surface-sunken)", borderBottom: "1px solid var(--border-subtle)" }}
        >
          <span className="w-[10px] h-[10px] rounded-full bg-[#FF5F57] block" />
          <span className="w-[10px] h-[10px] rounded-full bg-[#FEBC2E] block" />
          <span className="w-[10px] h-[10px] rounded-full bg-[#28C840] block" />
          <span className="ml-3 text-[12px]" style={{ color: "var(--fg-2)", fontFamily: "var(--font-sans)" }}>
            Steno
          </span>
        </div>

        {/* Body */}
        <div className="flex" style={{ height: 480 }}>
          <AppSidebar activeScreen={screen} />

          <div className="flex-1 min-w-0 overflow-hidden relative">
            <AnimatePresence mode="wait">
              <Motion.div
                key={screen}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                className="absolute inset-0 flex flex-col"
              >
                {screen === "notes" && <NotesScreen />}
                {screen === "summary" && <SummaryScreen />}
                {screen === "chat" && <ChatScreen />}
              </Motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-[6px] mt-3">
        {SCREENS.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className="rounded-full border-0 cursor-pointer p-0 transition-all duration-200"
            style={{
              width: 6,
              height: 6,
              background: i === screenIdx ? "var(--fg-1)" : "var(--border-strong)",
            }}
            aria-label={`View screen ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
