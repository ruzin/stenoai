import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const isMac =
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);

/**
 * Render a keyboard shortcut for the current platform. Pass mac glyphs and a
 * non-mac fallback; we pick the right one at call time. The Electron main
 * accelerator already auto-maps CommandOrControl, so this is purely cosmetic.
 */
export function shortcut(mac: string, other: string): string {
  return isMac ? mac : other;
}
