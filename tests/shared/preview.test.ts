import { describe, expect, it } from 'vitest';
import { byteLength, toPreview } from '../../src/shared/preview';

describe('toPreview', () => {
  it('keeps JSON values and tags the rest', () => {
    expect(toPreview({ a: 1, b: 'x', c: true, d: null })).toEqual({ a: 1, b: 'x', c: true, d: null });
    expect(toPreview(undefined)).toBe('[undefined]');
    expect(toPreview(NaN)).toBe('NaN');
    expect(toPreview(5n)).toBe('5n');
    expect(toPreview(Symbol('s'))).toBe('Symbol(s)');
    expect(toPreview(function named() {})).toBe('[ƒ named]');
    expect(toPreview(new Date('2026-01-01T00:00:00Z'))).toBe('[Date 2026-01-01T00:00:00.000Z]');
    expect(toPreview(new Date('nope'))).toBe('[Invalid Date]');
    expect(toPreview(new Error('boom'))).toBe('[Error: boom]');
    expect(toPreview(/x/g)).toBe('/x/g');
    expect(toPreview(new URL('https://a.b/c'))).toBe('[URL https://a.b/c]');
    expect(toPreview(Promise.resolve())).toBe('[Promise]');
    expect(toPreview(new Uint8Array(4))).toBe('[Uint8Array(4 bytes)]');
    expect(toPreview(new Map([['k', 1]]))).toEqual({ '[Map]': [['k', 1]] });
    expect(toPreview(new Set([1]))).toEqual({ '[Set]': [1] });
  });

  it('bounds size, depth and cycles', () => {
    expect(toPreview('x'.repeat(500))).toMatch(/… \(500 chars\)$/);
    const list = toPreview(Array.from({ length: 40 }, (_, i) => i)) as unknown[];
    expect(list).toHaveLength(26);
    expect(list[25]).toBe('… 15 more');
    const deep = { a: { b: { c: { d: { e: 1 } } } } };
    expect(JSON.stringify(toPreview(deep))).toContain('[Object]');
    const cycle: Record<string, unknown> = { name: 'loop' };
    cycle.self = cycle;
    expect(toPreview(cycle)).toEqual({ name: 'loop', self: '[Circular]' });
  });

  it('names class instances and survives throwing getters', () => {
    class Point {
      x = 1;
    }
    expect(toPreview(new Point())).toEqual({ '[class]': 'Point', x: 1 });
    const tricky = Object.defineProperty({}, 'bad', {
      enumerable: true,
      get() {
        throw new Error('nope');
      },
    });
    expect(toPreview(tricky)).toEqual({ bad: '[Thrown: nope]' });
  });

  it('measures UTF-8 bytes', () => {
    expect(byteLength('abc')).toBe(3);
    expect(byteLength('é')).toBe(2);
  });
});
