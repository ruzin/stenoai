import { motion as Motion } from "framer-motion";

const inds = [
  { title: "Healthcare", body: "Patient consultations and clinical meetings stay on your device. Suitable for confidential contexts without cloud risk." },
  { title: "Legal", body: "Client calls and case discussions remain privileged — enforced by architecture, not policy or a privacy checkbox." },
  { title: "Finance", body: "Earnings prep, board meetings, deal discussions. None of it touches a third-party server." },
  { title: "Research", body: "Interview recordings and sensitive study data stay local. Full transcripts available for analysis the moment a session ends." },
];

export function Industries() {
  return (
    <section id="industries" className="sect">
      <div className="container-site grid md:grid-cols-[1fr_1.1fr] gap-20 items-start">

        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          style={{ maxWidth: 400 }}
        >
          <h2
            style={{
              fontFamily: "var(--font-serif)",
              fontWeight: 400,
              fontSize: "clamp(34px, 4.6vw, 52px)",
              lineHeight: 1.08,
              letterSpacing: "-0.02em",
              color: "var(--fg-1)",
              margin: "0 0 20px",
            }}
          >
            When privacy isn't optional.
          </h2>
          <p className="text-fg-2 text-lg leading-[1.55]">
            If your meetings contain confidential data, you can't send audio to a third party.
            stenoAI is built for people who already know that.
          </p>
          <blockquote
            className="mt-10 text-fg-2"
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 22,
              fontStyle: "italic",
              fontWeight: 400,
              lineHeight: 1.4,
              borderLeft: "2px solid var(--border-strong)",
              paddingLeft: 20,
              margin: "40px 0 0",
            }}
          >
            "Your data never leaves your Mac."
          </blockquote>
        </Motion.div>

        <div className="flex flex-col">
          {inds.map((ind, i) => (
            <Motion.div
              key={ind.title}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="py-6"
              style={{
                borderTop: "1px solid var(--border-subtle)",
                borderBottom: i === inds.length - 1 ? "1px solid var(--border-subtle)" : "none",
              }}
            >
              <h3 className="text-fg-1 mb-1.5" style={{ fontWeight: 500, fontSize: 18 }}>{ind.title}</h3>
              <p className="text-fg-2 text-[15px] leading-[1.55]" style={{ maxWidth: "56ch" }}>{ind.body}</p>
            </Motion.div>
          ))}
        </div>

      </div>
    </section>
  );
}
