---
title: API reference
order: 8
---

# API reference

## CLI

```
rsc-stories <command> [options]
```

| Command           | What it does                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------- |
| `init`            | Scaffold `.rsc-stories/`, an example story, package scripts and a `.gitignore` entry. Never overwrites. |
| `dev`             | Start the workshop with hot reload (default `http://localhost:6006`).                                   |
| `serve`           | Build and serve the workshop without watching (`--dev` for `next dev`).                                 |
| `build`           | Write a static workshop (default `rsc-stories-static/`).                                                |
| `test`            | Render every story; check render errors, serialization, budgets and snapshots.                          |
| `doctor`          | Check Node, Next.js, React, config, stories and mocked modules.                                         |
| `migrate <glob…>` | Convert Storybook CSF files.                                                                            |

| Option            | Commands           |                                                                 |
| ----------------- | ------------------ | --------------------------------------------------------------- |
| `--port <n>`      | dev, serve, test   | Port (`0` picks a free one)                                     |
| `--host <h>`      | dev, serve         | Interface to bind; default `localhost`                          |
| `--cwd <dir>`     | all                | Project directory                                               |
| `--open`          | dev                | Open the browser                                                |
| `--out-dir <dir>` | build              | Output directory                                                |
| `-u`, `--update`  | test               | Write and update snapshots                                      |
| `--browser`       | test               | Hydrate in Chromium and run play functions (needs `playwright`) |
| `--filter <s>`    | test, build        | Only story ids containing `s`                                   |
| `--json <file>`   | test               | Write results, including full reports, as JSON                  |
| `--dev`           | test, build, serve | Use `next dev` instead of a production build                    |
| `--bundler <b>`   | all                | `turbopack` or `webpack`                                        |
| `--in-place`      | migrate            | Rewrite files instead of writing `*.rsc.stories.*` copies       |

## `rsc-stories`

Types: `Meta`, `StoryObj`, `Decorator`, `Parameters`, `Args`, `ArgTypes`, `ArgType`, `Mocks`,
`MocksInput`, `FetchMock`, `ModuleMock`, `NextMocks`, `PlayContext`, `PlayFunction`, `StoryContext`,
`Budgets`, `Viewport`, `RscStoriesConfig`, `Addon`, `AddonApi`, `AddonContext`.

| Export                                     |                                                                                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineConfig(config)`                     | Types `.rsc-stories/config.ts`                                                                                                                                      |
| `fn(implementation?)`                      | A spy: `.mock.calls`, `.mock.results`, `.mockImplementation()`, `.mockReturnValue()`, `.mockReset()`. As an arg of a Client Component, calls are logged as actions. |
| `mockModule<typeof import('…')>(partial)`  | Types a module mock against the real module                                                                                                                         |
| `mockVariants(base, { name: partial })`    | A module or fetch mock with switchable variants                                                                                                                     |
| `fixture(data)`                            | `.value`, `.with(patch)`, `.empty()`, `.large(n)`, `.loading()`, `.error(message)`, `.delayed(ms)`                                                                  |
| `repeat(n, (i) => item)`                   | Builds an array                                                                                                                                                     |
| `DEFAULT_STORY_GLOBS`, `DEFAULT_VIEWPORTS` | Defaults, for extending                                                                                                                                             |

### `Meta` / `StoryObj`

| Field              | Meta | Story |                                                        |
| ------------------ | ---- | ----- | ------------------------------------------------------ |
| `component`        | ✓    |       | The component to render                                |
| `title`            | ✓    |       | Sidebar path (`Group/Name`)                            |
| `id`               | ✓    | ✓     | Explicit component id / story id part                  |
| `name`             |      | ✓     | Display name                                           |
| `args`, `argTypes` | ✓    | ✓     | Props and control config                               |
| `parameters`       | ✓    | ✓     | See [Writing stories](writing-stories.html#parameters) |
| `decorators`       | ✓    | ✓     |                                                        |
| `mocks`            | ✓    | ✓     | Object or function; see [Mocking](mocking.html)        |
| `render`           | ✓    | ✓     | `(args, context) => ReactNode`, may be async           |
| `play`             | ✓    | ✓     | Runs in the browser after hydration                    |
| `tags`             | ✓    | ✓     | `!test`, `expect-error`, your own                      |

`StoryObj<typeof meta>` makes args the meta does not provide required in each story.

## `rsc-stories/test`

`expect`, `fn`, `userEvent`, `within`, `waitFor`, `screen` for play functions. Story files are also
evaluated on the server, so the module loads there too, but its browser helpers throw if called
outside the canvas.

## `rsc-stories/vitest` and `rsc-stories/vitest/plugin`

`rscStories(options?)` — Vitest plugin: starts the workshop for the run and makes story imports
resolvable. `options.cwd` sets the project; `options.server: false` skips starting a workshop.

`renderStory(storyOrId, options?)` → `Promise<RenderedStory>`. See [Testing](testing.html#vitest).

## `rsc-stories/playwright`

`test` (with a `stories` fixture) and `expect`. See [Testing](testing.html#playwright).

## `rsc-stories/node`

Programmatic access for tooling: `WorkshopServer`, `startServer`, `nextBuild`, `loadProject`,
`createIndex`, `findStory`, and the inspector's parsers (`parseFlight`, `FlightPayload`,
`buildTree`, `serverStoryHtml`, `normalizeHtml`, `diffLines`).

```ts
import { startServer } from 'rsc-stories/node';

const server = await startServer({ cwd: process.cwd(), mode: 'test' });
const { report, snapshot } = await server.renderStory('commerce-ordersummary--default');
await server.close();
```

## Story ids and URLs

- Story id: `<component id>--<story id part>`, both slugified (`commerce-ordersummary--default`).
- Workshop deep link: `/?story=<story id>&state=<token>`, where the token encodes args, globals
  and mock overrides; `viewport`, `size`, `panel` and `tab` restore the rest of the view. Copy it
  from the address bar.
- Canvas: `/rsc-stories/canvas/<file key>/<export>/<state>` — a real Next.js route you can open on
  its own.
