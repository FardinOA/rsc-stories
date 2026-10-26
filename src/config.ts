import type { Args, ArgTypes, Budgets, Decorator, Globals, Mocks, Parameters, Viewport } from './types';

/** An addon: extra workshop UI and/or render-time annotations (FR-8.1). */
export interface Addon {
  /** Unique name, shown in the UI and used in URLs. */
  name: string;
  /**
   * Path, relative to the project root, of a browser ES module whose default export receives the
   * {@link AddonApi} and registers panels or toolbar items.
   */
  manager?: string;
  /**
   * Path, relative to the project root, of a module exporting `decorators`, `parameters` or
   * `mocks`; applied to every story like `.rsc-stories/preview.tsx`.
   */
  preview?: string;
}

/** What an addon's manager module receives. Framework-agnostic: panels render into a DOM node. */
export interface AddonApi {
  addPanel(panel: { id: string; title: string; render(container: HTMLElement, context: AddonContext): void | (() => void) }): void;
  addToolbarItem(item: { id: string; title: string; onClick(context: AddonContext): void }): void;
}

/** Current workshop state passed to addon panels. */
export interface AddonContext {
  storyId: string | null;
  args: Record<string, unknown>;
  /** The latest inspector report for the story, when one exists. */
  report: unknown;
  /** Subscribe to workshop events (`story`, `render`, `args`); returns an unsubscribe function. */
  on(event: 'story' | 'render' | 'args', listener: () => void): () => void;
  /** Replace args for the current story. */
  updateArgs(args: Record<string, unknown>): void;
}

/** `.rsc-stories/config.ts`. */
export interface RscStoriesConfig {
  /** Story globs relative to the project root. Default: every `*.stories.{tsx,ts,jsx,js}` outside `node_modules`. */
  stories?: string[];
  /** Global mocks, the lowest-priority layer. `strictNetwork` turns unmocked requests into errors. */
  mocks?: Mocks;
  /** Global decorators, outermost. */
  decorators?: Decorator[];
  /** Global parameters. */
  parameters?: Parameters;
  /** Global default args and arg types. */
  args?: Args;
  argTypes?: ArgTypes;
  /** Initial toolbar globals (e.g. `{ theme: 'light' }`). */
  globals?: Globals;
  /** Budgets enforced by the inspector and `rsc-stories test` (FR-7.4). */
  budgets?: Budgets;
  /**
   * Environment variables visible while stories render (NFR-5.1). Patterns support a trailing
   * `*`. Defaults to `['NEXT_PUBLIC_*']`. `NODE_ENV` and system variables are always kept.
   */
  env?: { allow?: string[] };
  /** Extra module aliases for the generated app, specifier → path relative to the project root. */
  aliases?: Record<string, string>;
  /** Bundler for the generated app. Defaults to whatever the installed Next uses by default. */
  bundler?: 'turbopack' | 'webpack';
  /** Dev server port (default 6006) and host (default `localhost`, NFR-5.2). */
  port?: number;
  host?: string;
  /** Output directory of `rsc-stories build`. Default `rsc-stories-static`. */
  outDir?: string;
  /** Directory for `rsc-stories test` snapshots, relative to each story file. Default `__rsc_snapshots__`. */
  snapshotDir?: string;
  /** Extra viewport presets for the toolbar. */
  viewports?: Record<string, Viewport>;
  /** Addons (FR-8.1). */
  addons?: Addon[];
}

/** Identity helper that types `.rsc-stories/config.ts`. */
export function defineConfig(config: RscStoriesConfig): RscStoriesConfig {
  return config;
}

/** The default story globs. */
export const DEFAULT_STORY_GLOBS = ['**/*.stories.{tsx,ts,jsx,js,mts,mjs}'];

/** Default viewports offered in the toolbar. */
export const DEFAULT_VIEWPORTS: Record<string, Viewport> = {
  mobile: { name: 'Mobile', width: 375, height: 667, type: 'mobile' },
  tablet: { name: 'Tablet', width: 834, height: 1112, type: 'tablet' },
  laptop: { name: 'Laptop', width: 1280, height: 800, type: 'desktop' },
  desktop: { name: 'Desktop', width: 1680, height: 1050, type: 'desktop' },
};
