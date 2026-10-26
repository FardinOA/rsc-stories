import { decodeState, encodeState } from '../../shared/state';
import { store, type AppState, type Theme } from './store';

/** Reads the deep link (FR-4.8): story, state token, viewport, panel, theme. */
export function readLocation(): Partial<AppState> {
  const params = new URLSearchParams(window.location.search);
  const patch: Partial<AppState> = {};
  const story = params.get('story');
  if (story) patch.storyId = story;
  const state = params.get('state');
  if (state) patch.story = decodeState(state);
  const viewport = params.get('viewport');
  if (viewport) patch.viewport = viewport;
  const size = /^(\d+)x(\d+)$/.exec(params.get('size') ?? '');
  if (size) patch.customSize = { width: Number(size[1]), height: Number(size[2]) };
  const panel = params.get('panel');
  if (panel) patch.panel = panel;
  const tab = params.get('tab');
  if (tab) patch.inspectorTab = tab;
  try {
    const theme = localStorage.getItem('rsc-stories:theme') as Theme | null;
    if (theme === 'light' || theme === 'dark' || theme === 'system') patch.theme = theme;
  } catch {
    // storage blocked
  }
  return patch;
}

/** Keeps the address bar in sync, so any state can be shared as a link. */
export function writeLocation(state: AppState, push = false): void {
  const params = new URLSearchParams();
  if (state.storyId) params.set('story', state.storyId);
  const { nonce: _nonce, ...persistent } = state.story;
  const token = encodeState(persistent);
  if (token !== '_') params.set('state', token);
  if (state.viewport !== 'responsive') params.set('viewport', state.viewport);
  if (state.viewport === 'custom' && state.customSize) {
    params.set('size', `${state.customSize.width}x${state.customSize.height}`);
  }
  if (state.panel !== 'controls') params.set('panel', state.panel);
  if (state.panel === 'inspector' && state.inspectorTab !== 'tree') params.set('tab', state.inspectorTab);
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ''}`;
  if (next === `${window.location.pathname}${window.location.search}`) return;
  if (push) window.history.pushState(null, '', next);
  else window.history.replaceState(null, '', next);
}

const syncKey = (s: AppState) => JSON.stringify([s.storyId, s.story, s.viewport, s.customSize, s.panel, s.inspectorTab]);

/**
 * Mirrors the store into the URL. Opening another story adds a history entry, so Back returns to
 * the previous story (with its args and mocks); every other change replaces the current entry.
 */
export function startUrlSync(onRestore: (storyId: string) => void): () => void {
  let last = '';
  let lastStoryId = store.get().storyId;
  let restoring = false;
  const unsubscribe = store.subscribe(() => {
    if (restoring) return;
    const s = store.get();
    const key = syncKey(s);
    if (key === last) return;
    last = key;
    const push = lastStoryId !== undefined && s.storyId !== lastStoryId;
    lastStoryId = s.storyId;
    writeLocation(s, push);
  });
  const onPopState = () => {
    restoring = true;
    try {
      const { storyId, story } = readLocation();
      store.set({ story: story ?? {} });
      if (storyId) onRestore(storyId);
    } finally {
      restoring = false;
    }
    last = syncKey(store.get());
    lastStoryId = store.get().storyId;
  };
  window.addEventListener('popstate', onPopState);
  return () => {
    unsubscribe();
    window.removeEventListener('popstate', onPopState);
  };
}
