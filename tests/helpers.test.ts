import { describe, expect, it } from 'vitest';
import { defineConfig, fixture, fn, mockModule, mockVariants, repeat, VARIANTS } from '../src/index';

describe('public helpers', () => {
  it('defineConfig is an identity', () => {
    const config = { stories: ['a'] };
    expect(defineConfig(config)).toBe(config);
  });

  it('fn records calls and can be reprogrammed', () => {
    const spy = fn((a: number) => a * 2);
    expect(spy(2)).toBe(4);
    spy.mockReturnValue(7);
    expect(spy(1)).toBe(7);
    spy.mockImplementation(() => {
      throw new Error('x');
    });
    expect(() => spy(3)).toThrow('x');
    expect(spy.mock.calls).toEqual([[2], [1], [3]]);
    expect(spy.mock.results.map((r) => r.result ?? (r.error as Error).message)).toEqual([4, 7, 'x']);
    spy.mockReset();
    expect(spy.mock.calls).toEqual([]);
    expect(spy(5)).toBe(10);
    expect((spy as unknown as Record<symbol, boolean>)[Symbol.for('rsc-stories.fn')]).toBe(true);
    expect(fn()()).toBeUndefined();
  });

  it('typed module mocks and variants', () => {
    const impl = mockModule<{ db: { get(): number } }>({ db: { get: () => 1 } });
    expect(impl).toEqual({ db: { get: expect.any(Function) } });
    const variants = mockVariants({ a: 1 }, { empty: { a: 0 } });
    expect(variants[VARIANTS]).toEqual({ default: { a: 1 }, variants: { empty: { a: 0 } } });
  });

  it('fixtures generate variants (FR-3.9)', async () => {
    const orders = fixture({ items: [{ id: 'a', qty: 1 }], total: 10 });
    expect(orders.value).not.toBe(orders.value);
    expect(orders.with({ total: 20 })).toEqual({ items: [{ id: 'a', qty: 1 }], total: 20 });
    expect(orders.empty()).toEqual({ items: [], total: 10 });
    expect(orders.large(3).items.map((i) => i.id)).toEqual(['a', 'a-1', 'a-2']);
    await expect(orders.error('nope')).rejects.toThrow('nope');
    expect(await orders.delayed(1)).toEqual(orders.value);
    const pending = await Promise.race([orders.loading(), new Promise((r) => setTimeout(() => r('pending'), 20))]);
    expect(pending).toBe('pending');
    expect(fixture([1, 2]).empty()).toEqual([]);
    expect(fixture([]).large(3)).toEqual([]);
    expect(repeat(3, (i) => i * 2)).toEqual([0, 2, 4]);
  });
});
