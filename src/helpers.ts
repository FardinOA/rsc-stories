import { VARIANTS, type ModuleMock, type ModuleMockWithVariants } from './types';

/** Recursively optional, for typed module mocks. */
export type DeepPartial<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/**
 * Types a module mock against the real module:
 * `mockModule<typeof import('@/lib/db')>({ db: { orders: { findById: async () => order } } })`.
 */
export function mockModule<TModule>(implementation: DeepPartial<TModule>): ModuleMock {
  return implementation as ModuleMock;
}

/** A module mock with named variants, switchable from the Mocks panel. */
export function mockVariants(implementation: ModuleMock, variants: Record<string, ModuleMock>): ModuleMockWithVariants {
  return { [VARIANTS]: { default: implementation, variants } };
}

/** A recorded call to a {@link fn} spy. */
export interface SpyCall<TArgs extends unknown[], TResult> {
  args: TArgs;
  result?: TResult;
  error?: unknown;
}

/** A function that records its calls. Mirrors the parts of `vi.fn()` stories usually need. */
export interface Spy<TArgs extends unknown[] = unknown[], TResult = unknown> {
  (...args: TArgs): TResult;
  mock: { calls: TArgs[]; results: Array<SpyCall<TArgs, TResult>> };
  mockImplementation(implementation: (...args: TArgs) => TResult): Spy<TArgs, TResult>;
  mockReturnValue(value: TResult): Spy<TArgs, TResult>;
  mockReset(): Spy<TArgs, TResult>;
}

/**
 * A spy for function args. On the server its calls appear in the Calls panel; passed to a Client
 * Component it is turned into an action that logs to the Actions panel.
 */
export function fn<TArgs extends unknown[] = unknown[], TResult = undefined>(
  implementation?: (...args: TArgs) => TResult,
): Spy<TArgs, TResult> {
  let impl = implementation;
  const spy = function (this: unknown, ...args: TArgs): TResult {
    spy.mock.calls.push(args);
    try {
      const result = impl ? impl.apply(this, args) : (undefined as TResult);
      spy.mock.results.push({ args, result });
      return result;
    } catch (error) {
      spy.mock.results.push({ args, error });
      throw error;
    }
  } as Spy<TArgs, TResult>;
  spy.mock = { calls: [], results: [] };
  spy.mockImplementation = (next) => {
    impl = next;
    return spy;
  };
  spy.mockReturnValue = (value) => {
    impl = () => value;
    return spy;
  };
  spy.mockReset = () => {
    spy.mock.calls.length = 0;
    spy.mock.results.length = 0;
    impl = implementation;
    return spy;
  };
  Object.defineProperty(spy, Symbol.for('rsc-stories.fn'), { value: true });
  return spy;
}

/** Fixture data with the variants stories usually need (FR-3.9). */
export interface Fixture<T> {
  /** A fresh deep copy of the data. */
  readonly value: T;
  /** The data with a deep partial patch applied. */
  with(patch: DeepPartial<T>): T;
  /** Arrays emptied (top level and one level down), for empty states. */
  empty(): T;
  /** Arrays grown to `count` items by cloning, ids suffixed, for large-data states. */
  large(count: number): T;
  /** A promise that never settles, for loading states (keeps Suspense fallbacks on screen). */
  loading(): Promise<T>;
  /** A rejected promise, for error states. */
  error(message?: string): Promise<T>;
  /** The data after `ms` milliseconds. */
  delayed(ms: number): Promise<T>;
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : (JSON.parse(JSON.stringify(value)) as T);
}

function patchDeep(target: unknown, patch: unknown): unknown {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !target || typeof target !== 'object') {
    return patch;
  }
  const out: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch)) out[key] = patchDeep(out[key], value);
  return out;
}

function grow(items: unknown[], count: number): unknown[] {
  if (items.length === 0) return [];
  return Array.from({ length: count }, (_, index) => {
    const item = clone(items[index % items.length]);
    if (index >= items.length && item && typeof item === 'object' && 'id' in item) {
      const record = item as Record<string, unknown>;
      record.id = `${String(record.id)}-${index}`;
    }
    return item;
  });
}

/** Wraps JSON or TS fixture data with variant generators. */
export function fixture<T>(data: T): Fixture<T> {
  const mapArrays = (fnArray: (items: unknown[]) => unknown[]): T => {
    const copy = clone(data);
    if (Array.isArray(copy)) return fnArray(copy) as T;
    if (copy && typeof copy === 'object') {
      for (const [key, value] of Object.entries(copy)) {
        if (Array.isArray(value)) (copy as Record<string, unknown>)[key] = fnArray(value);
      }
    }
    return copy;
  };
  return {
    get value() {
      return clone(data);
    },
    with: (patch) => patchDeep(clone(data), patch) as T,
    empty: () => mapArrays(() => []),
    large: (count) => mapArrays((items) => grow(items, count)),
    loading: () => new Promise<T>(() => {}),
    error: (message = 'Fixture error') => Promise.reject(new Error(message)),
    delayed: (ms) => new Promise<T>((resolve) => setTimeout(() => resolve(clone(data)), ms)),
  };
}

/** Builds `count` items from a factory, for large-list stories. */
export function repeat<T>(count: number, factory: (index: number) => T): T[] {
  return Array.from({ length: count }, (_, index) => factory(index));
}
