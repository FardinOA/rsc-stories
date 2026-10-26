---
title: How it works
order: 9
---

# How it works

## A generated Next.js app

`rsc-stories dev` writes a small App Router app into `.rsc-stories/.cache/workshop`: one route per
story file, a canvas layout, shims for mocked modules and Next.js APIs, a `tsconfig.json` that
re-points your path aliases, and a `next.config.mjs` that loads yours. It then starts **your**
installed Next.js on it, in-process, with your bundler. There is no second React and no custom RSC
renderer: what you see is what `next dev` and `next build` produce.

The workshop UI is a separate single-page app served next to it. The canvas is an iframe pointing
at the story's route; changing args or mocks is a client-side navigation to a new URL, which re-runs
the server render and streams a fresh RSC payload into the same page, so Client Component state
that can survive does.

## Mocks are per render

Each canvas request runs inside an `AsyncLocalStorage` context holding that render's mocks, call
log and console capture. Mocked modules are tiny generated proxies: every export (and every nested
property) looks the current render's mocks up when called and falls back to the real module. Two
concurrent renders of different stories never see each other's mocks.

`fetch` is patched before Next.js loads, so Next's own fetch instrumentation and caching sit on
top of the mock and behave as in your app. `node:http`/`https` requests are observed and, in strict
mode, blocked.

`cookies()`, `headers()`, `draftMode()`, the navigation functions and the cache functions resolve
to shims that read the render context and otherwise defer to Next. Client-side navigation hooks
work because the canvas provides Next's own router contexts with a recording router.

## The inspector reads the wire

When a story renders, the server keeps the response bytes. The inspector parses the RSC payload
(the Flight protocol rows Next streamed) and the HTML (applying React's streaming instructions to
recover the final server HTML), then combines them with the bundler's module maps (to find which
files and chunks a client reference belongs to) and a static analysis of your client modules (for
leaks). Development builds add React's debug rows: component names, owners and timings.

## Production fidelity

`rsc-stories test` and `build` run `next build` on the generated app and render from the
production server: minified client chunks (accurate sizes), no debug rows, production React.
The conformance suite in this repository renders pages of the example apps through `next build &&
next start` and the same components through RSC Stories and compares the normalized HTML and RSC
payloads; they must be identical.
