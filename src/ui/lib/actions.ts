import type { FileDescriptor, StoryDescriptor } from '../../shared/descriptor';
import { isEnvelope, MESSAGE_SOURCE, type CanvasMessage, type WorkshopMessage } from '../../shared/protocol';
import type { StoryState } from '../../shared/state';
import type { IndexJson } from '../../node/indexer';
import type { RenderRecordJson } from '../../node/server/records';
import { api, canvasUrl, config, subscribe } from './api';
import { resetStoryData, store, type AppState } from './store';

type IndexFile = IndexJson['files'][number];

export interface Selection {
  file: IndexFile;
  story: IndexFile['stories'][number];
  descriptor?: StoryDescriptor;
  fileDescriptor?: FileDescriptor;
}

/** The selected story, its file, and its evaluated descriptor (when loaded). */
export function selection(state: AppState = store.get()): Selection | undefined {
  if (!state.index || !state.storyId) return undefined;
  for (const file of state.index.files) {
    const story = file.stories.find((s) => s.id === state.storyId);
    if (!story) continue;
    const loaded = state.descriptors[file.fileKey];
    const fileDescriptor = loaded && !('error' in loaded) ? loaded : undefined;
    return {
      file,
      story,
      ...(fileDescriptor ? { fileDescriptor } : {}),
      ...(() => {
        const descriptor = fileDescriptor?.stories.find((s) => s.exportName === story.exportName);
        return descriptor ? { descriptor } : {};
      })(),
    };
  }
  return undefined;
}

export async function loadIndex(): Promise<void> {
  try {
    const index = await api.index();
    store.set({ index, indexError: undefined });
    const state = store.get();
    const exists = index.files.some((f) => f.stories.some((s) => s.id === state.storyId));
    if (!exists) {
      const first = index.files.find((f) => f.stories.length)?.stories[0];
      if (first) selectStory(first.id, { keepState: false });
    } else if (state.storyId) {
      void ensureDescriptor(selection()!.file.fileKey);
    }
  } catch (error) {
    store.set({ indexError: (error as Error).message });
  }
}

const pendingDescriptors = new Map<string, Promise<void>>();

export function ensureDescriptor(fileKey: string, force = false): Promise<void> {
  if (!force && store.get().descriptors[fileKey]) return Promise.resolve();
  let pending = pendingDescriptors.get(fileKey);
  if (!pending || force) {
    pending = api
      .descriptor(fileKey)
      .then(
        (descriptor) => store.set((s) => ({ descriptors: { ...s.descriptors, [fileKey]: descriptor } })),
        (error: unknown) => store.set((s) => ({ descriptors: { ...s.descriptors, [fileKey]: { error: (error as Error).message } } })),
      )
      .finally(() => pendingDescriptors.delete(fileKey));
    pendingDescriptors.set(fileKey, pending);
  }
  if (!config.static && store.get().inferred[fileKey] === undefined) {
    api.argTypes(fileKey).then(
      (result) => store.set((s) => ({ inferred: { ...s.inferred, [fileKey]: result.argTypes } })),
      () => store.set((s) => ({ inferred: { ...s.inferred, [fileKey]: null } })),
    );
  }
  return pending;
}

export function selectStory(storyId: string, options: { keepState?: boolean } = {}): void {
  const current = store.get();
  if (current.storyId === storyId && options.keepState !== false) return;
  store.set({
    storyId,
    ...(options.keepState ? {} : { story: {} }),
    ...resetStoryData(),
    sidebarOpen: false,
  });
  const sel = selection();
  if (sel) void ensureDescriptor(sel.file.fileKey);
}

