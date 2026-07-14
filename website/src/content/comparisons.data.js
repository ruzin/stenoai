// Data for the /vs/ comparison pages, loaded into the `comparisons` content
// collection (see ../content.config.ts). `metaTitle`/`metaDescription` ARE
// read at runtime now — src/pages/vs/[slug].astro uses them directly for
// <title>/<meta>. See src/content/README.md for the verified-claims policy.

export const VERIFIED = "July 2026";

// Steno's side of the table. Shared rows reuse these so the four pages
// can't drift out of sync about our own product.
const STENO = {
  price: { text: "Free — everything included", tone: "good" },
  openSource: { text: "Yes — MIT license", tone: "good" },
  transcription: { text: "100% on your device (Parakeet, Whisper)", tone: "good" },
  summaries: { text: "On your device — bundled local models, no setup", tone: "good" },
  audio: { text: "Never", tone: "good" },
  bot: { text: "No bot — captures system audio directly", tone: "good" },
  worksWith: { text: "Any meeting app, plus in-person", tone: "good" },
  limits: { text: "None — unlimited meetings and minutes", tone: "good" },
  account: { text: "No account, no sign-up", tone: "good" },
  platforms: { text: "macOS (Apple Silicon) · Windows (alpha)", tone: "neutral" },
};

const ROW = (label, steno, them) => ({ label, steno, them });

export const granola = {
  slug: "granola",
  name: "Granola",
  oneLiner: "The cloud notetaker without a bot — Steno does the same job without the cloud either.",
  metaTitle: "Steno vs Granola — Free, Fully Local Alternative to Granola",
  metaDescription:
    "Granola processes your meeting audio in the cloud and costs from $14/user/month. Steno does the same job — no bot, AI meeting notes — entirely on your device, free and open source.",
  eyebrow: "Steno vs Granola",
  h1: "Like Granola, but data never leaves your premises.",
  intro:
    "Granola popularised the bot-free meeting notetaker — it captures system audio instead of sending a bot into your call. Steno works the same way, with one structural difference: Granola transcribes and summarizes your audio on cloud servers, while Steno runs the entire pipeline on your own device. No audio upload, no account, no subscription.",
  rows: [
    ROW("Price", STENO.price, {
      text: "Free plan with limited meeting history; paid from $14/user/month",
      tone: "bad",
    }),
    ROW("Open source", STENO.openSource, { text: "No — proprietary", tone: "bad" }),
    ROW("Transcription", STENO.transcription, {
      text: "In the cloud — audio is streamed to Granola's servers",
      tone: "bad",
    }),
    ROW("AI summaries", STENO.summaries, {
      text: "Cloud LLMs run on your transcripts",
      tone: "bad",
    }),
    ROW("Audio leaves your device", STENO.audio, { text: "Yes — for cloud transcription", tone: "bad" }),
    ROW("Bot joins your meetings", STENO.bot, {
      text: "No bot — also captures system audio",
      tone: "good",
    }),
    ROW("Works with", STENO.worksWith, { text: "Any meeting app", tone: "good" }),
    ROW("Usage limits", STENO.limits, {
      text: "Free plan caps meeting history",
      tone: "bad",
    }),
    ROW("Account required", STENO.account, { text: "Yes", tone: "bad" }),
    ROW("Platforms", STENO.platforms, { text: "macOS, Windows, iOS", tone: "neutral" }),
  ],
  verdict:
    "Granola is a polished cloud notetaker without the bot. Steno is the same idea taken to its conclusion: if the notes can be made without a bot, they can be made without a server too. Everything — recording, transcription, summaries, chat — runs on your device, free.",
  chooseSteno: [
    "Your meetings involve confidential, legal, medical, or client material that shouldn't transit third-party servers",
    "You want unlimited meetings without a per-user subscription",
    "You need it to work offline — planes, secure sites, flaky Wi-Fi",
    "You (or your security team) want to audit the code that touches your audio",
  ],
  chooseThem: [
    "You want an iPhone app for in-person meetings on the go",
    "You rely on cloud sync across several devices",
    "Your team lives in its integrations — Notion, Slack, HubSpot, Zapier",
    "You're comfortable with cloud processing and want the most polished template ecosystem",
  ],
  faqs: [
    {
      q: "Is Granola private?",
      a: "Granola avoids the meeting bot, which is a real privacy improvement over Otter-style tools. But your audio is still streamed to cloud servers for transcription, and cloud LLMs process your transcripts. Steno removes that layer entirely: transcription and summarization run locally, and your recordings, transcripts, and notes never leave your device. (Steno makes no network calls with your meeting content; anonymous usage telemetry is on by default and can be switched off in Settings.)",
    },
    {
      q: "Does Steno work the same way as Granola — no bot in the call?",
      a: "Yes. Steno captures system audio and microphone simultaneously, so both sides of a Zoom, Teams, or Meet call are transcribed without anything joining the meeting. It also works for in-person conversations.",
    },
    {
      q: "How much does Granola cost compared to Steno?",
      a: "Granola's paid plans start at $14/user/month ($168/user/year), with a free plan that limits meeting history. Steno is free and open source (MIT) — there is no paid tier, and nothing is held back.",
    },
    {
      q: "Can I use Steno on my phone?",
      a: "No — Steno is a desktop app for macOS (Apple Silicon) and Windows (alpha). If phone-first capture matters more to you than on-device privacy, Granola's iPhone app is the better fit today.",
    },
    {
      q: "Are Steno's local summaries as good as Granola's cloud ones?",
      a: "Steno ships a lineup of open-weight models (up to GPT-OSS 20B) that run on your machine, and you can optionally plug in your own cloud API key if you want a frontier model. For meeting summaries and action items, well-prompted local models are strong — and you can verify the results because you keep the full transcript.",
    },
  ],
};

