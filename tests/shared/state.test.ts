import { describe, expect, it } from 'vitest';
import { canvasPath, decodeState, encodeState, parseCanvasPath } from '../../src/shared/state';

describe('state tokens', () => {
  it('encodes the empty state as _', () => {
    expect(encodeState({})).toBe('_');
    expect(encodeState({ args: {}, mocks: { off: [], variants: {}, latency: {} }, globals: {} })).toBe('_');
    expect(decodeState('_')).toEqual({});
    expect(decodeState(undefined)).toEqual({});
  });

  it('round-trips args, mocks, globals and the nonce', () => {
    const state = {
      args: {
        name: 'Ada',
        count: 3,
        nested: { list: [1, 'two'] },
        missing: undefined,
        when: new Date('2026-01-02T03:04:05.000Z'),
        big: 10n,
      },
      mocks: { off: ['module:b', 'module:a'], variants: { 'fetch:user': 'error' }, latency: { '@/lib/db': 3000 } },
      globals: { background: 'Dark' },
      nonce: 'abc',
    };
    const decoded = decodeState(encodeState(state));
    expect(decoded.args).toEqual(state.args);
    expect(decoded.args?.when).toBeInstanceOf(Date);
    expect(decoded.mocks).toEqual({ ...state.mocks, off: ['module:a', 'module:b'] });
    expect(decoded.globals).toEqual(state.globals);
    expect(decoded.nonce).toBe('abc');
  });

  it('handles unicode and is URL safe', () => {
    const token = encodeState({ args: { emoji: 'héllo ✨ 東京' } });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeState(token).args?.emoji).toBe('héllo ✨ 東京');
  });

  it('decodes garbage to the empty state', () => {
    expect(decodeState('%%%not-base64')).toEqual({});
    expect(decodeState('eyJ0')).toEqual({});
  });

  it('builds and parses canvas paths', () => {
    const path = canvasPath('commerce-cart', 'Default', { args: { n: 1 } }, { q: 'shoes', tag: ['a', 'b'] });
    expect(path).toMatch(/^\/rsc-stories\/canvas\/commerce-cart\/Default\/[A-Za-z0-9_-]+\?q=shoes&tag=a&tag=b$/);
    const parsed = parseCanvasPath(path.split('?')[0]!);
    expect(parsed).toMatchObject({ fileKey: 'commerce-cart', exportName: 'Default', state: { args: { n: 1 } } });
    expect(parseCanvasPath('/other')).toBeNull();
    expect(parseCanvasPath('/rsc-stories/canvas/only')).toBeNull();
  });
});
