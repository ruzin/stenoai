import { useState, useEffect } from "react";
import { Github, Download } from "lucide-react";
import { StenoMark, Wordmark } from "../components/Brand";
import { ThemeToggle } from "../components/ThemeToggle";
import { trackDownload, trackGitHub } from "../analytics";

const GITHUB_URL = "https://github.com/ruzin/stenoai";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
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
          <StenoMark size={22} />
          <Wordmark size={18} />
        </a>

        <div className="hidden md:flex gap-7 items-center">
          <a href="#how" className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">How it works</a>
          <a href="#features" className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">Features</a>
          <a href="#industries" className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">Who it's for</a>
          <a href="#faq" className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">FAQ</a>
        </div>

        <div className="flex gap-1 items-center">
          <ThemeToggle />
          <a
            href={GITHUB_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => trackGitHub('nav')}
            className="hidden md:inline-flex btn-base btn-ghost btn-sm items-center gap-2 no-underline hover:no-underline"
          >
            <Github size={14} aria-hidden="true" /> GitHub
          </a>
          <a
            href="#download"
            onClick={() => trackDownload('nav', 'unknown')}
            className="btn-base btn-primary btn-sm inline-flex items-center gap-2 no-underline hover:no-underline"
          >
            Download
          </a>
        </div>
      </div>
    </nav>
  );
}
