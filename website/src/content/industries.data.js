// Data for the /enterprise/ industry pages, loaded into the `industries`
// content collection (see ../content.config.ts). See src/content/README.md
// for the compliance-wording policy behind these claims.

// Shared compliance paragraph — one source of truth so the pages can't drift
// into overclaiming. Rendered on every industry page's "Compliance" block.
export const COMPLIANCE_BODY =
  "Steno runs entirely on your device. Your meeting recordings, transcripts, and summaries never reach our servers — there is no third-party processor handling your meeting data, which addresses a meaningful part of HIPAA, GDPR, and data-residency exposure. (Those frameworks also cover safeguards, agreements, and processes that remain your responsibility — no tool hands you compliance.) Steno itself isn't a certified cloud service, because there is no cloud service handling your meetings to certify — and that's the point: the vendor-breach risk that frameworks such as SOC 2 exist to assure against isn't in that path.";

// Short, honest compliance chips shown on industry pages. "-aligned" / "by
// design" / "-friendly" are load-bearing hedges — do not upgrade them to
// "certified" or "compliant".
const CHIPS = {
  hipaa: "HIPAA-friendly by design",
  gdpr: "GDPR-aligned",
  dataResidency: "Nothing leaves the device",
  airGapped: "Runs air-gapped / offline",
  secFinra: "SEC & FINRA-aligned",
  privilege: "Privilege preserved by architecture",
};

const CTA_MAILTO =
  "mailto:chantelle@stenoai.co?subject=Steno%20demo%20request&body=Hi%20Steno%20team%2C%0A%0AWe%27d%20like%20to%20see%20a%20demo.%0A%0AOrganisation%3A%20%0ATeam%20size%3A%20%0AUse%20case%3A%20%0A%0AThanks%2C";

export const government = {
  slug: "government",
  name: "Government",
  metaTitle: "Steno for Government — On-Device Meeting Notes, No Cloud",
  metaDescription:
    "On-device meeting transcription and summaries for government teams — data never leaves your perimeter, runs air-gapped, supports data-residency obligations by architecture. Open source.",
  eyebrow: "Steno for Government",
  h1: "Meeting notes that never leave your perimeter.",
  intro:
    "Briefings, policy discussions, and internal reviews carry information that can't be handed to a cloud vendor. Steno records, transcribes, and summarizes entirely on the device — no third-party processor, no data crossing a border, no records leaving the machine they were captured on.",
  chips: [CHIPS.dataResidency, CHIPS.airGapped, CHIPS.gdpr],
  pains: [
    "Cloud meeting tools route audio through servers outside your control — and often outside your jurisdiction.",
    "A bot joining the call is a participant you can't fully account for in a sensitive briefing.",
    "Retention and access to recordings sit under a vendor's terms, not your records policy.",
  ],
  points: [
    { h: "Data sovereignty", b: "Everything is processed and stored on the device. Nothing transits an external server, so residency and sovereignty obligations are supported by architecture, not a vendor promise." },
    { h: "Works air-gapped", b: "After first-run setup, Steno needs no network. It runs on isolated and offline networks where cloud tools simply can't operate." },
    { h: "No bot in the room", b: "Steno captures system and microphone audio directly — nothing joins the meeting as a participant." },
    { h: "Auditable by design", b: "It's open source. Your security team can read exactly what touches the audio and confirm the no-network claim themselves." },
  ],
  faqs: [
    { q: "Does Steno meet data-residency requirements?", a: "Because processing and storage happen on the device and nothing is uploaded, your data never leaves the machine — or the jurisdiction it's in. There is no cloud region to configure and no cross-border transfer to account for." },
    { q: "Can it run on an isolated or air-gapped network?", a: "Yes. Once the models are downloaded during first-run setup, recording, transcription, and summarization all run offline. Steno makes no network requests with your meeting content." },
    { q: "How do we verify what it does?", a: "Steno is open source (MIT). Your team can audit the code, build it from source, and confirm exactly what it does and doesn't send before deploying." },
  ],
};

