import { startTransition, useEffect, useLayoutEffect, useRef } from 'react';
import type { JsonValue } from '../../types';
import type { A11yResult, CanvasMessage, PlayStep } from '../../shared/protocol';
import { API_PREFIX } from '../../shared/state';
import { canvasState, installCanvasChannel, onWorkshopMessage, post } from './channel';
import { setOverlays } from './overlays';

installCanvasChannel();

/** The parts of the App Router the bridge drives; passed in by the generated app. */
export interface BridgeRouter {
  replace(href: string, options?: { scroll?: boolean }): void;
  refresh(): void;
}

export interface CanvasBridgeProps {
  renderId: string;
  storyId: string;
  fileKey: string;
  exportName: string;
  hasPlay: boolean;
  args: JsonValue;
  parameters: JsonValue;
  /** `true` in static builds: there is no server to re-render against. */
  isStatic: boolean;
  router: BridgeRouter;
}

/** Time an RSC navigation or refresh was requested; consumed by the next commit. */
let pendingNavigation: number | null = null;
let initialReported = false;

interface TestingGlobals {
  within: (element: HTMLElement) => unknown;
  userEvent: { setup: () => unknown };
}

declare global {
  interface Window {
    __RSC_STORIES_TEST__?: TestingGlobals;
    axe?: { run: (context: Element, options?: unknown) => Promise<RawAxeResult> };
  }
}

interface RawAxeResult {
  violations: Array<{
    id: string;
    impact?: string | null;
    help: string;
    helpUrl: string;
    nodes: Array<{ target: unknown[]; html: string; failureSummary?: string }>;
  }>;
  passes: unknown[];
  incomplete: unknown[];
}

const scripts = new Map<string, Promise<void>>();

function loadScript(src: string): Promise<void> {
  let promise = scripts.get(src);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
    scripts.set(src, promise);
  }
  return promise;
}

// Bypasses the bundler: play modules are built on demand by the workshop server.
const importUrl = new Function('url', 'return import(url)') as (url: string) => Promise<Record<string, unknown>>;

function storyRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-rsc-stories-root]');
}

async function runPlay(props: CanvasBridgeProps): Promise<CanvasMessage> {
  const steps: PlayStep[] = [];
  const report = (status: 'running' | 'passed' | 'failed' | 'none', error?: string): CanvasMessage => {
    const message: CanvasMessage = {
      type: 'play',
      renderId: props.renderId,
      status,
      steps: steps.map((s) => ({ ...s })),
      ...(error ? { error } : {}),
    };
    post(message);
    return message;
  };
  if (!props.hasPlay) return report('none');
  report('running');
  try {
    await loadScript(`${API_PREFIX}/static/play-runtime.js`);
    const module = await importUrl(`${API_PREFIX}/play/${encodeURIComponent(props.fileKey)}.js?v=${encodeURIComponent(props.renderId)}`);
    const story = module[props.exportName] as { play?: (ctx: unknown) => unknown } | undefined;
    const meta = module.default as { play?: (ctx: unknown) => unknown } | undefined;
    const play = story?.play ?? meta?.play;
    const testing = window.__RSC_STORIES_TEST__;
    const root = storyRoot();
    if (!play) return report('none');
    if (!testing || !root) throw new Error('The play runtime or the story root is missing.');
    const step = async (label: string, run: () => Promise<void> | void) => {
      const entry: PlayStep = { label, status: 'running' };
      steps.push(entry);
      report('running');
      try {
        await run();
        entry.status = 'passed';
      } catch (error) {
        entry.status = 'failed';
        entry.error = (error as Error).message;
        throw error;
      } finally {
        report('running');
      }
    };
    await play({
      canvasElement: root,
      canvas: testing.within(root),
      userEvent: testing.userEvent.setup(),
      step,
      args: props.args,
      id: props.storyId,
      parameters: props.parameters,
    });
    return report('passed');
  } catch (error) {
    return report('failed', (error as Error).message ?? String(error));
  }
}

