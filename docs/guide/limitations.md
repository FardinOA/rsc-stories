---
title: Limitations & troubleshooting
order: 10
---

# Limitations & troubleshooting

## Known limitations

- **Turbopack matches module mocks by import specifier.** A module mocked as `@/lib/db` is not
  mocked where it is imported as `../lib/db`. Use one spelling (path aliases are easiest);
  `rsc-stories doctor` lists mocked modules. Webpack matches the resolved file, so any spelling
  works there.
- **Primitive exports cannot be mocked per story** (`export const LIMIT = 10`). Mock the function
  that reads them.
- **`'use server'` modules are not mocked.** Mock what the action calls.
- **Requests made with `node:http`/`https`** (axios, some SDKs) are reported and can be blocked, but
  not answered: mock the module that wraps the client.
- **Function args become actions only for Client Components.** A function passed to a Client
  Component from inside your own JSX is an error, as in Next.
- **Server Component names and timings** in the tree and timeline come from React's development
  debug information: they are present under `rsc-stories dev`. On Next.js 15 (React 19.1), the
  timeline shows data and I/O spans but not per-component server spans.
- **Snapshots of CSS Modules class names are bundler-specific** (Turbopack and webpack hash them
  differently). Everything else in a snapshot is stable across bundlers and modes.
- **Static builds are read-only**: controls and mock overrides need the server, and Server Actions
  do not run. They must be served from the root of a domain (canvases load `/_next/static`), not
  from a sub-path.
- **Turbopack only resolves packages inside its root** (your lockfile directory). A package linked
  from outside it (`npm link`, `file:` dependencies) works with `--bundler webpack`.
- **Middleware, route handlers, layouts and `generateMetadata`** of your app are not part of a story.
  Put what a component needs from a layout (providers, fonts, CSS) in `.rsc-stories/preview.tsx`.
- **Docs pages / MDX** are not supported.

## Troubleshooting

**"Module not found" for a mocked module.** Run `rsc-stories doctor`: it resolves every mocked
specifier from your project root. A typo in a `mocks.modules` key, or a path alias missing from
`tsconfig.json`, shows up there.

**My mock is not applied.** On Turbopack, check that the component imports the module with the same
specifier as the mock key. Check the Calls panel: mocked calls are marked _mocked_; real ones are
not.

**Global styles are missing.** Import them in `.rsc-stories/preview.tsx` — the root layout does
not wrap stories.

**A story hangs in "Rendering on the server…".** Something awaits forever: a mock with `latency:
Infinity`, an unmocked request to a host that does not answer, or a real database client waiting
for a connection. The Timeline and Calls panels show what is pending.

**Unmocked request warnings.** Every request no mock answers is listed in the Mocks panel with its
URL; copy the suggested matcher into `mocks.fetch`. Set `strictNetwork: true` once stories are
mocked.

**`process.env.X` is undefined in a story.** Only allowlisted variables exist while stories render:
add it to `env.allow` in the config.

**Hydration mismatch in a story.** The Hydration tab shows the diff. Common causes: `Date.now()`,
`Math.random()`, `toLocaleString()` without a fixed locale/time zone, or reading `window` during
render.

**The canvas keeps reloading.** The workshop shows a banner when the canvas document reloads over
and over — Next.js's hot reload restarting on stale development state. The generated app runs
without Turbopack's on-disk development cache and starts clean when the bundler, the Next.js version
or `NODE_ENV` changes, which removes the known causes; if it still happens, stop the workshop and
delete `.rsc-stories/.cache`.

**Stale output after changing the config.** The generated app lives in `.rsc-stories/.cache`.
Deleting it is always safe.
