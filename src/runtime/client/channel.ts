import type { LogEntry } from '../../shared/global';
import { toPreview } from '../../shared/preview';
import { isEnvelope, MESSAGE_SOURCE, type CanvasMessage, type WorkshopMessage } from '../../shared/protocol';

type Listener = (message: WorkshopMessage) => void;

interface CanvasWindow extends Window {
  __RSC_STORIES_CANVAS__?: boolean;
  __RSC_STORIES__?: CanvasState;
}

/** State exposed on `window.__RSC_STORIES__` for test drivers (Playwright, `rsc-stories test`). */
export interface CanvasState {
  renderId?: string;
  storyId?: string;
  hydrated: boolean;
  messages: CanvasMessage[];
  runPlay?: () => Promise<CanvasMessage | undefined>;
}

const listeners = new Set<Listener>();
let installed = false;

function canvasWindow(): CanvasWindow | undefined {
  return typeof window === 'undefined' ? undefined : (window as CanvasWindow);
}

/** Global canvas state, created on first use. */
export function canvasState(): CanvasState {
  const w = canvasWindow();
  if (!w) return { hydrated: false, messages: [] };
  return (w.__RSC_STORIES__ ??= { hydrated: false, messages: [] });
}

/** Sends a message to the workshop (if embedded) and records it for test drivers. */
export function post(message: CanvasMessage): void {
  const w = canvasWindow();
  if (!w) return;
  const state = canvasState();
  state.messages.push(message);
  if (state.messages.length > 500) state.messages.splice(0, state.messages.length - 500);
  if (w.parent && w.parent !== w) {
    try {
      w.parent.postMessage({ ...message, source: MESSAGE_SOURCE }, w.location.origin);
    } catch {
      // A detached or cross-origin parent cannot receive messages; tests read `messages` instead.
    }
  }
}

/** Subscribes to workshop → canvas messages. */
export function onWorkshopMessage(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function format(args: unknown[]): string {
  return (
    args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        try {
          return JSON.stringify(toPreview(arg));
        } catch {
          return String(arg);
        }
      })
      .join(' ')
      // React DevTools-style `%c` styling is noise outside the browser console.
      .replace(/%c/g, '')
  );
}

const HYDRATION_PATTERN = /hydrat|did not match|server rendered (text|html)|didn't match/i;

/**
 * Installs the canvas side of the bridge once: console capture, error forwarding and the message
 * listener. Runs at module evaluation, before React hydrates, so early logs are not lost.
 */
export function installCanvasChannel(): void {
  const w = canvasWindow();
  if (!w || installed) return;
  installed = true;
  w.__RSC_STORIES_CANVAS__ = true;
  canvasState();

  const levels: Array<LogEntry['level']> = ['log', 'info', 'warn', 'error', 'debug'];
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      const message = format(args);
      // Skip React's replay of server logs; the server already recorded them with their origin.
      if (args.some((arg) => typeof arg === 'string' && arg.includes(' Server '))) return;
      post({ type: 'log', entry: { origin: 'client', level, message, time: performance.now() } });
      if (level === 'error' && HYDRATION_PATTERN.test(message)) {
        post({ type: 'hydration-mismatch', renderId: canvasState().renderId ?? '', message });
      }
    };
  }
  w.addEventListener('error', (event) => {
    post({
      type: 'log',
      entry: { origin: 'client', level: 'error', message: `Uncaught ${event.message}`, time: performance.now() },
    });
  });
  w.addEventListener('unhandledrejection', (event) => {
    post({
      type: 'log',
      entry: {
        origin: 'client',
        level: 'error',
        message: `Unhandled rejection: ${format([event.reason])}`,
        time: performance.now(),
      },
    });
  });
  w.addEventListener('message', (event: MessageEvent) => {
    if (event.origin !== w.location.origin || !isEnvelope<WorkshopMessage>(event.data)) return;
    for (const listener of listeners) listener(event.data);
  });
}
