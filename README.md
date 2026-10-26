# RSC Stories

A component workshop for the **Next.js App Router**. Develop, document and test async **React
Server Components** in isolation — rendered by your own Next.js, with mocked data — and see
exactly what crosses the server → client boundary.

```tsx
// OrderSummary.stories.tsx
import type { Meta, StoryObj } from 'rsc-stories';
import { OrderSummary } from './OrderSummary'; // async: reads the database and cookies

const meta = {
  component: OrderSummary,
  mocks: {
    modules: { '@/lib/db': { orders: { findById: async (id: string) => ({ id, status: 'paid', lines: [] }) } } },
    next: { cookies: { locale: 'en-GB' } },
  },
} satisfies Meta<typeof OrderSummary>;
export default meta;

export const Default: StoryObj<typeof meta> = { args: { orderId: 'ord_123' } };
export const SlowDatabase: StoryObj<typeof meta> = { args: { orderId: 'ord_123' }, mocks: { latency: { '@/lib/db': 3000 } } };
```

## Quick start

```sh
npm install --save-dev rsc-stories
npx rsc-stories init     # .rsc-stories/config.ts, preview.tsx, an example story, package scripts
npx rsc-stories dev      # http://localhost:6006
```

Requires Next.js 15 or 16 (App Router), React 19 and Node.js 20+. Works with Turbopack and webpack.

## What it does

- **Real rendering.** Stories render through your installed Next.js — a server render, a streamed
  RSC payload, Suspense, hydration. No second React, no simulated server.
- **Server-side mocks, per story.** Modules (database clients, SDKs), `fetch`, `cookies()`,
  `headers()`, search params, `useRouter()`/`redirect()`/`notFound()`, latency, switchable variants —
  isolated per render, so concurrent stories never share state. Unmocked requests are reported, or
  blocked with `strictNetwork`.
- **The Boundary Inspector.** The component tree marked Server / Client / Shared, the serialized
  props at every boundary, non-serializable props before they bite, client JavaScript per
  component, Client Components that did not need to be (client leaks), a render timeline,
  hydration diffs and the raw payload.
- **Stories as tests.** `rsc-stories test` renders every story from a production build and
  snapshots its HTML and RSC payload — deterministic across machines, bundlers, and dev vs.
  production — with budgets for payload size, client JS and render time. `--browser` hydrates each
  story in Chromium and runs its `play` function. Plus `renderStory()` for Vitest and a Playwright
  fixture.
- **Familiar format.** Component Story Format: `args`, `argTypes`, `decorators`, `parameters`,
  `play`, `tags`. `rsc-stories migrate` converts Storybook files.
- **Static builds** for design review: `rsc-stories build`.

## How it compares

|                                  | RSC Stories                                                        | Storybook (`@storybook/nextjs`)                        |
| -------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| Async Server Components          | Rendered on the server by your Next.js                             | Experimental RSC mode renders them in the browser      |
| What a story exercises           | RSC payload, streaming, Server Actions, hydration — as in your app | Client render of the component tree                    |
| Data mocking                     | Server-side, per render: modules, `fetch`, Next.js APIs            | Module mocking and MSW in the browser                  |
| Server/client boundary insight   | Inspector: serialized props, client JS per component, client leaks | —                                                      |
| Snapshot tests                   | Server HTML + RSC payload, deterministic                           | Via Storybook Test / Vitest, and Chromatic for visuals |
| Docs pages, MDX, addon ecosystem | Not supported / small addon API                                    | Mature                                                 |
| Frameworks                       | Next.js App Router only                                            | Many                                                   |

They coexist: keep Storybook for client-only design systems and its addons; use RSC Stories for
the server half of an App Router codebase.

## Measured

Benchmark with 217 stories (200 generated across 40 files, plus the minimal example), `rsc-stories
dev` on Turbopack, Next.js 16.4, Apple M2 / 16 GB, Node 24 — `node scripts/bench.mjs`:

|                                                         | Result                    | Target    |
| ------------------------------------------------------- | ------------------------- | --------- |
| Cold start (index of 217 stories served)                | 0.7 s (ready at 0.5 s)    | ≤ 5 s     |
| Story switch, compiled, to first paint of the story     | 47 ms median, 52 ms p95   | ≤ 300 ms  |
| Hot reload after a component edit                       | 116 ms median, 120 ms p95 | ≤ 1 s p95 |
| `rsc-stories test`, 200 stories, including `next build` | 8.8 s                     | ≤ 60 s    |
| Workshop UI JavaScript                                  | 90.8 kB min+gzip          | ≤ 150 kB  |

Payload fidelity: the conformance suite renders pages of the example apps with `next build && next
start` and the same components as stories; the normalized HTML and RSC model are identical. Snapshots
written on Turbopack match webpack, and production matches `next dev`, on Next.js 15.5 and 16.4.

## Documentation

- [Getting started](docs/guide/getting-started.md)
- [Writing stories](docs/guide/writing-stories.md)
- [Mocking](docs/guide/mocking.md)
- [Boundary Inspector](docs/guide/inspector.md)
- [Testing](docs/guide/testing.md)
- [Migrating from Storybook](docs/guide/migrating-from-storybook.md)
- [Configuration](docs/guide/configuration.md) · [API reference](docs/guide/api.md)
- [How it works](docs/guide/how-it-works.md) · [Limitations & troubleshooting](docs/guide/limitations.md)

`pnpm docs:build` renders them into a static site in `docs/dist`.

## Examples

- [`examples/minimal`](examples/minimal) — async components, Server Actions, streaming, intentional
  mistakes for the inspector, Vitest tests.
- [`examples/commerce`](examples/commerce) — Tailwind CSS, `next/image`, `next/font`, database and
  `fetch` mocks, currency cookies.
- [`examples/monorepo`](examples/monorepo) — stories in a workspace package, rendered by the app.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). MIT licensed — see [LICENSE](LICENSE).
