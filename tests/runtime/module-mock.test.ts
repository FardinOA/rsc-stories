import { afterEach, describe, expect, it } from 'vitest';
import { createModuleMock, primitiveExports } from '../../src/runtime/mock/module-mock';
import { resolveMocks } from '../../src/runtime/server/mocks';
import { calls, makeStore, storage, useMocks } from '../helpers/store';

class Client {
  #secret = 'private';
  users = {
    findById: async (id: string) => ({ id, name: `real ${id}` }),
    count: () => 2,
  };
  peek() {
    return this.#secret;
  }
}

const real = {
  db: new Client(),
  getUser: async (id: string) => `real ${id}`,
  VERSION: '1.0',
  Widget: class Widget {
    kind = 'real';
  },
};

afterEach(() => useMocks(undefined));

describe('createModuleMock (FR-3.2)', () => {
  const mock = createModuleMock('@/lib/db', real);
  const db = mock.get('db') as Client;
  const getUser = mock.get('getUser') as (id: string) => Promise<string>;
  const Widget = mock.get('Widget') as new () => { kind: string };

  it('falls through to the real module outside stories', async () => {
    expect(await db.users.findById('1')).toEqual({ id: '1', name: 'real 1' });
    expect(await getUser('2')).toBe('real 2');
    expect(db.peek()).toBe('private');
    expect(mock.get('VERSION')).toBe('1.0');
    expect(new Widget().kind).toBe('real');
    expect(mock.get('db')).toBe(db);
    expect(db.users).toBe(db.users);
  });

  it('uses story mocks inside a render and records calls', async () => {
    useMocks(
      resolveMocks([
        {
          modules: {
            '@/lib/db': { db: { users: { findById: async (id: string) => ({ id, name: 'mock' }) } }, getUser: () => 'sync mock' },
          },
        },
      ]),
    );
    const store = makeStore();
    await storage.run(store, async () => {
      expect(await db.users.findById('9')).toEqual({ id: '9', name: 'mock' });
      expect(db.users.count()).toBe(2);
      expect(getUser('x')).toBe('sync mock');
    });
    expect(calls(store).map((c) => [c.label, c.mocked, c.status])).toEqual([
      ['db.users.findById', true, 'ok'],
      ['db.users.count', false, 'ok'],
      ['getUser', true, 'ok'],
    ]);
  });

  it('supports the sole-export shorthand from the SRS sample', async () => {
    const single = createModuleMock('single', { db: new Client() });
    const sdb = single.get('db') as Client;
    useMocks(resolveMocks([{ modules: { single: { users: { findById: async () => 'short' } } } }]));
    await storage.run(makeStore(), async () => {
      expect(await sdb.users.findById('1')).toBe('short');
    });
  });

  it('applies latency to mocked and real calls, and records errors', async () => {
    useMocks(
      resolveMocks([
        {
          modules: {
            '@/lib/db': {
              getUser: async () => {
                throw new Error('down');
              },
            },
          },
          latency: { '@/lib/db': 30 },
        },
      ]),
    );
    const store = makeStore();
    await storage.run(store, async () => {
      const started = performance.now();
      await db.users.findById('1');
      expect(performance.now() - started).toBeGreaterThanOrEqual(25);
      await expect(getUser('1')).rejects.toThrow('down');
    });
    expect(calls(store).map((c) => [c.label, c.status, c.latency])).toEqual([
      ['db.users.findById', 'ok', 30],
      ['getUser', 'error', 30],
    ]);
  });

  it('replaces classes and exports missing from the real module', () => {
    const cjs = createModuleMock('cjs', {});
    const named = cjs.get('helper') as () => string;
    useMocks(
      resolveMocks([
        {
          modules: {
            '@/lib/db': {
              Widget: class {
                kind = 'mock';
              },
            },
            cjs: { helper: () => 'from mock' },
          },
        },
      ]),
    );
    storage.run(makeStore(), () => {
      expect(new Widget().kind).toBe('mock');
      expect(named()).toBe('from mock');
    });
    expect(() => named()).toThrow(/not a function/);
  });

  it('lists primitive exports that cannot be mocked per story', () => {
    expect(primitiveExports('@/lib/db')).toEqual(['VERSION']);
    expect(primitiveExports('unknown')).toEqual([]);
  });
});
