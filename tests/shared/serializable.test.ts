import { describe, expect, it } from 'vitest';
import { findSerializationIssues, isClientReference, isServerReference } from '../../src/shared/serializable';

describe('findSerializationIssues (FR-5.3)', () => {
  it('accepts what React can serialize', () => {
    expect(
      findSerializationIssues({
        text: 'a',
        n: 1,
        b: true,
        nothing: null,
        list: [1, { a: 'b' }],
        map: new Map([['k', 'v']]),
        set: new Set([1]),
        big: 1n,
        bytes: new Uint8Array(2),
        promise: Promise.resolve(1),
        sym: Symbol.for('global'),
        children: () => null,
      }),
    ).toEqual([]);
  });

  it('flags functions, class instances, local symbols and null prototypes', () => {
    class Money {
      amount = 1;
    }
    const issues = findSerializationIssues({
      onSelect: function onSelect() {},
      price: new Money(),
      tag: Symbol('local'),
      bare: Object.create(null),
      nested: { deep: [() => 1] },
    });
    expect(issues.map((i) => [i.path, i.kind, i.severity])).toEqual([
      ['onSelect', 'function', 'error'],
      ['price', 'class-instance', 'error'],
      ['tag', 'symbol', 'error'],
      ['bare', 'null-prototype', 'error'],
      ['nested.deep[0]', 'function', 'error'],
    ]);
    expect(issues[0]!.message).toContain('use server');
    expect(issues[1]!.message).toContain('Money');
  });

  it('warns about dates and symbol keys', () => {
    const issues = findSerializationIssues({ when: new Date(), meta: { [Symbol('k')]: 1 } });
    expect(issues.map((i) => [i.path, i.kind, i.severity])).toEqual([
      ['when', 'date', 'warning'],
      ['meta[Symbol(k)]', 'symbol', 'warning'],
    ]);
  });

  it('allows server and client references', () => {
    const action = Object.assign(async () => {}, { $$typeof: Symbol.for('react.server.reference') });
    const client = Object.assign(() => null, { $$typeof: Symbol.for('react.client.reference') });
    expect(isServerReference(action)).toBe(true);
    expect(isClientReference(client)).toBe(true);
    expect(findSerializationIssues({ action, client, el: { $$typeof: Symbol.for('react.transitional.element') } })).toEqual([]);
  });

  it('does not loop on cycles', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(findSerializationIssues({ a })).toEqual([]);
  });
});
