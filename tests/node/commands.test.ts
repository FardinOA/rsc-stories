import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runChecks } from '../../src/node/commands/doctor';
import { init } from '../../src/node/commands/init';
import { migrateSource } from '../../src/node/commands/migrate';
import { failuresOf } from '../../src/node/commands/test';
import type { InspectorReport } from '../../src/node/inspector/report';
import { ChunkSizer, attributeSizes } from '../../src/node/inspector/sizes';
import { tempProject } from '../helpers/project';

afterEach(() => vi.restoreAllMocks());

describe('migrate (FR-8.3)', () => {
  it('rewrites Storybook imports and flags what needs a hand', () => {
    const result = migrateSource(`import type { Meta, StoryObj } from '@storybook/nextjs';
import { fn, expect, userEvent as ue, within } from '@storybook/test';
const meta = { parameters: { nextjs: { appDirectory: true, navigation: { pathname: '/cart', query: { step: '2' } } } }, loaders: [async () => ({})], beforeEach: () => {} } satisfies Meta;
`);
    expect(result.changed).toBe(true);
    expect(result.code).toContain("from 'rsc-stories';");
    expect(result.code).toContain("import { fn } from 'rsc-stories';");
    expect(result.code).toContain("import { expect, userEvent as ue, within } from 'rsc-stories/test';");
    expect(result.code).toContain("TODO(rsc-stories): move to `mocks: { next: { pathname: '/cart', searchParams: { step: '2' } } }`");
    expect(result.todos).toHaveLength(3);
    expect(migrateSource(`import x from '@storybook/addon-x';`).todos[0]).toMatch(/Other @storybook/);
    expect(migrateSource(`const p = { nextjs: { appDirectory: true } };`).todos[0]).toMatch(/usually be removed/);
    expect(migrateSource(`export const A = {};`)).toEqual({ code: 'export const A = {};', changed: false, todos: [] });
  });
});

describe('init (FR-6.1)', () => {
  it('scaffolds config, preview, example story, scripts and gitignore without overwriting', async () => {
    const root = await tempProject({ 'src/app/globals.css': 'body{}', 'src/components/.keep': '', '.gitignore': 'node_modules' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await init({ cwd: root })).toBe(0);
    expect(readFileSync(path.join(root, '.rsc-stories/config.ts'), 'utf8')).toContain("stories: ['src/**/*.stories.{tsx,ts,jsx,js}']");
    expect(readFileSync(path.join(root, '.rsc-stories/preview.tsx'), 'utf8')).toContain("import '../src/app/globals.css';");
    expect(existsSync(path.join(root, 'src/components/rsc-stories-example/Welcome.stories.tsx'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts.stories).toBe('rsc-stories dev');
    expect(readFileSync(path.join(root, '.gitignore'), 'utf8')).toBe('node_modules\n.rsc-stories/.cache\nrsc-stories-static\n');
    const config = readFileSync(path.join(root, '.rsc-stories/config.ts'), 'utf8');
    await init({ cwd: root });
    expect(readFileSync(path.join(root, '.rsc-stories/config.ts'), 'utf8')).toBe(config);
    const dry = await tempProject({});
    await init({ cwd: dry, dryRun: true });
    expect(existsSync(path.join(dry, '.rsc-stories'))).toBe(false);
  });
});

describe('doctor (FR-6.5)', () => {
  it('reports versions, stories and mock problems', async () => {
    const root = await tempProject({
      'src/A.stories.tsx': `export default { title: 'A', mocks: { modules: { '@/missing': {} } } }; export const One = {};`,
      'src/B.stories.tsx': `export default {{`,
      '.storybook/main.ts': '',
    });
    const checks = await runChecks(root);
    const titles = checks.map((c) => `${c.level}:${c.title}`);
    expect(titles).toEqual(
      expect.arrayContaining(['ok:1 stories in 2 files', 'error:Mocked module "@/missing"', 'info:Storybook detected', 'warn:.gitignore']),
    );
    expect(titles.some((t) => t.startsWith('error:Cannot parse src/B.stories.tsx'))).toBe(true);
    expect(titles.some((t) => /^ok:Next\.js 16/.test(t))).toBe(true);
    const outside = await runChecks('/');
    expect(outside.some((c) => c.level === 'error' && c.title === 'Project')).toBe(true);
  });
});

describe('test command checks (FR-6.4)', () => {
  const base = { errors: [], nonSerializable: [], budgets: [] } as unknown as InspectorReport;
  it('fails on errors, serialization problems and budgets', () => {
    expect(failuresOf(base, 200)).toEqual([]);
    expect(
      failuresOf(
        {
          ...base,
          errors: [
            { message: 'boom', source: 'payload' },
            { message: 'just a log', source: 'log' },
            { message: 'Error: x\nstack', source: 'log' },
          ],
          nonSerializable: [
            { from: 'A', to: 'B', prop: 'f', reason: 'fn', source: 'react-error', severity: 'error' },
            { from: 'A', to: 'B', prop: 'd', reason: 'date', source: 'arg-check', severity: 'warning' },
          ],
          budgets: [{ name: 'rscPayloadKb', limit: 1, actual: 2, unit: 'kB', ok: false }],
        } as unknown as InspectorReport,
        500,
      ),
    ).toEqual([
      'HTTP 500 from the canvas',
      'Render error: boom',
      'Render error: Error: x',
      'Serialization: A → B prop "f": fn',
      'Budget rscPayloadKb: 2 kB > 1 kB',
    ]);
  });
});

describe('chunk sizes (FR-5.4)', () => {
  it('fetches chunks once and excludes framework chunks', async () => {
    let requests = 0;
    const server = createServer((req, res) => {
      requests++;
      if (req.url === '/_next/static/chunks/missing.js') return res.writeHead(404).end();
      res.end(req.url === '/_next/static/chunks/fw.js' ? 'f'.repeat(100) : 'x'.repeat(1000));
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const origin = `http://localhost:${(server.address() as { port: number }).port}`;
    const sizer = new ChunkSizer(origin);
    const ref = (name: string, chunks: string[]) => ({ rowId: name, moduleId: name, chunks, exportName: name, async: false });
    const result = await attributeSizes(
      sizer,
      [
        ref('A', ['static/chunks/a.js', '/_next/static/chunks/fw.js', 'static/chunks/missing.js']),
        ref('B', ['static/chunks/a.js', 'not-js.css']),
      ],
      [ref('Fw', ['/_next/static/chunks/fw.js'])],
    );
    expect(result.components.map((c) => [c.name, c.bytes, c.chunks.length])).toEqual([
      ['A', 1000, 2],
      ['B', 1000, 1],
    ]);
    expect(result.storyBytes).toBe(1000);
    expect(result.frameworkBytes).toBe(100);
    expect(result.storyGzip).toBeGreaterThan(0);
    const before = requests;
    await sizer.size('/_next/static/chunks/a.js');
    expect(requests).toBe(before);
    sizer.clear();
    server.close();
  });
});
