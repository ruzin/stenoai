import { useState, useEffect, useRef, useCallback } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
import { Search, Plus, Settings, MessageSquare } from "lucide-react";

const SCREENS = ["meetings", "recording", "transcript", "summary", "chat"];
const ADVANCE_MS = 3500;

const MEETINGS = [
  { id: 1, title: "Q1 Budget Sync", date: "Feb 15", duration: "42 min" },
  { id: 2, title: "Product Roadmap Review", date: "Feb 12", duration: "28 min" },
  { id: 3, title: "Investor Update Prep", date: "Feb 10", duration: "55 min" },
  { id: 4, title: "Legal Review — Series B", date: "Feb 7", duration: "34 min" },
];

const TRANSCRIPT_LINES = [
  { speaker: "Alex", text: "I think we should move forward with the Q2 allocation before the board meeting." },
  { speaker: "Maria", text: "Agreed. Engineering is under by about 8%, which gives us some room." },
  { speaker: "Alex", text: "Marketing is over though — the paid pilot ran hot." },
  { speaker: "Maria", text: "Right, we're looking at a $40k reallocation through end of March." },
  { speaker: "Alex", text: "Can we get that filed by Friday?" },
  { speaker: "Maria", text: "Marcus can handle the reallocation request. I'll update the forecast." },
];

const CHAT_QUESTION = "What were the main budget decisions?";
const CHAT_ANSWER =
  "The team agreed to reallocate $40k from engineering underspend to the marketing pilot through March 31. Priya was actioned to draft an updated Q1 forecast by Friday.";

