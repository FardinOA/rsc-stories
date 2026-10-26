import { defineConfig, devices } from '@playwright/test';

const cli = 'node ../../dist/cli.js';

/**
 * End-to-end tests against the three example projects (NFR-7.3), each served by `rsc-stories dev`.
 * Run `pnpm build` first: the examples use the built package.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, trace: 'retain-on-failure' },
  webServer: [
    {
      command: `${cli} dev --port 6201`,
      cwd: 'examples/minimal',
      url: 'http://localhost:6201/__rsc_stories/api/config',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: `${cli} dev --port 6202`,
      cwd: 'examples/commerce',
      url: 'http://localhost:6202/__rsc_stories/api/config',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: `node ../../../../dist/cli.js dev --port 6203`,
      cwd: 'examples/monorepo/apps/web',
      url: 'http://localhost:6203/__rsc_stories/api/config',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
