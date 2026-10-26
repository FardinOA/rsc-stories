import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderStory } from '../../src/vitest/index';
import { rscStories } from '../../src/vitest/plugin';
import { bundlePlay } from '../../src/node/server/play';
import { tempProject } from '../helpers/project';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RSC_STORIES_ORIGIN;
});

describe('renderStory (FR-7.1)', () => {
  it('asks the workshop to render and returns HTML, payload model and report', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('http://ws.test/__rsc_stories/api/render-story?id=ui-card--default&state=eyJhIjp7InRpdGxlIjoiWCJ9fQ');
      return Response.json({
        status: 200,
        html: '<html></html>',
        storyHtml: '<h2>X</h2>',
        report: { calls: [{ label: 'db' }], logs: [], warnings: [] },
        snapshot: { dom: '<h2>X</h2>', rsc: { type: 'h2' } },
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    process.env.RSC_STORIES_ORIGIN = 'http://ws.test';
    const story = await renderStory({ __rscStoriesId: 'ui-card--default' }, { args: { title: 'X' } });
    expect(story).toMatchObject({
      id: 'ui-card--default',
      status: 200,
      html: '<h2>X</h2>',
      rawHtml: '<h2>X</h2>',
      rsc: { type: 'h2' },
      calls: [{ label: 'db' }],
    });
    expect(story.container).toBeUndefined();
  });

  it('explains missing setup and server errors', async () => {
    await expect(renderStory('x')).rejects.toThrow(/running workshop/);
    process.env.RSC_STORIES_ORIGIN = 'http://ws.test';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ error: 'Unknown story "x"' }, { status: 404 })),
    );
    await expect(renderStory('x')).rejects.toThrow('renderStory("x"): Unknown story "x"');
    await expect(renderStory({} as never)).rejects.toThrow(/pass a story id/);
  });
});

describe('rscStories() plugin', () => {
  it('registers the global setup and turns story modules into id stubs', async () => {
    const root = await tempProject({
      'src/Card.stories.tsx': `export default { title: 'UI/Card' }; export const Default = {}; export const Big = { name: 'Big one' };`,
    });
    const plugin = rscStories({ cwd: root });
    expect(plugin.config!()).toEqual({ test: { globalSetup: [expect.stringMatching(/vitest\/global-setup/)] } });
    expect(rscStories({ cwd: root, server: false }).config!()).toEqual({});
    const code = plugin.load!(`${path.join(root, 'src/Card.stories.tsx')}?import`)!;
    expect(code).toContain('export default {"title":"UI/Card","id":"ui-card"};');
    expect(code).toContain('export const Big = {"__rscStoriesId":"ui-card--big","name":"Big one"};');
    expect(plugin.load!(path.join(root, 'src/other.ts'))).toBeNull();
  });
});

describe('bundlePlay (FR-1.9)', () => {
  it('keeps play functions and stubs everything else', async () => {
    const root = await tempProject({
      'Card.tsx': `import 'server-only'; import { db } from './db'; export const Card = () => db;`,
      'fixtures/data.json': '{"title":"From fixture"}',
      'Card.stories.tsx': `import { Card } from './Card';
import data from './fixtures/data.json';
import './card.css';
export default { component: Card, render: () => <Card /> };
export const Default = { play: async ({ canvas }) => canvas.getByText(data.title) };`,
    });
    const code = await bundlePlay(path.join(root, 'Card.stories.tsx'));
    expect(code).toContain('From fixture');
    expect(code).toContain('getByText');
    expect(code).toContain('rsc-stories-stub');
    const module = await import(`data:text/javascript,${encodeURIComponent(code)}`);
    expect(typeof module.Default.play).toBe('function');
    expect(await module.Default.play({ canvas: { getByText: (t: string) => t } })).toBe('From fixture');
  });
});
