import type { NavigationSignal, RenderStore } from '../../shared/global';
import { toPreview } from '../../shared/preview';
import { currentMocks, endCall, startCall, storyStore } from './context';

/** Digest prefix carried by mocked navigation errors to the canvas error boundary. */
export const NAVIGATION_DIGEST = 'RSC_STORIES_NAV';

function record(store: RenderStore, label: string, args: unknown[] = [], result?: unknown): void {
  const call = startCall(store, {
    kind: 'next',
    key: `next:${label.split('(')[0]!.split('.')[0]}`,
    label,
    args: args.map((arg) => toPreview(arg)),
    mocked: true,
  });
  endCall(store, call, { status: 'ok', ...(result !== undefined ? { result: toPreview(result) } : {}) });
}

function jarFor(store: RenderStore): NonNullable<RenderStore['jar']> {
  if (!store.jar) {
    const mocks = currentMocks(store);
    store.jar = {
      cookies: new Map(Object.entries(mocks?.next.cookies ?? {})),
      draftMode: mocks?.next.draftMode ?? false,
    };
  }
  return store.jar;
}

interface CookieEntry {
  name: string;
  value: string;
}

/**
 * A cookie store with the `RequestCookies`/`ResponseCookies` surface. Writes are only allowed in
 * Server Actions, matching Next; every write is recorded in the call log.
 */
class MockCookies {
  constructor(
    private readonly store: RenderStore,
    private readonly jar: Map<string, string>,
  ) {}

  get size(): number {
    return this.jar.size;
  }

  get(nameOrCookie: string | { name: string }): CookieEntry | undefined {
    const name = typeof nameOrCookie === 'string' ? nameOrCookie : nameOrCookie.name;
    const value = this.jar.get(name);
    return value === undefined ? undefined : { name, value };
  }

  getAll(nameOrCookie?: string | { name: string }): CookieEntry[] {
    const all = [...this.jar].map(([name, value]) => ({ name, value }));
    if (nameOrCookie === undefined) return all;
    const name = typeof nameOrCookie === 'string' ? nameOrCookie : nameOrCookie.name;
    return all.filter((cookie) => cookie.name === name);
  }

  has(name: string): boolean {
    return this.jar.has(name);
  }

  private assertWritable(method: string): void {
    if (this.store.kind !== 'action') {
      throw new Error(`Cookies can only be modified in a Server Action or Route Handler (cookies().${method} called during render).`);
    }
  }

  set(...args: [string, string, Record<string, unknown>?] | [{ name: string; value: string }]): this {
    this.assertWritable('set');
    const [first, second] = args;
    const name = typeof first === 'string' ? first : first.name;
    const value = typeof first === 'string' ? String(second ?? '') : first.value;
    this.jar.set(name, value);
    record(this.store, `cookies().set(${name})`, args);
    return this;
  }

  delete(names: string | string[]): this {
    this.assertWritable('delete');
    for (const name of Array.isArray(names) ? names : [names]) this.jar.delete(name);
    record(this.store, `cookies().delete`, [names]);
    return this;
  }

  clear(): this {
    this.assertWritable('clear');
    this.jar.clear();
    record(this.store, 'cookies().clear');
    return this;
  }

  toString(): string {
    return [...this.jar].map(([name, value]) => `${name}=${encodeURIComponent(value)}`).join('; ');
  }

  [Symbol.iterator](): IterableIterator<[string, CookieEntry]> {
    return [...this.jar].map(([name, value]): [string, CookieEntry] => [name, { name, value }])[Symbol.iterator]();
  }
}

const NEXT_INTERNAL_HEADERS = /^(rsc|next-router-[a-z-]+|next-url|next-action|next-hmr-refresh|next-test-[a-z-]+|x-rsc-stories-[a-z-]+)$/i;

