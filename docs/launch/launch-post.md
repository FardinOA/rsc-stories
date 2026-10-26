<!-- Draft launch post. Not published. Replace the TODO links before posting. -->

# RSC Stories: a component workshop for React Server Components

Most App Router codebases have two kinds of components: the ones in Storybook, and the ones that
matter. The async ones — that read the database, call `cookies()`, stream behind Suspense and hand
Server Actions to Client Components — rarely get stories, because a browser bundle cannot run them.
Teams write presentational twins with the data passed in as props, and the real component is only
ever seen inside the running app.

RSC Stories renders those components as they are. A story is a familiar CSF file:

```tsx
const meta = {
  component: OrderSummary, // async; reads the database and the locale cookie
  args: { orderId: 'ord_123' },
  mocks: {
    modules: { '@/lib/db': { orders: { findById: async (id: string) => order.with({ id }) } } },
    next: { cookies: { locale: 'en-GB' } },
  },
} satisfies Meta<typeof OrderSummary>;

export const Default: Story = {};
export const SlowDatabase: Story = { mocks: { latency: { '@/lib/db': 3000 } } };
export const Refunded: Story = {
  mocks: { modules: { '@/lib/db': { orders: { findById: async () => order.with({ status: 'refunded' }) } } } },
};
```

…and `npx rsc-stories dev` opens a workshop where each story is rendered **by your own Next.js**: a
real server render, a real RSC payload, real Suspense streaming and hydration. Mocks replace the
database, `fetch`, cookies, headers and navigation per render — two stories rendering at the same
time never see each other's data.

## See what crosses the boundary

Because the workshop holds the actual payload Next.js streamed, it can show what normally stays
invisible. The Boundary Inspector marks every node in the tree as Server, Client or Shared, and
lists every boundary with the props that crossed it, serialized, and their size.

In our minimal example, it flags a `Badge` component: it has no state, no effects and no event
handlers, but it ships to the browser because `FollowButton` — a Client Component — imports it.
The fix it suggests (render `Badge` on the server and pass it in as `children`) removes it from the
bundle with no behavior change. When a plain function is passed to a Client Component, it names the
component and the prop instead of leaving you with React's serialization error. It shows client JavaScript per component, a timeline of
data calls and streaming, and a diff when hydration does not match.

## Stories are tests

`rsc-stories test` builds the workshop with `next build` and renders every story: render errors,
serialization problems and budget overruns fail it, and each story gets a deterministic snapshot of
its server HTML and RSC payload. Deterministic means the same snapshot on every machine, on
Turbopack and webpack, in development and production — React ids, Server Action ids, error
digests, font class names and timings are normalized. `--browser` also hydrates each story in
Chromium and runs its `play` function. There is a `renderStory()` helper for Vitest and a fixture
for Playwright.

## Numbers

On an Apple M2 with 217 stories (Next.js 16.4, Turbopack):

- the workshop is ready in **0.5 s** and the full story index is served in **0.7 s**;
- switching to an already compiled story paints it in **47 ms** (median; 52 ms p95);
- a component edit shows up in the canvas in **116 ms** (median; 120 ms p95);
- `rsc-stories test` renders **200 stories in 8.8 s**, including the production build;
- the workshop UI ships **90.8 kB** of JavaScript (min+gzip).

For fidelity, the repository's conformance suite renders pages of the example apps with `next
build && next start`, and the same components as stories, and compares them: the normalized HTML
and RSC models are identical. The benchmark and the conformance suite are in the repository, so
you can run them on your own machine.

## What it is not

RSC Stories is for the Next.js App Router only (Next.js 15 and 16, React 19). It has no MDX docs
pages and a small addon API. On Turbopack, module mocks match the import specifier, so import a
mocked module the same way everywhere. Storybook remains the better tool for client-only design
systems and its addon ecosystem; the two coexist in one repository, and `rsc-stories migrate`
converts Storybook files when you want to move one over.

## Try it

```sh
npm install --save-dev rsc-stories
npx rsc-stories init
npx rsc-stories dev
```

Documentation: TODO(link to docs). Source and issues: TODO(link to repository). It is MIT licensed,
and the issue tracker has a few good first issues if you want to help.
