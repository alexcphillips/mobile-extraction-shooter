import { vi } from 'vitest';

// Every server test sees the bundled content plus the tests' own (test/content.ts).
vi.mock('../generated/content.js', async (importOriginal) => {
  const { default: files } = await importOriginal<{ default: Record<string, unknown> }>();
  const { testContent } = await import('./content');
  return { default: { ...files, ...testContent } };
});
