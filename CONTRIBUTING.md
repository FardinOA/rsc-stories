# Contributing to RSC Stories

Thanks for helping. This guide covers the repository layout, the checks a change must pass, and
how releases work.

## Setup

```sh
pnpm install          # Node 20+, pnpm (version pinned in package.json)
pnpm build            # tsup (library + CLI) and esbuild (workshop UI) → dist/
pnpm exec playwright install chromium
```

Run the workshop against an example while you work:

```sh
cd examples/minimal && node ../../dist/cli.js dev
```

`pnpm dev` rebuilds the library on change (`tsup --watch`); run `node scripts/build-ui.mjs` again
after UI changes, and restart `rsc-stories dev` after changes to `src/node`.

## Layout

| Path                                              | What lives there                                                              |
| ------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/types.ts`, `src/config.ts`, `src/helpers.ts` | Public story format and helpers (`rsc-stories`)                               |
| `src/runtime/server`                              | Runs inside the generated Next app: story resolution, mocks, the canvas page  |
| `src/runtime/client`                              | Canvas bridge, error boundary, navigation mocks (`'use client'`)              |
| `src/runtime/mock`                                | Module mock proxies and Next API shims                                        |
| `src/node`                                        | CLI commands, the indexer, app generation, the workshop server, the inspector |
| `src/ui`                                          | The workshop single-page app (React, bundled with esbuild)                    |
| `src/vitest`, `src/playwright`, `src/test`        | Test integrations                                                             |
| `examples/`                                       | Three Next.js apps used by e2e tests, conformance and benchmarks              |
| `tests/`                                          | Unit tests (Vitest)                                                           |
| `e2e/`                                            | Workshop UI tests (Playwright)                                                |
| `conformance/`                                    | Story output vs. `next build` output                                          |
| `docs/guide`                                      | Documentation (`pnpm docs:build`)                                             |
| `docs/design`                                     | The UI's design contract — read `design-dna.md` before changing `src/ui`      |

`docs/guide/how-it-works.md` explains the architecture.

## Checks

Every pull request runs these in CI; run the relevant ones locally first:

```sh
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test                 # unit tests; pnpm test:coverage enforces ≥ 85 % lines
pnpm build && pnpm size   # workshop UI ≤ 150 kB gzip
pnpm test:e2e             # starts dev servers for the three examples
pnpm test:conformance     # next build + next start vs. rsc-stories, byte-for-byte after normalization
(cd examples/minimal && node ../../dist/cli.js test --browser)
node scripts/compat.mjs --next 15   # installs the packed package into a Next 15 copy of the example
node scripts/bench.mjs              # 200-story performance benchmark
```

Set `RSC_STORIES_BUNDLER=webpack` to run any of them against webpack instead of Turbopack.

## Guidelines

- **Fidelity first.** Stories must render exactly as the app would. If a feature needs Next.js to
  behave differently from production, find another way or document the difference in
  `docs/guide/limitations.md`.
- **No second React.** The runtime uses the host's React and Next.js; never bundle either.
- **Public API changes** need TSDoc, a docs update and a changeset.
- **UI changes** follow `docs/design/design-dna.md`: hue only for server/client/status, always with
  a glyph and a label; light and dark mode; keyboard operable; axe-clean (the e2e suite checks).
- **Tests**: unit tests for logic, an e2e or example story for anything users see.

## Changesets and releases

Add a changeset to every PR that changes published behavior:

```sh
pnpm changeset
```

Maintainers release with `pnpm release` (build + `changeset publish`) after merging the version PR.

## Reporting bugs

Use the bug report template. The most useful attachment is the inspector report: open the story,
**Inspector → Export**, and attach the JSON — it contains the RSC payload summary, versions and
the render timeline.
