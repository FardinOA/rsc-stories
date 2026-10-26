import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseStoryFile } from '../node/indexer/parse';
import { findProjectRoot } from '../node/project';

/** Minimal Vite plugin shape, so this module needs no `vite` types. */
export interface VitePluginLike {
  name: string;
  enforce?: 'pre' | 'post';
  config?: () => Record<string, unknown>;
  load?: (id: string) => string | null | undefined;
}

/** Options for the {@link rscStories} Vitest plugin. */
export interface RscStoriesPluginOptions {
  /** Project root (defaults to the nearest Next.js project above the current directory). */
  cwd?: string;
  /** Start the workshop for the test run (default `true`). */
  server?: boolean;
}

/**
 * Vitest plugin: registers the global setup that starts the workshop, and replaces story modules
 * with id stubs so `renderStory(stories.Default)` works without evaluating server code in tests.
 */
export function rscStories(options: RscStoriesPluginOptions = {}): VitePluginLike {
  const root = findProjectRoot(options.cwd ?? process.cwd());
  const require = createRequire(import.meta.url);
  return {
    name: 'rsc-stories',
    enforce: 'pre',
    config() {
      if (options.server === false) return {};
      process.env.RSC_STORIES_ROOT = root;
      return { test: { globalSetup: [require.resolve('rsc-stories/vitest/global-setup')] } };
    },
    load(id) {
      const file = id.split('?')[0]!;
      if (!/\.(stories|story)\.[cm]?[jt]sx?$/.test(file)) return null;
      const parsed = parseStoryFile(readFileSync(file, 'utf8'), file, path.relative(root, file).split(path.sep).join('/'));
      const lines = [
        `export default ${JSON.stringify({ title: parsed.title, id: parsed.componentId })};`,
        ...parsed.stories.map(
          (story) => `export const ${story.exportName} = ${JSON.stringify({ __rscStoriesId: story.id, name: story.name })};`,
        ),
      ];
      return lines.join('\n');
    },
  };
}
