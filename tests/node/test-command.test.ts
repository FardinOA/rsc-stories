import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { compareSnapshot, runStoryTests, snapshotFiles } from '../../src/node/commands/test';
import type { WorkshopServer } from '../../src/node/server/server';

const snapshot = { dom: '<p>a</p>', rsc: { type: 'p' }, report: { storyId: 's' } };

describe('snapshots (FR-6.4, FR-7.3)', () => {
  it('writes new snapshots, matches, reports mismatches and updates', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'snap-'));
    const files = snapshotFiles(path.join(dir, 'A.stories.tsx'), 'a--b', '__rsc_snapshots__');
    expect(files.dom).toBe(path.join(dir, '__rsc_snapshots__', 'a--b.html'));
    expect(await compareSnapshot(files, snapshot, { update: false, ci: true })).toEqual({ state: 'missing' });
    expect(await compareSnapshot(files, snapshot, { update: false, ci: false })).toEqual({ state: 'written' });
    expect(await readFile(files.rsc, 'utf8')).toBe('{\n  "type": "p"\n}\n');
    expect(await compareSnapshot(files, snapshot, { update: false, ci: false })).toEqual({ state: 'matched' });
    const changed = { ...snapshot, dom: '<p>b</p>' };
    const mismatch = await compareSnapshot(files, changed, { update: false, ci: false });
    expect(mismatch.state).toBe('mismatch');
    expect(mismatch.diff).toContain('a--b.html');
    expect(await compareSnapshot(files, changed, { update: true, ci: false })).toEqual({ state: 'updated' });
    expect(await compareSnapshot(files, changed, { update: true, ci: false })).toEqual({ state: 'matched' });
  });
});

describe('runStoryTests', () => {
  it('renders stories, applies filters and tags, and collects failures', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'run-'));
    await writeFile(path.join(dir, 'A.stories.tsx'), '');
    const report = (budgetOk: boolean) => ({
      errors: [],
      nonSerializable: [],
      budgets: [{ name: 'rscPayloadKb', limit: 1, actual: budgetOk ? 0.5 : 2, unit: 'kB', ok: budgetOk }],
      warnings: [{ type: 'unmocked-request', message: 'Unmocked request: GET x' }],
      storyPayloadBytes: 10,
      clientJsGzipBytes: 0,
    });
    const renderStory = vi.fn(async (id: string) => {
      if (id === 'a--throws') throw new Error('render failed');
      return { status: 200, report: report(id !== 'a--over'), snapshot };
    });
    const server = {
      project: { config: {}, root: dir },
      // Dev mode: the first story renders alone before the rest run concurrently.
      options: { mode: 'dev' },
      origin: 'http://localhost',
      storyIndex: {
        files: [
          {
            file: path.join(dir, 'A.stories.tsx'),
            relativePath: 'A.stories.tsx',
            fileKey: 'a',
            stories: [
              { id: 'a--ok', exportName: 'Ok', tags: [], hasPlay: false },
              { id: 'a--over', exportName: 'Over', tags: [], hasPlay: false },
              { id: 'a--throws', exportName: 'Throws', tags: [], hasPlay: false },
              { id: 'a--skipped', exportName: 'Skipped', tags: ['!test'], hasPlay: false },
            ],
          },
        ],
      },
      renderStory,
    } as unknown as WorkshopServer;
    const lines: string[] = [];
    const results = await runStoryTests(server, { cwd: dir, update: false, browser: false, dev: true }, (line) => lines.push(line));
    expect(results.map((r) => [r.storyId, r.status, r.snapshot])).toEqual([
      ['a--ok', 'passed', 'written'],
      ['a--over', 'failed', 'written'],
      ['a--throws', 'failed', 'matched'],
    ]);
    expect(results[1]!.failures).toEqual(['Budget rscPayloadKb: 2 kB > 1 kB']);
    expect(results[2]!.failures).toEqual(['render failed']);
    expect(results[0]!.warnings).toEqual(['Unmocked request: GET x']);
    expect(lines.some((l) => l.includes('a--ok'))).toBe(true);
    const filtered = await runStoryTests(server, { cwd: dir, update: false, browser: false, dev: true, filter: 'over' }, () => {});
    expect(filtered.map((r) => r.storyId)).toEqual(['a--over']);
  });
});
