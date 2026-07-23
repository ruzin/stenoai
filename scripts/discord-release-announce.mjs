#!/usr/bin/env node
// Posts a release announcement to a Discord channel via an incoming webhook.
// Invoked from the `release` job in .github/workflows/build-release.yml right
// after the GitHub Release is created, so every tagged release announces itself
// — the same brief note + a few headline features + a contributor thank-you the
// maintainer used to post by hand.
//
// It NEVER fails the release: if the webhook secret is absent (forks, or before
// the secret is configured) it logs and exits 0, and the workflow step also runs
// with continue-on-error as a second belt.
//
// Inputs (env):
//   DISCORD_WEBHOOK_URL  the channel's incoming-webhook URL (a repo secret)
//   VERSION              e.g. "0.6.0" (no leading v)
//   RELEASE_URL          canonical release page URL
//   RELEASE_NOTES        the annotated-tag body (the notes we authored)
//
// Notes format it parses (see the release notes we write on the tag):
//   <one-line summary>
//   ### <Section>
//   - **<Feature>** — <description>
//   ...
//   ### Thanks to our contributors
//   <paragraph crediting @handles>

const webhook = process.env.DISCORD_WEBHOOK_URL?.trim();
const version = process.env.VERSION?.trim() || '';
const releaseUrl = process.env.RELEASE_URL?.trim() || '';
const notes = process.env.RELEASE_NOTES ?? '';

if (!webhook) {
  console.log('DISCORD_WEBHOOK_URL not set — skipping Discord announcement.');
  process.exit(0);
}

const lines = notes.split('\n').map((l) => l.replace(/\r$/, ''));

// 1. Summary = the first non-empty line that isn't a heading or a bullet.
//    A leading "v1.2.3 — " / "Steno v1.2.3 — " prefix is dropped so the summary
//    doesn't just repeat the version already in the greeting + embed title. If
//    the notes carry no prose summary line at all, we omit it rather than print
//    a redundant "Steno vX is out." (the greeting already says that).
const summary = (
  lines.find((l) => {
    const t = l.trim();
    return t && !t.startsWith('#') && !t.startsWith('-') && !t.startsWith('>');
  })?.trim() || ''
).replace(/^(?:steno\s+)?v?\d+\.\d+\.\d+\s*[—:-]\s*/i, '').trim();

// 2. Headline features. Preferred shape is "- **Name** — desc" bullets (skipping
//    the Upgrade / Thanks sections). If a release's notes instead use a
//    "### Feature\n- description" shape (section header IS the feature), we fall
//    back to synthesising one feature per content section — so the announcement
//    never silently loses its features section over a formatting slip.
const featureBullets = [];
let section = '';
for (const line of lines) {
  const h = line.match(/^###\s+(.*)$/);
  if (h) {
    section = h[1].trim().toLowerCase();
    continue;
  }
  if (section.includes('upgrade') || section.includes('contributor')) continue;
  const m = line.match(/^-\s+\*\*(.+?)\*\*\s*(?:[—-]\s*(.*))?$/);
  if (m) {
    const name = m[1].trim();
    const desc = (m[2] || '').trim().replace(/\s+/g, ' ');
    featureBullets.push(desc ? `• **${name}** — ${truncate(desc, 140)}` : `• **${name}**`);
  }
}
if (featureBullets.length === 0) {
  // Fallback: section title = feature name, its bullet text = description.
  let sec = '';
  let desc = [];
  const flush = () => {
    if (sec && desc.length) {
      featureBullets.push(`• **${sec}** — ${truncate(desc.join(' ').replace(/\s+/g, ' '), 140)}`);
    }
    sec = '';
    desc = [];
  };
  for (const line of lines) {
    const h = line.match(/^###\s+(.*)$/);
    if (h) {
      flush();
      const t = h[1].trim();
      sec = /upgrade|contributor/i.test(t) ? '' : t;
      continue;
    }
    if (sec) {
      const b = line.match(/^-\s+(.*)$/);
      if (b) desc.push(b[1].trim());
    }
  }
  flush();
}
const features = featureBullets.slice(0, 4);

// 3. Contributors = the paragraph under the "Thanks to our contributors" heading.
let contributors = '';
const thanksIdx = lines.findIndex((l) => /^###\s+.*contributor/i.test(l));
if (thanksIdx !== -1) {
  const rest = [];
  for (let i = thanksIdx + 1; i < lines.length; i++) {
    if (/^###\s+/.test(lines[i])) break;
    if (lines[i].trim()) rest.push(lines[i].trim());
  }
  contributors = rest.join(' ').trim();
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

// Casual @here greeting lives in `content` — embeds can't ping, so a mention
// only fires from the message body. allowed_mentions lets the @here actually
// notify the channel (webhooks otherwise won't ping @here/@everyone).
const greeting = `🚀 Hey @here — **Steno v${version}** is out!`;

// The embed carries the substance: summary, headline features, contributor
// thanks, and a link to the full notes.
const parts = [];
if (summary) parts.push(truncate(summary, 300));
if (features.length) parts.push(`**A bunch of great features:**\n${features.join('\n')}`);
if (contributors) parts.push(contributors);
parts.push(`[Full release notes →](${releaseUrl})`);

const payload = {
  username: 'Steno Releases',
  content: greeting,
  allowed_mentions: { parse: ['everyone'] }, // enables the @here ping
  embeds: [
    {
      title: `Steno v${version}`,
      url: releaseUrl,
      description: parts.join('\n\n'),
      color: 0x1b1b19, // brand ink
    },
  ],
};

// DISCORD_DRY_RUN=1 prints the payload without posting — for local testing.
if (process.env.DISCORD_DRY_RUN === '1') {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

let res;
try {
  res = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
} catch (err) {
  // Transport-level failure (DNS, timeout, connection refused) rejects the
  // fetch promise — handle it the same as an HTTP error so a network hiccup
  // logs cleanly and exits 0 rather than surfacing as an unhandled rejection
  // (the design intent is to NEVER fail the release).
  console.error(`Discord webhook request failed: ${err?.message || err}`);
  process.exit(0);
}

if (!res.ok) {
  const body = await res.text().catch(() => '');
  // Don't hard-fail the release over a Discord hiccup — log and exit 0.
  console.error(`Discord webhook returned ${res.status}: ${body}`);
  process.exit(0);
}
console.log(`Announced Steno v${version} to Discord.`);
