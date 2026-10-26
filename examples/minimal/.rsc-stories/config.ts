import { defineConfig } from 'rsc-stories';

export default defineConfig({
  stories: ['src/**/*.stories.tsx'],
  // Unmocked network requests fail the render instead of silently hitting the internet.
  mocks: { strictNetwork: true },
  budgets: { rscPayloadKb: 30, clientJsKbPerStory: 80 },
  env: { allow: ['NEXT_PUBLIC_*'] },
});
