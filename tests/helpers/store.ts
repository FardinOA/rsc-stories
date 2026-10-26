import { AsyncLocalStorage } from 'node:async_hooks';
import { getGlobal, type RenderEvent, type RenderStore } from '../../src/shared/global';
import type { ResolvedMocks } from '../../src/runtime/server/mocks';

export const storage = new AsyncLocalStorage<RenderStore>();
getGlobal().storage = storage;

/** A render store with recorded events, for running code "inside a story". */
export function makeStore(patch: Partial<RenderStore> = {}): RenderStore & { events: RenderEvent[] } {
  const events: RenderEvent[] = [];
  return {
    renderId: 'r1',
    kind: 'canvas',
    fileKey: 'file',
    exportName: 'Default',
    state: {},
    mode: 'dev',
    startedAt: performance.now(),
    strictNetwork: false,
    origin: 'http://localhost:6006',
    emit: (event) => events.push(event),
    nextCallId: 1,
    events,
    ...patch,
  };
}

/** Points the runtime hooks at fixed mocks. */
export function useMocks(mocks: ResolvedMocks | undefined): void {
  getGlobal().runtime = {
    resolveFetchMocks: () => mocks?.fetch ?? [],
    resolveMocks: () => mocks,
  };
}

export function calls(store: { events: RenderEvent[] }) {
  return store.events.filter((e) => e.type === 'call:end').map((e) => (e as Extract<RenderEvent, { type: 'call:end' }>).call);
}