/** Read-only `Headers`, like Next's `ReadonlyHeaders`. */
function readonlyHeaders(headers: Headers): Headers {
  const fail = () => {
    throw new Error('Headers cannot be modified during a story render (headers() is read-only).');
  };
  return new Proxy(headers, {
    get(target, prop) {
      if (prop === 'set' || prop === 'append' || prop === 'delete') return fail;
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** Next 15 allowed synchronous access to these promises; mirror that so both versions work. */
function syncCompatible<T extends object>(value: T): Promise<T> & T {
  const promise = Promise.resolve(value) as Promise<T> & T;
  for (const key of Reflect.ownKeys(Object.getPrototypeOf(value) as object)) {
    if (key === 'constructor' || key in promise) continue;
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(value) as object, key);
    if (descriptor?.get) {
      Object.defineProperty(promise, key, { get: () => (value as Record<PropertyKey, unknown>)[key] });
    } else if (typeof descriptor?.value === 'function') {
      Object.defineProperty(promise, key, {
        value: (descriptor.value as (...a: unknown[]) => unknown).bind(value),
      });
    }
  }
  return promise;
}

interface RealHeaders {
  cookies: () => Promise<unknown>;
  headers: () => Promise<Headers>;
  draftMode: () => Promise<unknown>;
}

/** `next/headers` for story renders; outside stories it defers to Next. */
export function createHeadersShim(real: RealHeaders) {
  return {
    cookies(): Promise<unknown> {
      const store = storyStore();
      if (!store) return real.cookies();
      const jar = jarFor(store);
      record(store, 'cookies()', [], Object.fromEntries(jar.cookies));
      return syncCompatible(new MockCookies(store, jar.cookies));
    },

    headers(): Promise<Headers> {
      const store = storyStore();
      if (!store) return real.headers();
      const mocked = currentMocks(store)?.next.headers ?? {};
      const build = async () => {
        const merged = new Headers();
        try {
          const actual = await real.headers();
          actual.forEach((value, key) => {
            if (!NEXT_INTERNAL_HEADERS.test(key) && key !== 'cookie') merged.set(key, value);
          });
        } catch {
          // Outside a request scope there are no real headers to merge.
        }
        const cookie = new MockCookies(store, jarFor(store).cookies).toString();
        if (cookie) merged.set('cookie', cookie);
        for (const [key, value] of Object.entries(mocked)) merged.set(key, value);
        record(store, 'headers()', [], mocked);
        return readonlyHeaders(merged);
      };
      return build();
    },

    draftMode(): Promise<unknown> {
      const store = storyStore();
      if (!store) return real.draftMode();
      const jar = jarFor(store);
      record(store, 'draftMode()', [], { isEnabled: jar.draftMode });
      const draft = {
        get isEnabled() {
          return jar.draftMode;
        },
        enable() {
          jar.draftMode = true;
          record(store, 'draftMode().enable');
        },
        disable() {
          jar.draftMode = false;
          record(store, 'draftMode().disable');
        },
      };
      return syncCompatible(draft);
    },
  };
}

/** Error carrying a mocked navigation to the canvas error boundary. */
export class StoryNavigationError extends Error {
  readonly digest: string;
  constructor(readonly signal: NavigationSignal) {
    super(
      signal.url
        ? `${signal.type}(${JSON.stringify(signal.url)}) was called while rendering the story.`
        : `${signal.type}() was called while rendering the story.`,
    );
    this.name = 'StoryNavigationError';
    this.digest = [NAVIGATION_DIGEST, signal.type, signal.url ?? '', signal.redirectType ?? ''].join(';');
  }
}

/** Parses a navigation digest back into a signal (client side). */
export function parseNavigationDigest(digest: unknown): NavigationSignal | null {
  if (typeof digest !== 'string' || !digest.startsWith(NAVIGATION_DIGEST + ';')) return null;
  const [, type, url, redirectType] = digest.split(';');
  return {
    type: type as NavigationSignal['type'],
    ...(url ? { url } : {}),
    ...(redirectType ? { redirectType } : {}),
  };
}

function inCanvasBrowser(): boolean {
  return typeof window !== 'undefined' && !!(window as typeof window & { __RSC_STORIES_CANVAS__?: boolean }).__RSC_STORIES_CANVAS__;
}

interface RealNavigation {
  redirect: (url: string, type?: unknown) => never;
  permanentRedirect: (url: string, type?: unknown) => never;
  notFound: () => never;
  forbidden?: () => never;
  unauthorized?: () => never;
}

/** `redirect`, `notFound` & co. that surface in the canvas instead of navigating away. */
export function createNavigationShim(real: RealNavigation) {
  const signal = (type: NavigationSignal['type'], fallback: () => never, url?: string, redirectType?: unknown): never => {
    const store = storyStore();
    if (!store && !inCanvasBrowser()) return fallback();
    const navigation: NavigationSignal = {
      type,
      ...(url !== undefined ? { url } : {}),
      ...(typeof redirectType === 'string' ? { redirectType } : {}),
    };
    if (store) {
      store.emit({ type: 'navigation', signal: navigation });
      record(store, url !== undefined ? `${type}(${url})` : `${type}()`, url !== undefined ? [url] : []);
    }
    throw new StoryNavigationError(navigation);
  };
  return {
    redirect: (url: string, type?: unknown): never => signal('redirect', () => real.redirect(url, type), url, type),
    permanentRedirect: (url: string, type?: unknown): never =>
      signal('permanentRedirect', () => real.permanentRedirect(url, type), url, type),
    notFound: (): never => signal('notFound', () => real.notFound()),
    forbidden: (): never => signal('forbidden', () => (real.forbidden ? real.forbidden() : real.notFound())),
    unauthorized: (): never => signal('unauthorized', () => (real.unauthorized ? real.unauthorized() : real.notFound())),
  };
}

type AnyFunction = (...args: never[]) => unknown;

/** `next/cache` that records revalidation and keeps `unstable_cache` cold unless asked otherwise. */
export function createCacheShim<T extends Record<string, unknown>>(real: T): T {
  const shim: Record<string, unknown> = { ...real };
  const recorded = (name: string) => {
    const original = real[name];
    if (typeof original !== 'function') return;
    shim[name] = (...args: unknown[]) => {
      const store = storyStore();
      if (store) record(store, `${name}(${args.map((a) => JSON.stringify(a)).join(', ')})`, args);
      return (original as (...a: unknown[]) => unknown)(...args);
    };
  };
  for (const name of ['revalidatePath', 'revalidateTag', 'updateTag', 'refresh']) recorded(name);
  const realCache = real.unstable_cache;
  if (typeof realCache === 'function') {
    shim.unstable_cache = (callback: AnyFunction, keyParts?: string[], options?: unknown) => {
      const cached = (realCache as (...a: unknown[]) => AnyFunction)(callback, keyParts, options);
      return (...args: never[]) => {
        const store = storyStore();
        if (!store) return cached(...args);
        const cache = (store.story as { parameters?: { cache?: string } } | undefined)?.parameters?.cache;
        if (cache === 'warm') return cached(...args);
        record(store, `unstable_cache(${(keyParts ?? []).join(',')}) [cold]`);
        return callback(...args);
      };
    };
  }
  return shim as T;
}
