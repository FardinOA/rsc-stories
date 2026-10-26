import { describe, expect, it } from 'vitest';
import { mockVariants } from '../../src/helpers';
import { deepMerge, describeMatcher, moduleLatency, resolveMocks } from '../../src/runtime/server/mocks';

describe('resolveMocks (FR-3.7)', () => {
  it('layers modules: later layers override exports, false removes', () => {
    const findById = async () => 'meta';
    const story = async () => 'story';
    const mocks = resolveMocks([
      { modules: { '@/lib/db': { users: { findById, list: async () => [] } }, '@/lib/flags': { on: true } } },
      { modules: { '@/lib/db': { users: { findById: story } }, '@/lib/flags': false } },
    ]);
    const db = mocks.modules.get('@/lib/db')!;
    expect(db.impl).toMatchObject({ users: { findById: story } });
    expect((db.impl.users as Record<string, unknown>).list).toBeTypeOf('function');
    expect(mocks.modules.has('@/lib/flags')).toBe(false);
  });

  it('evaluates function mocks per call (isolation)', () => {
    let n = 0;
    const factory = () => ({ modules: { m: { value: ++n } } });
    expect(resolveMocks([factory]).modules.get('m')!.impl).toEqual({ value: 1 });
    expect(resolveMocks([factory]).modules.get('m')!.impl).toEqual({ value: 2 });
  });

  it('orders fetch mocks by priority and overrides by name', () => {
    const mocks = resolveMocks([
      {
        fetch: [
          { name: 'a', match: '/a', response: 1 },
          { match: '/b', response: 'meta b' },
        ],
      },
      { fetch: { a: { match: '/a', response: 2 }, gone: false } },
    ]);
    expect(mocks.fetch.map((f) => [f.name, f.behavior.response])).toEqual([
      ['a', 2],
      ['/b', 'meta b'],
    ]);
    const removed = resolveMocks([{ fetch: [{ name: 'x', match: '/x' }] }, { fetch: { x: false } }]);
    expect(removed.fetch).toEqual([]);
  });

  it('applies runtime overrides: off, variants, latency', () => {
    const mocks = resolveMocks(
      [
        {
          modules: { db: mockVariants({ get: async () => 'default' }, { empty: { get: async () => 'empty' } }) },
          fetch: [{ name: 'rates', match: '/rates', response: 1, variants: { error: { status: 500 } } }],
          next: { cookies: { a: '1' }, headers: { h: 'v' } },
          latency: { db: 100 },
        },
      ],
      { off: ['next:headers'], variants: { 'module:db': 'empty', 'fetch:rates': 'error' }, latency: { 'fetch:rates': 250 } },
    );
    expect(mocks.modules.get('db')).toMatchObject({ variant: 'empty', variants: ['empty'], latency: 100 });
    expect(mocks.fetch[0]).toMatchObject({ variant: 'error', latency: 250, behavior: { status: 500 } });
    expect(mocks.next).toEqual({ cookies: { a: '1' } });
    expect(mocks.catalog.map((c) => [c.key, c.active])).toEqual([
      ['module:db', true],
      ['fetch:rates', true],
      ['next:cookies', true],
      ['next:headers', false],
    ]);
    const off = resolveMocks([{ modules: { db: { a: 1 } } }], { off: ['module:db', 'fetch:none'] });
    expect(off.modules.size).toBe(0);
  });

  it('resolves latency: per key, per family, global', () => {
    const mocks = resolveMocks([
      { modules: { a: {}, b: {} }, fetch: [{ name: 'f', match: '/f' }], latency: 50 },
      { latency: { a: 10, fetch: 30 } },
    ]);
    expect(mocks.modules.get('a')!.latency).toBe(10);
    expect(mocks.modules.get('b')!.latency).toBe(50);
    expect(mocks.fetch[0]!.latency).toBe(30);
    expect(moduleLatency(mocks, 'unmocked')).toBe(50);
    const slowReal = resolveMocks([{ latency: { '@/lib/real': 300 } }]);
    expect(moduleLatency(slowReal, '@/lib/real')).toBe(300);
    expect(slowReal.catalog[0]).toMatchObject({ key: 'module:@/lib/real', detail: 'real implementation (latency only)' });
  });

  it('describes matchers', () => {
    expect(describeMatcher('GET /a')).toBe('GET /a');
    expect(describeMatcher(/a+/)).toBe('/a+/');
    expect(
      describeMatcher(function isUser() {
        return true;
      }),
    ).toBe('ƒ isUser');
    expect(describeMatcher({ url: '/u', method: 'post' })).toBe('POST /u');
    expect(describeMatcher({})).toBe('*');
  });

  it('deep merges plain objects only', () => {
    expect(deepMerge({ a: { b: 1, c: 2 } }, { a: { b: 3 } })).toEqual({ a: { b: 3, c: 2 } });
    expect(deepMerge({ a: [1] }, { a: [2] })).toEqual({ a: [2] });
    expect(deepMerge(1, { a: 1 })).toEqual({ a: 1 });
  });
});
