export const meetingsKeys = {
  all: ['meetings'] as const,
  list: () => [...meetingsKeys.all, 'list'] as const,
};
