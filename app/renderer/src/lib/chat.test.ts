import { describe, expect, test } from 'vitest';
import { chatProviderReady, formatActiveModel } from '@/lib/chat';

describe('Local CLI chat provider helpers', () => {
  test('is ready without an API key or Ollama URL', () => {
    expect(chatProviderReady({ ai_provider: 'local_cli' })).toBe(true);
  });

  test('shows the selected CLI instead of an Ollama/cloud model', () => {
    const base = {
      ai_provider: 'local_cli' as const,
      cloud_provider: 'openai' as const,
      cloud_model: 'gpt-4o',
      model: 'gemma4:e2b-it-qat',
    };
    expect(formatActiveModel({ ...base, local_cli_provider: 'codex' })).toBe('Codex CLI');
    expect(formatActiveModel({ ...base, local_cli_provider: 'claude' })).toBe('Claude CLI');
  });
});
