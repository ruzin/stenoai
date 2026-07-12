import { ArrowRight } from "lucide-react";
import { m as Motion } from "framer-motion";
import { Nav } from "../sections/Nav";
import { Footer } from "../sections/Footer";
import { CTAFooter } from "../sections/CTAFooter";
import { ALL, VERIFIED } from "./competitors";

export function VsIndex() {
  return (
    <>
      <Nav subpage />

      <main>
        <section className="pt-[48px] pb-[24px] md:pt-[72px]">
          <div className="container-site" style={{ maxWidth: 880 }}>
            <Motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="text-fg-2 text-[12px] mb-5"
              style={{ fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.14em" }}
            >
              Comparisons
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
              How Steno compares.
            </Motion.h1>
            <Motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-fg-2 text-lg leading-[1.6] mt-6"
              style={{ maxWidth: "66ch" }}
            >
              Steno transcribes and summarizes meetings entirely on your device — free, open source,
              no bot, no account. Here is how that stacks up against the tools you might be using
              instead, stated as fairly as we can. Competitor details verified {VERIFIED}.
            </Motion.p>
          </div>
        </section>

        <section className="pt-[40px] pb-[24px]">
          <div className="container-site" style={{ maxWidth: 880 }}>
            <div className="flex flex-col">
              {ALL.map((c, i) => (
                <a
                  key={c.slug}
                  href={`/vs/${c.slug}/`}
                  className="vs-index-row group no-underline hover:no-underline"
                  style={{
                    borderTop: "1px solid var(--border-subtle)",
                    borderBottom: i === ALL.length - 1 ? "1px solid var(--border-subtle)" : "none",
                  }}
                >
                  <div className="flex items-center justify-between gap-5 py-7">
                    <div>
                      <span
                        className="block text-fg-1"
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontWeight: 400,
                          fontSize: "clamp(22px, 2.8vw, 28px)",
                          letterSpacing: "-0.015em",
                          lineHeight: 1.2,
                        }}
                      >
                        Steno vs {c.name}
                      </span>
                      <span className="block text-fg-2 text-[15px] leading-[1.6] mt-2" style={{ maxWidth: "58ch" }}>
                        {c.oneLiner}
                      </span>
                    </div>
                    <ArrowRight
                      size={18}
                      aria-hidden="true"
                      className="flex-shrink-0 text-fg-muted transition-transform group-hover:translate-x-1 group-hover:text-fg-1"
                    />
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>

        <CTAFooter />
      </main>

      <Footer />
    </>
  );
}
