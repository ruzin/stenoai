import { m as Motion } from "framer-motion";
import { Landmark, Shield, Scale, Briefcase, ArrowRight } from "lucide-react";

const inds = [
  { title: "Government", href: "/enterprise/government/", icon: Landmark, body: "Sensitive briefings, policy discussions, and internal reviews stay within your perimeter. No cloud dependencies, no third-party processors, no records leaving the device." },
  { title: "Defense", href: "/enterprise/defense/", icon: Shield, body: "Operational planning and classified discussions run entirely on-device. Works offline, on air-gapped networks, with nothing transiting an external server." },
  { title: "Legal", href: "/enterprise/legal/", icon: Scale, body: "Client calls and case discussions remain privileged. Enforced by architecture, not policy or a privacy checkbox." },
  { title: "Executives", href: "/enterprise/executive/", icon: Briefcase, body: "Board prep, M&A discussions, exec offsites. The conversations that decide the company's direction never leave the device they're held on." },
];

export function Industries() {
  return (
    <section id="industries" className="sect" style={{ background: "var(--surface-sunken)" }}>
      <div className="container-site grid md:grid-cols-[1fr_1.1fr] gap-10 md:gap-20 items-start">

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
            AI for confidential workflows.
          </h2>
          <p className="text-fg-2 text-lg leading-[1.55]">
            If your meetings contain confidential data, you can't send audio to a third party.
            Steno is built for people who understand this.
          </p>
          <p className="text-fg-2 text-[15px] leading-[1.55] mt-4">
            Because nothing leaves the device, there's no third-party processor in your data path —
            supporting HIPAA and GDPR obligations and keeping data in your jurisdiction by design.
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mt-7">
            <a
              href="mailto:chantelle@stenoai.co?subject=Steno%20demo%20request&body=Hi%20Steno%20team%2C%0A%0AWe%27d%20like%20to%20see%20a%20demo.%0A%0AOrganisation%3A%20%0ATeam%20size%3A%20%0AUse%20case%3A%20%0A%0AThanks%2C"
              className="btn-base btn-primary inline-flex items-center gap-2 no-underline hover:no-underline"
            >
              Book a demo
            </a>
            <a href="/enterprise/" className="inline-flex items-center gap-1.5 text-fg-1 text-sm">
              All industries <ArrowRight size={14} aria-hidden="true" />
            </a>
          </div>
        </Motion.div>

        <div className="flex flex-col">
          {inds.map((ind, i) => (
            <Motion.a
              key={ind.title}
              href={ind.href}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="group block py-6 no-underline hover:no-underline"
              style={{
                borderTop: "1px solid var(--border-subtle)",
                borderBottom: i === inds.length - 1 ? "1px solid var(--border-subtle)" : "none",
              }}
            >
              <h3 className="text-fg-1 mb-1.5 flex items-center gap-2" style={{ fontWeight: 500, fontSize: 18 }}>
                <ind.icon size={17} strokeWidth={1.75} className="text-fg-2" aria-hidden="true" />
                {ind.title}
                <ArrowRight size={15} aria-hidden="true" className="text-fg-muted transition-transform group-hover:translate-x-1 group-hover:text-fg-1" />
              </h3>
              <p className="text-fg-2 text-[15px] leading-[1.55]" style={{ maxWidth: "56ch" }}>{ind.body}</p>
            </Motion.a>
          ))}
        </div>

      </div>
    </section>
  );
}