export const defense = {
  slug: "defense",
  name: "Defense",
  metaTitle: "Steno for Defense — Air-Gapped, On-Device Meeting Notes",
  metaDescription:
    "Meeting transcription and summaries that run fully offline and air-gapped on your own hardware. Nothing transits an external server — designed for air-gapped, local-only deployments. Open source.",
  eyebrow: "Steno for Defense",
  h1: "Built for the discussions that can't touch a cloud.",
  intro:
    "Operational planning and sensitive discussions run on hardware you control, on networks you control. Steno does the entire pipeline — capture, transcription, summary — on the device, offline, with nothing transiting an external server. It's designed for air-gapped, local-only deployments — the environment cloud notetakers structurally can't serve. (Accreditation for any specific classified environment is a function of your own deployment and authorization process, not the app alone.)",
  chips: [CHIPS.airGapped, CHIPS.dataResidency],
  pains: [
    "Cloud transcription is a non-starter when the audio can't leave the enclave.",
    "SaaS meeting assistants require connectivity and a vendor relationship you can't extend to classified work.",
    "A meeting bot is an external participant — unacceptable in an operational context.",
  ],
  points: [
    { h: "Fully offline", b: "No network dependency after setup. Steno runs on air-gapped and disconnected systems where SaaS tools cannot." },
    { h: "Nothing leaves the device", b: "Audio, transcripts, and summaries stay on the machine. There is no upload path and no vendor in the data flow." },
    { h: "On-device models", b: "Transcription (Parakeet, Whisper) and summarization run locally on your hardware — no external inference service is ever called." },
    { h: "Open and inspectable", b: "MIT-licensed source your security authority can review and build in a controlled environment." },
  ],
  faqs: [
    { q: "Can Steno run in an air-gapped environment?", a: "Yes — that's a primary design target. After the one-time model download, everything runs with no network connection at all." },
    { q: "Is any data ever sent to Steno's servers?", a: "No. Steno makes no network calls with your meeting content. Recordings, transcripts, and summaries are ordinary files in local storage on your device." },
    { q: "Can we review and control the build?", a: "Yes. It's open source, so it can be audited and built from source in your own environment before deployment." },
  ],
};

export const legal = {
  slug: "legal",
  name: "Legal",
  metaTitle: "Steno for Legal — Privileged, On-Device Meeting Notes",
  metaDescription:
    "Keep client calls and case strategy privileged — Steno records, transcribes, and summarizes entirely on the device, with no third-party processor in the chain of custody. Open source.",
  eyebrow: "Steno for Legal",
  h1: "Privileged conversations that stay privileged.",
  intro:
    "Client calls, case strategy, and internal deliberations are privileged — and privilege is easiest to defend when the material never left your control. Steno keeps every recording, transcript, and summary on the device, with no third-party processor able to touch or be compelled to produce it.",
  chips: [CHIPS.privilege, CHIPS.gdpr, CHIPS.dataResidency],
  pains: [
    "Routing privileged audio through a cloud vendor introduces a third party into the chain of custody.",
    "Vendor-held recordings can become a discovery and retention liability.",
    "A notetaker bot joining a client call is hard to reconcile with confidentiality obligations.",
  ],
  points: [
    { h: "Privilege by architecture", b: "Because the audio never reaches a third party, there's no external processor to weaken a privilege claim — it's enforced by how the tool works, not a policy checkbox." },
    { h: "Chain of custody stays intact", b: "Recordings and transcripts are local files under your control and your retention policy, not a vendor's terms." },
    { h: "No bot on the call", b: "Steno captures audio directly, so nothing joins a client meeting as a participant." },
    { h: "Verifiable", b: "Open source, so confidentiality can be confirmed by inspection rather than taken on trust." },
  ],
  faqs: [
    { q: "Does using Steno introduce a third party to privileged material?", a: "No. Everything is processed and stored on the device; no recording, transcript, or summary is sent to us or any other service. There is no third-party processor in the chain of custody." },
    { q: "Where are recordings stored, and under whose terms?", a: "In local app storage on your device, under your retention policy — not a vendor's cloud or terms of service." },
    { q: "Can both sides of a video call be transcribed without a bot?", a: "Yes. Steno captures system and microphone audio simultaneously, so a Zoom, Teams, or Meet call is transcribed with nothing joining the meeting." },
  ],
};

export const healthcare = {
  slug: "healthcare",
  name: "Healthcare",
  metaTitle: "Steno for Healthcare — HIPAA-Friendly, On-Device Meeting Notes",
  metaDescription:
    "Clinical meeting notes where PHI never leaves the device. Steno transcribes and summarizes on-device — HIPAA-friendly by design, no business associate, no cloud. Open source.",
  eyebrow: "Steno for Healthcare",
  h1: "Clinical notes where PHI never leaves the device.",
  intro:
    "Consultations, care-team discussions, and clinical supervision involve protected health information that shouldn't be handed to a third party. Steno transcribes and summarizes entirely on-device, so PHI stays with you — supporting your HIPAA obligations instead of expanding them.",
  chips: [CHIPS.hipaa, CHIPS.dataResidency, CHIPS.gdpr],
  pains: [
    "Cloud transcription means PHI is transmitted to and stored by a vendor — a business-associate relationship you have to paper and trust.",
    "Every additional processor is another entity in scope for a breach.",
    "A bot in a patient consultation is a privacy problem before it's a product feature.",
  ],
  points: [
    { h: "PHI stays on-device", b: "Recordings, transcripts, and summaries never leave the machine. Because no PHI is transmitted to us, Steno isn't a business associate touching your patient data." },
    { h: "Supports HIPAA by design", b: "The surest way to keep PHI out of third-party hands is to never send it anywhere. Steno's local-only pipeline does exactly that." },
    { h: "No bot in the consult", b: "Audio is captured directly on the device — nothing joins the appointment." },
    { h: "Inspectable", b: "Open source, so a compliance or security team can verify how PHI is handled rather than trust a badge." },
  ],
  faqs: [
    { q: "Is Steno HIPAA compliant?", a: "HIPAA compliance is a property of your overall environment, not a single app — so no tool can hand you compliance. What Steno does is keep PHI entirely on the device: nothing is transmitted to us, so there's no third-party processor and no business-associate exposure through Steno. That makes it a strong fit for a HIPAA-conscious workflow. We don't claim to be a certified service, because there's no cloud service to certify." },
    { q: "Do you sign a Business Associate Agreement (BAA)?", a: "A BAA covers a vendor that handles your PHI. Steno never receives PHI — it all stays on your device — so there's no PHI-handling relationship for a BAA to govern. That absence is the privacy benefit, not a gap." },
    { q: "Where do recordings and transcripts live?", a: "In local app storage on your device only. Nothing is synced to a server, which also means no cloud backup — export anything you need to retain." },
  ],
};

