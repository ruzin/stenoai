import { useState } from "react";
import { Check, ShieldCheck, Download, Plus, Minus, ArrowRight } from "lucide-react";
import { AnimatePresence, m as Motion } from "framer-motion";
import { Nav } from "../sections/Nav";
import { Footer } from "../sections/Footer";
import { CTAFooter } from "../sections/CTAFooter";
import { trackDownload } from "../analytics";
import { ALL, COMPLIANCE_BODY, CTA_MAILTO } from "./industries";

const DOWNLOAD_ARM = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg";

const H2_STYLE = {
  fontFamily: "var(--font-serif)",
  fontWeight: 400,
  fontSize: "clamp(28px, 3.6vw, 40px)",
  lineHeight: 1.1,
  letterSpacing: "-0.02em",
  color: "var(--fg-1)",
};

function Chip({ label }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-fg-2 text-[13px]"
      style={{ border: "1px solid var(--border)", borderRadius: 9999, padding: "5px 12px" }}
    >
      <ShieldCheck size={13} aria-hidden="true" /> {label}
    </span>
  );
}

function FaqItem({ faq, open, onToggle, last }) {
  return (
    <div style={{ borderTop: "1px solid var(--border-subtle)", borderBottom: last ? "1px solid var(--border-subtle)" : "none" }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full bg-transparent border-0 py-6 flex justify-between items-center gap-5 cursor-pointer text-left text-fg-1 text-base md:text-[17px]"
        style={{ fontFamily: "var(--font-sans)", fontWeight: 500 }}
      >
        <span>{faq.q}</span>
        <span className="text-fg-2 flex-shrink-0">
          {open ? <Minus size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
        </span>
      </button>
      <AnimatePresence>
        {open && (
          <Motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <p className="text-fg-2 text-[15px] leading-[1.6] pb-6" style={{ maxWidth: "64ch" }}>{faq.a}</p>
          </Motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function IndustryPage({ data }) {
  const [openFaq, setOpenFaq] = useState(null);
  const others = ALL.filter((c) => c.slug !== data.slug);

  return (
    <>
      <Nav subpage />

      <main>
        {/* Header */}
        <section className="pt-[48px] pb-[24px] md:pt-[72px]">
          <div className="container-site" style={{ maxWidth: 880 }}>
            <Motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-fg-2 text-[12px] mb-5"
              style={{ fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}
            >
              {data.eyebrow}
            </Motion.p>
            <Motion.h1
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05 }}
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 400,
                fontSize: "clamp(36px, 5vw, 58px)",
                lineHeight: 1.05,
                letterSpacing: "-0.025em",
                color: "var(--fg-1)",
                maxWidth: "22ch",
              }}
            >
              {data.h1}
            </Motion.h1>
            <Motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-fg-2 text-lg leading-[1.6] mt-6"
              style={{ maxWidth: "66ch" }}
            >
              {data.intro}
            </Motion.p>
            <Motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.13 }}
              className="flex flex-wrap gap-2 mt-7"
            >
              {data.chips.map((c) => <Chip key={c} label={c} />)}
            </Motion.div>
            <Motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.16 }}
              className="flex gap-[10px] flex-wrap mt-8"
            >
              <a href={CTA_MAILTO} className="btn-base btn-primary inline-flex items-center gap-2 no-underline hover:no-underline">
                Book a demo
              </a>
              <a
                href={DOWNLOAD_ARM}
                onClick={() => trackDownload(`enterprise_${data.slug}`, "arm64")}
                className="btn-base btn-ghost inline-flex items-center gap-2 no-underline hover:no-underline"
              >
                <Download size={15} aria-hidden="true" /> Download for macOS
              </a>
            </Motion.div>
          </div>
        </section>

        {/* The problem */}
        <section className="pt-[48px] pb-[8px]">
          <div className="container-site" style={{ maxWidth: 880 }}>
            <h2 className="mb-6" style={H2_STYLE}>Why cloud tools don't fit</h2>
            <ul className="m-0 p-0 flex flex-col gap-4" style={{ listStyle: "none", maxWidth: "68ch" }}>
              {data.pains.map((p) => (
                <li key={p} className="flex items-start gap-3 text-fg-2 text-[15px] leading-[1.6]">
                  <span aria-hidden="true" style={{ color: "var(--fg-muted)", marginTop: 2 }}>—</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Points grid */}
        <section className="pt-[56px] pb-[8px]">
          <div className="container-site" style={{ maxWidth: 880 }}>
            <div className="grid md:grid-cols-2 gap-x-12 gap-y-9">
              {data.points.map((pt) => (
                <div key={pt.h}>
                  <h3 className="text-fg-1 mb-2 flex items-center gap-2" style={{ fontWeight: 500, fontSize: 17 }}>
                    <Check size={16} strokeWidth={2.2} aria-hidden="true" style={{ color: "var(--fg-1)" }} />
                    {pt.h}
                  </h3>
                  <p className="text-fg-2 text-[15px] leading-[1.6]" style={{ maxWidth: "48ch" }}>{pt.b}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Compliance */}
        <section className="pt-[64px] pb-[8px]">
          <div className="container-site" style={{ maxWidth: 880 }}>
            <div
              className="rounded-[14px] p-8 md:p-10"
              style={{ background: "var(--surface-sunken)", border: "1px solid var(--border-subtle)" }}
            >
              <h2 className="mb-4" style={{ ...H2_STYLE, fontSize: "clamp(22px, 2.6vw, 28px)" }}>
                On compliance
              </h2>
              <p className="text-fg-2 text-[15px] leading-[1.65]" style={{ maxWidth: "68ch" }}>
                {COMPLIANCE_BODY}
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="sect" style={{ paddingBottom: 48 }}>
          <div className="container-site" style={{ maxWidth: 820 }}>
            <h2 className="mb-10" style={H2_STYLE}>Questions</h2>
            <div className="flex flex-col">
              {data.faqs.map((f, i) => (
                <FaqItem
                  key={f.q}
                  faq={f}
                  open={openFaq === i}
                  onToggle={() => setOpenFaq(openFaq === i ? null : i)}
                  last={i === data.faqs.length - 1}
                />
              ))}
            </div>
          </div>
        </section>

        {/* Cross-links */}
        <section className="pb-[16px]">
          <div className="container-site" style={{ maxWidth: 820 }}>
            <p className="text-fg-2 text-sm">
              Also built for:{" "}
              {others.map((c, i) => (
                <span key={c.slug}>
                  <a href={`/enterprise/${c.slug}/`}>{c.name}</a>
                  {i < others.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          </div>
        </section>

        <CTAFooter />
      </main>

      <Footer />
    </>
  );
}
