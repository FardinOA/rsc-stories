import type { FetchMatcher, FetchMockRequestInfo, JsonValue } from '../types';
import { getGlobal, getStore, sinceStart, type MockCall, type RenderStore, type ResolvedFetchMock } from './global';
import { toPreview } from './preview';
import { NEVER_RESOLVE } from './state';

const METHOD_PREFIX = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i;

interface CompiledPattern {
  method?: string;
  regex: RegExp;
  names: string[];
  pathOnly: boolean;
  hasQuery: boolean;
}

const patternCache = new Map<string, CompiledPattern>();

/**
 * Compiles a string matcher: optional method prefix, `*` wildcards and `:name` segments. A pattern
 * starting with `/` matches the pathname of any origin. A pattern without `?` ignores the query.
 */
export function compilePattern(pattern: string): CompiledPattern {
  const cached = patternCache.get(pattern);
  if (cached) return cached;
  let rest = pattern.trim();
  let method: string | undefined;
  const methodMatch = METHOD_PREFIX.exec(rest);
  if (methodMatch) {
    method = methodMatch[1]!.toUpperCase();
    rest = rest.slice(methodMatch[0].length);
  }
  const names: string[] = [];
  let source = '';
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i]!;
    if (char === '*') {
      source += '.*';
    } else if (char === ':' && rest[i - 1] === '/' && /[A-Za-z_]/.test(rest[i + 1] ?? '')) {
      const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest.slice(i + 1))![0];
      names.push(name);
      source += '([^/?#]+)';
      i += name.length;
    } else {
      source += char.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  const compiled: CompiledPattern = {
    ...(method ? { method } : {}),
    regex: new RegExp(`^${source}/?$`),
    names,
    pathOnly: rest.startsWith('/'),
    hasQuery: rest.includes('?'),
  };
  patternCache.set(pattern, compiled);
  return compiled;
}

function matchUrlPattern(pattern: string, url: URL, method: string): Record<string, string> | null {
  const compiled = compilePattern(pattern);
  if (compiled.method && compiled.method !== method) return null;
  let target: string;
  if (compiled.pathOnly) target = compiled.hasQuery ? url.pathname + url.search : url.pathname;
  else target = compiled.hasQuery ? url.origin + url.pathname + url.search : url.origin + url.pathname;
  const match = compiled.regex.exec(target);
  if (!match) return null;
  const params: Record<string, string> = {};
  compiled.names.forEach((name, index) => {
    params[name] = decodeURIComponent(match[index + 1] ?? '');
  });
  return params;
}

/** Reads a request body once: JSON when it parses, otherwise text; `undefined` when empty. */
export async function readBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  try {
    const text = await request.clone().text();
    if (!text) return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  } catch {
    return undefined;
  }
}

/** Matches a request against a fetch matcher; returns captured params, or `null`. */
export async function matchRequest(matcher: FetchMatcher, request: Request, body: unknown): Promise<Record<string, string> | null> {
  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  if (typeof matcher === 'string') return matchUrlPattern(matcher, url, method);
  if (matcher instanceof RegExp) return matcher.test(url.href) ? {} : null;
  if (typeof matcher === 'function') return matcher(request.clone()) ? {} : null;
  if (matcher.method && matcher.method.toUpperCase() !== method) return null;
  let params: Record<string, string> = {};
  if (matcher.url !== undefined) {
    if (matcher.url instanceof RegExp) {
      if (!matcher.url.test(url.href)) return null;
    } else {
      const matched = matchUrlPattern(matcher.url, url, method);
      if (!matched) return null;
      params = matched;
    }
  }
  for (const [key, value] of Object.entries(matcher.query ?? {})) {
    if (url.searchParams.get(key) !== value) return null;
  }
  for (const [key, value] of Object.entries(matcher.headers ?? {})) {
    const actual = request.headers.get(key);
    if (actual === null) return null;
    if (value instanceof RegExp ? !value.test(actual) : actual !== value) return null;
  }
  if (matcher.body && !matcher.body(body)) return null;
  return params;
}

/** Turns a mock response into a fresh `Response`. Plain values become JSON; strings become text. */
export async function toResponse(
  response: unknown,
  request: Request,
  info: FetchMockRequestInfo,
  status = 200,
  headers: Record<string, string> = {},
): Promise<Response> {
  let value = response;
  if (typeof value === 'function') {
    value = await (value as (r: Request, i: FetchMockRequestInfo) => unknown)(request.clone(), info);
  }
  if (value instanceof Response) return value.clone();
  if (value === undefined || value === null) {
    return new Response(value === null ? 'null' : null, {
      status,
      headers: value === null ? { 'content-type': 'application/json', ...headers } : headers,
    });
  }
  if (typeof value === 'string') {
    return new Response(value, { status, headers: { 'content-type': 'text/plain;charset=utf-8', ...headers } });
  }
  return new Response(JSON.stringify(value as JsonValue), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    if (ms <= 0) return resolve();
    // `Infinity` keeps the request pending: a loading state.
    if (!Number.isFinite(ms) || ms >= NEVER_RESOLVE) return;
    setTimeout(resolve, ms);
  });

