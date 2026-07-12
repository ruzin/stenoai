import { StenoMark, Wordmark } from "../components/Brand";
import { trackGitHub } from "../analytics";

const GITHUB_URL = "https://github.com/ruzin/stenoai";
const DISCORD_URL = "https://discord.gg/DZ6vcQnxxu";

export function Footer() {
  return (
    <footer style={{ borderTop: "1px solid var(--border-subtle)", padding: "56px 0 40px" }}>
      <div className="container-site">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 flex-wrap">
          <div className="flex items-center gap-[10px] text-fg-1">
            <StenoMark size={18} />
            <Wordmark size={16} />
          </div>
          <div className="flex gap-4 md:gap-6">
            <a href={DISCORD_URL} target="_blank" rel="noopener noreferrer" className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">Discord</a>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" onClick={() => trackGitHub('footer')} className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">GitHub</a>
            <a href="/privacy.html" className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">Privacy</a>
            <a href="/terms.html" className="text-fg-2 text-sm no-underline hover:text-fg-1 transition-colors">Terms</a>
          </div>
          <div className="text-fg-2 text-[13px]">© 2026 Steno</div>
        </div>
        <div className="mt-10 flex gap-x-4 gap-y-2 flex-wrap items-center">
          <span className="text-fg-muted text-[13px]">Enterprise:</span>
          {[
            { slug: "government", name: "Government" },
            { slug: "defense", name: "Defense" },
            { slug: "legal", name: "Legal" },
            { slug: "healthcare", name: "Healthcare" },
            { slug: "finance", name: "Finance" },
            { slug: "executive", name: "Executive" },
          ].map(({ slug, name }) => (
            <a key={slug} href={`/enterprise/${slug}/`} className="text-fg-muted text-[13px] no-underline hover:text-fg-1 transition-colors">
              {name}
            </a>
          ))}
        </div>
        <div className="mt-3 flex gap-x-4 gap-y-2 flex-wrap items-center">
          <span className="text-fg-muted text-[13px]">Compare:</span>
          {[
            { slug: "granola", name: "Granola" },
            { slug: "otter", name: "Otter.ai" },
            { slug: "fireflies", name: "Fireflies" },
            { slug: "meetily", name: "Meetily" },
          ].map(({ slug, name }) => (
            <a key={slug} href={`/vs/${slug}/`} className="text-fg-muted text-[13px] no-underline hover:text-fg-1 transition-colors">
              Steno vs {name}
            </a>
          ))}
        </div>
        <p className="mt-8 text-fg-muted text-[13px] leading-[1.55]" style={{ maxWidth: "70ch" }}>
          Independent open-source project for private meeting notes. Not affiliated with any similarly named company.
          Product names (Whisper, Llama, Gemma, Qwen, DeepSeek, Granola, Otter, Fireflies, Meetily) are trademarks
          of their respective owners; comparisons are independent editorial content.
        </p>
      </div>
    </footer>
  );
}
