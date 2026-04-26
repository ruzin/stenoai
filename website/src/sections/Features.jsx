import { Cpu, SlidersHorizontal, MessageSquare, ShieldOff, Layers, HardDrive } from "lucide-react";
import { motion as Motion } from "framer-motion";

const feats = [
  { icon: <Cpu size={18} aria-hidden="true" />, title: "Local transcription", body: "Whisper.cpp runs on Apple Silicon and Intel. Fast on a laptop, private by architecture." },
  { icon: <SlidersHorizontal size={18} aria-hidden="true" />, title: "Choose your model", body: "Llama 3.2, Gemma, Qwen, DeepSeek, GPT-OSS. Switch any time; all open-weight models run locally." },
  { icon: <MessageSquare size={18} aria-hidden="true" />, title: "Ask your meetings", body: "Chat with a model that has full context of the transcript. Answers come with citations to the source." },
  { icon: <ShieldOff size={18} aria-hidden="true" />, title: "No data leaves", body: "Zero network requests after install. Verified by inspectable, open-source code you can audit yourself." },
  { icon: <Layers size={18} aria-hidden="true" />, title: "99 languages", body: "Whisper auto-detects the language spoken. Works equally well across multilingual meetings." },
  { icon: <HardDrive size={18} aria-hidden="true" />, title: "Runs offline", body: "No internet required after the initial model download. Works on planes, in hospitals, anywhere." },
];

export function Features() {
  return (
    <section id="features" className="sect" style={{ background: "var(--surface-sunken)" }}>
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
            Built for focus. Engineered for privacy.
          </h2>
          <p className="text-fg-2 text-lg leading-[1.55]" style={{ maxWidth: "56ch" }}>
            Every capability is designed around one constraint: your audio never leaves your device.
          </p>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8 sm:gap-10 sm:gap-x-12">
          {feats.map((f, i) => (
            <Motion.div
              key={f.title}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.05 }}
            >
              <div className="text-fg-2 mb-[14px]">{f.icon}</div>
              <h3 className="text-fg-1 mb-2" style={{ fontWeight: 500, fontSize: 18 }}>{f.title}</h3>
              <p className="text-fg-2 text-[15px] leading-[1.6]" style={{ maxWidth: "42ch" }}>{f.body}</p>
            </Motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
