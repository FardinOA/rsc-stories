import { defineConfig, type Options } from 'tsup';

const shared: Options = {
  format: ['esm'],
  dts: true,
  sourcemap: true,
  treeshake: true,
  splitting: false,
  target: 'es2022',
  // Never bundle a second React or Next: the runtime must use whatever the host project resolves.
  external: [
    'react',
    'react-dom',
    'react/jsx-runtime',
    'next',
    'typescript',
    'playwright',
    'vitest',
    '@playwright/test',
    // Separate module instances on purpose: the client entry carries 'use client', and the mock
    // registry must be shared by every shim.
    'rsc-stories/runtime/client',
    'rsc-stories/runtime/mock',
  ],
};

// No `clean`: the configurations build in parallel and would delete each other's output. The
// build script empties dist/ first.
export default defineConfig([
  {
    ...shared,
    platform: 'neutral',
    entry: {
      index: 'src/index.ts',
      'runtime/server': 'src/runtime/server/index.ts',
      'runtime/mock': 'src/runtime/mock/index.ts',
      'test.server': 'src/test/server.ts',
    },
  },
  {
    ...shared,
    platform: 'browser',
    entry: { 'runtime/client': 'src/runtime/client/index.ts' },
    // Next bundles these components into the client graph; the directive marks the module boundary.
    // Rollup's tree-shaking pass would strip the directive, so esbuild's output is kept as-is.
    treeshake: false,
    banner: { js: "'use client';" },
  },
  {
    ...shared,
    platform: 'browser',
    entry: { test: 'src/test/index.ts' },
  },
  {
    ...shared,
    platform: 'node',
    entry: {
      node: 'src/node/index.ts',
      'next-config': 'src/node/next/next-config.ts',
      vitest: 'src/vitest/index.ts',
      'vitest/global-setup': 'src/vitest/global-setup.ts',
      'vitest/plugin': 'src/vitest/plugin.ts',
      playwright: 'src/playwright/index.ts',
    },
  },
  {
    ...shared,
    platform: 'node',
    dts: false,
    entry: { cli: 'src/cli/index.ts' },
    banner: { js: '#!/usr/bin/env node' },
  },
]);