export const finance = {
  slug: "finance",
  name: "Finance",
  metaTitle: "Steno for Financial Services — On-Device Meeting Notes",
  metaDescription:
    "On-device meeting transcription for banking and investment teams. MNPI and client discussions stay local, under your retention and supervision controls — SEC & FINRA-aligned. Open source.",
  eyebrow: "Steno for Financial Services",
  h1: "Deal rooms and client calls that stay in the building.",
  intro:
    "Investment discussions, client meetings, and internal reviews carry material, non-public information that can't sit on a third party's servers. Steno records, transcribes, and summarizes on-device, keeping sensitive discussion inside your controls and out of a vendor's cloud.",
  chips: [CHIPS.secFinra, CHIPS.dataResidency, CHIPS.gdpr],
  pains: [
    "Cloud meeting tools place MNPI and client data in a vendor's hands and jurisdiction.",
    "Supervision and record-keeping obligations are harder to meet when the record lives under someone else's terms.",
    "A third-party processor is one more surface in scope for a data incident.",
  ],
  points: [
    { h: "MNPI stays local", b: "Material non-public information never leaves the device — there's no external processor holding your deal or client discussions." },
    { h: "SEC & FINRA-aligned", b: "Records stay under your retention and supervision controls, on your systems, rather than a vendor's cloud and terms." },
    { h: "No bot, no leak", b: "Audio is captured on-device with nothing joining the call as a participant." },
    { h: "Auditable", b: "Open source, so controls can be verified by your risk and security teams." },
  ],
  faqs: [
    { q: "Does Steno support SEC / FINRA record-keeping?", a: "Steno keeps recordings and transcripts as local files under your own retention and supervision controls, rather than in a vendor's cloud. It aligns with keeping records inside your governed environment — how you retain and supervise them remains your firm's process, which is exactly where those obligations should sit." },
    { q: "Does material non-public information ever leave our systems?", a: "No. Transcription and summarization run on-device, and nothing is uploaded. MNPI discussed in a meeting stays on the machine that captured it." },
    { q: "Can our security team verify the controls?", a: "Yes — Steno is open source, so its data handling can be audited and the no-network behavior confirmed before deployment." },
  ],
};

export const executive = {
  slug: "executive",
  name: "Executive",
  metaTitle: "Steno for Executives — Private Board & M&A Meeting Notes",
  metaDescription:
    "Board prep, M&A, and exec offsites captured entirely on the device — no cloud, no bot, no vendor holding your most sensitive strategy discussions. Open source.",
  eyebrow: "Steno for Executives",
  h1: "Board prep and M&A talks that never leave the room.",
  intro:
    "The conversations that decide a company's direction — board prep, M&A, exec offsites, restructurings — are the ones you least want on a third party's servers. Steno keeps them on the device they're held on, with no cloud, no bot, and no vendor in the loop.",
  chips: [CHIPS.dataResidency, CHIPS.gdpr, CHIPS.privilege],
  pains: [
    "Cloud notetakers put your most sensitive strategy discussions in a vendor's hands.",
    "A recording of an M&A or board conversation held by a third party is a real exposure.",
    "A bot in an executive session is a leak risk and a trust problem.",
  ],
  points: [
    { h: "Strategy stays private", b: "Board, M&A, and offsite discussions are processed and stored on the device — never uploaded, never held by a vendor." },
    { h: "No third party in the loop", b: "There's no external processor to trust, subpoena, or breach. The material stays where the conversation happened." },
    { h: "No bot in the session", b: "Steno captures audio directly, so nothing joins an executive meeting as a participant." },
    { h: "Verifiable discretion", b: "Open source, so the confidentiality claim can be checked, not just believed." },
  ],
  faqs: [
    { q: "Who can access a recording of a board or M&A discussion?", a: "Only you. Recordings and transcripts are local files on the device — there is no vendor copy in a cloud, so no third party holds or can be compelled to produce your executive discussions through Steno." },
    { q: "Does anything sync to the cloud?", a: "No. Everything stays on the device. That means full privacy and also no cloud backup — export anything you need to keep." },
    { q: "Can it capture a remote board call without a bot?", a: "Yes. Steno records system and microphone audio locally, so both sides of a call are transcribed with nothing joining the meeting." },
  ],
};

export const ALL = [government, defense, legal, healthcare, finance, executive];
export { CTA_MAILTO };
