import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      'rsc-stories/runtime/client': path.resolve('src/runtime/client/index.ts'),
      'rsc-stories/runtime/mock': path.resolve('src/runtime/mock/index.ts'),
      'rsc-stories/runtime/server': path.resolve('src/runtime/server/index.ts'),
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    restoreMocks: true,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      // The UI, the CLI entry and process orchestration are covered by the e2e suite (e2e/),
      // which drives them through a real Next.js app; type-only modules have no lines.
      exclude: [
        'src/ui/**',
        'src/cli/**',
        'src/types.ts',
        // Barrel files: re-exports only.
        'src/index.ts',
        'src/node/index.ts',
        'src/runtime/server/index.ts',
        'src/runtime/client/index.ts',
        'src/runtime/mock/index.ts',
        'src/node/server/server.ts',
        'src/node/next/host.ts',
        'src/node/production.ts',
        'src/node/commands/dev.ts',
        'src/node/commands/serve.ts',
        'src/node/commands/build.ts',
        'src/playwright/**',
        'src/vitest/global-setup.ts',
        'src/runtime/client/bridge.tsx',
        'src/runtime/client/overlays.ts',
      ],
      thresholds: { lines: 85 },
    },
  },
});
