import { useState, useEffect, useRef } from "react";
import { Github, Download, Menu, X, ChevronDown, Landmark, Shield, Scale, Stethoscope, Banknote, Briefcase } from "lucide-react";
import { m as Motion, AnimatePresence, LazyMotion, domMax } from "framer-motion";
import { StenoMark, Wordmark } from "../components/Brand";
import { ThemeToggle } from "../components/ThemeToggle";
import { trackDownload, trackGitHub } from "../analytics";

const GITHUB_URL = "https://github.com/ruzin/stenoai";

// Plain in-page hash links. Enterprise + Compare are dropdowns (below), so
// they aren't in this list.
const NAV_LINKS = [
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
  { href: "#faq", label: "FAQ" },
];

// Dropdown link lists. Kept as small local arrays (mirroring the /vs/ and
// /enterprise/ data modules) so the nav doesn't pull the full page copy into
// the homepage bundle.
const COMPARE_LINKS = [
  { href: "/vs/granola/", label: "vs Granola" },
  { href: "/vs/otter/", label: "vs Otter.ai" },
  { href: "/vs/fireflies/", label: "vs Fireflies" },
  { href: "/vs/meetily/", label: "vs Meetily" },
];

const ENTERPRISE_LINKS = [
  { href: "/enterprise/government/", label: "Government", icon: Landmark },
  { href: "/enterprise/defense/", label: "Defense", icon: Shield },
  { href: "/enterprise/legal/", label: "Legal", icon: Scale },
  { href: "/enterprise/healthcare/", label: "Healthcare", icon: Stethoscope },
  { href: "/enterprise/finance/", label: "Finance", icon: Banknote },
  { href: "/enterprise/executive/", label: "Executive", icon: Briefcase },
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

// Desktop-only nav dropdown: opens on hover or keyboard focus, closes on leave,
// outside click, or Escape. The trigger itself navigates to `hubHref` so the
// hub page stays reachable even without interacting with the menu. Used for
// both Compare (/vs/) and Enterprise (/enterprise/).
function NavDropdown({ label, hubHref, hubLabel, ariaLabel, links }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const closeTimer = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  return (
    <div
      ref={wrapRef}
      className="relative"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
      // Close when focus leaves the wrapper (e.g. Tab out to the other
      // dropdown's trigger) so two panels can't be open at once with stale
      // aria-expanded. relatedTarget is the element receiving focus.
      onBlur={(e) => { if (!wrapRef.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <a
        href={hubHref}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors"
      >
        {label}
        <ChevronDown
          size={12}
          aria-hidden="true"
          style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform var(--dur-fast) var(--ease)" }}
        />
      </a>

      <AnimatePresence>
        {open && (
          // Plain links in a labelled group, not role="menu": a nav dropdown of
          // page links doesn't need the application-menu keyboard model (arrow
          // keys, roving focus). Tab/Shift-Tab through the links + Escape is the
          // correct, expected interaction here.
          <Motion.div
            aria-label={ariaLabel}
            initial={{ opacity: 0, y: 4, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 4, x: "-50%" }}
            transition={{ duration: 0.15, ease: [0.33, 1, 0.68, 1] }}
            className="absolute left-1/2 top-full pt-3"
          >
            <div
              className="flex flex-col py-2 min-w-[200px]"
              style={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius)",
                boxShadow: "var(--shadow-md)",
              }}
            >
              {links.map(({ href, label: itemLabel, icon: Icon }) => (
                <a
                  key={href}
                  href={href}
                  className="flex items-center gap-2.5 px-4 py-2 text-fg-2 text-sm no-underline hover:text-fg-1 hover:bg-surface-hover transition-colors whitespace-nowrap"
                >
                  {Icon && <Icon size={14} aria-hidden="true" className="text-fg-muted flex-shrink-0" />}
                  {itemLabel}
                </a>
              ))}
              <div className="my-2" style={{ borderTop: "1px solid var(--border-subtle)" }} />
              <a
                href={hubHref}
                className="px-4 py-2 text-fg-2 text-sm no-underline hover:text-fg-1 hover:bg-surface-hover transition-colors whitespace-nowrap"
              >
                {hubLabel}
              </a>
            </div>
          </Motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// `subpage` renders the nav for pages other than the homepage (/vs/*):
// section links become absolute (/#how) so they navigate home, and the
// lazy-chunk scroll polyfill is skipped — it only applies to same-page ids.
export function Nav({ subpage = false }) {
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
    <LazyMotion features={domMax} strict={false}>
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
        <a href={subpage ? "/" : "#"} className="flex items-center gap-[10px] text-fg-1 no-underline hover:no-underline">
          <StenoMark size={26} />
          <Wordmark size={21} />
        </a>

        <div className="hidden md:flex gap-7 items-center">
          {NAV_LINKS.slice(0, 2).map(({ href, label }) => (
            <a
              key={href}
              href={subpage ? `/${href}` : href}
              onClick={subpage ? undefined : (e) => scrollToHash(e, href)}
              className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors"
            >
              {label}
            </a>
          ))}
          <NavDropdown
            label="Enterprise"
            hubHref="/enterprise/"
            hubLabel="All industries"
            ariaLabel="Steno for specific industries"
            links={ENTERPRISE_LINKS}
          />
          <NavDropdown
            label="Compare"
            hubHref="/vs/"
            hubLabel="All comparisons"
            ariaLabel="Compare Steno with other tools"
            links={COMPARE_LINKS}
          />
          {NAV_LINKS.slice(2).map(({ href, label }) => (
            <a
              key={href}
              href={subpage ? `/${href}` : href}
              onClick={subpage ? undefined : (e) => scrollToHash(e, href)}
              className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors"
            >
              {label}
            </a>
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
                  href={subpage ? `/${href}` : href}
                  onClick={(e) => { if (!subpage) scrollToHash(e, href); setMenuOpen(false); }}
                  className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors"
                  style={{ padding: "10px 0" }}
                >
                  {label}
                </a>
              ))}
              <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <a
                  href="/enterprise/"
                  onClick={() => setMenuOpen(false)}
                  className="block text-fg-muted text-[12px] py-2 no-underline hover:text-fg-1 transition-colors"
                  style={{ fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.12em" }}
                >
                  Enterprise
                </a>
                {ENTERPRISE_LINKS.map(({ href, label, icon: Icon }) => (
                  <a
                    key={href}
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2.5 text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors"
                    style={{ padding: "10px 0" }}
                  >
                    {Icon && <Icon size={14} aria-hidden="true" className="text-fg-muted flex-shrink-0" />}
                    {label}
                  </a>
                ))}
              </div>
              <div className="mt-2 pt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
                <a
                  href="/vs/"
                  onClick={() => setMenuOpen(false)}
                  className="block text-fg-muted text-[12px] py-2 no-underline hover:text-fg-1 transition-colors"
                  style={{ fontFamily: "var(--font-mono)", textTransform: "uppercase", letterSpacing: "0.12em" }}
                >
                  Compare
                </a>
                {COMPARE_LINKS.map(({ href, label }) => (
                  <a
                    key={href}
                    href={href}
                    onClick={() => setMenuOpen(false)}
                    className="block text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors"
                    style={{ padding: "10px 0" }}
                  >
                    {label}
                  </a>
                ))}
              </div>
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
    </LazyMotion>
  );
}
