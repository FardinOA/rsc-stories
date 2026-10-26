import { useSyncExternalStore } from 'react';
import type { FileDescriptor } from '../../shared/descriptor';
import type { LogEntry, NavigationSignal } from '../../shared/global';
import type { A11yResult, PlayStep } from '../../shared/protocol';
import type { StoryState } from '../../shared/state';
import type { JsonValue } from '../../types';
import type { IndexJson } from '../../node/indexer';
import type { InspectorReport } from '../../node/inspector/report';
import type { RenderRecordJson } from '../../node/server/records';
import type { InferredArgType } from '../../node/server/argtypes';

export type Theme = 'system' | 'light' | 'dark';
export type NextStatus = 'starting' | 'ready' | 'restarting' | 'error';

/** A client-side event from the canvas (action, router call). */
export interface ClientEvent {
  id: number;
  kind: 'action' | 'router';
  name: string;
  args: JsonValue[];
  time: number;
}

export interface CanvasError {
  renderId: string;
  message: string;
  stack?: string;
  digest?: string;
  navigation?: NavigationSignal;
}

export interface AppState {
  index?: IndexJson & { warnings?: string[] };
  indexError?: string;
  descriptors: Record<string, FileDescriptor | { error: string }>;
  inferred: Record<string, Record<string, InferredArgType> | null>;
  storyId?: string;
  /** Overrides for the selected story; encoded into the canvas URL and the deep link. */
  story: StoryState;
  viewport: string;
  customSize?: { width: number; height: number };
  rotate: boolean;
  theme: Theme;
  panel: string;
  inspectorTab: string;
  overlays: { suspense: boolean; measure: boolean };
  sidebarOpen: boolean;
  nextStatus: NextStatus;
  nextError?: string;
  /** The canvas document keeps reloading (a Next.js hot-reload loop). */
  canvasReloading: boolean;
  // Per render
  renderId?: string;
  renderPending: boolean;
  commitMs?: number;
  record?: RenderRecordJson;
  /** Server Action requests made by the current story (calls and logs of each). */
  actionRecords: RenderRecordJson[];
  report?: InspectorReport;
  reportError?: string;
  clientHtml?: string;
  clientLogs: LogEntry[];
  events: ClientEvent[];
  error?: CanvasError;
  mismatches: string[];
  play?: { status: 'running' | 'passed' | 'failed' | 'none'; steps: PlayStep[]; error?: string };
  a11y?: { result?: A11yResult; error?: string; running: boolean };
}

type Listener = () => void;

function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const store = createStore<AppState>({
  descriptors: {},
  inferred: {},
  story: {},
  viewport: 'responsive',
  rotate: false,
  theme: 'system',
  panel: 'controls',
  inspectorTab: 'tree',
  overlays: { suspense: false, measure: false },
  sidebarOpen: false,
  nextStatus: 'starting',
  canvasReloading: false,
  renderPending: false,
  clientLogs: [],
  events: [],
  mismatches: [],
  actionRecords: [],
});

/** Subscribes a component to a slice of the store. */
export function useStore<S>(selector: (state: AppState) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()));
}

/** Clears per-render data when a different story is selected. */
export function resetStoryData(): Partial<AppState> {
  return {
    renderId: undefined,
    record: undefined,
    actionRecords: [],
    report: undefined,
    reportError: undefined,
    clientHtml: undefined,
    commitMs: undefined,
    clientLogs: [],
    events: [],
    error: undefined,
    mismatches: [],
    play: undefined,
    a11y: undefined,
  };
}
