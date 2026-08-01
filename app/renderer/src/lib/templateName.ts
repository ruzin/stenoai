import i18n from '@/lib/i18n';

/*
 * Display name for a report template (#337).
 *
 * Template names are *user data*: built-ins can be overridden and the seeded
 * "Shareable summary" is written into config.json on first run and belongs to
 * the user from then on. So nothing here changes what is stored — the storage
 * stays canonical English, and only the render is localised, the same way the
 * four summary headings are handled.
 *
 * Scope is deliberately narrow. "Product Demo", "Sales Call", "Standup" and
 * "1:1" are left alone because those ARE the terms German speakers use for
 * these meetings; translating "Standup" to "Tagesbesprechung" would be worse
 * German, not better. Only names that read as untranslated English are mapped,
 * which today is the seeded sample.
 *
 * The localised name applies ONLY while the stored name still matches the
 * English source. The moment a user renames the template, their name wins —
 * which is why the comparison is against the English bundle rather than a
 * literal copied into this file, so the two cannot drift.
 */
const LOCALISED_TEMPLATE_IDS: Record<string, string> = {
  'shareable-summary': 'settings.templates.seeded.shareableSummary',
};

export function templateDisplayName(template: { id?: string; name: string }): string {
  const key = template.id ? LOCALISED_TEMPLATE_IDS[template.id] : undefined;
  if (!key) return template.name;
  // Untouched by the user? Then it is still ours to present.
  const englishSource = i18n.getFixedT('en')(key);
  if (template.name !== englishSource) return template.name;
  return i18n.t(key);
}
