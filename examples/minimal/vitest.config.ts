import { defineConfig } from 'vitest/config';
import { rscStories } from 'rsc-stories/vitest/plugin';

export default defineConfig({
  plugins: [rscStories()],
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], testTimeout: 120_000, hookTimeout: 180_000 },
});
