import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'client', environment: 'node', passWithNoTests: true },
});
