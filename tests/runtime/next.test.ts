import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createCacheShim,
  createHeadersShim,
  createNavigationShim,
  parseNavigationDigest,
  StoryNavigationError,
} from '../../src/runtime/mock/next';
import { resolveMocks } from '../../src/runtime/server/mocks';
import { calls, makeStore, storage, useMocks } from '../helpers/store';

afterEach(() => useMocks(undefined));

const real = {
  cookies: vi.fn(async () => 'real cookies'),
  headers: vi.fn(async () => new Headers({ 'user-agent': 'UA', cookie: 'real=1', rsc: '1', 'x-real': 'yes' })),
  draftMode: vi.fn(async () => 'real draft'),
};

describe('next/headers shim (FR-3.3)', () => {
  const shim = createHeadersShim(real);

  it('defers to Next outside stories', async () => {
    expect(await shim.cookies()).toBe('real cookies');
    expect(await shim.draftMode()).toBe('real draft');
    expect(await shim.headers()).toBeInstanceOf(Headers);
  });

  it('serves mocked cookies and blocks writes during render', async () => {
    useMocks(resolveMocks([{ next: { cookies: { locale: 'en', theme: 'dark' } } }]));
    const store = makeStore();
    await storage.run(store, async () => {
      const jar = (await shim.cookies()) as {
        get(n: string): { value: string } | undefined;
        getAll(n?: string): unknown[];
        has(n: string): boolean;
        size: number;
        set(n: string, v: string): void;
        toString(): string;
        [Symbol.iterator](): Iterator<unknown>;
      };
      expect(jar.get('locale')?.value).toBe('en');
      expect(jar.has('theme')).toBe(true);
      expect(jar.size).toBe(2);
      expect(jar.getAll()).toHaveLength(2);
      expect(jar.getAll('theme')).toEqual([{ name: 'theme', value: 'dark' }]);
      expect(jar.toString()).toBe('locale=en; theme=dark');
      expect([...jar]).toHaveLength(2);
      expect(() => jar.set('a', 'b')).toThrow(/Server Action/);
      // Next 15 allowed synchronous access.
      expect((shim.cookies() as unknown as { get(n: string): { value: string } }).get('locale').value).toBe('en');
    });
    expect(calls(store)[0]).toMatchObject({ kind: 'next', key: 'next:cookies', label: 'cookies()' });
  });

  it('allows cookie writes in Server Actions and records them', async () => {
    useMocks(resolveMocks([{ next: { cookies: { a: '1' } } }]));
    const store = makeStore({ kind: 'action' });
    await storage.run(store, async () => {
      const jar = (await shim.cookies()) as {
        set(...a: unknown[]): unknown;
        delete(n: string): unknown;
        clear(): unknown;
        get(n: string): unknown;
      };
      jar.set('b', '2');
      jar.set({ name: 'c', value: '3' });
      jar.delete('a');
      expect(jar.get('b')).toEqual({ name: 'b', value: '2' });
      jar.clear();
      expect(jar.get('c')).toBeUndefined();
    });
    expect(calls(store).map((c) => c.label)).toEqual([
      'cookies()',
      'cookies().set(b)',
      'cookies().set(c)',
      'cookies().delete',
      'cookies().clear',
    ]);
  });

  it('merges mocked headers over real ones without Next internals', async () => {
    useMocks(resolveMocks([{ next: { headers: { 'x-region': 'eu' }, cookies: { s: '1' } } }]));
    await storage.run(makeStore(), async () => {
      const headers = await shim.headers();
      expect(headers.get('x-region')).toBe('eu');
      expect(headers.get('user-agent')).toBe('UA');
      expect(headers.get('rsc')).toBeNull();
      expect(headers.get('cookie')).toBe('s=1');
      expect(() => headers.set('a', 'b')).toThrow(/read-only/);
    });
  });

  it('mocks draft mode', async () => {
    useMocks(resolveMocks([{ next: { draftMode: true } }]));
    const store = makeStore();
    await storage.run(store, async () => {
      const draft = (await shim.draftMode()) as { isEnabled: boolean; disable(): void; enable(): void };
      expect(draft.isEnabled).toBe(true);
      draft.disable();
      expect(draft.isEnabled).toBe(false);
      draft.enable();
      expect(draft.isEnabled).toBe(true);
    });
  });
});

describe('next/navigation shim', () => {
  const realNav = {
    redirect: vi.fn((): never => {
      throw new Error('real redirect');
    }),
    permanentRedirect: vi.fn((): never => {
      throw new Error('real permanent');
    }),
    notFound: vi.fn((): never => {
      throw new Error('real notFound');
    }),
  };
  const shim = createNavigationShim(realNav);

  it('throws the real errors outside stories', () => {
    expect(() => shim.redirect('/x')).toThrow('real redirect');
    expect(() => shim.notFound()).toThrow('real notFound');
    expect(() => shim.forbidden()).toThrow('real notFound');
  });

  it('turns navigation into a signal with a digest inside stories', () => {
    const store = makeStore();
    storage.run(store, () => {
      let error: unknown;
      try {
        shim.redirect('/login', 'replace');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(StoryNavigationError);
      expect(parseNavigationDigest((error as StoryNavigationError).digest)).toEqual({
        type: 'redirect',
        url: '/login',
        redirectType: 'replace',
      });
      expect(() => shim.permanentRedirect('/new')).toThrow('permanentRedirect("/new") was called');
      expect(() => shim.notFound()).toThrow('notFound() was called');
      expect(() => shim.unauthorized()).toThrow(StoryNavigationError);
    });
    expect(store.events.filter((e) => e.type === 'navigation')).toHaveLength(4);
    expect(parseNavigationDigest('other')).toBeNull();
  });
});

describe('next/cache shim', () => {
  it('records revalidation and keeps unstable_cache cold by default', async () => {
    const revalidatePath = vi.fn();
    const cachedResult = vi.fn(async () => 'cached');
    const shim = createCacheShim({ revalidatePath, unstable_cache: () => cachedResult, other: 1 }) as unknown as {
      revalidatePath: (path: string) => void;
      unstable_cache: (fn: () => Promise<string>, keys: string[]) => () => Promise<string>;
      other: number;
    };
    const store = makeStore();
    const fn = vi.fn(async () => 'fresh');
    const wrapped = shim.unstable_cache(fn, ['k']);
    await storage.run(store, async () => {
      shim.revalidatePath('/a');
      expect(await wrapped()).toBe('fresh');
    });
    expect(revalidatePath).toHaveBeenCalledWith('/a');
    expect(calls(store).map((c) => c.label)).toEqual(['revalidatePath("/a")', 'unstable_cache(k) [cold]']);
    const warm = makeStore({ story: { parameters: { cache: 'warm' } } });
    await storage.run(warm, async () => expect(await wrapped()).toBe('cached'));
    expect(await wrapped()).toBe('cached');
    expect(shim.other).toBe(1);
  });
});