export const otter = {
  slug: "otter",
  name: "Otter.ai",
  oneLiner: "The incumbent: a bot in your calls, recordings on their servers, minute caps below Business.",
  metaTitle: "Steno vs Otter.ai — Private, Unlimited Alternative to Otter",
  metaDescription:
    "Otter sends a bot into your meetings, stores recordings in the cloud, and caps free transcription at 300 minutes a month. Steno transcribes unlimited meetings entirely on your device — free, no bot, no account.",
  eyebrow: "Steno vs Otter.ai",
  h1: "Everything Otter does, without the bot or the cloud.",
  intro:
    "Otter is the incumbent cloud transcription service: an OtterPilot bot joins your call as a participant, recordings live on Otter's servers, and every plan below Business has minute caps. Steno takes the opposite approach — it captures system audio on your own machine, transcribes and summarizes locally, and never uploads anything.",
  rows: [
    ROW("Price", STENO.price, {
      text: "Free: 300 min/month (30 min per conversation); Pro from $8.33/user/month billed annually; Business from $19.99",
      tone: "bad",
    }),
    ROW("Open source", STENO.openSource, { text: "No — proprietary", tone: "bad" }),
    ROW("Transcription", STENO.transcription, { text: "In the cloud", tone: "bad" }),
    ROW("AI summaries", STENO.summaries, { text: "In the cloud", tone: "bad" }),
    ROW("Audio leaves your device", STENO.audio, {
      text: "Yes — recordings are stored on Otter's servers",
      tone: "bad",
    }),
    ROW("Bot joins your meetings", STENO.bot, {
      text: "Yes — OtterPilot appears as a participant in your calls",
      tone: "bad",
    }),
    ROW("Works with", STENO.worksWith, {
      text: "Zoom, Meet, Teams via the bot; mobile recording",
      tone: "neutral",
    }),
    ROW("Usage limits", STENO.limits, {
      text: "Minute caps on every plan below Business",
      tone: "bad",
    }),
    ROW("Account required", STENO.account, { text: "Yes", tone: "bad" }),
    ROW("Platforms", STENO.platforms, { text: "Web browser, iOS, Android", tone: "neutral" }),
  ],
  verdict:
    "Otter charges a subscription to run your audio through its servers, with a bot sitting visibly in your meetings. Steno removes the bot, the server, the account, and the bill — the whole pipeline runs on hardware you already own.",
  chooseSteno: [
    "You don't want a bot appearing in client or internal calls",
    "Your recordings shouldn't live on a third party's servers",
    "You keep hitting minute caps — Steno has no limits at any length",
    "You record in-person conversations and don't want them uploaded",
  ],
  chooseThem: [
    "You need to record from a phone, or work entirely in a browser",
    "Your team collaborates inside a shared cloud workspace of transcripts",
    "You want Otter's live shared highlights during large webinars",
  ],
  faqs: [
    {
      q: "Does Steno need a bot like OtterPilot?",
      a: "No. Steno captures system audio and microphone on your machine, so both sides of any call are transcribed without a participant joining. Nothing announces itself in your meeting, because nothing enters the meeting.",
    },
    {
      q: "Is Steno really unlimited?",
      a: "Yes. Transcription and summarization run on your own hardware, so there's no metering — no monthly minutes, no per-conversation cap, no file-import quota. Otter's free plan allows 300 minutes a month with a 30-minute cap per conversation.",
    },
    {
      q: "Where do my recordings go?",
      a: "With Otter, recordings and transcripts are stored in Otter's cloud, under Otter's terms. With Steno, they're ordinary files in local app storage on your device — your meeting content is never uploaded. (Steno does make some network calls unrelated to your content: update checks, first-run model downloads, and anonymous usage telemetry that's on by default and can be switched off in Settings.)",
    },
    {
      q: "Is Steno's accuracy comparable to Otter's?",
      a: "Steno uses Parakeet TDT v3 for live transcription and Whisper for the long tail of 99 languages — current open models that benchmark competitively with commercial cloud ASR. As with any transcription, quiet rooms and decent microphones matter more than the engine.",
    },
    {
      q: "What's the catch — why is Steno free?",
      a: "There's no hosted infrastructure to pay for: your machine does the work. Steno is an open-source project (MIT), so you can read the code, build it yourself, and verify exactly what it does and doesn't send.",
    },
  ],
};

