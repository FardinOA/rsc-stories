import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeForDisplay, extractInlineFlight, FlightPayload, isComponentInfo, parseFlight } from '../../src/node/inspector/flight';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

describe('parseFlight', () => {
  it('parses model, tagged and length-prefixed rows', () => {
    const text = 'T\n';
    const payload = [
      '0:{"a":"$1"}',
      '1:I["mod",["chunk.js"],"Button"]',
      `2:T${new TextEncoder().encode('multi\nline é').length.toString(16)},multi\nline é`,
      '3:D{"time":1}',
      ':N1000.5',
      '4:E{"digest":"abc","message":"boom"}',
      '5:null',
      '6:{"broken"',
      'garbage-without-colon',
    ].join('\n');
    const rows = parseFlight(payload);
    expect(rows.map((r) => [r.id, r.tag])).toEqual([
      ['0', ''],
      ['1', 'I'],
      ['2', 'T'],
      ['3', 'D'],
      ['', 'N'],
      ['4', 'E'],
      ['5', ''],
      ['6', ''],
      ['', '?'],
    ]);
    expect(rows[2]!.text).toBe('multi\nline é');
    expect(rows[4]!.value).toBe(1000.5);
    expect(rows[6]!.value).toBeNull();
    expect(rows[7]!.value).toBeUndefined();
    expect(text).toBe('T\n');
  });

  it('indexes rows and resolves references', () => {
    const p = new FlightPayload(
      [
        '0:["$","$L1",null,{"x":"$2"}]',
        '1:I["$3",["$4"],"Card",1]',
        '2:{"deep":true}',
        '3:"[project]/src/Card.tsx [app-client] (ecmascript)"',
        '4:"/_next/static/chunks/a.js"',
        '5:D"$6"',
        '6:{"name":"Page","env":"Server"}',
        '5:"ok"',
      ].join('\n'),
    );
    expect(FlightPayload.refId('$L1')).toBe('1');
    expect(FlightPayload.refId('$1f')).toBe('1f');
    expect(FlightPayload.refId('$Sreact.suspense')).toBeUndefined();
    expect(p.deref('$2')).toEqual({ deep: true });
    expect(p.clientReference('$L1')).toEqual({
      rowId: '1',
      moduleId: '[project]/src/Card.tsx [app-client] (ecmascript)',
      chunks: ['/_next/static/chunks/a.js'],
      exportName: 'Card',
      async: true,
    });
    expect(p.clientReference('$2')).toBeUndefined();
    expect(p.componentsOf('5').map((c) => c.name)).toEqual(['Page']);
    expect(isComponentInfo({ name: 'x', env: 'Server', awaited: 1 })).toBe(false);
  });

  it('extracts the inline payload from Next HTML', () => {
    const html = fixture('usercard.prod.html');
    const bytes = extractInlineFlight(html);
    expect(bytes.length).toBeGreaterThan(1000);
    const payload = new FlightPayload(bytes);
    expect(payload.imports.size).toBeGreaterThan(0);
    expect([...payload.imports.values()].some((row) => JSON.stringify(row.value).includes('FollowButton'))).toBe(true);
    expect(extractInlineFlight('<script>self.__next_f.push([3,"aGk="])</script><script>self.__next_f.push([1,"x"]</script>')).toEqual(
      new Uint8Array([104, 105]),
    );
  });

  it('decodes Flight encodings for display', () => {
    const p = new FlightPayload(['1:I["m",[],"Btn"]', '2:{"name":"save","id":"a"}', '3:[1,2]', '4:"text"'].join('\n'));
    expect(
      decodeForDisplay(p, {
        u: '$undefined',
        d: '$D2026-01-01',
        n: '$n10',
        nan: '$NaN',
        inf: '$Infinity',
        ninf: '$-Infinity',
        neg: '$-0',
        sym: '$Sreact.fragment',
        fn: '$E()=>1',
        action: '$h2',
        lazyClient: '$L1',
        lazy: '$L9',
        promise: '$@5',
        map: '$Q3',
        set: '$W3',
        form: '$K1',
        blob: '$B1',
        temp: '$T',
        omitted: '$Y',
        ref: '$4',
        escaped: '$$money',
        element: ['$', '$L1', null, {}],
        host: ['$', 'div', null, {}],
        plain: 'x',
      }),
    ).toEqual({
      u: '[undefined]',
      d: '[Date 2026-01-01]',
      n: '10n',
      nan: 'NaN',
      inf: 'Infinity',
      ninf: '-Infinity',
      neg: -0,
      sym: '[Symbol react.fragment]',
      fn: '[ƒ (dev source)]',
      action: '[Server Action save]',
      lazyClient: '[Client Btn]',
      lazy: '[Lazy element]',
      promise: '[Promise]',
      map: { '[Map]': [1, 2] },
      set: { '[Set]': [1, 2] },
      form: '[FormData]',
      blob: '[Blob]',
      temp: '[Temporary reference]',
      omitted: '[Omitted in dev]',
      ref: 'text',
      escaped: '$money',
      element: '[<Btn>]',
      host: '[<div>]',
      plain: 'x',
    });
  });
});
