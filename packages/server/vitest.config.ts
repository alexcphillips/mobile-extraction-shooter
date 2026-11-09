import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    // Bundles content/ for the server first (src/generated/content.js).
    globalSetup: ['../../scripts/bundle-content.mjs'],
    // Adds the tests' own content (src/test/content.ts) to that bundle.
    setupFiles: ['src/test/setup.ts'],
    // Off, as in the client's config: cached modules went stale.
    fsModuleCache: false,
  },
});
