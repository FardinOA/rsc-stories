---
title: Configuration
order: 7
---

# Configuration

## `.rsc-stories/config.ts`

```ts
import { defineConfig } from 'rsc-stories';

export default defineConfig({
  stories: ['src/**/*.stories.tsx'], // default: every *.stories.* outside node_modules
  mocks: { strictNetwork: true }, // global mocks, the lowest layer
  decorators: [], // outermost decorators
  parameters: { layout: 'padded' },
  args: {},
  argTypes: {},
  globals: { theme: 'light' }, // initial toolbar globals
  budgets: { rscPayloadKb: 20, clientJsKbPerStory: 40, serverRenderMs: 200 },
  env: { allow: ['NEXT_PUBLIC_*', 'FEATURE_FLAGS'] },
  aliases: { 'server-only': './src/test/empty.ts' },
  bundler: 'turbopack', // or 'webpack'; default: what your Next uses
  port: 6006,
  host: 'localhost',
  outDir: 'rsc-stories-static',
  snapshotDir: '__rsc_snapshots__',
  viewports: { kiosk: { name: 'Kiosk', width: 1080, height: 1920 } },
  addons: [],
});
```

Changes to the config or preview file restart the generated app automatically.

## `.rsc-stories/preview.tsx`

Runs on the server for every story. It may export `decorators`, `parameters`, `args`, `argTypes`,
`mocks` and `globals`, and imports global CSS:

```tsx
import '../src/app/globals.css';
import type { Decorator, Parameters } from 'rsc-stories';

export const decorators: Decorator[] = [
  (Story) => (
    <div className="font-sans">
      <Story />
    </div>
  ),
];
export const parameters: Parameters = {
  backgrounds: {
    default: 'paper',
    values: [
      { name: 'paper', value: '#fbfaf7' },
      { name: 'ink', value: '#111' },
    ],
  },
};
```

## Your Next.js config

The workshop is a separate, generated App Router app (in `.rsc-stories/.cache/`) that loads **your**
`next.config.*`, `tsconfig.json` paths, PostCSS/Tailwind config, `public/` directory and `.env`
files. Settings that only make sense for your deployed app are ignored: `basePath`, `assetPrefix`,
`i18n`, `rewrites`, `redirects`, `headers`, `output`, `distDir`, `trailingSlash`, `typedRoutes` and
`pageExtensions`. Your app's routes, layouts and middleware are never loaded.

## Monorepos

Run RSC Stories from the Next.js app's directory. Stories can live in workspace packages:

```ts
// apps/web/.rsc-stories/config.ts
export default defineConfig({ stories: ['src/**/*.stories.tsx', '../../packages/ui/src/**/*.stories.tsx'] });
```

Workspace packages compile through the app's `transpilePackages` as usual. The lockfile directory is
used as the Turbopack root, so linked packages resolve.

## Addons

```ts
addons: [{ name: 'design-tokens', manager: './tools/tokens-panel.js', preview: './tools/tokens-preview.tsx' }],
```

- `preview` is a module whose `decorators`, `parameters` and `mocks` apply to every story.
- `manager` is a browser ES module whose default export receives the addon API:

```js
export default function register(api) {
  api.addPanel({
    id: 'tokens',
    title: 'Tokens',
    render(container, context) {
      const update = () => (container.textContent = `${context.storyId}: ${JSON.stringify(context.args)}`);
      update();
      return context.on('args', update); // cleanup
    },
  });
  api.addToolbarItem({ id: 'reset', title: 'Reset args', onClick: (context) => context.updateArgs({}) });
}
```

Panels render into a plain DOM node, so an addon can use any framework or none. `context.report`
holds the latest inspector report.

## Environment variables

| Variable                 | Effect                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| `RSC_STORIES_BUNDLER`    | `turbopack` or `webpack` (same as `--bundler`)                        |
| `RSC_STORIES_ORIGIN`     | Workshop URL for `renderStory()` and the Playwright fixture           |
| `RSC_STORIES_MODE=build` | Vitest global setup serves a production build instead of `next dev`   |
| `CI`                     | `rsc-stories test` fails on missing snapshots instead of writing them |
