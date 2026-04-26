import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import { AnimatePresence, motion as Motion } from "framer-motion";

const faqs = [
  { q: "What's included for free?", a: "Unlimited local transcription and summarization. No account, no tier, no upsell. stenoAI is open source — you can build and run it yourself if you prefer." },
  { q: "Which AI models can I use?", a: "Five open-weight models: Llama 3.2 3B, Gemma 3 4B, Qwen 3.5 9B, DeepSeek-R1 14B, and GPT-OSS 20B. All run locally on your Mac." },
  { q: "Is my data really private?", a: "Yes. stenoAI makes no network requests after install. The source is open — you can verify it yourself, or have your security team do so." },
  { q: "How accurate is the transcription?", a: "stenoAI uses Whisper. Results depend on audio clarity — quiet rooms and good microphones produce the best outcomes. Whisper performs well across 99 languages." },
  { q: "What Mac do I need?", a: "macOS only, on Apple Silicon or Intel. Apple Silicon is recommended for speed. The app runs comfortably on an M1 MacBook Air." },
  { q: "Does it work with remote meetings?", a: "Yes. stenoAI captures system audio and microphone simultaneously — both sides of a Zoom, Teams, or Meet call are transcribed without any bot joining the meeting." },
];

export function FAQ() {
  const [open, setOpen] = useState(null);

  return (
    <section id="faq" className="sect">
      <div className="container-site" style={{ maxWidth: 820 }}>
        <div className="mb-10">
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 400,
              fontSize: "clamp(34px, 4.6vw, 52px)",
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              color: "var(--fg-1)",
            }}
          >
            Questions
          </h2>
        </div>

        <div className="flex flex-col">
          {faqs.map((f, i) => (
            <div
              key={i}
              style={{ borderTop: "1px solid var(--border-subtle)", borderBottom: i === faqs.length - 1 ? "1px solid var(--border-subtle)" : "none" }}
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full bg-transparent border-0 py-6 flex justify-between items-center gap-5 cursor-pointer text-left text-fg-1"
                style={{ fontFamily: "var(--font-sans)", fontSize: 17, fontWeight: 500 }}
              >
                <span>{f.q}</span>
                <span className="text-fg-2 flex-shrink-0">
                  {open === i ? <Minus size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
                </span>
              </button>

              <AnimatePresence>
                {open === i && (
                  <Motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <p
                      className="text-fg-2 text-[15px] leading-[1.6] pb-6"
                      style={{ maxWidth: "62ch" }}
                    >
                      {f.a}
                    </p>
                  </Motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
