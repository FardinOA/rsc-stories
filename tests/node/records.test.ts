import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildReport, payloadRows } from '../../src/node/inspector/report';
import { ChunkSizer } from '../../src/node/inspector/sizes';
import { installStorage, RecordStore, recordToJson, storeFor } from '../../src/node/server/records';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));

describe('RecordStore', () => {
  it('creates records, applies runtime events and finishes', () => {
    const records = new RecordStore();
    const events: string[] = [];
    records.on('render:start', () => events.push('start'));
    records.on('render:update', (_r, e: { type: string }) => events.push(e.type));
    records.on('render:end', () => events.push('end'));
    const record = records.create({ kind: 'canvas', method: 'GET', url: '/c', fileKey: 'f', exportName: 'E', state: {} });
    const store = storeFor(record, records, { mode: 'dev', strictNetwork: true, origin: 'http://x', isStatic: true });
    expect(store).toMatchObject({ renderId: record.renderId, strictNetwork: true, isStatic: true });
    const call = { id: 1, kind: 'module' as const, key: 'k', label: 'l', args: [], mocked: true, status: 'pending' as const, start: 0 };
    store.emit({ type: 'call:start', call });
    store.emit({ type: 'call:end', call: { ...call, status: 'ok' } });
    store.emit({ type: 'warning', warning: { type: 'unmocked-request', message: 'w' } });
    store.emit({ type: 'warning', warning: { type: 'unmocked-request', message: 'w' } });
    store.emit({ type: 'log', entry: { origin: 'server', level: 'log', message: 'm', time: 1 } });
    store.emit({ type: 'navigation', signal: { type: 'notFound' } });
    store.emit({ type: 'story', storyId: 's', title: 't', name: 'n', budgets: { rscPayloadKb: 1 } });
    records.finish(record);
    expect(record.calls).toEqual([{ ...call, status: 'ok' }]);
    expect(record.warnings).toHaveLength(1);
    expect(record).toMatchObject({ storyId: 's', budgets: { rscPayloadKb: 1 }, done: true });
    expect(events).toEqual(['start', 'call:start', 'call:end', 'warning', 'warning', 'log', 'navigation', 'story', 'end']);
    expect(recordToJson(record)).toMatchObject({ renderId: record.renderId, storyId: 's', done: true, bodyBytes: 0 });
    expect(records.get(record.renderId)).toBe(record);
    expect(records.all()).toHaveLength(1);
    for (let i = 0; i < 305; i++) records.create({ kind: 'meta', method: 'GET', url: '/', fileKey: '', exportName: '', state: {} });
    expect(records.all()).toHaveLength(300);
    expect(installStorage()).toBe(installStorage());
  });
});

describe('buildReport (FR-5.x)', () => {
  it('assembles a report from a captured development render', async () => {
    const records = new RecordStore();
    const record = records.create({
      kind: 'canvas',
      method: 'GET',
      url: '/c',
      fileKey: 'people-usercard',
      exportName: 'Default',
      state: {},
    });
    record.contentType = 'html';
    record.body = [fixture('usercard.dev.html')];
    record.firstByteAt = record.startedAt + 40;
    record.endedAt = record.startedAt + 100;
    record.storyId = 'people-usercard--default';
    record.budgets = { rscPayloadKb: 0.1, clientJsKbPerStory: 100, serverRenderMs: 1000 };
    record.calls = [
      {
        id: 1,
        kind: 'module',
        key: 'module:@/lib/db',
        label: 'db.users.findById',
        args: ['u1'],
        mocked: true,
        status: 'ok',
        start: 5,
        duration: 10,
        latency: 0,
      },
      { id: 2, kind: 'next', key: 'next:cookies', label: 'cookies()', args: [], mocked: true, status: 'ok', start: 6, duration: 0 },
    ];
    record.logs = [{ origin: 'server', level: 'error', message: 'Error: something odd', time: 1 }];
    record.warnings = [
      {
        type: 'non-serializable-arg',
        message: 'Arg "when" → Button: Date crosses the boundary.',
        detail: { path: 'when', kind: 'date', severity: 'warning' },
      },
    ];
    const report = await buildReport(record, {
      rootDir: '/repo',
      projectRoot: '/repo/examples/minimal',
      workshopDir: '/repo/examples/minimal/.rsc-stories/.cache/workshop',
      distDir: '/nowhere',
      sizer: new ChunkSizer('http://127.0.0.1:1'),
      mode: 'dev',
    });
    expect(report.storyId).toBe('people-usercard--default');
    expect(report.boundaries.map((b) => `${b.from}→${b.to}`)).toEqual(['UserCard→FollowButton']);
    expect(report.clientComponents[0]).toMatchObject({ name: 'FollowButton', file: 'src/components/FollowButton.tsx' });
    expect(report.timings).toMatchObject({ fetch: 10, ttfb: 40, total: 100 });
    expect(report.timeline.some((t) => t.lane === 'server' && t.label.includes('UserCard'))).toBe(true);
    expect(report.timeline.some((t) => t.lane === 'data')).toBe(true);
    expect(report.nonSerializable).toEqual([
      { from: '(story args)', to: 'Button', prop: 'when', reason: 'Date crosses the boundary.', source: 'arg-check', severity: 'warning' },
    ]);
    expect(report.errors).toEqual([{ message: 'Error: something odd', source: 'log' }]);
    expect(report.budgets.map((b) => [b.name, b.ok])).toEqual([
      ['rscPayloadKb', false],
      ['clientJsKbPerStory', true],
      ['serverRenderMs', true],
    ]);
    // Development chunks are unminified: the client JS budget is reported, not enforced.
    expect(report.budgets.find((b) => b.name === 'clientJsKbPerStory')?.skipped).toMatch(/production builds/);
    expect(report.serverHtml).toContain('Ada Lovelace');
    expect(payloadRows(record).length).toBeGreaterThan(50);
  });

  it('handles RSC navigations, errors and empty bodies', async () => {
    const records = new RecordStore();
    const ctx = {
      rootDir: '/repo',
      projectRoot: '/repo/examples/minimal',
      workshopDir: '/w',
      distDir: '/nowhere',
      sizer: new ChunkSizer('http://127.0.0.1:1'),
      mode: 'dev' as const,
    };
    const rsc = records.create({ kind: 'canvas', method: 'GET', url: '/c', fileKey: 'f', exportName: 'E', state: {} });
    rsc.contentType = 'rsc';
    rsc.body = [fixture('usercard.dev.rsc')];
    expect((await buildReport(rsc, ctx)).boundaries).toHaveLength(1);
    const broken = records.create({ kind: 'canvas', method: 'GET', url: '/c', fileKey: 'f', exportName: 'E', state: {} });
    broken.contentType = 'html';
    broken.body = [fixture('functionprop.dev.html')];
    const report = await buildReport(broken, ctx);
    expect(report.nonSerializable).toEqual([
      {
        from: 'PassesAFunction',
        to: 'Toggle',
        prop: 'onToggle',
        reason: 'Event handlers cannot be passed to Client Component props',
        source: 'react-error',
        severity: 'error',
      },
    ]);
    expect(report.boundaries[0]!.nonSerializable).toEqual([
      { prop: 'onToggle', reason: 'Event handlers cannot be passed to Client Component props' },
    ]);
    const empty = records.create({ kind: 'canvas', method: 'GET', url: '/c', fileKey: 'f', exportName: 'E', state: {} });
    expect(await buildReport(empty, ctx)).toMatchObject({ payloadBytes: 0, tree: null, serverHtml: null });
    expect(payloadRows(empty)).toEqual([]);
  });
});
