import { test, expect } from '../fixtures/electron';
import { readFileSync } from 'fs';
import path from 'path';

/**
 * T2 — announcements feed contract. check-announcements reads the repo-root
 * announcements.json (local-first; the remote raw.githubusercontent.com fallback
 * only fires when that file is absent). In dev/e2e the local file is always
 * present, so this is deterministic with NO network. Asserts the parsed shape +
 * that the version is stamped from the app's package.json. The live-update check
 * (check-for-updates → GitHub API) is non-deterministic and stays in manual
 * /verify per the release checklist.
 */

interface Announcement {
  id: string;
  title: string;
  body: string;
}
type AnnouncementsResult = {
  success: boolean;
  announcements?: Announcement[];
  currentVersion?: string;
  error?: string;
};

type StenoWindow = Window & {
  stenoai: { updates: { announcements: () => Promise<AnnouncementsResult> } };
};

test('check-announcements reads the local feed and stamps the package version', async ({
  launchApp,
}) => {
  const { page } = await launchApp();

  const res = await page.evaluate(() =>
    (window as StenoWindow).stenoai.updates.announcements(),
  );

  expect(res.success).toBe(true);
  // Shape: an array of announcements (empty in the checked-in feed) — proves the
  // local-file read + parse path, deterministically, no network.
  expect(Array.isArray(res.announcements)).toBe(true);

  // currentVersion is stamped from app/package.json (the gating field the
  // renderer uses to filter min/max_version).
  const pkgVersion = JSON.parse(
    readFileSync(path.resolve(__dirname, '..', '..', 'app', 'package.json'), 'utf8'),
  ).version;
  expect(res.currentVersion).toBe(pkgVersion);
});
