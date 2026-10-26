---
title: Testing
order: 5
---

# Testing

Every story is a test case. RSC Stories offers three levels, all rendering through your real
Next.js: the `rsc-stories test` runner, a Vitest helper, and a Playwright fixture.

## `rsc-stories test`

```sh
npx rsc-stories test             # build once, render every story, compare snapshots
npx rsc-stories test --browser   # also hydrate each story in Chromium and run play functions
npx rsc-stories test -u          # write/update snapshots
npx rsc-stories test --filter commerce --json report.json
```

For each story it checks:

- the server render succeeds (render errors, HTTP 5xx and errors in the payload fail the story);
- no props fail serialization;
- budgets hold;
- the snapshot matches;
- with `--browser`: the page hydrates without mismatches or console errors, and `play` passes.

It runs a production build by default — the same code your users get. `--dev` uses `next dev`
instead (quicker for a handful of stories, and component names appear in reports). Stories render
four at a time. A story that never finishes streaming (a permanent loading state) is snapshotted as
its fallback after five seconds of silence, with a note.

Tags control participation: `!test` skips a story, `expect-error` inverts the render check.

In CI (`CI` set), missing snapshots fail instead of being written. Exit code is `1` when any story
fails.

### Snapshots

Snapshots live next to each story file in `__rsc_snapshots__/` (configurable with `snapshotDir`):

| File               | Contents                                                              |
| ------------------ | --------------------------------------------------------------------- |
| `<id>.html`        | The story's server HTML, every streamed boundary resolved, normalized |
| `<id>.rsc.json`    | The story's RSC model: elements, props, client references by file     |
| `<id>.report.json` | Boundaries, serialized props, calls, warnings, navigation             |

Snapshots are deterministic: React ids, Server Action ids and the action encryption key, error
digests, `next/font` class names, package store paths and timings are normalized, so the same story
produces the same snapshot in development and production, on Turbopack and webpack, on any machine.
CSS Modules class names are the exception: their hashes differ between bundlers, so keep one
bundler per snapshot set.

### Budgets

```ts
// .rsc-stories/config.ts — or parameters.budgets in a story/meta
budgets: {
  rscPayloadKb: 20,          // the story's share of the RSC payload, debug rows excluded
  clientJsKbPerStory: 40,    // gzipped JS of the story's Client Components
  serverRenderMs: 200,       // server render time, simulated latency excluded
}
```

Budgets are checked in the Inspector and fail `rsc-stories test`. Story budgets merge over meta,
preview and config budgets. The client JS budget is enforced on production builds only: under
`rsc-stories dev` (and `test --dev`) chunks are unminified, so the size is shown but not judged.

## Vitest

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { rscStories } from 'rsc-stories/vitest/plugin';

export default defineConfig({
  plugins: [rscStories()],
  test: { environment: 'jsdom', testTimeout: 60_000, hookTimeout: 180_000 },
});
```

The plugin starts a workshop server once for the whole run (`next dev`; set
`RSC_STORIES_MODE=build` to test a production build instead) and lets test files import story files
directly. Point `RSC_STORIES_ORIGIN` at an already running workshop to skip starting one.

```ts
import { expect, it } from 'vitest';
import { renderStory } from 'rsc-stories/vitest';
import * as stories from '../src/components/OrderSummary.stories';

it('renders the order on the server', async () => {
  const story = await renderStory(stories.Default, { args: { orderId: 'ord_9' } });
  expect(story.container?.querySelector('h2')?.textContent).toBe('Order ord_9');
  expect(story.calls.map((c) => c.label)).toContain('db.orders.findById');
  expect(story.report.boundaries.map((b) => b.to)).toEqual(['RefundButton']);
  expect(story.html).toMatchSnapshot();
});
```

`renderStory(storyOrId, { args, mocks, globals, hydrate })` returns `html` (normalized),
`rawHtml`, `rsc`, `report`, `calls`, `logs`, `warnings` and, in a DOM environment, a `container`
element. `hydrate: true` also loads the story in Chromium and returns `hydratedHtml`.

Story modules imported in tests are replaced by lightweight references (the components themselves
only run inside Next.js), so test files stay fast and environment-agnostic.

## Playwright

```ts
// playwright.config.ts
export default defineConfig({
  use: { baseURL: 'http://localhost:6006' },
  webServer: { command: 'npx rsc-stories dev', url: 'http://localhost:6006', reuseExistingServer: true },
});
```

```ts
import { test, expect } from 'rsc-stories/playwright';

test('refund flow', async ({ stories }) => {
  const story = await stories.open('commerce-ordersummary--default', { args: { orderId: 'ord_123' } });
  await story.root.getByRole('button', { name: 'Request refund' }).click();
  await expect(story.root.getByText('Refund requested')).toBeVisible();
  const report = await story.report();
  expect(report.clientLeaks).toEqual([]);
});
```

`stories.open()` waits for hydration and returns `root` (a locator for the story), `play()`,
`report()` and `messages()` (logs, actions, router calls, hydration mismatches).

## Static builds

```sh
npx rsc-stories build            # → rsc-stories-static/
```

Writes a static workshop — every story pre-rendered in its default state, with reports and
payloads — that any static host can serve from the root of a domain, for design review or a link in
a pull request. Controls
and mock overrides are read-only there (there is no server to re-render), and Server Actions do not
run.
