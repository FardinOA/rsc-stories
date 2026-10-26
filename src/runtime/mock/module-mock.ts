import { toPreview } from '../../shared/preview';
import { moduleLatency } from '../server/mocks';
import { currentMocks, endCall, isThenable, sleep, startCall, storyStore } from './context';

type Path = readonly string[];

type MockNode =
  | { kind: 'none' }
  /** The mock replaces the value at this path entirely. */
  | { kind: 'value'; value: unknown }
  /** A plain object: its keys override, other keys fall through to the real value. */
  | { kind: 'object'; value: Record<string, unknown> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

function walk(root: unknown, path: Path): MockNode {
  let node: unknown = root;
  for (const key of path) {
    if (!isPlainObject(node) || !Object.prototype.hasOwnProperty.call(node, key)) {
      return { kind: 'none' };
    }
    node = node[key];
  }
  return isPlainObject(node) ? { kind: 'object', value: node } : { kind: 'value', value: node };
}

/** Real modules registered by shims, used to report mocks of primitive exports. */
const realModules = new Map<string, Record<string, unknown>>();

/** Export names of a real module whose values cannot be swapped per story. */
export function primitiveExports(specifier: string): string[] {
  const real = realModules.get(specifier);
  if (!real) return [];
  return Object.keys(real).filter((key) => {
    const value = real[key];
    return value !== null && value !== undefined && typeof value !== 'object' && typeof value !== 'function';
  });
}

/**
 * The one object export of a module such as `export const db = createClient()`. Mocks for such
 * modules may omit the export name: `{ orders: { findById } }` patches `db.orders.findById`.
 */
function soleObjectExport(real: Record<string, unknown>): string | undefined {
  const objects = Object.keys(real).filter((key) => {
    if (key === 'default' || key === '__esModule') return false;
    const value = real[key];
    return !!value && typeof value === 'object';
  });
  return objects.length === 1 ? objects[0] : undefined;
}

/**
 * Creates the per-export proxies a generated module shim re-exports. Each access consults the
 * mocks of the render in progress, so one bundled module serves every story without rebuilding.
 */
export function createModuleMock(specifier: string, real: Record<string, unknown>) {
  realModules.set(specifier, real);
  const sole = soleObjectExport(real);
  const exportsCache = new Map<string, unknown>();
  const childCache = new WeakMap<object, Map<string, unknown>>();
  // Proxy → real object, so real methods run with their real `this` (private fields, brands).
  const targets = new WeakMap<object, object>();
  const unwrap = (value: unknown): unknown =>
    value && (typeof value === 'object' || typeof value === 'function') ? (targets.get(value as object) ?? value) : value;

  const resolveNode = (path: Path): MockNode => {
    const mocks = currentMocks();
    const mock = mocks?.modules.get(specifier);
    if (!mock) return { kind: 'none' };
    const direct = walk(mock.impl, path);
    if (direct.kind !== 'none') return direct;
    // Sole-export shorthand: the mock describes the export itself.
    if (sole && path[0] === sole && !Object.prototype.hasOwnProperty.call(mock.impl, sole)) {
      return path.length === 1 ? { kind: 'object', value: mock.impl as Record<string, unknown> } : walk(mock.impl, path.slice(1));
    }
    return { kind: 'none' };
  };

  const invoke = (
    path: Path,
    fn: (...args: unknown[]) => unknown,
    thisArg: unknown,
    args: unknown[],
    mocked: boolean,
    construct = false,
  ): unknown => {
    const call = () =>
      construct ? Reflect.construct(fn as unknown as new (...a: unknown[]) => object, args) : Reflect.apply(fn, thisArg, args);
    const store = storyStore();
    const mocks = currentMocks(store);
    if (!store || !mocks) return call();
    const latency = moduleLatency(mocks, specifier);
    const mock = mocks.modules.get(specifier);
    if (!mocked && !mock && latency <= 0) return call();
    const record = startCall(store, {
      kind: 'module',
      key: `module:${specifier}`,
      label: path.join('.'),
      args: args.map((arg) => toPreview(arg)),
      mocked,
      ...(mock?.variant ? { variant: mock.variant } : {}),
      ...(latency > 0 ? { latency } : {}),
    });
    let result: unknown;
    try {
      result = call();
    } catch (error) {
      endCall(store, record, { status: 'error', error: (error as Error)?.message ?? String(error) });
      throw error;
    }
    if (isThenable(result)) {
      return Promise.all([result, sleep(latency)]).then(
        ([value]) => {
          endCall(store, record, { status: 'ok', result: toPreview(value) });
          return value;
        },
        (error: unknown) => {
          endCall(store, record, { status: 'error', error: (error as Error)?.message ?? String(error) });
          throw error;
        },
      );
    }
    endCall(store, record, { status: 'ok', result: toPreview(result) });
    return result;
  };

  const wrapMockFunction = (path: Path, fn: (...args: unknown[]) => unknown): unknown =>
    new Proxy(fn, {
      apply: (target, thisArg, args: unknown[]) => invoke(path, target, thisArg, args, true),
      construct: (target, args: unknown[]) => invoke(path, target, undefined, args, true, true) as object,
    });

  const makeProxy = (path: Path, realValue: unknown): unknown => {
    const target: object =
      typeof realValue === 'function' || (realValue !== null && typeof realValue === 'object')
        ? (realValue as object)
        : function placeholder() {};
    const proxy: object = new Proxy(target, {
      get(t, prop, receiver) {
        if (typeof prop === 'symbol') return Reflect.get(t, prop, receiver);
        const own = resolveNode(path);
        if (own.kind === 'value') {
          const mockValue = own.value as Record<string, unknown> | null | undefined;
          return mockValue == null ? undefined : mockValue[prop];
        }
        const childPath = [...path, prop];
        const node = resolveNode(childPath);
        if (node.kind === 'value') {
          return typeof node.value === 'function' ? wrapMockFunction(childPath, node.value as (...args: unknown[]) => unknown) : node.value;
        }
        const realChild = target === realValue ? Reflect.get(t, prop, t) : undefined;
        if (node.kind === 'object' || typeof realChild === 'function' || (realChild && typeof realChild === 'object')) {
          if (realChild === undefined && node.kind !== 'object') return undefined;
          // Cache child proxies per real parent so identity is stable across accesses.
          const parent = target;
          let children = childCache.get(parent);
          if (!children) childCache.set(parent, (children = new Map()));
          const cacheKey = childPath.join('\u0000');
          if (!children.has(cacheKey)) children.set(cacheKey, makeProxy(childPath, realChild));
          return children.get(cacheKey);
        }
        return realChild;
      },
      apply(t, thisArg, args: unknown[]) {
        const own = resolveNode(path);
        if (own.kind === 'value' && typeof own.value === 'function') {
          return invoke(path, own.value as (...a: unknown[]) => unknown, thisArg, args, true);
        }
        if (typeof realValue !== 'function') {
          throw new TypeError(`${path.join('.')} from "${specifier}" is not a function in this story.`);
        }
        return invoke(path, realValue as (...a: unknown[]) => unknown, unwrap(thisArg), args, false);
      },
      construct(t, args: unknown[]) {
        const own = resolveNode(path);
        if (own.kind === 'value' && typeof own.value === 'function') {
          return invoke(path, own.value as (...a: unknown[]) => unknown, undefined, args, true, true) as object;
        }
        return invoke(path, realValue as (...a: unknown[]) => unknown, undefined, args, false, true) as object;
      },
      has(t, prop) {
        const own = resolveNode(path);
        if (own.kind !== 'none' && own.value && typeof own.value === 'object' && prop in own.value) return true;
        return Reflect.has(t, prop);
      },
    });
    targets.set(proxy, target);
    return proxy;
  };

  return {
    /** The value to re-export under `exportName`. Primitives are re-exported as-is. */
    get(exportName: string): unknown {
      if (exportsCache.has(exportName)) return exportsCache.get(exportName);
      const value = real[exportName];
      const isProxyable = value === undefined || typeof value === 'function' || (value !== null && typeof value === 'object');
      const result = isProxyable ? makeProxy([exportName], value) : value;
      exportsCache.set(exportName, result);
      return result;
    },
  };
}
