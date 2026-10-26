import type { FileDescriptor } from '../../shared/descriptor';
import { API_PREFIX, canvasPath, encodeState, META_PREFIX, type StoryState } from '../../shared/state';
import type { Viewport } from '../../types';
import type { IndexJson } from '../../node/indexer';
import type { InspectorReport } from '../../node/inspector/report';
import type { DiffLine } from '../../node/inspector/html';
import type { RenderRecordJson } from '../../node/server/records';
import type { InferredArgType } from '../../node/server/argtypes';

/** Injected by the workshop server (or written into a static build). */
export interface UiConfig {
  mode: 'dev' | 'build' | 'test';
  static: boolean;
  project: { name: string; next: string; react: string; bundler: string };
  viewports: Record<string, Viewport>;
  globals: Record<string, unknown>;
  budgets: Record<string, number>;
  addons: Array<{ name: string; url: string }>;
  version: string;
}

declare global {
  interface Window {
    __RSC_STORIES_CONFIG__?: UiConfig;
  }
}

export const config: UiConfig = window.__RSC_STORIES_CONFIG__ ?? {
  mode: 'dev',
  static: false,
  project: { name: 'project', next: '', react: '', bundler: '' },
  viewports: {},
  globals: {},
  budgets: {},
  addons: [],
  version: '',
};

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // not JSON
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

/** Static builds store everything as files next to index.html. */
const isStatic = config.static;

export const api = {
  index: () => getJson<IndexJson & { warnings?: string[] }>(isStatic ? './stories.json' : `${API_PREFIX}/api/index`),
  descriptor: (fileKey: string) =>
    getJson<FileDescriptor>(isStatic ? `./meta/${encodeURIComponent(fileKey)}.json` : `${META_PREFIX}/${encodeURIComponent(fileKey)}`),
  argTypes: (fileKey: string) =>
    isStatic
      ? Promise.resolve({ argTypes: null })
      : getJson<{ argTypes: Record<string, InferredArgType> | null }>(`${API_PREFIX}/api/argtypes/${encodeURIComponent(fileKey)}`),
  record: (renderId: string) => getJson<RenderRecordJson>(`${API_PREFIX}/api/render/${renderId}`),
  report: (renderId: string, storyId?: string) =>
    getJson<InspectorReport>(isStatic ? `./reports/${encodeURIComponent(storyId ?? '')}.json` : `${API_PREFIX}/api/report/${renderId}`),
  payload: (renderId: string, storyId?: string) =>
    getJson<Array<{ id: string; tag: string; bytes: number; text: string; debug: boolean }>>(
      isStatic ? `./payloads/${encodeURIComponent(storyId ?? '')}.json` : `${API_PREFIX}/api/payload/${renderId}`,
    ),
  diff: (renderId: string, html: string) =>
    isStatic
      ? Promise.resolve({ available: false, matches: true, lines: [] as DiffLine[] })
      : getJson<{ available: boolean; matches: boolean; lines: DiffLine[] }>(`${API_PREFIX}/api/diff`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ renderId, html }),
        }),
};

/** URL of a story canvas for the current mode. */
export function canvasUrl(
  fileKey: string,
  exportName: string,
  state: StoryState,
  searchParams?: Record<string, string | string[]>,
): string {
  if (isStatic) {
    return `.${canvasPath(fileKey, exportName, {}).replace(/\/_$/, '/_/')}`;
  }
  return canvasPath(fileKey, exportName, state, searchParams);
}

/** Server-sent events from the dev server. */
export function subscribe(handlers: Record<string, (data: unknown) => void>): () => void {
  if (isStatic || typeof EventSource === 'undefined') return () => {};
  const source = new EventSource(`${API_PREFIX}/api/events`);
  for (const [event, handler] of Object.entries(handlers)) {
    source.addEventListener(event, (message) => {
      try {
        handler(JSON.parse((message as MessageEvent<string>).data) as unknown);
      } catch {
        // malformed event
      }
    });
  }
  return () => source.close();
}

export { encodeState };
