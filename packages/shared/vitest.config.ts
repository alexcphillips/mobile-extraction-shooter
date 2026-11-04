import { defineProject } from 'vitest/config';

export default defineProject({
  // fsModuleCache off, as in the client's config: cached modules went stale.
  test: { name: 'shared', environment: 'node', fsModuleCache: false },
});
