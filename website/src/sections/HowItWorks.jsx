import { Mic, FileText, Sparkles } from "lucide-react";
import { motion as Motion } from "framer-motion";

const steps = [
  {
    n: "01",
    icon: <Mic size={18} aria-hidden="true" />,
    title: "Record",
    body: "Capture microphone, system audio, or both. Even with headphones, both sides of a virtual meeting are recorded without any bot joining the call.",
  },
  {
    n: "02",
    icon: <FileText size={18} aria-hidden="true" />,
    title: "Transcribe",
    body: "Whisper.cpp converts audio to text entirely on your Mac. Ninety-nine languages, auto-detected. Apple Silicon runs it fast.",
  },
  {
    n: "03",
    icon: <Sparkles size={18} aria-hidden="true" />,
    title: "Summarize",
    body: "A local language model extracts the summary, key topics, and action items. Nothing is uploaded. Ever.",
  },
];

export function HowItWorks() {
  return (
    <section id="how" className="sect">
      <div className="container-site">
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
            Three steps. Zero cloud.
          </h2>
          <p className="text-fg-2 text-lg leading-[1.55]" style={{ maxWidth: "56ch" }}>
            From raw audio to structured notes, every step happens on your machine, including the language model.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8 md:gap-12">
          {steps.map((s, i) => (
            <Motion.div
              key={s.n}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.1 }}
            >
              <div className="flex items-center gap-3 mb-5">
                <div
                  className="text-[13px] text-fg-2 tabular-nums"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {s.n}
                </div>
                <div className="text-fg-2">{s.icon}</div>
              </div>
              <h3
                className="text-fg-1 mb-2.5"
                style={{ fontWeight: 500, fontSize: 20, letterSpacing: "-0.01em" }}
              >
                {s.title}
              </h3>
              <p className="text-fg-2 text-[15px] leading-[1.6]" style={{ maxWidth: "34ch" }}>
                {s.body}
              </p>
            </Motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