export const fireflies = {
  slug: "fireflies",
  name: "Fireflies.ai",
  oneLiner: "Team conversation intelligence in the cloud, metered by storage and AI credits.",
  metaTitle: "Steno vs Fireflies.ai — No-Bot, On-Device Alternative to Fireflies",
  metaDescription:
    "Fireflies sends its Fred bot into your calls and stores everything in its cloud, with AI-credit caps per tier. Steno keeps meetings on your device: unlimited local transcription and AI notes, free and open source.",
  eyebrow: "Steno vs Fireflies.ai",
  h1: "Meeting notes without Fred in the room.",
  intro:
    "Fireflies is a cloud conversation-intelligence platform: its bot (Fred) joins your calls, recordings are stored and analyzed in Fireflies' cloud, and plans are metered by storage and AI credits. Steno is the private counterpart — it records on your machine, transcribes and summarizes locally, and nothing is uploaded, metered, or credited.",
  rows: [
    ROW("Price", STENO.price, {
      text: "Free (400 min storage, AI-credit caps); Pro $10/seat/month billed annually; Business $19; Enterprise $39",
      tone: "bad",
    }),
    ROW("Open source", STENO.openSource, { text: "No — proprietary", tone: "bad" }),
    ROW("Transcription", STENO.transcription, { text: "In the cloud", tone: "bad" }),
    ROW("AI summaries", STENO.summaries, {
      text: "In the cloud, metered by AI credits",
      tone: "bad",
    }),
    ROW("Audio leaves your device", STENO.audio, {
      text: "Yes — stored in Fireflies' cloud",
      tone: "bad",
    }),
    ROW("Bot joins your meetings", STENO.bot, {
      text: "Yes — the Fireflies notetaker joins as a participant",
      tone: "bad",
    }),
    ROW("Works with", STENO.worksWith, {
      text: "Meeting platforms via the bot; uploads for other audio",
      tone: "neutral",
    }),
    ROW("Usage limits", STENO.limits, {
      text: "Storage minutes, AI credits, and recording-length caps per tier",
      tone: "bad",
    }),
    ROW("Account required", STENO.account, { text: "Yes", tone: "bad" }),
    ROW("Platforms", STENO.platforms, { text: "Web browser, iOS, Android", tone: "neutral" }),
  ],
  verdict:
    "Fireflies is built for teams that want a cloud archive of every call, analyzed and integrated with their CRM. If what you actually need is accurate, private notes from your own meetings, Steno does that with no bot, no credits, and no data leaving your machine.",
  chooseSteno: [
    "A bot in the participant list isn't acceptable for your calls",
    "Compliance or client confidentiality rules out cloud storage of recordings",
    "You'd rather not budget storage minutes and AI credits — Steno has neither",
    "You want notes from in-person meetings, not just scheduled video calls",
  ],
  chooseThem: [
    "You want conversation analytics across a whole sales or support team",
    "You need deep CRM integrations — Salesforce, HubSpot — fed automatically",
    "A searchable cloud archive shared across the team is the point",
  ],
  faqs: [
    {
      q: "How does Steno record without a bot?",
      a: "Steno captures system audio and your microphone directly on your machine, so both sides of a Zoom, Teams, or Meet call are transcribed without anything joining the meeting. It works for in-person conversations too.",
    },
    {
      q: "Does Steno have AI credits or storage limits like Fireflies?",
      a: "No. Everything runs on your own hardware, so nothing is metered. Unlimited meetings, unlimited length, unlimited summaries — the only resource used is your machine's disk and compute.",
    },
    {
      q: "Can my team share notes with Steno?",
      a: "Steno is built around local-first, per-person notes; you can copy and share summaries wherever your team works. If your core need is a shared, always-on cloud archive with CRM automation, Fireflies is honestly the better match — at the cost of every call living in its cloud.",
    },
    {
      q: "Is Fireflies' free plan enough?",
      a: "Fireflies' free tier caps storage at 400 minutes per team, limits AI credits, and holds back downloads and several AI features. Steno's free tier is the entire product — it's the only tier.",
    },
  ],
};

