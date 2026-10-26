import type { ServerResponse } from 'node:http';
import type { RenderRecord } from './records';

/**
 * How long the start of a canvas navigation's RSC response is held back. A story that resolves
 * within it reaches the browser in one piece; otherwise React commits the workshop's Suspense
 * fallback first and then throttles revealing the story by 300 ms (`FALLBACK_THROTTLE_MS`), so a
 * fast story would flash "Rendering on the server…" and appear late.
 */
export const COALESCE_MS = 50;

/**
 * Wraps a response so the body and timings are recorded for the inspector. With `coalesce`, writes
 * during the first {@link COALESCE_MS} are sent together (recorded timings stay exact).
 */
export function capture(res: ServerResponse, record: RenderRecord, onEnd: () => void, coalesce = false): void {
  const write = res.write.bind(res) as (...args: unknown[]) => boolean;
  const end = res.end.bind(res) as (...args: unknown[]) => ServerResponse;
  const toBuffer = (chunk: unknown, encoding?: unknown) =>
    typeof chunk === 'string'
      ? Buffer.from(chunk, (typeof encoding === 'string' ? encoding : 'utf8') as BufferEncoding)
      : Buffer.from(chunk as Uint8Array);
  const push = (chunk: unknown, encoding?: unknown) => {
    if (chunk === undefined || chunk === null || typeof chunk === 'function') return;
    record.firstByteAt ??= performance.now();
    if (record.contentType === 'other') {
      const type = String(res.getHeader('content-type') ?? '');
      record.contentType = type.includes('text/html') ? 'html' : type.includes('text/x-component') ? 'rsc' : 'other';
    }
    if (record.contentType === 'other') return;
    record.body.push(toBuffer(chunk, encoding));
  };

  // Held chunks and their write callbacks, until the window closes.
  let held: { chunks: Buffer[]; callbacks: Array<(error?: Error | null) => void>; timer: NodeJS.Timeout } | undefined;
  let windowOpen = coalesce;
  const flush = () => {
    if (!held) return;
    const { chunks, callbacks, timer } = held;
    held = undefined;
    clearTimeout(timer);
    write(Buffer.concat(chunks), (error?: Error | null) => {
      for (const callback of callbacks) callback(error);
    });
  };

  res.write = ((chunk: unknown, ...rest: unknown[]) => {
    push(chunk, rest[0]);
    if (windowOpen && chunk !== undefined && chunk !== null && typeof chunk !== 'function') {
      held ??= {
        chunks: [],
        callbacks: [],
        timer: setTimeout(() => {
          windowOpen = false;
          flush();
        }, COALESCE_MS),
      };
      held.chunks.push(toBuffer(chunk, rest[0]));
      const callback = rest.find((arg) => typeof arg === 'function') as ((error?: Error | null) => void) | undefined;
      if (callback) held.callbacks.push(callback);
      return true;
    }
    return write(chunk, ...rest);
  }) as typeof res.write;
  res.end = ((chunk?: unknown, ...rest: unknown[]) => {
    push(chunk, rest[0]);
    windowOpen = false;
    flush();
    record.status = res.statusCode;
    record.endedAt = performance.now();
    const result = end(chunk, ...rest);
    onEnd();
    return result;
  }) as typeof res.end;
  res.on('close', () => {
    if (held) clearTimeout(held.timer);
    if (!record.done) {
      record.status ??= res.statusCode;
      onEnd();
    }
  });
}