function startCall(store: RenderStore, call: Omit<MockCall, 'id' | 'status' | 'start'>): MockCall {
  const started: MockCall = { ...call, id: store.nextCallId++, status: 'pending', start: sinceStart(store) };
  store.emit({ type: 'call:start', call: started });
  return started;
}

function endCall(store: RenderStore, call: MockCall, patch: Partial<MockCall>): void {
  const ended: MockCall = {
    ...call,
    ...patch,
    duration: Math.round((sinceStart(store) - call.start) * 100) / 100,
  };
  store.emit({ type: 'call:end', call: ended });
}

/**
 * Hosts Next.js itself downloads from while compiling (`next/font/google`). Compilation can run
 * inside a story's request, but these are not the story's requests.
 */
export const FRAMEWORK_HOSTS: ReadonlySet<string> = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

function isWorkshopRequest(url: URL, store: RenderStore): boolean {
  try {
    return url.origin === new URL(store.origin).origin;
  } catch {
    return false;
  }
}

/**
 * Handles a `fetch` made during a story render: answers from the first matching mock, otherwise
 * warns (or throws in strict mode) and falls through to the network.
 */
export async function interceptFetch(
  store: RenderStore,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  original: typeof fetch,
): Promise<Response> {
  let request: Request;
  try {
    request = new Request(input, init);
  } catch {
    return original(input, init);
  }
  const url = new URL(request.url);
  if (isWorkshopRequest(url, store)) return original(input, init);
  const method = request.method.toUpperCase();
  const label = `${method} ${url.href}`;
  const mocks: ResolvedFetchMock[] = getGlobal().runtime?.resolveFetchMocks(store) ?? [];
  const body = await readBody(request);

  for (const mock of mocks) {
    const params = await matchRequest(mock.match as FetchMatcher, request, body);
    if (!params) continue;
    const call = startCall(store, {
      kind: 'fetch',
      key: mock.key,
      label,
      args: body === undefined ? [] : [toPreview(body)],
      mocked: true,
      ...(mock.variant ? { variant: mock.variant } : {}),
      latency: mock.latency + (mock.behavior.delay ?? 0),
    });
    await sleep(mock.latency + (mock.behavior.delay ?? 0));
    if (mock.behavior.error) {
      endCall(store, call, { status: 'error', error: mock.behavior.error });
      throw new TypeError(`fetch failed: ${mock.behavior.error}`, {
        cause: new Error(mock.behavior.error),
      });
    }
    try {
      const response = await toResponse(
        mock.behavior.response,
        request,
        { url, method, params, body },
        mock.behavior.status,
        mock.behavior.headers,
      );
      let preview: JsonValue = `[${response.status}]`;
      try {
        const text = await response.clone().text();
        preview = toPreview(response.headers.get('content-type')?.includes('json') ? (JSON.parse(text) as unknown) : text);
      } catch {
        // Bodies that cannot be read are previewed by status only.
      }
      endCall(store, call, { status: 'ok', result: { status: response.status, body: preview } });
      return response;
    } catch (error) {
      endCall(store, call, { status: 'error', error: (error as Error).message });
      throw error;
    }
  }

  if (FRAMEWORK_HOSTS.has(url.hostname)) return original(input, init);
  store.emit({
    type: 'warning',
    warning: {
      type: 'unmocked-request',
      message: `Unmocked request: ${label}`,
      detail: { method, url: url.href },
    },
  });
  const call = startCall(store, {
    kind: 'fetch',
    key: 'fetch:unmocked',
    label,
    args: body === undefined ? [] : [toPreview(body)],
    mocked: false,
  });
  if (store.strictNetwork) {
    const message = `[rsc-stories] Unmocked request in strict network mode: ${label}. Add a fetch mock for it, or set mocks.strictNetwork = false.`;
    endCall(store, call, { status: 'error', error: message });
    throw new Error(message);
  }
  try {
    const response = await original(input, init);
    endCall(store, call, { status: 'ok', result: { status: response.status } });
    return response;
  } catch (error) {
    endCall(store, call, { status: 'error', error: (error as Error).message });
    throw error;
  }
}

/**
 * Replaces `globalThis.fetch` once per process. Must run before Next initialises so Next's own
 * fetch instrumentation wraps this function, not the other way round.
 */
export function installFetchInterceptor(): void {
  const g = getGlobal();
  if (g.originalFetch) return;
  const original = globalThis.fetch.bind(globalThis);
  g.originalFetch = original;
  const intercepted = function fetch(input: RequestInfo | URL, init?: RequestInit) {
    const store = getStore();
    if (!store || store.kind === 'meta') return original(input, init);
    return interceptFetch(store, input, init, original);
  };
  globalThis.fetch = intercepted as typeof fetch;
}
