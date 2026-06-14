import { test, expect } from '../fixtures/electron';
import { realUserDataDir, fileSig } from '../fixtures/real-user-data';
import { writeUserConfig, writeMeetingSummary } from '../fixtures/user-config';
import { startMockOllama } from '../fixtures/mock-ollama';
import { readFileSync } from 'fs';

/**
 * T2 @contract — summarisation prompt-build + response-parse contract. Drives the
 * real `reprocess` path (re-summarise an existing transcript — NO ASR, NO real
 * model) with a capturing mock Ollama, and asserts the two halves of the
 * summariser's contract deterministically:
 *   1. prompt-build: the prompt the backend sent to the LLM embedded the
 *      transcript text.
 *   2. response-parse: a fixed markdown reply was parsed into the summary schema
 *      (summary / key_points / action_items) and written back to *_summary.json.
 *
 * Model-free: the transcript is pre-seeded and the LLM is the mock, so no model
 * loads. Tagged @contract for documentation; runs in the model-free t2 jobs.
 */

const TRANSCRIPT =
  'Alice: we ship the release on Friday. Bob: the budget is fifty thousand dollars.';

// A fixed assistant reply in the exact markdown the parser keys on
// (## Summary / ## Key Points / ## Action Items — simple_recorder.py
// _parse_streamed_markdown).
const FIXED_REPLY = [
  '## Summary',
  'The team agreed to ship on Friday within budget.',
  '',
  '## Key Points',
  '- Ship date is Friday',
  '- Budget is fifty thousand',
  '',
  '## Action Items',
  '- Alice to finalize the release',
  '- Bob to confirm the budget',
  '',
].join('\n');

type ReprocessResult = { success: boolean; error?: string };
type StenoWindow = Window & {
  stenoai: {
    meetings: {
      reprocess: (summaryFile: string, regenTitle: boolean, name: string) => Promise<ReprocessResult>;
    };
  };
};

const readSummary = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

test('@contract reprocess builds a transcript-bearing prompt and parses the reply into the summary schema', async ({
  launchApp,
  userDataDir,
}) => {
  const realDirBefore = fileSig(realUserDataDir());

  // Local provider so the summarizer talks to the mock Ollama on 11434.
  writeUserConfig(userDataDir, { ai_provider: 'local' });
  const summaryFile = writeMeetingSummary(userDataDir, 'contract', {
    name: 'Contract Meeting',
    summary: 'STALE summary that reprocess must replace',
    transcript: TRANSCRIPT,
  });

  const ollama = await startMockOllama({ chatReply: FIXED_REPLY });
  try {
    const { page } = await launchApp();

    const res = await page.evaluate(
      (f) => (window as StenoWindow).stenoai.meetings.reprocess(f, false, 'Contract Meeting'),
      summaryFile,
    );
    expect(res.success).toBe(true);

    // reprocess streams + writes the file at STREAM_COMPLETE — poll until the
    // stale summary is replaced by the parsed reply.
    await expect
      .poll(() => readSummary(summaryFile).summary, { timeout: 30_000 })
      .toBe('The team agreed to ship on Friday within budget.');

    // Response-parse contract: bullets parsed into the right arrays.
    const updated = readSummary(summaryFile);
    expect(updated.key_points).toEqual(['Ship date is Friday', 'Budget is fifty thousand']);
    expect(updated.action_items).toEqual([
      'Alice to finalize the release',
      'Bob to confirm the budget',
    ]);

    // Prompt-build contract: the prompt the backend sent embedded the transcript.
    const prompt = ollama.lastChatPrompt();
    expect(prompt).toBeTruthy();
    expect(prompt).toContain('we ship the release on Friday');
    expect(prompt).toContain('budget is fifty thousand');

    // Exactly one summarise call (regenTitle=false → no separate title call) —
    // pins that reprocess didn't double-summarise.
    expect(ollama.chatCalls()).toBe(1);

    // Keystone: the real user-data dir is byte-for-byte untouched.
    expect(fileSig(realUserDataDir())).toBe(realDirBefore);
  } finally {
    await ollama.close();
  }
});
