import { describe, expect, it } from 'vitest';
import { componentKind, componentName, toControlValue, toJsonSafe } from '../../src/runtime/server/describe';

const clientRef = Object.assign(() => null, { $$typeof: Symbol.for('react.client.reference'), $$id: '/src/Button.tsx#Button' });

describe('describe helpers', () => {
  it('names components', () => {
    expect(componentName(clientRef)).toBe('Button');
    expect(
      componentName(Object.assign(() => null, { $$typeof: Symbol.for('react.client.reference'), $$id: '/src/Card.tsx#default' })),
    ).toBe('Card.tsx');
    expect(componentName(function OrderSummary() {})).toBe('OrderSummary');
    expect(componentName(Object.assign(() => null, { displayName: 'Shown' }))).toBe('Shown');
    expect(componentName({ render: { name: 'Fwd' } })).toBe('Fwd');
    expect(componentName(undefined)).toBeUndefined();
  });

  it('classifies components', () => {
    expect(componentKind(clientRef)).toBe('client');
    expect(componentKind(async function Async() {})).toBe('server');
    expect(componentKind(function Sync() {})).toBe('shared');
    expect(componentKind(undefined)).toBe('none');
  });

  it('converts args for the Controls panel', () => {
    const action = Object.assign(async function save() {}, { $$typeof: Symbol.for('react.server.reference') });
    class Money {
      v = 1;
    }
    expect(
      toControlValue({
        s: 'a',
        n: 1,
        inf: Infinity,
        u: undefined,
        d: new Date('2026-01-01T00:00:00Z'),
        bad: new Date('x'),
        f: function onClick() {},
        action,
        c: clientRef,
        el: { $$typeof: Symbol.for('react.transitional.element'), type: 'div' },
        cmp: { $$typeof: Symbol.for('react.transitional.element'), type: function Card() {} },
        list: [1, 2],
        money: new Money(),
        big: 2n,
        sym: Symbol('x'),
      }),
    ).toEqual({
      s: 'a',
      n: 1,
      inf: { $value: 'Infinity' },
      u: { $undefined: true },
      d: { $date: '2026-01-01T00:00:00.000Z' },
      bad: { $date: 'Invalid Date' },
      f: { $fn: 'onClick' },
      action: { $fn: 'save', serverAction: true },
      c: { $component: 'Button' },
      el: { $element: 'div' },
      cmp: { $element: 'Card' },
      list: [1, 2],
      money: { $value: { '[class]': 'Money', v: 1 } },
      big: { $value: '2n' },
      sym: { $value: 'Symbol(x)' },
    });
  });

  it('makes parameters JSON safe', () => {
    expect(toJsonSafe({ a: undefined, b: [1, () => 1], c: { d: NaN }, e: new Map() })).toEqual({
      b: [1, '[ƒ anonymous]'],
      c: { d: 'NaN' },
      e: { '[Map]': [] },
    });
  });
});
