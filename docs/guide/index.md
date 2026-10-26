---
title: Introduction
order: 0
---

# RSC Stories

A component workshop for the Next.js App Router. Develop, document and test **async Server
Components** in isolation — rendered by your own Next.js, with mocked data — and see exactly what
crosses the server → client boundary.

```tsx
export default {
  component: OrderSummary, // async, reads the database and cookies
  mocks: {
    modules: { '@/lib/db': { orders: { findById: async () => order } } },
    next: { cookies: { locale: 'en-GB' } },
    latency: { '@/lib/db': 800 },
  },
} satisfies Meta<typeof OrderSummary>;
```

## Why

Storybook and its peers render components in a browser bundle. Storybook's experimental RSC mode
can run an async component there, but in the browser: there is no server render, no RSC payload and
no boundary to inspect, and every server-only module must be mocked before it can even load. In
practice App Router teams end up with stories for leaf Client Components only, or for
presentational twins of their real components.

RSC Stories renders stories through the **real** React Server Components pipeline of your
installed Next.js: a server render, a streamed RSC payload, Suspense, hydration. Mocks replace the
outside world per story. Because it holds the real payload, it can also show you what usually stays
invisible: which components ran where, what each boundary serialized, what each Client Component
costs in JavaScript, and which ones did not need to be Client Components at all.

## What you get

- **Stories for every kind of component** — async Server Components, Client Components, mixed trees
  — in a format Storybook users already know.
- **Per-story mocks** for modules, `fetch`, cookies, headers, search params and navigation, with
  latency simulation and switchable variants.
- **The Boundary Inspector** — component tree, serialized props per boundary, non-serializable
  props, client JS per component, client-leak detection, a render timeline, hydration diffs.
- **Tests from stories** — `rsc-stories test` renders every story from a production build and
  snapshots its HTML and RSC payload deterministically; plus a Vitest helper and a Playwright
  fixture.
- **A static build** for design review.

Start with [Getting started](getting-started.html).
