import { expect, type Page } from '@playwright/test';

/**
 * Open the note detail Share menu and return its scoped locator.
 *
 * Entries MUST be queried through the returned locator rather than off `page`:
 * "Copy transcript" is also an AskBar / LiveTranscriptBar control, so an
 * unscoped role query is ambiguous by accessible name.
 */
export async function openShareMenu(page: Page) {
  const menu = page.getByTestId('note-share-menu');
  // A copy entry leaves its "Copied" label up for 800 ms before the menu
  // dismisses itself. Clicking the trigger inside that window would toggle the
  // still-open menu shut, so wait it out instead of racing it.
  await expect(menu).toBeHidden();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(menu).toBeVisible();
  return menu;
}
