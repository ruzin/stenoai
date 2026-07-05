import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { writeUserConfig } from '../fixtures/user-config';
import { startMockOllama } from '../fixtures/mock-ollama';
import { readFileSync } from 'fs';

/**
 * T2 — decoupled transcription / summarisation (Parakeet Granola-style flow).
 *
 * Drives the model-free half of the feature through the preload bridge and
 * asserts backend state on disk:
 *   1. `recording.saveTranscriptNote` persists a transcript-only note
 *      (`summary_status: pending`, a `## Transcript`, NO summary) — no ASR,
 *      no enqueue, no model.
 *   2. `list-meetings` surfaces it as pending with a transcript.
 *   3. "Generate notes" = `reprocess` (a capturing mock Ollama) fills the
 *      summary in place and the pending marker is dropped.
 *
 * Model-free: the transcript is passed in (the renderer owns the live
 * transcript), and the LLM is the mock, so nothing loads. Runs in the
 * model-free t2 jobs.
 */

const TRANSCRIPT = '[00:03] [You] we ship on Friday\n[00:06] [Others] the budget is fifty thousand';

// A fixed assistant reply in the markdown the parser keys on
// (## Summary / ## Key Points / ## Action Items).
const FIXED_REPLY = [
  '## Summary',
  'The team agreed to ship on Friday within budget.',
  '',
  '## Key Points',
  '- Ship date is Friday',
  '',
  '## Action Items',
  '- Confirm the budget',
  '',
].join('\n');

interface SaveResult {
  success: boolean;
  summaryFile?: string;
  error?: string;
}
interface MeetingListItem {
  session_info: { summary_file: string; summary_status?: string };
  has_transcript?: boolean;
}
type StenoWindow = Window & {
  stenoai: {
    recording: {
      saveTranscriptNote: (payload: {
        name: string;
        transcript: string;
        durationSeconds: number;
        language?: string;
        isDiarised: boolean;
      }) => Promise<SaveResult>;
    };
    meetings: {
      list: () => Promise<{ success: boolean; meetings: MeetingListItem[] }>;
      reprocess: (summaryFile: string, regenTitle: boolean, name: string) => Promise<{ success: boolean }>;
    };
  };
};

test('save-transcript-note persists a pending note; generate-notes (reprocess) summarises it', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());

  // Local provider so reprocess's summariser talks to the mock Ollama on 11434.
  writeUserConfig(userDataDir, { ai_provider: 'local' });

  const ollama = await startMockOllama({ chatReply: FIXED_REPLY });
  try {
    const { page } = await launchApp();

    // 1. Persist a transcript-only note.
    const save = await page.evaluate(
      (transcript) =>
        (window as StenoWindow).stenoai.recording.saveTranscriptNote({
          name: 'New note',
          transcript,
          durationSeconds: 8,
          language: 'en',
          isDiarised: true,
        }),
      TRANSCRIPT,
    );
    expect(save.success).toBe(true);
    const summaryFile = save.summaryFile!;
    expect(summaryFile).toBeTruthy();
    expect(summaryFile.endsWith('_summary.md')).toBe(true);

    // On disk: pending marker + the labelled transcript, and NO summary section.
    const pendingBody = readFileSync(summaryFile, 'utf8');
    expect(pendingBody).toContain('summary_status: "pending"');
    expect(pendingBody).toContain('## Transcript');
    expect(pendingBody).toContain('[00:03] [You] we ship on Friday');
    expect(pendingBody).toContain('[00:06] [Others] the budget is fifty thousand');
    expect(pendingBody).not.toContain('## Summary');

    // 2. It lists as a pending note that has a transcript.
    const list = await page.evaluate(() => (window as StenoWindow).stenoai.meetings.list());
    expect(list.success).toBe(true);
    const listed = list.meetings.find((m) => m.session_info.summary_file === summaryFile);
    expect(listed, 'the transcript-only note should appear in the meetings list').toBeTruthy();
    expect(listed!.session_info.summary_status).toBe('pending');
    expect(listed!.has_transcript).toBe(true);

    // 3. Generate notes = reprocess. Fills the summary; drops the pending marker.
    const res = await page.evaluate(
      (f) => (window as StenoWindow).stenoai.meetings.reprocess(f, false, 'New note'),
      summaryFile,
    );
    expect(res.success).toBe(true);

    await expect
      .poll(() => readFileSync(summaryFile, 'utf8'), { timeout: 30_000 })
      .toContain('The team agreed to ship on Friday within budget.');

    const doneBody = readFileSync(summaryFile, 'utf8');
    // Pending marker gone (reprocess rewrites frontmatter without it) and the
    // transcript survives.
    expect(doneBody).not.toContain('summary_status:');
    expect(doneBody).toContain('## Transcript');
    expect(doneBody).toContain('[00:03] [You] we ship on Friday');

    // Prompt-build contract: the summariser saw the transcript text.
    const prompt = ollama.lastChatPrompt();
    expect(prompt).toContain('we ship on Friday');

    // Keystone: the real user-data dir is byte-for-byte untouched.
    expect(fileSig(realUserDataDir())).toBe(realDirBefore);
  } finally {
    await ollama.close();
  }
});