function updateStory(update: (story: StoryState) => StoryState): void {
  store.set((s) => ({ story: update(s.story) }));
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Sets one arg; storing only differences keeps deep links short. */
export function setArg(name: string, value: unknown): void {
  const defaults = selection()?.descriptor?.args ?? {};
  updateStory((story) => {
    const args = { ...story.args };
    if (sameValue(defaults[name], value)) delete args[name];
    else args[name] = value;
    const { nonce: _nonce, ...rest } = story;
    return { ...rest, args };
  });
}

export function resetArgs(): void {
  updateStory(({ args: _args, nonce: _nonce, ...rest }) => rest);
}

export function setMockActive(key: string, active: boolean): void {
  updateStory((story) => {
    const off = new Set(story.mocks?.off ?? []);
    if (active) off.delete(key);
    else off.add(key);
    return { ...story, nonce: undefined, mocks: { ...story.mocks, off: [...off] } } as StoryState;
  });
}

export function setMockVariant(key: string, variant: string | undefined): void {
  updateStory((story) => {
    const variants = { ...story.mocks?.variants };
    if (variant) variants[key] = variant;
    else delete variants[key];
    return { ...story, nonce: undefined, mocks: { ...story.mocks, variants } } as StoryState;
  });
}

export function setMockLatency(key: string, latency: number | undefined): void {
  updateStory((story) => {
    const values = { ...story.mocks?.latency };
    if (latency === undefined) delete values[key];
    else values[key] = latency;
    return { ...story, nonce: undefined, mocks: { ...story.mocks, latency: values } } as StoryState;
  });
}

export function resetMocks(): void {
  updateStory(({ mocks: _mocks, nonce: _nonce, ...rest }) => rest);
}

export function setGlobal(name: string, value: string | undefined): void {
  updateStory((story) => {
    const globals = { ...story.globals };
    if (value === undefined) delete globals[name];
    else globals[name] = value;
    return { ...story, globals };
  });
}

/** Re-runs the server render with the same state (FR-2.7); mocks replay from scratch. */
export function rerun(): void {
  updateStory((story) => ({ ...story, nonce: Math.random().toString(36).slice(2, 8) }));
}

/** The canvas URL the current state asks for. */
export function desiredCanvasUrl(state: AppState = store.get()): string | undefined {
  const sel = selection(state);
  if (!sel) return undefined;
  const search = sel.descriptor?.next?.searchParams as Record<string, string | string[]> | undefined;
  return canvasUrl(sel.file.fileKey, sel.story.exportName, state.story, search);
}

// --- Canvas channel -------------------------------------------------------------------------------

let frame: HTMLIFrameElement | null = null;
let bridgeReady = false;
let loadedUrl: string | undefined;

export function attachFrame(element: HTMLIFrameElement | null): void {
  if (element === frame) return;
  frame = element;
  bridgeReady = false;
  // A new iframe element starts blank; let the next navigation load it.
  loadedUrl = undefined;
  if (element) {
    const url = desiredCanvasUrl();
    const sel = selection();
    if (url && sel && store.get().descriptors[sel.file.fileKey]) navigateCanvas(url);
  }
}

const RELOAD_WINDOW_MS = 5000;
let documentLoads: number[] = [];
let reloadQuiet: ReturnType<typeof setTimeout> | undefined;

export function frameLoaded(): void {
  // A full document load: the bridge announces itself again once hydrated.
  bridgeReady = false;
  // Next's hot reload can get stuck reloading the page; say so instead of flickering silently.
  const now = performance.now();
  documentLoads = [...documentLoads.filter((at) => now - at < RELOAD_WINDOW_MS), now];
  if (documentLoads.length >= 8 && !store.get().canvasReloading) store.set({ canvasReloading: true });
  clearTimeout(reloadQuiet);
  reloadQuiet = setTimeout(() => {
    documentLoads = [];
    if (store.get().canvasReloading) store.set({ canvasReloading: false });
  }, RELOAD_WINDOW_MS);
}

export function postToCanvas(message: WorkshopMessage): void {
  frame?.contentWindow?.postMessage({ ...message, source: MESSAGE_SOURCE }, window.location.origin);
}

/** Navigates the canvas: a soft RSC navigation when possible, a document load otherwise. */
export function navigateCanvas(url: string): void {
  if (!frame) return;
  if (url === loadedUrl) return;
  loadedUrl = url;
  store.set({ renderPending: true });
  if (bridgeReady && !config.static) postToCanvas({ type: 'navigate', url });
  else frame.src = url;
}

export function reloadCanvas(): void {
  if (!frame || !loadedUrl) return;
  bridgeReady = false;
  frame.src = loadedUrl;
}

let eventId = 0;

async function loadRender(renderId: string): Promise<void> {
  const sel = selection();
  try {
    if (!config.static) {
      const record = await api.record(renderId);
      if (store.get().renderId !== renderId) return;
      store.set({ record });
    }
    const report = await api.report(renderId, sel?.story.id);
    if (store.get().renderId !== renderId) return;
    store.set({ report, renderPending: false, reportError: undefined });
    const html = store.get().clientHtml;
    if (html !== undefined) void runDiff(renderId, html);
  } catch (error) {
    if (store.get().renderId === renderId) store.set({ reportError: (error as Error).message, renderPending: false });
  }
}

export interface DiffState {
  renderId: string;
  available: boolean;
  matches: boolean;
  lines: Array<{ op: ' ' | '+' | '-'; text: string }>;
}

export let lastDiff: DiffState | undefined;
const diffListeners = new Set<() => void>();
export function onDiff(listener: () => void): () => void {
  diffListeners.add(listener);
  return () => diffListeners.delete(listener);
}

async function runDiff(renderId: string, html: string): Promise<void> {
  const report = store.get().report;
  if (!report || report.renderId !== renderId || report.response !== 'html') return;
  try {
    const diff = await api.diff(renderId, html);
    lastDiff = { renderId, ...diff };
    for (const listener of diffListeners) listener();
  } catch {
    // diff is best effort
  }
}

function handleMessage(message: CanvasMessage): void {
  bridgeReady = true;
  switch (message.type) {
    case 'rendered': {
      const state = store.get();
      if (message.renderId === state.renderId) return;
      store.set({
        renderId: message.renderId,
        commitMs: message.commitMs,
        report: undefined,
        record: undefined,
        clientHtml: undefined,
        error: undefined,
        mismatches: message.navigation === 'initial' ? [] : state.mismatches,
        play: undefined,
      });
      lastDiff = undefined;
      for (const listener of diffListeners) listener();
      void loadRender(message.renderId);
      return;
    }
    case 'dom':
      if (message.renderId !== store.get().renderId) return;
      store.set({ clientHtml: message.html });
      void runDiff(message.renderId, message.html);
      return;
    case 'log':
      store.set((s) => ({ clientLogs: [...s.clientLogs.slice(-499), message.entry] }));
      return;
    case 'action':
    case 'router':
      store.set((s) => ({
        events: [
          ...s.events.slice(-499),
          {
            id: ++eventId,
            kind: message.type,
            name: message.type === 'action' ? message.name : message.method,
            args: message.args,
            time: message.time,
          },
        ],
      }));
      return;
    case 'error':
      store.set({
        error: {
          renderId: message.renderId,
          message: message.message,
          ...(message.stack ? { stack: message.stack } : {}),
          ...(message.digest ? { digest: message.digest } : {}),
          ...(message.navigation ? { navigation: message.navigation } : {}),
        },
      });
      return;
    case 'hydration-mismatch':
      store.set((s) => ({ mismatches: [...s.mismatches, message.message] }));
      return;
    case 'play':
      store.set({
        play: { status: message.status, steps: message.steps, ...(message.error ? { error: message.error } : {}) },
      });
      return;
    case 'a11y':
      store.set({
        a11y: {
          running: false,
          ...(message.result ? { result: message.result } : {}),
          ...(message.error ? { error: message.error } : {}),
        },
      });
      return;
  }
}

/** Starts listening to the canvas and the dev server. */
export function startChannels(): () => void {
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== frame?.contentWindow) return;
    if (isEnvelope<CanvasMessage>(event.data)) handleMessage(event.data);
  };
  window.addEventListener('message', onMessage);
  const unsubscribe = subscribe({
    hello: (data) => {
      const status = data as { status?: AppState['nextStatus']; message?: string };
      if (status.status) store.set({ nextStatus: status.status, ...(status.message ? { nextError: status.message } : {}) });
    },
    index: (data) => {
      store.set({ index: { ...(store.get().index ?? {}), ...(data as IndexJson) } });
      // Story files changed: their descriptors may be stale.
      const sel = selection();
      if (sel) void ensureDescriptor(sel.file.fileKey, true);
    },
    'next:ready': () => store.set({ nextStatus: 'ready', nextError: undefined }),
    'next:restart': () => store.set({ nextStatus: 'restarting' }),
    'next:error': (data) => store.set({ nextStatus: 'error', nextError: (data as { message?: string }).message }),
    'render:end': (data) => {
      const record = data as RenderRecordJson;
      const current = store.get();
      if (record.kind === 'action' && current.record && record.url.split('?')[0] === current.record.url.split('?')[0]) {
        store.set((s) => ({ actionRecords: [...s.actionRecords, record].slice(-20) }));
      }
    },
  });
  return () => {
    window.removeEventListener('message', onMessage);
    unsubscribe();
  };
}
