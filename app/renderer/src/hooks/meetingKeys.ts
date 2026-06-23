export const meetingsKeys = {
  all: ['meetings'] as const,
  list: () => [...meetingsKeys.all, 'list'] as const,
  detail: (summaryFile: string | null | undefined) =>
    [...meetingsKeys.all, 'detail', summaryFile ?? null] as const,
};
