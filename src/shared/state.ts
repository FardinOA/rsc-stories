import type { Globals } from '../types';

/** Runtime overrides for a story's mocks, chosen in the Mocks panel. */
export interface MockOverrides {
  /** Mock keys turned off (`module:@/lib/db`, `fetch:user`). */
  off?: string[];
  /** Selected variant per mock key. */
  variants?: Record<string, string>;
  /** Latency per mock key, in milliseconds. */
  latency?: Record<string, number>;
}

/**
 * Everything about one render that is not in the story file: arg and mock overrides, toolbar
 * globals, and a nonce that forces a fresh server render. Encoded into the canvas URL so every
 * state is linkable (FR-4.8).
 */
export interface StoryState {
  args?: Record<string, unknown>;
  mocks?: MockOverrides;
  globals?: Globals;
  nonce?: string;
}

const EMPTY_TOKEN = '_';

/**
 * Latency meaning "never resolves" (a permanent loading state). `Infinity` does not survive JSON,
 * so URL state uses the largest `setTimeout` delay instead; both are treated as never.
 */
export const NEVER_RESOLVE = 2_147_483_647;

/** Tags for values JSON cannot represent. */
function encodeValue(value: unknown): unknown {
  if (value === undefined) return { $u: 1 };
  if (value instanceof Date) return { $d: value.toISOString() };
  if (typeof value === 'bigint') return { $n: value.toString() };
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = encodeValue(item);
    return out;
  }
  return value;
}

function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1) {
      if (keys[0] === '$u') return undefined;
      if (keys[0] === '$d' && typeof record.$d === 'string') return new Date(record.$d);
      if (keys[0] === '$n' && typeof record.$n === 'string') return BigInt(record.$n);
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) out[key] = decodeValue(item);
    return out;
  }
  return value;
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(token: string): string {
  const base64 = token.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isEmptyState(state: StoryState): boolean {
  const hasKeys = (value: object | undefined) => !!value && Object.keys(value).length > 0;
  const mocks = state.mocks;
  const hasMocks = !!mocks && ((mocks.off?.length ?? 0) > 0 || hasKeys(mocks.variants) || hasKeys(mocks.latency));
  return !hasKeys(state.args) && !hasMocks && !hasKeys(state.globals) && !state.nonce;
}

/** Encodes a state as a URL path segment. The empty state is `_`. */
export function encodeState(state: StoryState): string {
  if (isEmptyState(state)) return EMPTY_TOKEN;
  const compact: Record<string, unknown> = {};
  if (state.args && Object.keys(state.args).length) compact.a = encodeValue(state.args);
  if (state.mocks) {
    const m: Record<string, unknown> = {};
    if (state.mocks.off?.length) m.o = [...state.mocks.off].sort();
    if (state.mocks.variants && Object.keys(state.mocks.variants).length) m.v = state.mocks.variants;
    if (state.mocks.latency && Object.keys(state.mocks.latency).length) m.l = state.mocks.latency;
    if (Object.keys(m).length) compact.m = m;
  }
  if (state.globals && Object.keys(state.globals).length) compact.g = state.globals;
  if (state.nonce) compact.n = state.nonce;
  return toBase64Url(JSON.stringify(compact));
}

/** Decodes a state token. Malformed tokens decode to the empty state rather than throwing. */
export function decodeState(token: string | undefined | null): StoryState {
  if (!token || token === EMPTY_TOKEN) return {};
  try {
    const compact = JSON.parse(fromBase64Url(decodeURIComponent(token))) as Record<string, unknown>;
    const state: StoryState = {};
    if (compact.a && typeof compact.a === 'object') {
      state.args = decodeValue(compact.a) as Record<string, unknown>;
    }
    const m = compact.m as Record<string, unknown> | undefined;
    if (m && typeof m === 'object') {
      state.mocks = {};
      if (Array.isArray(m.o)) state.mocks.off = m.o.filter((v): v is string => typeof v === 'string');
      if (m.v && typeof m.v === 'object') state.mocks.variants = m.v as Record<string, string>;
      if (m.l && typeof m.l === 'object') state.mocks.latency = m.l as Record<string, number>;
    }
    if (compact.g && typeof compact.g === 'object') state.globals = compact.g as Globals;
    if (typeof compact.n === 'string') state.nonce = compact.n;
    return state;
  } catch {
    return {};
  }
}

/** Route prefix of story canvases inside the generated Next app. */
export const CANVAS_PREFIX = '/rsc-stories/canvas';
/** Route prefix of story descriptors inside the generated Next app. */
export const META_PREFIX = '/rsc-stories/meta';
/** Prefix of the workshop server's own endpoints (never reaches Next). */
export const API_PREFIX = '/__rsc_stories';

/** `/rsc-stories/canvas/<fileKey>/<exportName>/<state>` plus mocked search params. */
export function canvasPath(
  fileKey: string,
  exportName: string,
  state: StoryState = {},
  searchParams?: Record<string, string | string[]>,
): string {
  let path = `${CANVAS_PREFIX}/${encodeURIComponent(fileKey)}/${encodeURIComponent(exportName)}/${encodeState(state)}`;
  if (searchParams && Object.keys(searchParams).length) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
    }
    path += `?${query.toString()}`;
  }
  return path;
}

/** Parses a canvas URL path; returns `null` for anything else. */
export function parseCanvasPath(pathname: string): { fileKey: string; exportName: string; token: string; state: StoryState } | null {
  if (!pathname.startsWith(CANVAS_PREFIX + '/')) return null;
  const [fileKey, exportName, token] = pathname
    .slice(CANVAS_PREFIX.length + 1)
    .split('/')
    .map((part) => decodeURIComponent(part));
  if (!fileKey || !exportName) return null;
  return { fileKey, exportName, token: token || EMPTY_TOKEN, state: decodeState(token) };
}
