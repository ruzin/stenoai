import { Mic, FileText, Sparkles } from "lucide-react";
import { motion as Motion } from "framer-motion";

const steps = [
  {
    n: "01",
    Icon: Mic,
    title: "Record",
    body: "Captures your mic, system audio, or both. Both sides of a video call are recorded without any bot or app joining.",
  },
  {
    n: "02",
    Icon: FileText,
    title: "Transcribe",
    body: "Your words are transcribed in real time, entirely on your device. Works in 99 languages with automatic detection — on Mac and Windows.",
  },
  {
    n: "03",
    Icon: Sparkles,
    title: "Summarize",
    body: "Pulls out a summary, key topics, and action items automatically. Nothing ever leaves your device.",
  },
];

const cardVariants = {
  hidden: { opacity: 0, y: 30, filter: "blur(4px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)" },
};

export function HowItWorks() {
  return (
    <section id="how" className="sect">
      <div className="container-site">
        <Motion.div
          initial={{ y: -10, opacity: 0 }}
          whileInView={{ y: 0, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8, ease: [0.21, 0.47, 0.32, 0.98] }}
          className="mb-[48px] md:mb-[72px]"
          style={{ maxWidth: 640 }}
        >
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
        </Motion.div>

        <Motion.div
          variants={{
            hidden: { opacity: 0 },
            show: { opacity: 1, transition: { staggerChildren: 0.1 } },
          }}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true }}
          className="grid md:grid-cols-3 gap-6"
        >
          {steps.map((s) => (
            <Motion.div
              key={s.n}
              variants={cardVariants}
              transition={{ duration: 0.8, ease: [0.21, 0.47, 0.32, 0.98] }}
            >
              <div className="step-card">
                <s.Icon size={28} strokeWidth={1.2} style={{ color: "var(--fg-1)" }} aria-hidden="true" />
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <h3
                    className="text-fg-1"
                    style={{ fontWeight: 500, fontSize: 19, letterSpacing: "-0.01em", margin: 0 }}
                  >
                    <span className="text-fg-2 tabular-nums" style={{ fontWeight: 400 }}>{s.n} </span>
                    {s.title}
                  </h3>
                  <p className="text-fg-2 text-[15px] leading-[1.6]">
                    {s.body}
                  </p>
                </div>
              </div>
            </Motion.div>
          ))}
        </Motion.div>
      </div>
    </section>
  );
}