async function runA11y(renderId: string): Promise<void> {
  try {
    await loadScript(`${API_PREFIX}/static/axe.min.js`);
    const root = storyRoot();
    if (!window.axe || !root) throw new Error('axe-core or the story root is missing.');
    const raw = await window.axe.run(root, { resultTypes: ['violations'] });
    const result: A11yResult = {
      violations: raw.violations.map((v) => ({
        id: v.id,
        impact: v.impact ?? null,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.slice(0, 20).map((n) => ({
          target: n.target.map(String),
          html: n.html.slice(0, 300),
          ...(n.failureSummary ? { failureSummary: n.failureSummary } : {}),
        })),
      })),
      passes: raw.passes.length,
      incomplete: raw.incomplete.length,
    };
    post({ type: 'a11y', renderId, result });
  } catch (error) {
    post({ type: 'a11y', renderId, error: (error as Error).message });
  }
}

function isPlainLeftClick(event: MouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/**
 * Connects the canvas to the workshop: reports each server render, snapshots the story DOM for the
 * hydration diff, executes workshop commands, and keeps links inside the story from navigating the
 * iframe away.
 */
export function CanvasBridgeImpl(props: CanvasBridgeProps) {
  const latest = useRef(props);
  latest.current = props;
  const { renderId, storyId } = props;

  useLayoutEffect(() => {
    const state = canvasState();
    state.renderId = renderId;
    state.storyId = storyId;
    let navigation: 'initial' | 'soft' = 'soft';
    let commitMs = 0;
    if (!initialReported) {
      initialReported = true;
      navigation = 'initial';
      const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      commitMs = performance.now() - (entry?.responseEnd ?? 0);
    } else if (pendingNavigation !== null) {
      commitMs = performance.now() - pendingNavigation;
    }
    pendingNavigation = null;
    state.hydrated = true;
    post({ type: 'rendered', renderId, storyId, navigation, commitMs: Math.round(commitMs * 10) / 10 });
  }, [renderId, storyId]);

  useEffect(() => {
    const canvas = document.querySelector('[data-rsc-stories-canvas]');
    if (!canvas) return;
    let timer = 0;
    let last = '';
    const snapshot = () => {
      const root = storyRoot();
      if (!root) return;
      const html = root.innerHTML;
      if (html === last) return;
      last = html;
      post({ type: 'dom', renderId, html });
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(snapshot, 120);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(canvas, { subtree: true, childList: true, characterData: true, attributes: true });
    schedule();
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [renderId]);

  useEffect(() => {
    canvasState().runPlay = () => runPlay(latest.current);
    return onWorkshopMessage((message) => {
      const current = latest.current;
      switch (message.type) {
        case 'navigate':
          if (current.isStatic) {
            window.location.assign(message.url);
            return;
          }
          pendingNavigation = performance.now();
          startTransition(() => current.router.replace(message.url, { scroll: false }));
          return;
        case 'refresh':
          if (current.isStatic) return;
          pendingNavigation = performance.now();
          startTransition(() => current.router.refresh());
          return;
        case 'play':
          void runPlay(current);
          return;
        case 'overlays':
          setOverlays(message);
          return;
        case 'a11y':
          void runA11y(current.renderId);
          return;
        case 'hello':
          post({
            type: 'rendered',
            renderId: current.renderId,
            storyId: current.storyId,
            navigation: 'soft',
            commitMs: 0,
          });
          return;
      }
    });
  }, []);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!isPlainLeftClick(event)) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>('a[href]');
      if (!anchor || !anchor.closest('[data-rsc-stories-root]')) return;
      if (anchor.target && anchor.target !== '_self') return;
      if (anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || (url.hash && url.pathname === window.location.pathname)) return;
      // `next/link` checks `defaultPrevented` before navigating, so this stops it too.
      event.preventDefault();
      post({ type: 'router', method: 'link', args: [anchor.getAttribute('href') ?? url.pathname], time: performance.now() });
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, []);

  return null;
}
