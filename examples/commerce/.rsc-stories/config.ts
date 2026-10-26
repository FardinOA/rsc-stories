import { defineConfig } from 'rsc-stories';

export default defineConfig({
  stories: ['src/**/*.stories.tsx'],
  mocks: {
    strictNetwork: true,
    // Every story gets exchange rates unless it overrides them.
    fetch: [
      {
        name: 'rates',
        match: 'GET https://api.frankfurter.app/latest',
        response: { amount: 1, base: 'USD', rates: { EUR: 0.92, GBP: 0.79, JPY: 151.2 } },
      },
    ],
  },
  budgets: { rscPayloadKb: 40, clientJsKbPerStory: 100, serverRenderMs: 8000 },
  env: { allow: ['NEXT_PUBLIC_*'] },
});
