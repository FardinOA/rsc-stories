---
title: Writing stories
order: 2
---

# Writing stories

Stories live in `*.stories.tsx` files (any `.stories.{tsx,ts,jsx,js}` matching your config's
`stories` globs). The format is CSF-shaped — a default `meta` export and named story exports — so it
reads like Storybook, with server-specific additions: `mocks`, async components, Server Actions.

```tsx
import type { Meta, StoryObj } from 'rsc-stories';
import { ProductGrid } from './ProductGrid';

const meta = {
  title: 'Commerce/ProductGrid', // sidebar path; derived from the file path when omitted
  component: ProductGrid, // async Server Component, Client Component, or neither
  args: { columns: 3 }, // default props
  argTypes: { columns: { control: { type: 'range', min: 1, max: 6 } } },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <main className="p-6">
        <Story />
      </main>
    ),
  ],
  mocks: {/* see Mocking */},
  tags: ['commerce'],
} satisfies Meta<typeof ProductGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const TwoColumns: Story = { args: { columns: 2 } };
```

## Server, client and mixed components

- **Async Server Components** work as-is. They `await` on the server; the canvas streams their
  Suspense boundaries.
- **Client Components** (`'use client'`) are server-rendered and hydrated like in your app. Their
  props cross the server → client boundary, so they must be serializable — the inspector tells you
  when they are not.
- **Mixed trees** need nothing special: a story renders whatever the component renders.

## Args and controls

`args` become props. The Controls panel infers a control for every prop from your TypeScript types
(text, number, boolean, select/radio for unions of literals, color for `*Color` props, date for
`Date`, JSON for objects). `argTypes` refine or override:

```ts
argTypes: {
  tone: { control: 'radio', options: ['info', 'warning'], description: 'Visual tone' },
  internal: { table: { disable: true } },
  trailingIcon: { if: { arg: 'variant', eq: 'button' } },
}
```

Every change re-renders the story **on the server** (an RSC navigation, so client state that can
survive does).

### Functions

- For **Client Components**, function args become _actions_: the server cannot send functions, so
  the workshop recreates them in the browser and logs every call in the Calls panel.

  ```tsx
  import { fn } from 'rsc-stories';
  export default { component: LikeButton, args: { onLike: fn() } };
  ```

- For **Server Components**, function args are passed through and their calls are logged.
- A **Server Action** (`'use server'`) passes to a Client Component as-is, and runs on the server
  with the story's mocks.

Passing a plain function to a Client Component _inside your own JSX_ (in a component or a custom
`render`) is an RSC error in the app too; the story shows it and the inspector names the prop.

## Render functions

```tsx
export const InACard: Story = {
  render: (args, context) => (
    <Card title={context.name}>
      <ProductGrid {...args} />
    </Card>
  ),
};
```

`render` runs on the server, and may be `async`.

## Decorators

Decorators wrap the story, innermost first: story → meta → `preview.tsx` → `config.ts`.

```tsx
decorators: [
  // A function decorator runs on the server and receives the story as a component.
  (Story, context) => <ThemeShell theme={context.globals.theme}><Story /></ThemeShell>,
  // A Client Component is used as a wrapper: it receives `children` and a serializable `context`.
  ClientThemeProvider,
],
```

## Parameters

| Parameter     | Effect                                                                         |
| ------------- | ------------------------------------------------------------------------------ |
| `layout`      | `padded` (default), `centered` or `fullscreen`                                 |
| `backgrounds` | `{ default, values: [{ name, value }] }` for the toolbar's background switcher |
| `suspense`    | `false` to render without the workshop's outer Suspense boundary               |
| `cache`       | `cold` (default) bypasses `unstable_cache`; `warm` uses Next's cache           |
| `budgets`     | Per-story budgets (see [Testing](testing.html#budgets))                        |

## Play functions

`play` runs in the browser after hydration — in the Interactions panel, in
`rsc-stories test --browser` and in the Playwright fixture.

```tsx
import { expect } from 'rsc-stories/test';

export const SubmitsRefund: Story = {
  play: async ({ canvas, userEvent, step }) => {
    await step('request a refund', async () => {
      await userEvent.click(canvas.getByRole('button', { name: 'Request refund' }));
    });
    await expect(await canvas.findByText('Refund requested')).toBeVisible();
  },
};
```

The context provides Testing Library queries (`canvas`), `userEvent`, `step`, `args`, `id` and
`parameters`. `rsc-stories/test` exports `expect`, `within`, `waitFor`, `screen`, `userEvent` and
`fn`. Play modules only bundle the story file plus JSON and `fixtures`/`mocks` modules; everything
else is stubbed in the browser, so keep play functions about the DOM.

## Story ids

Ids are `<component id>--<story>`: `commerce-ordersummary--default`. The component id is
`meta.id` or the slugified title; the story part is the story's `id` or its export name. Set ids
explicitly to keep deep links and snapshots stable when you rename things.

## Tags

- `!test` — skip in `rsc-stories test` (stories that fail on purpose, demos).
- `expect-error` — the story is _supposed_ to error; `rsc-stories test` fails if it renders.
