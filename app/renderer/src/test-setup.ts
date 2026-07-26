/*
 * Vitest setup. Initialises i18next for every renderer unit test.
 *
 * In the real app this happens because main.tsx imports lib/i18n before it
 * mounts React. A unit test renders a component directly, so nothing pulls that
 * module in — and an uninitialised react-i18next returns the key instead of the
 * string, which would turn every existing English assertion into a failure
 * against text like "settings.general.title".
 *
 * The bootstrap has no window.stenoai bridge here, so it falls back to English,
 * which is what the existing assertions expect.
 */
import '@/lib/i18n';