function fmt(s) {
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sec}`;
}

// ─── Sidebar ───────────────────────────────────────────────────────────────

function AppSidebar({ activeScreen }) {
  const activeMeetingId = ["transcript", "summary", "chat"].includes(activeScreen) ? 1 : null;

  return (
    <div
      className="flex flex-col flex-shrink-0"
      style={{
        width: 192,
        background: "var(--surface-sunken)",
        borderRight: "1px solid var(--border-subtle)",
        overflow: "hidden",
      }}
    >
      {/* Search bar */}
      <div className="px-2.5 pt-3 pb-2">
        <div
          className="flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[11px]"
          style={{ background: "var(--surface-raised)", color: "var(--fg-2)" }}
        >
          <Search size={10} />
          Search
        </div>
      </div>

      {/* Meetings list */}
      <div className="flex-1 overflow-hidden px-1.5 py-1">
        {activeScreen === "recording" && (
          <div
            className="rounded-[6px] px-2.5 py-2 mb-0.5"
            style={{ background: "var(--surface-active)" }}
          >
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="rec-dot" style={{ width: 5, height: 5 }} />
              <span className="text-[11px] font-medium truncate" style={{ color: "var(--fg-1)" }}>
                New note
              </span>
            </div>
            <span className="text-[10px]" style={{ color: "var(--fg-2)" }}>
              Just now
            </span>
          </div>
        )}
        {MEETINGS.map((m) => (
          <div
            key={m.id}
            className="rounded-[6px] px-2.5 py-2 mb-0.5"
            style={{
              background: activeMeetingId === m.id ? "var(--surface-active)" : "transparent",
            }}
          >
            <div
              className="text-[11px] font-medium truncate"
              style={{ color: "var(--fg-1)" }}
            >
              {m.title}
            </div>
            <div className="text-[10px]" style={{ color: "var(--fg-2)" }}>
              {m.date} · {m.duration}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom icons */}
      <div
        className="flex items-center justify-between px-3 py-2.5"
        style={{ borderTop: "1px solid var(--border-subtle)" }}
      >
        <Settings size={12} style={{ color: "var(--fg-2)" }} />
        <Plus size={12} style={{ color: "var(--fg-2)" }} />
      </div>
    </div>
  );
}

// ─── Screen 1: Meetings list ────────────────────────────────────────────────

function MeetingsListScreen() {
  return (
    <div className="px-5 pt-5 pb-4 h-full overflow-hidden">
      <div className="text-[11px] font-medium mb-3" style={{ color: "var(--fg-2)" }}>
        Recent meetings
      </div>
      <div className="space-y-0.5">
        {MEETINGS.map((m) => (
          <div
            key={m.id}
            className="flex items-start justify-between gap-3 rounded-[8px] px-3 py-2.5"
            style={{ background: "transparent" }}
          >
            <div className="min-w-0">
              <div className="text-[13px] font-medium truncate" style={{ color: "var(--fg-1)" }}>
                {m.title}
              </div>
              <div className="text-[11px] mt-0.5" style={{ color: "var(--fg-2)" }}>
                {m.date} · {m.duration}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Screen 2: Recording ────────────────────────────────────────────────────

function RecordingScreen() {
  const [visibleLines, setVisibleLines] = useState(0);
  const [seconds, setSeconds] = useState(862);

  useEffect(() => {
    setVisibleLines(0);
    const delays = [350, 950, 1600, 2250, 2900];
    const timers = delays.map((d, i) =>
      setTimeout(() => setVisibleLines(i + 1), d)
    );
    const ticker = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(ticker);
    };
  }, []);

  return (
    <div className="h-full overflow-hidden px-6 pt-5 pb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="rec-dot" />
        <span
          className="text-[11px] tabular-nums"
          style={{ color: "var(--fg-2)", fontFamily: "var(--font-mono)" }}
        >
          Recording · {fmt(seconds)}
        </span>
      </div>

      <div
        className="mb-4 text-[17px]"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 400,
          letterSpacing: "-0.015em",
          color: "var(--fg-1)",
        }}
      >
        Q1 Budget Sync
      </div>

      <div className="space-y-3">
        {TRANSCRIPT_LINES.slice(0, visibleLines).map((line, i) => (
          <Motion.div
            key={i}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div
              className="text-[10px] font-medium mb-0.5 uppercase tracking-wide"
              style={{ color: "var(--fg-2)" }}
            >
              {line.speaker}
            </div>
            <div className="text-[12px] leading-[1.55]" style={{ color: "var(--fg-1)" }}>
              {line.text}
              {i === visibleLines - 1 && (
                <span
                  className="inline-block w-[1.5px] h-[12px] ml-0.5 align-middle animate-pulse"
                  style={{ background: "var(--fg-1)" }}
                />
              )}
            </div>
          </Motion.div>
        ))}
      </div>
    </div>
  );
}

// ─── Screen 3: Transcript ───────────────────────────────────────────────────

function TranscriptScreen() {
  return (
    <div className="h-full flex flex-col">
      <div
        className="px-5 pt-4 pb-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="text-[13px] font-medium" style={{ color: "var(--fg-1)" }}>
          Q1 Budget Sync
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--fg-2)" }}>
          Feb 15, 2026 · 42 min · Transcript
        </div>
      </div>
      <div className="flex-1 overflow-hidden px-5 py-4 space-y-4">
        {TRANSCRIPT_LINES.map((line, i) => (
          <div key={i}>
            <div
              className="text-[10px] font-medium mb-1 uppercase tracking-wide"
              style={{ color: "var(--fg-2)" }}
            >
              {line.speaker}
            </div>
            <div className="text-[12px] leading-[1.55]" style={{ color: "var(--fg-1)" }}>
              {line.text}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Screen 4: Summary ──────────────────────────────────────────────────────

function SummaryScreen() {
  return (
    <div className="px-6 pt-5 pb-4 h-full overflow-hidden">
      <div
        className="mb-1"
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 400,
          fontSize: 18,
          letterSpacing: "-0.015em",
          color: "var(--fg-1)",
        }}
      >
        Q1 Budget Sync
      </div>
      <div className="text-[11px] mb-4" style={{ color: "var(--fg-2)" }}>
        Feb 15, 2026 · 42 min
      </div>
      <p className="text-[12px] leading-[1.6] mb-4" style={{ color: "var(--fg-1)" }}>
        The team reviewed Q1 variance. Engineering is 8% under plan; marketing is 3% over,
        driven by a paid pilot. Decision: reallocate $40k through March 31.
      </p>

      <div className="text-[11px] font-medium mb-2" style={{ color: "var(--fg-1)" }}>
        Key points
      </div>
      <ul className="space-y-1.5 mb-4 list-none p-0 m-0">
        {[
          "Engineering underspend: two hires slipped to March.",
          "Paid pilot ahead of signups, over budget.",
          "Reallocate $40k; revisit at next sync.",
        ].map((item) => (
          <li key={item} className="flex gap-2 text-[12px] leading-[1.55]" style={{ color: "var(--fg-1)" }}>
            <span
              className="w-[3px] h-[3px] rounded-full flex-shrink-0 mt-[8px]"
              style={{ background: "var(--fg-2)" }}
            />
            {item}
          </li>
        ))}
      </ul>

      <div className="text-[11px] font-medium mb-2" style={{ color: "var(--fg-1)" }}>
        Action items
      </div>
      <ul className="space-y-1.5 list-none p-0 m-0">
        {[
          "Marcus to file reallocation request by Friday.",
          "Priya to draft updated Q1 forecast.",
        ].map((item) => (
          <li key={item} className="flex gap-2 text-[12px] leading-[1.55]" style={{ color: "var(--fg-1)" }}>
            <span
              className="w-[3px] h-[3px] rounded-full flex-shrink-0 mt-[8px]"
              style={{ background: "var(--fg-2)" }}
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Screen 5: Chat ─────────────────────────────────────────────────────────

function ChatScreen() {
  const [typedQ, setTypedQ] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [typedA, setTypedA] = useState("");

  useEffect(() => {
    setTypedQ("");
    setShowAnswer(false);
    setTypedA("");

    let qIdx = 0;
    let pauseHandle = null;
    let aTimer = null;

    const qTimer = setInterval(() => {
      qIdx++;
      setTypedQ(CHAT_QUESTION.slice(0, qIdx));
      if (qIdx >= CHAT_QUESTION.length) {
        clearInterval(qTimer);
        pauseHandle = setTimeout(() => {
          setShowAnswer(true);
          let aIdx = 0;
          aTimer = setInterval(() => {
            aIdx++;
            setTypedA(CHAT_ANSWER.slice(0, aIdx));
            if (aIdx >= CHAT_ANSWER.length) clearInterval(aTimer);
          }, 18);
        }, 600);
      }
    }, 45);

    return () => {
      clearInterval(qTimer);
      clearTimeout(pauseHandle);
      clearInterval(aTimer);
    };
  }, []);

  return (
    <div className="h-full flex flex-col">
      <div
        className="px-5 pt-4 pb-3 flex-shrink-0"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <div className="text-[13px] font-medium" style={{ color: "var(--fg-1)" }}>
          Q1 Budget Sync
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: "var(--fg-2)" }}>
          Feb 15, 2026 · Ask your meeting
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-4 py-4 space-y-4">
        {/* User question bubble */}
        <div className="flex justify-end">
          <div
            className="max-w-[82%] rounded-[10px] px-3 py-2 text-[12px] leading-[1.55]"
            style={{ background: "var(--surface-sunken)", color: "var(--fg-1)" }}
          >
            {typedQ}
            {typedQ.length < CHAT_QUESTION.length && (
              <span
                className="inline-block w-[1.5px] h-[11px] ml-0.5 align-middle"
                style={{ background: "var(--fg-1)", opacity: 0.8 }}
              />
            )}
          </div>
        </div>

        {/* AI answer */}
        {showAnswer && (
          <Motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="flex gap-2 items-start"
          >
            <div
              className="w-[20px] h-[20px] rounded-full flex-shrink-0 flex items-center justify-center text-[9px] font-semibold"
              style={{ background: "var(--surface-active)", color: "var(--fg-2)" }}
            >
              AI
            </div>
            <div className="text-[12px] leading-[1.6]" style={{ color: "var(--fg-1)" }}>
              {typedA}
              {typedA.length < CHAT_ANSWER.length && (
                <span
                  className="inline-block w-[1.5px] h-[11px] ml-0.5 align-middle animate-pulse"
                  style={{ background: "var(--fg-1)" }}
                />
              )}
            </div>
          </Motion.div>
        )}
      </div>

      {/* Ask bar */}
      <div className="px-4 pb-4 flex-shrink-0">
        <div
          className="flex items-center gap-2 rounded-[8px] px-3 py-2 text-[11px]"
          style={{
            background: "var(--surface-sunken)",
            color: "var(--fg-2)",
            border: "1px solid var(--border)",
          }}
        >
          <MessageSquare size={11} />
          Ask about this meeting…
        </div>
      </div>
    </div>
  );
}

// ─── Root component ─────────────────────────────────────────────────────────

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
          className="flex items-center gap-[6px] px-[14px] py-[10px]"
          style={{
            background: "var(--surface-sunken)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <span className="w-[10px] h-[10px] rounded-full bg-[#FF5F57] block" />
          <span className="w-[10px] h-[10px] rounded-full bg-[#FEBC2E] block" />
          <span className="w-[10px] h-[10px] rounded-full bg-[#28C840] block" />
          <span
            className="ml-3 text-[12px]"
            style={{ color: "var(--fg-2)", fontFamily: "var(--font-sans)" }}
          >
            Steno
          </span>
        </div>

        {/* Two-pane body */}
        <div className="flex" style={{ height: 400 }}>
          <AppSidebar activeScreen={screen} />

          <div className="flex-1 min-w-0 overflow-hidden relative">
            <AnimatePresence mode="wait">
              <Motion.div
                key={screen}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.25 }}
                className="absolute inset-0"
              >
                {screen === "meetings" && <MeetingsListScreen />}
                {screen === "recording" && <RecordingScreen />}
                {screen === "transcript" && <TranscriptScreen />}
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
            className="w-[6px] h-[6px] rounded-full border-0 cursor-pointer p-0 transition-all duration-200"
            style={{
              background: i === screenIdx ? "var(--fg-1)" : "var(--border-strong)",
            }}
            aria-label={`View screen ${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}
