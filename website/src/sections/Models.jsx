import { useState } from "react";
import { Check } from "lucide-react";
import { motion as Motion } from "framer-motion";

const models = [
  { id: "llama3.2:3b",     label: "Llama 3.2",   detail: "3B · Fast" },
  { id: "gemma3:4b",       label: "Gemma 3",      detail: "4B · Balanced" },
  { id: "qwen3.5:9b",      label: "Qwen 3.5",     detail: "9B · Smart" },
  { id: "deepseek-r1:14b", label: "DeepSeek R1",  detail: "14B · Reasoning" },
  { id: "gpt-oss:20b",     label: "GPT-OSS",      detail: "20B · Capable" },
];

export function Models() {
  const [active, setActive] = useState("llama3.2:3b");

  return (
    <section id="models" className="sect">
      <div className="container-site grid md:grid-cols-2 gap-10 md:gap-20 items-center">

        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
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
            Your model, your choice.
          </h2>
          <p className="text-fg-2 text-lg leading-[1.55]" style={{ maxWidth: "44ch" }}>
            Five open-weight models included. Switch instantly without restarting.
            All run on your Mac — none phone home.
          </p>
        </Motion.div>

        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="flex flex-col gap-0.5"
        >
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => setActive(m.id)}
              className="flex items-center gap-3 px-4 py-[14px] rounded-[8px] border-0 bg-transparent cursor-pointer w-full text-left transition-colors text-fg-1"
              style={{
                background: active === m.id ? "var(--surface-hover)" : "transparent",
                transition: "background var(--dur-fast) var(--ease)",
              }}
            >
              <div className="flex flex-col gap-0.5 flex-1">
                <span className="text-[15px] font-medium text-fg-1">{m.label}</span>
                <code
                  className="text-fg-2"
                  style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}
                >
                  {m.id}
                </code>
              </div>
              <span className="text-fg-2 text-[13px] whitespace-nowrap">{m.detail}</span>
              {active === m.id && <Check size={14} className="text-fg-1" aria-hidden="true" />}
            </button>
          ))}
        </Motion.div>

      </div>
    </section>
  );
}