export const meetily = {
  slug: "meetily",
  name: "Meetily",
  oneLiner: "The other open-source local notetaker — with a $120/year Pro tier for what Steno ships free.",
  metaTitle: "Steno vs Meetily — What Meetily Pro Charges For, Free",
  metaDescription:
    "Steno and Meetily are both open-source, local-first meeting notetakers. The difference: Meetily moves accuracy, exports, and auto-detect behind a $120/year-per-device Pro license — Steno ships everything free, with models bundled in.",
  eyebrow: "Steno vs Meetily",
  h1: "Same privacy philosophy. But Steno offers a whole lot more.",
  intro:
    "Meetily deserves credit: like Steno, it's open source and transcribes meetings on your own machine. The comparison here isn't about privacy — both projects take it seriously. It's about what's actually in the box. Steno ships features free that Meetily reserves for its $120/year Pro tier: chat with your meetings, speaker attribution, meeting auto-detect, and local AI models bundled in so there's nothing to set up. Steno has one tier, and it's free.",
  rows: [
    ROW("Price", STENO.price, {
      text: "Community edition free; Pro $10/user/month billed annually ($120/year); Enterprise custom",
      tone: "bad",
    }),
    ROW("Open source", STENO.openSource, {
      text: "Community edition is MIT; Pro is a separate paid product on a different codebase",
      tone: "neutral",
    }),
    ROW("Transcription", STENO.transcription, {
      text: "On-device (Whisper, Parakeet)",
      tone: "good",
    }),
    ROW("AI summaries", STENO.summaries, {
      text: "Local via an Ollama you install and configure yourself, or your own cloud API key",
      tone: "neutral",
    }),
    ROW("Audio leaves your device", STENO.audio, { text: "Never (local setup)", tone: "good" }),
    ROW("Bot joins your meetings", STENO.bot, { text: "No bot", tone: "good" }),
    ROW("Speaker attribution", {
      text: "Live [You] / [Others] labels — included free",
      tone: "good",
    }, {
      text: "Paid Pro feature (diarization)",
      tone: "bad",
    }),
    ROW("Meeting auto-detect", {
      text: "Included free (calendar integration)",
      tone: "good",
    }, {
      text: "Paid Pro feature",
      tone: "bad",
    }),
    ROW("Chat with your meetings", {
      text: "Included free — ask questions across any note or recording",
      tone: "good",
    }, {
      text: "Paid Pro feature",
      tone: "bad",
    }),
    ROW("Usage limits", STENO.limits, { text: "None", tone: "good" }),
    ROW("Platforms", STENO.platforms, {
      text: "macOS, Windows; Linux build-from-source",
      tone: "neutral",
    }),
  ],
  verdict:
    "If you're choosing between the two open-source local notetakers, the question is simple: Steno ships the whole product free — bundled models, speaker attribution, meeting auto-detect, chat with your meetings — while Meetily reserves its enhanced accuracy, exports, auto-detect, and chat for a $120/year Pro tier.",
  chooseSteno: [
    "You want local summaries working out of the box — Steno bundles Ollama and downloads models in-app, no separate install",
    "You want speaker attribution, meeting auto-detect, and chat with your meetings today, free",
    "You'd rather not manage per-device licenses",
    "You want one codebase you can read end to end — no separate Pro fork",
  ],
  chooseThem: [
    "You're on Linux — Meetily can be built from source there; Steno is macOS/Windows only",
    "You want a paid support relationship with the vendor",
  ],
  faqs: [
    {
      q: "Aren't Steno and Meetily basically the same app?",
      a: "They share a philosophy — open source, on-device transcription, no meeting bot — and even similar engines (Whisper, Parakeet). They differ in what's free: Steno's single free tier includes everything, while Meetily's Community edition sits under a paid Pro product that holds back enhanced accuracy models, advanced exports, custom templates, meeting auto-detect, and chat with your meetings.",
    },
    {
      q: "Do I need to install Ollama to get local AI summaries?",
      a: "With Steno, no — Ollama is bundled inside the app and the models download during first-run setup. With Meetily, local summaries require setting up your own Ollama (or supplying a cloud API key).",
    },
    {
      q: "What does Meetily Pro cost, and what's the Steno equivalent?",
      a: "Meetily Pro is $10/user/month billed annually ($120/year); per their FAQ, each license is valid for one device. The Steno equivalent is the free download: there is no Pro tier, and features Meetily charges Pro for — speaker attribution, meeting auto-detect, chat — are included.",
    },
    {
      q: "Which is more accurate?",
      a: "Both build on the same open ASR family — Whisper and NVIDIA's Parakeet — so baseline accuracy is comparable. Meetily sells “enhanced accuracy models” as a Pro feature; Steno's best models are simply the defaults.",
    },
    {
      q: "Is this comparison fair? You're a competitor.",
      a: `We've tried to be. Every claim here comes from Meetily's public website, pricing page, or GitHub repository as of ${VERIFIED}, and the things Meetily does well — genuine local-first design, open source Community edition, Linux buildability — are stated plainly. If something is out of date, tell us and we'll fix it.`,
    },
  ],
};

export const ALL = [granola, otter, fireflies, meetily];
