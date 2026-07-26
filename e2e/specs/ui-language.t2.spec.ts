import { test, expect } from '../fixtures/electron';
import { readUserConfig, writeUserConfig } from '../fixtures/user-config';

/**
 * T2 — interface language (#337).
 *
 * Model-free: drives the real backend's ui-language IPC and asserts the value
 * lands on the right `config.json` key, then relaunches to prove the language
 * is resolved BEFORE first paint rather than applied afterwards.
 *
 * That ordering is the part worth a test. A round-trip alone would still pass
 * if the app painted English and then flipped to German a frame later, which is
 * exactly the flash the launch-argument bootstrap exists to prevent.
 *
 * Note these specs override `STENOAI_UI_LANGUAGE`, which the shared fixture
 * pins to 'en' for every other spec in the suite.
 */

type UiLanguageBridge = {
  uiLanguage: string;
  settings: {
    getUiLanguage: () => Promise<{
      success: boolean;
      ui_language?: string;
      resolved?: string;
    }>;
    setUiLanguage: (code: string) => Promise<{
      success: boolean;
      ui_language?: string;
      resolved?: string;
      error?: string;
    }>;
  };
};
type StenoWindow = Window & { stenoai: UiLanguageBridge };

test('set-ui-language persists to config.json and reports the resolved tag', async ({
  launchApp,
  userDataDir,
}) => {
  const { page } = await launchApp();

  const result = await page.evaluate(
    () => (window as unknown as StenoWindow).stenoai.settings.setUiLanguage('de'),
  );
  expect(result.success).toBe(true);
  expect(result.resolved).toBe('de');

  // The write goes through the Python config's atomic/locked persistence, so
  // asserting the file is asserting the real storage path, not a JS shortcut.
  expect(readUserConfig(userDataDir).ui_language).toBe('de');

  const readBack = await page.evaluate(
    () => (window as unknown as StenoWindow).stenoai.settings.getUiLanguage(),
  );
  expect(readBack.ui_language).toBe('de');
  expect(readBack.resolved).toBe('de');
});

test('an unsupported language is rejected and leaves the stored value alone', async ({
  launchApp,
  userDataDir,
}) => {
  const { page } = await launchApp();

  await page.evaluate(() =>
    (window as unknown as StenoWindow).stenoai.settings.setUiLanguage('de'),
  );
  const rejected = await page.evaluate(
    () => (window as unknown as StenoWindow).stenoai.settings.setUiLanguage('klingon'),
  );

  expect(rejected.success).toBe(false);
  // The running UI must not switch to something that would not survive a
  // restart, so the stored value stays where it was.
  expect(readUserConfig(userDataDir).ui_language).toBe('de');
});

test('a stored German preference is in force at first paint, not applied after it', async ({
  launchApp,
  userDataDir,
}) => {
  // Seed before launch so the app reads it during startup, the way a returning
  // user's config would be read.
  writeUserConfig(userDataDir, { ui_language: 'de' });

  // Clear the suite-wide English pin for this spec only.
  const { page } = await launchApp({ env: { STENOAI_UI_LANGUAGE: '' } });

  // The launch argument is what the renderer bootstraps i18next from. If this
  // is right, no English frame was ever rendered — the alternative design (ask
  // main over IPC after mount) could not satisfy this assertion.
  const bootstrap = await page.evaluate(
    () => (window as unknown as StenoWindow).stenoai.uiLanguage,
  );
  expect(bootstrap).toBe('de');

  // Set synchronously by lib/i18n.ts at module scope, before React mounts.
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
});

test('an existing config without the key keeps English rather than following the OS', async ({
  launchApp,
  userDataDir,
}) => {
  // The migration case the whole design turns on: this install has been showing
  // an English UI, and an upgrade must not silently switch it just because the
  // machine's OS language is not English.
  writeUserConfig(userDataDir, { model: 'gemma4:e4b-it-qat' });

  const { page } = await launchApp({ env: { STENOAI_UI_LANGUAGE: '' } });

  const bootstrap = await page.evaluate(
    () => (window as unknown as StenoWindow).stenoai.uiLanguage,
  );
  expect(bootstrap).toBe('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
