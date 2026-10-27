import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    // Bundles content/ for the server first (src/generated/content.js).
    globalSetup: ['../../scripts/bundle-content.mjs'],
  },
});
