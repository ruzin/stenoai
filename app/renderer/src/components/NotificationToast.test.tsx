import { describe, it, expect } from 'vitest';
import { AlertCircle, CheckCircle2, Mic, Info } from 'lucide-react';
import { notificationIconMeta } from './NotificationToast';

describe('notificationIconMeta', () => {
  it('returns null for the brand app icon (unset or "app")', () => {
    expect(notificationIconMeta(undefined)).toBeNull();
    expect(notificationIconMeta('app')).toBeNull();
  });

  it('maps alert -> red AlertCircle', () => {
    const meta = notificationIconMeta('alert');
    expect(meta?.Icon).toBe(AlertCircle);
    expect(meta?.className).toContain('red');
  });

  it('maps success -> green CheckCircle2', () => {
    const meta = notificationIconMeta('success');
    expect(meta?.Icon).toBe(CheckCircle2);
    expect(meta?.className).toContain('green');
  });

  it('maps recording -> blue Mic', () => {
    const meta = notificationIconMeta('recording');
    expect(meta?.Icon).toBe(Mic);
    expect(meta?.className).toContain('blue');
  });

  it('falls back to Info for an unknown iconType', () => {
    // @ts-expect-error - intentionally exercising an out-of-contract value
    const meta = notificationIconMeta('bogus');
    expect(meta?.Icon).toBe(Info);
    expect(meta?.className).toContain('gray');
  });
});
