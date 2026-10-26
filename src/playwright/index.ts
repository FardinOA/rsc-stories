import { expect, test as base, type Locator, type Page } from '@playwright/test';
import type { InspectorReport } from '../node/inspector/report';
import type { CanvasMessage } from '../shared/protocol';
import { canvasPath, type MockOverrides } from '../shared/state';
import type { Globals } from '../types';

/** A story opened in the canvas. */
export interface OpenedStory {
  id: string;
  page: Page;
  /** The story root element. */
  root: Locator;
  /** Runs the story's play function in the page; throws if it fails. */
  play(): Promise<void>;
  /** The inspector report of the render shown. */
  report(): Promise<InspectorReport>;
  /** Messages the canvas sent (logs, actions, router calls, hydration mismatches). */
  messages(): Promise<CanvasMessage[]>;
}

/** The `stories` fixture: opens stories in the canvas of a running workshop. */
export interface StoriesFixture {
  open(id: string, options?: { args?: Record<string, unknown>; mocks?: MockOverrides; globals?: Globals }): Promise<OpenedStory>;
}

interface IndexFile {
  fileKey: string;
  stories: Array<{ id: string; exportName: string }>;
}

/**
 * Playwright test with a `stories` fixture (FR-7.2). Point `baseURL` (or RSC_STORIES_ORIGIN) at a
 * running workshop, e.g. via `webServer: { command: 'rsc-stories dev --port 6006' }`.
 */
export const test = base.extend<{ stories: StoriesFixture }>({
  stories: async ({ page, baseURL }, use) => {
    const origin = baseURL ?? process.env.RSC_STORIES_ORIGIN ?? 'http://localhost:6006';
    let index: IndexFile[] | undefined;
    await use({
      async open(id, options = {}) {
        index ??= ((await (await fetch(`${origin}/__rsc_stories/api/index`)).json()) as { files: IndexFile[] }).files;
        const file = index.find((f) => f.stories.some((s) => s.id === id));
        const story = file?.stories.find((s) => s.id === id);
        if (!file || !story) throw new Error(`Unknown story "${id}"`);
        const url = canvasPath(file.fileKey, story.exportName, options);
        const response = await page.goto(new URL(url, origin).href);
        const renderId = response?.headers()['x-rsc-stories-render'];
        await page.waitForFunction(() => (window as unknown as { __RSC_STORIES__?: { hydrated: boolean } }).__RSC_STORIES__?.hydrated);
        return {
          id,
          page,
          root: page.locator('[data-rsc-stories-root]'),
          async play() {
            const result = (await page.evaluate(() =>
              (window as unknown as { __RSC_STORIES__: { runPlay(): Promise<unknown> } }).__RSC_STORIES__.runPlay(),
            )) as { status?: string; error?: string } | undefined;
            if (result?.status === 'failed') throw new Error(`Play function of ${id} failed: ${result.error}`);
          },
          async report() {
            if (!renderId) throw new Error('The canvas response carried no render id.');
            return (await (await fetch(`${origin}/__rsc_stories/api/report/${renderId}`)).json()) as InspectorReport;
          },
          async messages() {
            return (await page.evaluate(
              () => (window as unknown as { __RSC_STORIES__: { messages: unknown[] } }).__RSC_STORIES__.messages,
            )) as CanvasMessage[];
          },
        };
      },
    });
  },
});

/** Playwright's `expect`, re-exported so tests need one import. */
export { expect };
