---
title: Getting started
order: 1
---

# Getting started

RSC Stories is a component workshop for the Next.js App Router. Stories for async Server
Components render through **your project's own Next.js** — a real server render, a real RSC
payload, real hydration — with mocks for databases, `fetch`, cookies and navigation.

## Requirements

- Next.js 15 or 16 with the App Router, React 19
- Node.js 20 or newer
- TypeScript is optional (it powers the Controls panel's prop-type inference)

## Install

```sh
npm install --save-dev rsc-stories      # or: pnpm add -D rsc-stories / yarn add -D rsc-stories
npx rsc-stories init
```

`init` never overwrites files. It creates:

| File                                   | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `.rsc-stories/config.ts`               | Story globs, global mocks, budgets, env allowlist              |
| `.rsc-stories/preview.tsx`             | Global CSS and decorators — the equivalent of your root layout |
| `src/components/rsc-stories-example/*` | An async Server Component and its stories                      |

It also adds `stories`, `stories:build` and `stories:test` scripts and ignores
`.rsc-stories/.cache` (generated files) in `.gitignore`.

## Start the workshop

```sh
npm run stories        # rsc-stories dev → http://localhost:6006
```

The sidebar is ready immediately: story files are indexed statically. The first time you open a
story, Next.js compiles it (a second or two); after that, switching stories is a soft navigation
and edits hot-reload in well under a second.

Open **Getting started / Welcome**, then the **Inspector** panel: the component tree marks what ran
on the server and what shipped to the browser.

## Your first story

```tsx
// src/components/OrderSummary.stories.tsx
import type { Meta, StoryObj } from 'rsc-stories';
import { OrderSummary } from './OrderSummary'; // an async Server Component

const meta = {
  title: 'Commerce/OrderSummary',
  component: OrderSummary,
  mocks: {
    modules: {
      '@/lib/db': { orders: { findById: async () => ({ id: 'ord_123', lines: [], status: 'paid' }) } },
    },
    next: { cookies: { locale: 'en' } },
  },
} satisfies Meta<typeof OrderSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { orderId: 'ord_123' } };
```

Next: [Writing stories](writing-stories.html) and [Mocking](mocking.html).

## Global styles

Your root layout does not wrap stories. Import global CSS — and fonts, providers, anything the
layout sets up — in `.rsc-stories/preview.tsx`:

```tsx
import '../src/app/globals.css';
import type { Decorator } from 'rsc-stories';
import { inter } from '../src/app/fonts';

export const decorators: Decorator[] = [
  (Story) => (
    <div className={inter.variable}>
      <Story />
    </div>
  ),
];
```

Tailwind CSS v3 and v4 work through your PostCSS config.

## Next steps

- `npx rsc-stories doctor` checks versions, config, stories and mocks.
- `npx rsc-stories test` renders every story headlessly; see [Testing](testing.html).
- `npx rsc-stories build` writes a static workshop for reviewers; see [Testing](testing.html#static-builds).
