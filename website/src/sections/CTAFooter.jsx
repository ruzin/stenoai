import { Download } from "lucide-react";
import { motion as Motion } from "framer-motion";
import { trackDownload } from "../analytics";

const DOWNLOAD_ARM = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-macos-arm64.dmg";
const DOWNLOAD_WIN = "https://github.com/ruzin/stenoai/releases/latest/download/stenoAI-windows-x64.exe";

export function CTAFooter() {
  return (
    <section id="download" className="pb-[120px] pt-[80px]">
      <div className="container-site">
        <Motion.div
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="cta-wrap rounded-[14px] md:rounded-[20px] px-6 py-14 sm:px-10 sm:py-16 md:px-16 md:py-24 text-center"
          style={{ backgroundColor: "var(--primary)", color: "var(--primary-fg)" }}
        >
          <div style={{ maxWidth: 520, margin: "0 auto" }}>
            <h2
              className="mb-[14px]"
              style={{
                fontFamily: "var(--font-serif)",
                fontWeight: 400,
                fontSize: "clamp(34px, 4.6vw, 52px)",
                lineHeight: 1.08,
                letterSpacing: "-0.02em",
                color: "var(--primary-fg)",
              }}
            >
              Start keeping private notes.
            </h2>
            <p className="text-lg mb-8" style={{ color: "var(--primary-fg)", opacity: 0.7 }}>
              Free. Open source. No account needed.
            </p>

            <div className="flex gap-[10px] justify-center flex-wrap">
              <a
                href={DOWNLOAD_ARM}
                onClick={() => trackDownload('cta_footer', 'arm64')}
                className="btn-base btn-primary no-underline"
              >
                <Download size={15} aria-hidden="true" /> Download for Apple Silicon
              </a>
              <a
                href={DOWNLOAD_WIN}
                onClick={() => trackDownload('cta_footer', 'win-x64')}
                className="btn-base btn-ghost no-underline"
              >
                <Download size={15} aria-hidden="true" /> Download for Windows (alpha)
              </a>
            </div>

            <p className="mt-5 text-[13px]" style={{ color: "var(--primary-fg)", opacity: 0.5 }}>
              macOS 12+ (Apple Silicon) · Windows 10/11 (x64, alpha — unsigned) · ~4 GB for the default model
            </p>
          </div>
        </Motion.div>
      </div>
    </section>
  );
}
