// e2e/specs/templates-crud.t2.spec.ts
import { test, expect } from '../fixtures/electron';
import { readUserConfig } from '../fixtures/user-config';

type Tmpl = { id: string; name: string; builtin: boolean; locked: boolean };
type ListResult = { success: boolean; templates: Tmpl[]; default_template_id: string };
type SaveResult = { success: boolean; template?: { id: string }; error?: string };
type Result = { success?: boolean };

type StenoWindow = Window & {
  stenoai: {
    templates: {
      list: () => Promise<ListResult>;
      save: (t: Record<string, unknown>) => Promise<SaveResult>;
      remove: (id: string) => Promise<Result>;
      setDefault: (id: string) => Promise<Result>;
      reset: (id: string) => Promise<Result>;
    };
  };
};

test('templates: list ships Standard + seeded sample; default is Standard', async ({
  launchApp, userDataDir,
}) => {
  const { page } = await launchApp();
  const data = await page.evaluate(() =>
    (window as unknown as StenoWindow).stenoai.templates.list());
  expect(data.success).toBe(true);
  const ids = data.templates.map((t) => t.id);
  expect(ids).toContain('standard');
  expect(ids).toContain('shareable-summary');
  expect(data.default_template_id).toBe('standard');
  // standard is a locked built-in
  expect(data.templates.find((t) => t.id === 'standard')?.locked).toBe(true);
});

test('templates: create custom, set default, delete; persisted to config.json', async ({
  launchApp, userDataDir,
}) => {
  const { page } = await launchApp();
  const win = () => (window as unknown as StenoWindow).stenoai.templates;

  const saved = await page.evaluate(() =>
    (window as unknown as StenoWindow).stenoai.templates.save({
      name: 'Leitung', prompt: 'kurz halten', language: 'de',
    }));
  expect(saved.success).toBe(true);
  const id = saved.template!.id;

  await page.evaluate((tid) =>
    (window as unknown as StenoWindow).stenoai.templates.setDefault(tid), id);

  await expect.poll(() => readUserConfig(userDataDir).default_template_id).toBe(id);
  expect(readUserConfig(userDataDir).custom_templates).toEqual(
    expect.arrayContaining([expect.objectContaining({ id, prompt: 'kurz halten' })]),
  );

  await page.evaluate((tid) =>
    (window as unknown as StenoWindow).stenoai.templates.remove(tid), id);
  await expect
    .poll(() => (readUserConfig(userDataDir).custom_templates as Tmpl[]).map((t) => t.id))
    .not.toContain(id);
  // deleting the default falls back to standard
  await expect.poll(() => readUserConfig(userDataDir).default_template_id).toBe('standard');
});

test('templates: locked Standard rejects an edit', async ({ launchApp }) => {
  const { page } = await launchApp();
  const res = await page.evaluate(() =>
    (window as unknown as StenoWindow).stenoai.templates.save({
      id: 'standard', name: 'X', prompt: 'hack', language: 'auto',
    }));
  expect(res.success).toBe(false);
  expect((res.error ?? '').toLowerCase()).toContain('locked');
});
