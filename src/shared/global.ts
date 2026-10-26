import type { Budgets, JsonValue } from '../types';
import type { StoryState } from './state';

/** Where a render happens. */
export type RenderMode = 'dev' | 'build' | 'test';

/** One recorded call to a mock, a Next API, a server action or an arg function (FR-3.8). */
export interface MockCall {
  id: number;
  kind: 'module' | 'fetch' | 'next' | 'action' | 'arg';
  /** Mock key: `module:@/lib/db`, `fetch:user`, `next:cookies`, `arg:onSelect`. */
  key: string;
  /** Human label, e.g. `db.orders.findById` or `GET https://api.example.com/user`. */
  label: string;
  args: JsonValue[];
  /** `true` when a mock answered; `false` when the call fell through to the real implementation. */
  mocked: boolean;
  variant?: string;
  status: 'pending' | 'ok' | 'error';
  result?: JsonValue;
  error?: string;
  /** Milliseconds since the render started. */
  start: number;
  duration?: number;
  /** Simulated latency applied to this call. */
  latency?: number;
}

/** A warning attached to a render (unmocked request, ignored mock, …). */
export interface RenderWarning {
  type: 'unmocked-request' | 'unmockable-export' | 'non-serializable-arg' | 'unknown-mock-override' | 'story-not-found' | 'env-access';
  message: string;
  detail?: JsonValue;
}

/** A server console message captured during a render. */
export interface LogEntry {
  origin: 'server' | 'client';
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  message: string;
  time: number;
}

/** A mocked navigation signal (redirect, notFound, …) raised during a render. */
export interface NavigationSignal {
  type: 'redirect' | 'permanentRedirect' | 'notFound' | 'forbidden' | 'unauthorized';
  url?: string;
  redirectType?: string;
}

/** Events the runtime reports into the current render. */
export type RenderEvent =
  | { type: 'call:start'; call: MockCall }
  | { type: 'call:end'; call: MockCall }
  | { type: 'warning'; warning: RenderWarning }
  | { type: 'log'; entry: LogEntry }
  | { type: 'navigation'; signal: NavigationSignal }
  | { type: 'story'; storyId: string; title: string; name: string; budgets?: Budgets };

/**
 * Per-request state, created by the workshop server around every request to the generated app and
 * propagated with `AsyncLocalStorage` into server components, actions and mocks.
 */
export interface RenderStore {
  renderId: string;
  kind: 'canvas' | 'meta' | 'action';
  fileKey: string;
  exportName: string;
  state: StoryState;
  mode: RenderMode;
  /** Captured for a static build: the canvas must not try to re-render against a server. */
  isStatic?: boolean;
  /** `performance.now()` when the request started. */
  startedAt: number;
  /** Turn unmocked network requests into errors. */
  strictNetwork: boolean;
  /** Origin of the workshop server; requests to it are never treated as unmocked. */
  origin: string;
  /** Sink for runtime events; provided by the server. */
  emit: (event: RenderEvent) => void;
  /** Lazily resolved story (set by the runtime). Opaque to the server. */
  story?: unknown;
  /** Per-render mutable state for Next API mocks (cookie jar, draft mode). */
  jar?: { cookies: Map<string, string>; draftMode: boolean };
  /** Monotonic counter for call ids. */
  nextCallId: number;
}

/** Minimal structural view of `AsyncLocalStorage` so shared code needs no Node imports. */
export interface StoreStorage {
  getStore(): RenderStore | undefined;
  run<R>(store: RenderStore, callback: () => R): R;
}

/** Hooks the Next-side runtime registers so the server-side interceptors can use story data. */
export interface RuntimeHooks {
  /** Fetch mocks of the story a request renders (resolved once and cached on the store). */
  resolveFetchMocks(store: RenderStore): ResolvedFetchMock[];
  /** All resolved mocks of the story; typed by the runtime that registers it. */
  resolveMocks(store: RenderStore): unknown;
}

/** A fetch mock after layering, overrides and variant selection. */
export interface ResolvedFetchMock {
  key: string;
  name: string;
  match: unknown;
  behavior: {
    response?: unknown;
    status?: number;
    headers?: Record<string, string>;
    delay?: number;
    error?: string;
  };
  variant?: string;
  latency: number;
}

/** State shared between the CLI's module instance and the copies bundled into the Next app. */
export interface RscStoriesGlobal {
  storage?: StoreStorage;
  runtime?: RuntimeHooks;
  /** Story files registered by generated pages, keyed by file key. */
  files?: Map<string, RegisteredFile>;
  /** Original `fetch`, before interception. */
  originalFetch?: typeof fetch;
}

/** A story file as registered by its generated page or meta route. */
export interface RegisteredFile {
  fileKey: string;
  stories: Record<string, unknown>;
}

const KEY = Symbol.for('rsc-stories');

/** The process-wide registry. Uses a global symbol so every bundled copy sees the same object. */
export function getGlobal(): RscStoriesGlobal {
  const g = globalThis as typeof globalThis & { [KEY]?: RscStoriesGlobal };
  return (g[KEY] ??= {});
}

/** The store of the render in progress, if any. */
export function getStore(): RenderStore | undefined {
  return getGlobal().storage?.getStore();
}

/** Milliseconds since the current render started. */
export function sinceStart(store: RenderStore): number {
  return Math.round((performance.now() - store.startedAt) * 100) / 100;
}
