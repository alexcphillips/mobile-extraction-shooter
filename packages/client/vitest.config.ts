import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'client',
    environment: 'node',
    passWithNoTests: true,
    // Off (2026-11-03): cached modules keep import.meta.glob's old file lists, so content
    // added since (a new prefab) looked missing. Each package sets it; the root's doesn't reach them.
    fsModuleCache: false,
  },
});
