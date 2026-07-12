import { useState, useEffect } from "react";
import { Github, Download, Menu, X } from "lucide-react";
import { m as Motion, AnimatePresence } from "framer-motion";
import { StenoMark, Wordmark } from "../components/Brand";
import { ThemeToggle } from "../components/ThemeToggle";
import { trackDownload, trackGitHub } from "../analytics";

const GITHUB_URL = "https://github.com/ruzin/stenoai";

const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#industries", label: "Enterprise" },
  { href: "#faq", label: "FAQ" },
];

function formatStars(n) {
  if (n >= 1000) return (n / 1000).toFixed(n >= 10000 ? 1 : 1).replace(/\.0$/, "") + "K";
  return String(n);
}

// NAV_LINKS point at ids owned by lazy-loaded sections (HowItWorks, Features,
// Industries, FAQ, CTAFooter). All those chunks start fetching as soon as App
// mounts, but there's still a real window where a click lands before the
// target id exists — a plain <a href="#..."> is a silent no-op then. Only
// intervene in that case; if the id already exists, let native behavior run.
function scrollToHash(e, href) {
  const id = href.slice(1);
  if (!id || document.getElementById(id)) return;
  e.preventDefault();
  const deadline = Date.now() + 3000;
  const tryScroll = () => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (Date.now() < deadline) requestAnimationFrame(tryScroll);
  };
  tryScroll();
}

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [stars, setStars] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  useEffect(() => {
    fetch("https://api.github.com/repos/ruzin/stenoai")
      .then(r => r.json())
      .then(d => { if (d.stargazers_count != null) setStars(d.stargazers_count); })
      .catch(() => {});
  }, []);

  // Close the mobile menu if the viewport grows past the md breakpoint
  // (e.g. rotating a tablet) so it can't be left open behind the desktop nav.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const close = () => setMenuOpen(false);
    mq.addEventListener("change", close);
    return () => mq.removeEventListener("change", close);
  }, []);

  return (
    <nav
      className="sticky top-0 z-40 transition-shadow"
      style={{
        background: "var(--surface-translucent)",
        backdropFilter: "blur(16px)",
        borderBottom: scrolled ? "1px solid var(--border-subtle)" : "1px solid transparent",
        boxShadow: scrolled ? "var(--shadow-sm)" : "none",
      }}
    >
      <div className="container-site flex items-center justify-between py-[18px]">
        <a href="#" className="flex items-center gap-[10px] text-fg-1 no-underline hover:no-underline">
          <StenoMark size={26} />
          <Wordmark size={21} />
        </a>

        <div className="hidden md:flex gap-7 items-center">
          {NAV_LINKS.map(({ href, label }) => (
            <a key={href} href={href} onClick={(e) => scrollToHash(e, href)} className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">{label}</a>
          ))}
        </div>

        <div className="flex gap-1 items-center">
          <ThemeToggle />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackGitHub('nav')}
            aria-label="GitHub"
            className="hidden md:inline-flex btn-base btn-ghost btn-ghost-strong btn-sm items-center gap-2 no-underline hover:no-underline"
          >
            <Github size={14} aria-hidden="true" />
            {stars != null && (
              <span className="gh-stars-chip">{formatStars(stars)}</span>
            )}
          </a>
          <a
            href="#download"
            onClick={(e) => { trackDownload('nav', 'unknown'); scrollToHash(e, '#download'); }}
            className="btn-base btn-primary btn-sm inline-flex items-center gap-2 no-underline hover:no-underline"
          >
            Download
          </a>
          <button
            type="button"
            onClick={() => setMenuOpen(v => !v)}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            style={{ width: 40, height: 40 }}
            className="md:hidden inline-flex items-center justify-center rounded-[6px] border-0 bg-transparent text-fg-2 cursor-pointer transition-colors hover:bg-surface-hover hover:text-fg-1"
          >
            {menuOpen ? <X size={17} /> : <Menu size={17} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <Motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.33, 1, 0.68, 1] }}
            className="md:hidden overflow-hidden"
            style={{ borderTop: "1px solid var(--border-subtle)" }}
          >
            <div className="container-site flex flex-col py-3">
              {NAV_LINKS.map(({ href, label }) => (
                <a
                  key={href}
                  href={href}
                  onClick={(e) => { scrollToHash(e, href); setMenuOpen(false); }}
                  className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors"
                  style={{ padding: "10px 0" }}
                >
                  {label}
                </a>
              ))}
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => { trackGitHub('nav'); setMenuOpen(false); }}
                className="inline-flex items-center gap-2 text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors"
                style={{ padding: "10px 0" }}
              >
                <Github size={14} aria-hidden="true" />
                GitHub{stars != null ? ` · ${formatStars(stars)}` : ""}
              </a>
            </div>
          </Motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
