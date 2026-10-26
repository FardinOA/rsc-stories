import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { capture, COALESCE_MS } from '../../src/node/server/capture';
import { RecordStore } from '../../src/node/server/records';

/** A ServerResponse stand-in that records what reaches the socket. */
function fakeResponse(contentType = 'text/x-component') {
  const sent: string[] = [];
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    getHeader: (name: string) => (name === 'content-type' ? contentType : undefined),
    write(chunk: unknown, ...rest: unknown[]) {
      sent.push(Buffer.from(chunk as Uint8Array).toString());
      const callback = rest.find((arg) => typeof arg === 'function') as (() => void) | undefined;
      callback?.();
      return true;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined && typeof chunk !== 'function') sent.push(Buffer.from(chunk as Uint8Array).toString());
      sent.push('<end>');
      return res;
    },
  });
  return { res: res as unknown as ServerResponse, sent };
}

const newRecord = () => new RecordStore().create({ kind: 'canvas', method: 'GET', url: '/c', fileKey: 'f', exportName: 'E', state: {} });

describe('capture', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('records the body and passes writes straight through by default', () => {
    const { res, sent } = fakeResponse('text/html; charset=utf-8');
    const record = newRecord();
    const onEnd = vi.fn();
    capture(res, record, onEnd);
    res.write('<p>a</p>');
    expect(sent).toEqual(['<p>a</p>']);
    res.end('<p>b</p>');
    expect(sent).toEqual(['<p>a</p>', '<p>b</p>', '<end>']);
    expect(record.contentType).toBe('html');
    expect(Buffer.concat(record.body).toString()).toBe('<p>a</p><p>b</p>');
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('sends the start of a coalesced response in one piece, then streams', () => {
    const { res, sent } = fakeResponse();
    const record = newRecord();
    capture(res, record, () => {}, true);
    const callback = vi.fn();
    res.write('0:shell\n', callback);
    res.write('1:story\n');
    expect(sent).toEqual([]);
    expect(Buffer.concat(record.body).toString()).toBe('0:shell\n1:story\n');
    vi.advanceTimersByTime(COALESCE_MS);
    expect(sent).toEqual(['0:shell\n1:story\n']);
    expect(callback).toHaveBeenCalledTimes(1);
    res.write('2:late\n');
    expect(sent.at(-1)).toBe('2:late\n');
    res.end();
    expect(sent.at(-1)).toBe('<end>');
  });

  it('flushes held chunks before ending early', () => {
    const { res, sent } = fakeResponse();
    capture(res, newRecord(), () => {}, true);
    res.write('0:a\n');
    res.end('1:b\n');
    expect(sent).toEqual(['0:a\n', '1:b\n', '<end>']);
    vi.advanceTimersByTime(COALESCE_MS);
    expect(sent).toHaveLength(3);
  });

  it('finishes the record when the client goes away', () => {
    const { res, sent } = fakeResponse();
    const record = newRecord();
    const onEnd = vi.fn();
    capture(res, record, onEnd, true);
    res.write('0:a\n');
    res.emit('close');
    vi.advanceTimersByTime(COALESCE_MS);
    expect(sent).toEqual([]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(record.status).toBe(200);
  });
});
