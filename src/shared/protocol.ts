import type { JsonValue } from '../types';
import type { LogEntry, NavigationSignal } from './global';

/** Marks every message so the workshop ignores unrelated `postMessage` traffic. */
export const MESSAGE_SOURCE = 'rsc-stories';

/** A step reported by a running `play` function. */
export interface PlayStep {
  label: string;
  status: 'running' | 'passed' | 'failed';
  error?: string;
}

/** Result of an axe run in the canvas. */
export interface A11yResult {
  violations: Array<{
    id: string;
    impact: string | null;
    help: string;
    helpUrl: string;
    nodes: Array<{ target: string[]; html: string; failureSummary?: string }>;
  }>;
  passes: number;
  incomplete: number;
}

/** Messages from the canvas iframe to the workshop. */
export type CanvasMessage =
  | {
      type: 'rendered';
      renderId: string;
      storyId: string;
      /** `initial` for a document load, `soft` for an RSC navigation or refresh. */
      navigation: 'initial' | 'soft';
      /** Initial load: response end → first hydration commit. Soft: request → commit. */
      commitMs: number;
    }
  | { type: 'dom'; renderId: string; html: string }
  | { type: 'log'; entry: LogEntry }
  | { type: 'action'; name: string; args: JsonValue[]; time: number }
  | { type: 'router'; method: string; args: JsonValue[]; time: number }
  | {
      type: 'error';
      renderId: string;
      message: string;
      stack?: string;
      digest?: string;
      navigation?: NavigationSignal;
    }
  | { type: 'hydration-mismatch'; renderId: string; message: string }
  | { type: 'play'; renderId: string; status: 'running' | 'passed' | 'failed' | 'none'; steps: PlayStep[]; error?: string }
  | { type: 'a11y'; renderId: string; result?: A11yResult; error?: string };

/** Messages from the workshop to the canvas iframe. */
export type WorkshopMessage =
  | { type: 'navigate'; url: string }
  | { type: 'refresh' }
  | { type: 'play' }
  | { type: 'overlays'; suspense: boolean; measure: boolean }
  | { type: 'a11y' }
  | { type: 'hello' };

export type Envelope<T> = T & { source: typeof MESSAGE_SOURCE };

export function isEnvelope<T>(data: unknown): data is Envelope<T> {
  return (
    !!data &&
    typeof data === 'object' &&
    (data as { source?: unknown }).source === MESSAGE_SOURCE &&
    typeof (data as { type?: unknown }).type === 'string'
  );
}
