import { getGlobal, getStore, sinceStart, type MockCall, type RenderStore } from '../../shared/global';
import { NEVER_RESOLVE } from '../../shared/state';
import type { ResolvedMocks } from '../server/mocks';

/** The current render, if it is a story render (descriptor requests never apply mocks). */
export function storyStore(): RenderStore | undefined {
  const store = getStore();
  return store && store.kind !== 'meta' ? store : undefined;
}

/** Mocks for the current render, resolved lazily by the server runtime. */
export function currentMocks(store: RenderStore | undefined = storyStore()): ResolvedMocks | undefined {
  if (!store) return undefined;
  const hooks = getGlobal().runtime as { resolveMocks?: (store: RenderStore) => ResolvedMocks | undefined } | undefined;
  return hooks?.resolveMocks?.(store);
}

export function startCall(store: RenderStore, call: Omit<MockCall, 'id' | 'status' | 'start'>): MockCall {
  const started: MockCall = {
    ...call,
    id: store.nextCallId++,
    status: 'pending',
    start: sinceStart(store),
  };
  store.emit({ type: 'call:start', call: started });
  return started;
}

export function endCall(store: RenderStore, call: MockCall, patch: Partial<MockCall>): void {
  store.emit({
    type: 'call:end',
    call: { ...call, ...patch, duration: Math.round((sinceStart(store) - call.start) * 100) / 100 },
  });
}

/** Resolves after `ms`; `Infinity` never resolves, which keeps a Suspense fallback on screen. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (ms <= 0) return resolve();
    if (!Number.isFinite(ms) || ms >= NEVER_RESOLVE) return;
    setTimeout(resolve, ms);
  });
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    !!value && (typeof value === 'object' || typeof value === 'function') && typeof (value as PromiseLike<unknown>).then === 'function'
  );
}
