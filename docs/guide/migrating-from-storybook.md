---
title: Migrating from Storybook
order: 6
---

# Migrating from Storybook

RSC Stories reads Component Story Format, so most Storybook stories for Client Components work after
an import change. Keep Storybook for what it is great at — client-only design systems, its addon
ecosystem — and use RSC Stories for the server half of your App Router code. Both can live in the
same repository.

## Codemod

```sh
npx rsc-stories migrate 'src/**/*.stories.tsx'            # writes Button.rsc.stories.tsx next to each file
npx rsc-stories migrate 'src/**/*.stories.tsx' --in-place # rewrites the files
```

The codemod is text-based, so formatting and comments survive. It:

- rewrites `@storybook/react`, `@storybook/nextjs`, `@storybook/nextjs-vite` (and similar) type
  imports to `rsc-stories`;
- splits `@storybook/test` imports: `fn` from `rsc-stories`, `expect`, `userEvent`, `within`,
  `waitFor` and `screen` from `rsc-stories/test`;
- turns `parameters.nextjs.navigation` into a `TODO` pointing at `mocks.next`;
- marks what has no equivalent (`loaders`, `beforeEach`, other `@storybook/*` imports) with
  `TODO(rsc-stories)` comments and lists them in its output.

While Storybook and RSC Stories share a glob, files that still import from `@storybook/*` are
skipped by the indexer (and `rsc-stories doctor` says so), so nothing breaks before you migrate.

## Concept map

| Storybook                                                                          | RSC Stories                                                                     |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `Meta`, `StoryObj`, `args`, `argTypes`, `parameters`, `decorators`, `tags`, `play` | Same names, same shape                                                          |
| `loaders`                                                                          | Make the component async, or mock its data with `mocks.modules` / `mocks.fetch` |
| `beforeEach`                                                                       | Function-form `mocks: () => ({ … })`                                            |
| `parameters.nextjs.navigation`                                                     | `mocks.next: { pathname, searchParams, params }`                                |
| `parameters.nextjs.appDirectory`                                                   | Not needed: everything is the App Router                                        |
| MSW addon                                                                          | `mocks.fetch` (server-side `fetch`)                                             |
| Module mocking (`sb.mock`, subpath imports)                                        | `mocks.modules`                                                                 |
| `.storybook/preview.tsx`                                                           | `.rsc-stories/preview.tsx`                                                      |
| `.storybook/main.ts`                                                               | `.rsc-stories/config.ts`                                                        |
| Actions addon (`fn()` / `argTypesRegex`)                                           | `fn()` in args; the Calls panel                                                 |
| Interactions addon                                                                 | Interactions panel (`play` runs after hydration)                                |
| a11y addon                                                                         | Accessibility panel (axe-core)                                                  |
| Viewport / backgrounds toolbar                                                     | Built in                                                                        |
| Docs / MDX                                                                         | Not supported                                                                   |
| Chromatic / visual testing                                                         | `rsc-stories test` DOM + RSC snapshots; screenshot with the Playwright fixture  |

## What changes in practice

- **The component may now be async.** Write the story for the Server Component itself instead of a
  presentational twin with props injected by a loader.
- **Data comes from mocks, not args.** Args are still props; what the component fetches is mocked
  per story.
- **Functions passed to Client Components** from a Server Component are an error in Next, and in
  RSC Stories. Story args that are functions are fine: the workshop recreates them in the browser.
- **Global CSS** moves from `.storybook/preview` to `.rsc-stories/preview.tsx`.
