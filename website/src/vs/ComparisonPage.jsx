import { useState } from "react";
import { Check, Minus, X, Download, Plus, ArrowRight } from "lucide-react";
import { AnimatePresence, m as Motion } from "framer-motion";
import { Nav } from "../sections/Nav";
import { Footer } from "../sections/Footer";
import { CTAFooter } from "../sections/CTAFooter";
import { trackDownload } from "../analytics";
import { ALL, VERIFIED } from "./competitors";

const DOWNLOAD_ARM = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg";
const DOWNLOAD_WIN = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-windows-x64.exe";

const H2_STYLE = {
  fontFamily: "var(--font-serif)",
  fontWeight: 400,
  fontSize: "clamp(28px, 3.6vw, 40px)",
  lineHeight: 1.1,
  letterSpacing: "-0.02em",
  color: "var(--fg-1)",
};

function ToneIcon({ tone }) {
  if (tone === "good") return <Check size={15} strokeWidth={2.2} aria-hidden="true" style={{ color: "var(--fg-1)", flexShrink: 0, marginTop: 2 }} />;
  if (tone === "bad") return <X size={15} strokeWidth={2} aria-hidden="true" style={{ color: "var(--fg-muted)", flexShrink: 0, marginTop: 2 }} />;
  return <Minus size={15} strokeWidth={2} aria-hidden="true" style={{ color: "var(--fg-muted)", flexShrink: 0, marginTop: 2 }} />;
}

function Cell({ value }) {
  return (
    <div className="flex items-start gap-2">
      <ToneIcon tone={value.tone} />
      <span>{value.text}</span>
    </div>
  );
}

function FaqItem({ faq, open, onToggle, last }) {
  return (
    <div style={{ borderTop: "1px solid var(--border-subtle)", borderBottom: last ? "1px solid var(--border-subtle)" : "none" }}>
      <button
        onClick={onToggle}
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
            <p className="text-fg-2 text-[15px] leading-[1.6] pb-6" style={{ maxWidth: "62ch" }}>{faq.a}</p>
          </Motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ComparisonPage({ data }) {
  const [openFaq, setOpenFaq] = useState(null);
  const others = ALL.filter((c) => c.slug !== data.slug);

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: data.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

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
                maxWidth: "24ch",
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
              transition={{ duration: 0.5, delay: 0.15 }}
              className="flex gap-[10px] flex-wrap mt-8"
            >
              <a
                href={DOWNLOAD_ARM}
                onClick={() => trackDownload(`vs_${data.slug}`, "arm64")}
                className="btn-base btn-primary inline-flex items-center gap-2 no-underline hover:no-underline"
              >
                <Download size={15} aria-hidden="true" /> Download for macOS
              </a>
              <a
                href={DOWNLOAD_WIN}
                onClick={() => trackDownload(`vs_${data.slug}`, "win-x64")}
                className="btn-base btn-ghost inline-flex items-center gap-2 no-underline hover:no-underline"
              >
                <Download size={15} aria-hidden="true" /> Windows (alpha)
              </a>
            </Motion.div>
          </div>
        </section>

        {/* Ledger table */}
        <section className="pt-[40px] pb-[24px]">
          <div className="container-site" style={{ maxWidth: 880 }}>
            <div className="vs-table-wrap">
              <table className="vs-table">
                <caption className="sr-only">Feature comparison between Steno and {data.name}</caption>
                <thead>
                  <tr>
                    <th scope="col" aria-label="Feature"></th>
                    <th scope="col" className="vs-col-steno">Steno</th>
                    <th scope="col">{data.name}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td className="vs-col-steno"><Cell value={row.steno} /></td>
                      <td><Cell value={row.them} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-fg-muted text-[13px] mt-4" style={{ maxWidth: "70ch" }}>
              {data.name} details taken from its public website and documentation, verified {VERIFIED}. Pricing
              and features change — check their site for current terms.
            </p>
          </div>
        </section>

        {/* Verdict */}
        <section className="pt-[48px] pb-[8px]">
          <div className="container-site" style={{ maxWidth: 880 }}>
            <blockquote
              className="m-0 py-2 pl-6 md:pl-8"
              style={{ borderLeft: "2px solid var(--fg-1)" }}
            >
              <p
                style={{
                  fontFamily: "var(--font-serif)",
                  fontWeight: 400,
                  fontSize: "clamp(20px, 2.6vw, 26px)",
                  lineHeight: 1.4,
                  letterSpacing: "-0.01em",
                  color: "var(--fg-1)",
                  maxWidth: "52ch",
                }}
              >
                {data.verdict}
              </p>
            </blockquote>
          </div>
        </section>

        {/* Choose lists */}
        <section className="pt-[64px] pb-[16px]">
          <div className="container-site" style={{ maxWidth: 880 }}>
            <div className="grid md:grid-cols-2 gap-10 md:gap-14">
              <div>
                <h2 className="mb-6" style={H2_STYLE}>Choose Steno if</h2>
                <ul className="m-0 p-0 flex flex-col gap-4" style={{ listStyle: "none" }}>
                  {data.chooseSteno.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-fg-2 text-[15px] leading-[1.6]">
                      <Check size={15} strokeWidth={2.2} aria-hidden="true" style={{ color: "var(--fg-1)", flexShrink: 0, marginTop: 4 }} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h2 className="mb-6" style={H2_STYLE}>Choose {data.name} if</h2>
                <ul className="m-0 p-0 flex flex-col gap-4" style={{ listStyle: "none" }}>
                  {data.chooseThem.map((item) => (
                    <li key={item} className="flex items-start gap-3 text-fg-2 text-[15px] leading-[1.6]">
                      <ArrowRight size={15} strokeWidth={2} aria-hidden="true" style={{ color: "var(--fg-muted)", flexShrink: 0, marginTop: 4 }} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="sect" style={{ paddingBottom: 48 }}>
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd).replace(/</g, "\\u003c") }}
          />
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
              More comparisons:{" "}
              {others.map((c, i) => (
                <span key={c.slug}>
                  <a href={`/vs/${c.slug}/`}>Steno vs {c.name}</a>
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
