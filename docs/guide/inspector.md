---
title: Boundary Inspector
order: 4
---

# Boundary Inspector

The Inspector panel reads the story's real RSC payload and tells you what crossed the server →
client boundary, what it cost, and what went wrong. Every view is computed from the bytes Next.js
actually sent — nothing is simulated.

## Tree

The rendered component tree, each node marked **Server**, **Client** or **Shared** (a component
without `'use client'` that a Client Component imports, so it runs in both places). The line where
the server tree hands over to a Client Component is drawn as a seam; that is a boundary.

Component names come from React's development debug information, so the tree is richest under
`rsc-stories dev`. Production renders (`rsc-stories build`/`test`) show host elements and Client
Components.

## Boundaries

One row per Client Component the server rendered: who rendered it (`from`, development only), the
props it received **as serialized**, and their size in the payload. Large props are the most common
cause of heavy RSC payloads — a whole product object where the button needed an id.

### Non-serializable props

Props that cannot cross the boundary are flagged before you hit them in the app:

| Value                                   | Severity | What happens in Next                                                                                    |
| --------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| Functions that are not Server Actions   | error    | Render error                                                                                            |
| Class instances, null-prototype objects | error    | Render error                                                                                            |
| Symbols not created with `Symbol.for()` | error    | Render error                                                                                            |
| `Date`                                  | warning  | Arrives as a `Date`; formatting it with the browser's timezone or locale can cause a hydration mismatch |
| Symbol-keyed properties                 | warning  | Silently dropped                                                                                        |

Args are checked before rendering, so the panel can name the exact prop path (`order.lines[2].total`).
When React refuses to serialize a value, the inspector maps React's error message back to the
component and prop name.

## Timeline

A waterfall of the render: server components (development builds on Next.js 16), mocked data calls
with their simulated latency, awaited I/O, streaming, and hydration in the canvas. Waterfalls —
sequential awaits that could run in parallel — are visible at a glance.

## Client JS

The JavaScript each Client Component in the story ships, from the chunks Next.js built for it,
minified and gzipped. Framework code (React, Next.js runtime) is listed separately and not
attributed to your components. Sizes are measured from production builds; in `dev`, chunks are
unminified and the numbers are only comparable with each other.

## Client leaks

Components that are Client Components but do not need to be: no state, no effects, no event
handlers, no browser APIs — only markup. Each leak shows the reason it was flagged and the file.
There are two kinds:

- **marked** — the file has `'use client'` but uses no client-only API. Remove the directive.
- **inherited** — no directive, but a Client Component imports it, so it ships too. Render it in a
  Server Component and pass it to the Client Component as `children` or a prop.

The analysis is static (the module graph plus a pattern check for hooks, handlers and browser
globals), so it errs on the side of not flagging: a component that only passes `onClick` through to
a child is considered interactive.

## Hydration

After the canvas hydrates, the server HTML and the hydrated DOM are compared. Mismatches show as a
diff with React's own hydration error, so `Date.now()`, `Math.random()` or locale-dependent output
in a render is caught in the story, not in production.

## Payload

The raw RSC payload, row by row: model rows, client references, Server Action references, debug
rows (dev), errors. Useful for understanding exactly what Next.js streams.

## Budgets and export

Budget results (see [Testing](testing.html#budgets)) appear at the top of the panel. **Export**
downloads the full report as JSON — the same data `rsc-stories test --json` and `renderStory()`
return, so a report attached to a bug ticket is reproducible.
