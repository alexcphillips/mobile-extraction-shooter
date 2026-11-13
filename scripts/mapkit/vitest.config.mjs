import { defineProject } from 'vitest/config';

export default defineProject({
  // fsModuleCache off, as in the packages' configs: cached modules went stale.
  test: { name: 'mapkit', environment: 'node', fsModuleCache: false },
});
