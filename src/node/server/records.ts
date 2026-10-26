import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import {
  getGlobal,
  type LogEntry,
  type MockCall,
  type NavigationSignal,
  type RenderEvent,
  type RenderMode,
  type RenderStore,
  type RenderWarning,
} from '../../shared/global';
import type { StoryState } from '../../shared/state';
import type { Budgets } from '../../types';

/** Everything recorded about one request to the generated app. */
export interface RenderRecord {
  renderId: string;
  kind: RenderStore['kind'];
  method: string;
  url: string;
  fileKey: string;
  exportName: string;
  storyId?: string;
  /** Story-level budgets (`parameters.budgets`), reported by the runtime. */
  budgets?: Budgets;
  state: StoryState;
  status?: number;
  /** `html` for document loads, `rsc` for navigations/refreshes/actions, `other` otherwise. */
  contentType: 'html' | 'rsc' | 'other';
  /** `performance.now()` values. */
  startedAt: number;
  firstByteAt?: number;
  endedAt?: number;
  /** Wall-clock start, for display. */
  startedAtMs: number;
  calls: MockCall[];
  warnings: RenderWarning[];
  logs: LogEntry[];
  navigation: NavigationSignal[];
  /** Raw response body (HTML or Flight), captured for the inspector. */
  body: Buffer[];
  done: boolean;
}

/** JSON view of a record for the workshop UI. */
export function recordToJson(record: RenderRecord) {
  return {
    renderId: record.renderId,
    kind: record.kind,
    method: record.method,
    url: record.url,
    fileKey: record.fileKey,
    exportName: record.exportName,
    storyId: record.storyId ?? null,
    state: record.state,
    status: record.status ?? null,
    contentType: record.contentType,
    startedAtMs: record.startedAtMs,
    timings: {
      ttfb: record.firstByteAt === undefined ? null : round(record.firstByteAt - record.startedAt),
      total: record.endedAt === undefined ? null : round(record.endedAt - record.startedAt),
    },
    calls: record.calls,
    warnings: record.warnings,
    logs: record.logs,
    navigation: record.navigation,
    bodyBytes: record.body.reduce((sum, chunk) => sum + chunk.length, 0),
    done: record.done,
  };
}

export type RenderRecordJson = ReturnType<typeof recordToJson>;

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

const MAX_RECORDS = 300;

/** Keeps recent render records and turns runtime events into record updates. */
export class RecordStore extends EventEmitter {
  private readonly records = new Map<string, RenderRecord>();
  private counter = 0;

  /** `render:start`, `render:update`, `render:end` events carry the record. */
  create(input: {
    kind: RenderStore['kind'];
    method: string;
    url: string;
    fileKey: string;
    exportName: string;
    state: StoryState;
  }): RenderRecord {
    const renderId = `r${Date.now().toString(36)}${(++this.counter).toString(36)}`;
    const record: RenderRecord = {
      renderId,
      ...input,
      contentType: 'other',
      startedAt: performance.now(),
      startedAtMs: Date.now(),
      calls: [],
      warnings: [],
      logs: [],
      navigation: [],
      body: [],
      done: false,
    };
    this.records.set(renderId, record);
    if (this.records.size > MAX_RECORDS) {
      const oldest = this.records.keys().next().value;
      if (oldest !== undefined) this.records.delete(oldest);
    }
    this.emit('render:start', record);
    return record;
  }

  get(renderId: string): RenderRecord | undefined {
    return this.records.get(renderId);
  }

  all(): RenderRecord[] {
    return [...this.records.values()];
  }

  /** Applies a runtime event to its record. */
  apply(record: RenderRecord, event: RenderEvent): void {
    switch (event.type) {
      case 'call:start':
      case 'call:end': {
        const index = record.calls.findIndex((call) => call.id === event.call.id);
        if (index === -1) record.calls.push(event.call);
        else record.calls[index] = event.call;
        break;
      }
      case 'warning':
        if (!record.warnings.some((w) => w.message === event.warning.message)) record.warnings.push(event.warning);
        break;
      case 'log':
        record.logs.push(event.entry);
        if (record.logs.length > 500) record.logs.shift();
        break;
      case 'navigation':
        record.navigation.push(event.signal);
        break;
      case 'story':
        record.storyId = event.storyId;
        if (event.budgets) record.budgets = event.budgets;
        break;
    }
    this.emit('render:update', record, event);
  }

  finish(record: RenderRecord): void {
    record.done = true;
    record.endedAt ??= performance.now();
    this.emit('render:end', record);
  }
}

/** Creates the process-wide `AsyncLocalStorage` and publishes it for the bundled runtime. */
export function installStorage(): AsyncLocalStorage<RenderStore> {
  const g = getGlobal();
  if (g.storage) return g.storage as AsyncLocalStorage<RenderStore>;
  const storage = new AsyncLocalStorage<RenderStore>();
  g.storage = storage;
  return storage;
}

/** The store a request runs in. */
export function storeFor(
  record: RenderRecord,
  records: RecordStore,
  options: { mode: RenderMode; strictNetwork: boolean; origin: string; isStatic?: boolean },
): RenderStore {
  return {
    renderId: record.renderId,
    kind: record.kind,
    fileKey: record.fileKey,
    exportName: record.exportName,
    state: record.state,
    mode: options.mode,
    ...(options.isStatic ? { isStatic: true } : {}),
    startedAt: record.startedAt,
    strictNetwork: options.strictNetwork,
    origin: options.origin,
    emit: (event) => records.apply(record, event),
    nextCallId: 1,
  };
}
