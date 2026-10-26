import { useEffect, useRef } from 'react';
import type { AddonApi, AddonContext } from '../../config';
import { config } from '../lib/api';
import { selection, setArg } from '../lib/actions';
import { store } from '../lib/store';

/** A panel registered by an addon's manager module (FR-8.1). */
export interface AddonPanel {
  id: string;
  title: string;
  render(container: HTMLElement, context: AddonContext): void | (() => void);
}

export interface AddonToolbarItem {
  id: string;
  title: string;
  onClick(context: AddonContext): void;
}

const panels: AddonPanel[] = [];
const toolbarItems: AddonToolbarItem[] = [];
let loaded: Promise<void> | undefined;

function context(): AddonContext {
  const state = store.get();
  const sel = selection(state);
  return {
    storyId: state.storyId ?? null,
    args: { ...(sel?.descriptor?.args ?? {}), ...(state.story.args ?? {}) },
    report: state.report ?? null,
    on(event, listener) {
      let last: unknown = event === 'story' ? state.storyId : event === 'render' ? state.renderId : state.story.args;
      return store.subscribe(() => {
        const s = store.get();
        const current = event === 'story' ? s.storyId : event === 'render' ? s.report : s.story.args;
        if (current !== last) {
          last = current;
          listener();
        }
      });
    },
    updateArgs(args) {
      for (const [name, value] of Object.entries(args)) setArg(name, value);
    },
  };
}

/** Imports every addon manager module once and collects what they register. */
export function loadAddons(): Promise<void> {
  loaded ??= (async () => {
    const api: AddonApi = {
      addPanel: (panel) => panels.push(panel),
      addToolbarItem: (item) => toolbarItems.push(item),
    };
    for (const addon of config.addons) {
      try {
        const module = (await import(/* @vite-ignore */ addon.url)) as { default?: (api: AddonApi) => void };
        module.default?.(api);
      } catch (error) {
        console.error(`[rsc-stories] Addon "${addon.name}" failed to load`, error);
      }
    }
  })();
  return loaded;
}

export function addonPanels(): AddonPanel[] {
  return panels;
}

export function addonToolbarItems(): AddonToolbarItem[] {
  return toolbarItems;
}

export function addonContext(): AddonContext {
  return context();
}

/** Mounts an addon panel into a plain DOM node; addons bring their own framework (or none). */
export function AddonPanelView({ panel }: { panel: AddonPanel }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = ref.current;
    if (!container) return;
    const cleanup = panel.render(container, context());
    return () => {
      if (typeof cleanup === 'function') cleanup();
      container.textContent = '';
    };
  }, [panel]);
  return <div ref={ref} className="panel-body" />;
}
