import { defineConfig } from 'rsc-stories';

export default defineConfig({
  // Stories live in the shared UI package; the workshop runs through this app's Next.js.
  stories: ['../../packages/ui/src/**/*.stories.tsx'],
  mocks: { strictNetwork: true },
});
