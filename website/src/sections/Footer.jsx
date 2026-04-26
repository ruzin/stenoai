import { StenoMark, Wordmark } from "../components/Brand";

const GITHUB_URL = "https://github.com/ruzin/stenoai";

export function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--border-subtle)", padding: "56px 0 40px" }}>
      <div className="container-site">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 flex-wrap">
          <div className="flex items-center gap-[10px] text-fg-1">
            <StenoMark size={18} />
            <Wordmark size={16} />
          </div>
          <div className="flex gap-6">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">GitHub</a>
            <a href="/privacy.html" className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">Privacy</a>
            <a href="/terms.html" className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">Terms</a>
          </div>
          <div className="text-fg-2 text-[13px]">© 2026 stenoAI</div>
        </div>
        <p className="mt-14 text-fg-muted text-[13px] leading-[1.55]" style={{ maxWidth: "70ch" }}>
          Independent open-source project for private meeting notes. Not affiliated with any similarly named company.
          Product names (Whisper, Llama, Gemma, Qwen, DeepSeek) are trademarks of their respective owners.
        </p>
      </div>
    </footer>
  );
}
