import { describe, expect, test } from 'vitest';
import { chatProviderReady, formatActiveModel } from '@/lib/chat';

describe('Local CLI chat provider helpers', () => {
  test('is ready only when a command is configured', () => {
    expect(chatProviderReady({ ai_provider: 'local_cli' })).toBe(false);
    expect(
      chatProviderReady({
        ai_provider: 'local_cli',
        local_cli_configured: true,
      })
    ).toBe(true);
  });

  test('shows the configured name instead of a provider brand', () => {
    const base = {
      ai_provider: 'local_cli' as const,
      cloud_provider: 'openai' as const,
      cloud_model: 'gpt-4o',
      model: 'gemma4:e2b-it-qat',
    };
    expect(formatActiveModel({ ...base, local_cli_name: 'My command' })).toBe('My command');
    expect(formatActiveModel({ ...base, local_cli_name: '' })).toBe('Locally invoked CLI');
  });
});
