import type { ResolvedFetchMock } from '../../shared/global';
import type { MockOverrides } from '../../shared/state';
import {
  VARIANTS,
  type FetchMatcher,
  type FetchMock,
  type FetchMockBehavior,
  type JsonValue,
  type ModuleMock,
  type ModuleMockWithVariants,
  type Mocks,
  type MocksInput,
  type NextMocks,
} from '../../types';

/** A module mock after layering and variant selection. */
export interface ResolvedModuleMock {
  key: string;
  specifier: string;
  impl: ModuleMock;
  variant?: string;
  variants: string[];
  latency: number;
}

/** Mocks after layering (config → preview → meta → story) and runtime overrides. */
export interface ResolvedMocks {
  modules: Map<string, ResolvedModuleMock>;
  fetch: ResolvedFetchMock[];
  next: NextMocks;
  latency: { all: number; byKey: Record<string, number> };
  strictNetwork?: boolean;
  /** Keys present before overrides were applied, for the Mocks panel. */
  catalog: MockCatalogEntry[];
}

/** One mock as listed in the Mocks panel. */
export interface MockCatalogEntry {
  key: string;
  kind: 'module' | 'fetch' | 'next';
  label: string;
  detail?: JsonValue;
  variants: string[];
  variant?: string;
  latency: number;
  active: boolean;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/** Recursive merge of plain objects; anything else in `b` replaces `a`. */
export function deepMerge<T>(a: T, b: unknown): T {
  if (!isPlainObject(a) || !isPlainObject(b)) return b as T;
  const out: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries(b)) {
    out[key] = key in out ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

function isVariants(value: unknown): value is ModuleMockWithVariants {
  return !!value && typeof value === 'object' && VARIANTS in value;
}

/** Text form of a fetch matcher, used as its default name. */
export function describeMatcher(match: FetchMatcher): string {
  if (typeof match === 'string') return match;
  if (match instanceof RegExp) return match.toString();
  if (typeof match === 'function') return match.name ? `ƒ ${match.name}` : 'ƒ matcher';
  const url = match.url instanceof RegExp ? match.url.toString() : (match.url ?? '*');
  return match.method ? `${match.method.toUpperCase()} ${url}` : url;
}

function evaluate(input: MocksInput | undefined): Mocks | undefined {
  return typeof input === 'function' ? input() : input;
}

interface ModuleLayer {
  base: ModuleMock;
  variants: Record<string, ModuleMock>;
}

/**
 * Layers mocks from lowest to highest priority and applies runtime overrides. Function-form mocks
 * are evaluated here, once per render, which keeps stateful fixtures isolated (NFR-4.2).
 */
export function resolveMocks(layers: Array<MocksInput | undefined>, overrides: MockOverrides = {}): ResolvedMocks {
  const modules = new Map<string, ModuleLayer>();
  const fetchMocks = new Map<string, FetchMock>();
  let next: NextMocks = {};
  let all = 0;
  const byKey: Record<string, number> = {};
  let strictNetwork: boolean | undefined;

  for (const input of layers) {
    const layer = evaluate(input);
    if (!layer) continue;
    for (const [specifier, definition] of Object.entries(layer.modules ?? {})) {
      if (definition === false) {
        modules.delete(specifier);
      } else if (isVariants(definition)) {
        const { default: base, variants } = definition[VARIANTS];
        modules.set(specifier, { base, variants });
      } else {
        const existing = modules.get(specifier);
        modules.set(
          specifier,
          existing ? { base: deepMerge(existing.base, definition), variants: existing.variants } : { base: definition, variants: {} },
        );
      }
    }
    // Later layers take precedence: re-insert their entries at the front.
    const entries: Array<[string, FetchMock | false]> = Array.isArray(layer.fetch)
      ? layer.fetch.map((mock) => [mock.name ?? describeMatcher(mock.match), mock])
      : Object.entries(layer.fetch ?? {}).map(([name, mock]) => [name, mock === false ? false : { ...mock, name: mock.name ?? name }]);
    const previous = [...fetchMocks.entries()];
    fetchMocks.clear();
    for (const [name, mock] of entries) if (mock) fetchMocks.set(name, mock);
    for (const [name, mock] of previous) {
      const removed = entries.some(([n, m]) => n === name && m === false);
      if (!fetchMocks.has(name) && !removed) fetchMocks.set(name, mock);
    }
    if (layer.next) next = deepMerge(next, layer.next);
    if (typeof layer.latency === 'number') all = layer.latency;
    else if (layer.latency) Object.assign(byKey, layer.latency);
    if (layer.strictNetwork !== undefined) strictNetwork = layer.strictNetwork;
  }

  const off = new Set(overrides.off ?? []);
  const selected = overrides.variants ?? {};
  Object.assign(byKey, overrides.latency ?? {});

  const latencyFor = (key: string, ...aliases: string[]): number => {
    for (const k of [key, ...aliases]) {
      const value = byKey[k];
      if (typeof value === 'number') return value;
    }
    return all;
  };

  const catalog: MockCatalogEntry[] = [];
  const resolvedModules = new Map<string, ResolvedModuleMock>();
  for (const [specifier, layer] of modules) {
    const key = `module:${specifier}`;
    const variant = selected[key];
    const variantImpl = variant ? layer.variants[variant] : undefined;
    const latency = latencyFor(key, specifier);
    const active = !off.has(key);
    catalog.push({
      key,
      kind: 'module',
      label: specifier,
      detail: Object.keys(layer.base),
      variants: Object.keys(layer.variants),
      ...(variantImpl ? { variant } : {}),
      latency,
      active,
    });
    if (!active) continue;
    resolvedModules.set(specifier, {
      key,
      specifier,
      impl: variantImpl ? deepMerge(layer.base, variantImpl) : layer.base,
      ...(variantImpl ? { variant } : {}),
      variants: Object.keys(layer.variants),
      latency,
    });
  }
  // Latency for modules that are not mocked still applies to their real implementation.
  for (const key of Object.keys(byKey)) {
    const specifier = key.startsWith('module:') ? key.slice(7) : key;
    if (specifier.startsWith('fetch') || specifier.startsWith('next:')) continue;
    if (!modules.has(specifier)) {
      catalog.push({
        key: `module:${specifier}`,
        kind: 'module',
        label: specifier,
        detail: 'real implementation (latency only)',
        variants: [],
        latency: latencyFor(key),
        active: true,
      });
    }
  }

  const resolvedFetch: ResolvedFetchMock[] = [];
  for (const [name, mock] of fetchMocks) {
    const key = `fetch:${name}`;
    const variant = selected[key];
    const variantBehavior: FetchMockBehavior | undefined = variant ? mock.variants?.[variant] : undefined;
    const latency = latencyFor(key, 'fetch');
    const active = !off.has(key);
    const behavior: FetchMockBehavior = {
      response: mock.response,
      ...(mock.status !== undefined ? { status: mock.status } : {}),
      ...(mock.headers ? { headers: mock.headers } : {}),
      ...(mock.delay !== undefined ? { delay: mock.delay } : {}),
      ...(mock.error !== undefined ? { error: mock.error } : {}),
      ...variantBehavior,
    };
    catalog.push({
      key,
      kind: 'fetch',
      label: name,
      detail: describeMatcher(mock.match),
      variants: Object.keys(mock.variants ?? {}),
      ...(variantBehavior ? { variant } : {}),
      latency: latency + (behavior.delay ?? 0),
      active,
    });
    if (!active) continue;
    resolvedFetch.push({
      key,
      name,
      match: mock.match,
      behavior,
      ...(variantBehavior ? { variant } : {}),
      latency,
    });
  }

  for (const field of ['cookies', 'headers', 'draftMode', 'searchParams', 'params', 'pathname'] as const) {
    if (next[field] === undefined) continue;
    const key = `next:${field}`;
    const active = !off.has(key);
    catalog.push({
      key,
      kind: 'next',
      label: field,
      detail: next[field] as JsonValue,
      variants: [],
      latency: 0,
      active,
    });
    if (!active) {
      const { [field]: _removed, ...rest } = next;
      next = rest;
    }
  }

  return {
    modules: resolvedModules,
    fetch: resolvedFetch,
    next,
    latency: { all, byKey },
    ...(strictNetwork !== undefined ? { strictNetwork } : {}),
    catalog,
  };
}

/** Latency for a module specifier, applied to mocked and real calls alike. */
export function moduleLatency(mocks: ResolvedMocks, specifier: string): number {
  const mock = mocks.modules.get(specifier);
  if (mock) return mock.latency;
  const { byKey, all } = mocks.latency;
  return byKey[`module:${specifier}`] ?? byKey[specifier] ?? all;
}
