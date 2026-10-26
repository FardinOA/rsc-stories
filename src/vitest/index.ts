// Imported by test files, which may run in jsdom: keep this module free of build tooling.
// The Vitest plugin lives in `rsc-stories/vitest/plugin`.
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { InspectorReport } from '../node/inspector/report';
import { encodeState, type MockOverrides } from '../shared/state';
import type { LogEntry, MockCall, RenderWarning } from '../shared/global';
import type { Globals } from '../types';

/** A story reference produced by the `rscStories()` plugin for `import * as stories from './X.stories'`. */
export interface StoryRef {
  readonly __rscStoriesId: string;
  readonly name?: string;
}

/** What {@link renderStory} returns. */
export interface RenderedStory {
  id: string;
  status: number;
  /** Normalized server HTML of the story root (deterministic, snapshot-friendly). */
  html: string;
  /** Server HTML of the story root as streamed (streamed boundaries resolved). */
  rawHtml: string | null;
  /** The full HTML document of the canvas. */
  documentHtml: string;
  /** The story's RSC model, normalized. */
  rsc: unknown;
  report: InspectorReport;
  calls: MockCall[];
  logs: LogEntry[];
  warnings: RenderWarning[];
  /** A detached element holding the server HTML, when a DOM is available (jsdom/happy-dom). */
  container?: HTMLElement;
  /** `root.innerHTML` after hydration in Chromium, with `hydrate: true`. */
  hydratedHtml?: string;
}

/** Options for {@link renderStory}: per-call args, mock overrides and globals, as the workshop URL state carries them. */
export interface RenderStoryOptions {
  args?: Record<string, unknown>;
  mocks?: MockOverrides;
  globals?: Globals;
  /** Also load the canvas in Chromium (needs Playwright) and return the hydrated DOM. */
  hydrate?: boolean;
  /** Workshop origin; defaults to the one started by the global setup. */
  origin?: string;
}

function origin(explicit?: string): string {
  const value = explicit ?? process.env.RSC_STORIES_ORIGIN;
  if (!value) {
    throw new Error(
      "renderStory needs a running workshop. Add `rscStories()` from 'rsc-stories/vitest/plugin' to the Vitest plugins (it registers a global setup), or set RSC_STORIES_ORIGIN.",
    );
  }
  return value;
}

/**
 * Renders a story through the real RSC pipeline and returns its server HTML, RSC payload and
 * inspector report (FR-7.1).
 */
export async function renderStory(
  /** A story id, or a story export imported through the `rscStories()` plugin. */
  story: string | StoryRef | object,
  options: RenderStoryOptions = {},
): Promise<RenderedStory> {
  const id = typeof story === 'string' ? story : (story as Partial<StoryRef>).__rscStoriesId;
  if (!id) throw new Error('renderStory: pass a story id, or a story imported through the rscStories() plugin.');
  const base = origin(options.origin);
  const state = encodeState({
    ...(options.args ? { args: options.args } : {}),
    ...(options.mocks ? { mocks: options.mocks } : {}),
    ...(options.globals ? { globals: options.globals } : {}),
  });
  const response = await fetch(`${base}/__rsc_stories/api/render-story?id=${encodeURIComponent(id)}&state=${state}`);
  const data = (await response.json()) as {
    error?: string;
    status: number;
    html: string;
    storyHtml: string | null;
    report: InspectorReport;
    snapshot: { dom: string; rsc: unknown };
  };
  if (!response.ok || data.error) throw new Error(`renderStory("${id}"): ${data.error ?? response.statusText}`);
  const result: RenderedStory = {
    id,
    status: data.status,
    html: data.snapshot.dom,
    rawHtml: data.storyHtml,
    documentHtml: data.html,
    rsc: data.snapshot.rsc,
    report: data.report,
    calls: data.report.calls,
    logs: data.report.logs,
    warnings: data.report.warnings,
  };
  if (typeof document !== 'undefined' && data.storyHtml !== null) {
    const container = document.createElement('div');
    container.innerHTML = data.storyHtml;
    result.container = container;
  }
  if (options.hydrate) result.hydratedHtml = await hydrate(base, id, state);
  return result;
}

async function hydrate(base: string, id: string, state: string): Promise<string> {
  const index = (await (await fetch(`${base}/__rsc_stories/api/index`)).json()) as {
    files: Array<{ fileKey: string; stories: Array<{ id: string; exportName: string }> }>;
  };
  const file = index.files.find((f) => f.stories.some((s) => s.id === id));
  const story = file?.stories.find((s) => s.id === id);
  if (!file || !story) throw new Error(`Unknown story "${id}"`);
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  type Page = {
    goto(url: string): Promise<unknown>;
    waitForFunction(expression: string): Promise<unknown>;
    waitForTimeout(ms: number): Promise<void>;
    evaluate(expression: string): Promise<unknown>;
  };
  type Playwright = { chromium: { launch(): Promise<{ newPage(): Promise<Page>; close(): Promise<void> }> } };
  let playwright: Playwright;
  try {
    const module = (await import(pathToFileURL(require.resolve('playwright')).href)) as Playwright & { default?: Playwright };
    playwright = module.default ?? module;
  } catch {
    throw new Error('renderStory({ hydrate: true }) needs Playwright: install `playwright`.');
  }
  const browser = await playwright.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${base}/rsc-stories/canvas/${encodeURIComponent(file.fileKey)}/${encodeURIComponent(story.exportName)}/${state}`);
    await page.waitForFunction('window.__RSC_STORIES__ && window.__RSC_STORIES__.hydrated');
    await page.waitForTimeout(100);
    return (await page.evaluate('document.querySelector("[data-rsc-stories-root]").innerHTML')) as string;
  } finally {
    await browser.close();
  }
}
