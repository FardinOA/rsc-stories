import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { findClientLeaks, locateModule, moduleFacts } from '../../src/node/inspector/modules';
import { tempProject } from '../helpers/project';

describe('client module analysis (FR-5.5)', () => {
  it('detects client-only APIs', async () => {
    const root = await tempProject({
      'a.tsx': `'use client';\nimport { useState } from 'react';\nexport function A() { const [s] = useState(0); return <button onClick={() => {}}>{s}</button>; }`,
      'b.tsx': `export const B = () => <p>{typeof window}</p>;`,
      'c.tsx': `import { Component } from 'react'; export default class C extends Component {}`,
      'd.ts': `export function useThing() {} export const x = useCustom();`,
    });
    expect((await moduleFacts(path.join(root, 'a.tsx'))).clientApis).toEqual(['useState', 'onClick']);
    expect((await moduleFacts(path.join(root, 'a.tsx'))).directive).toBe('use client');
    expect((await moduleFacts(path.join(root, 'b.tsx'))).clientApis).toEqual(['window']);
    expect((await moduleFacts(path.join(root, 'c.tsx'))).clientApis).toContain('class Component');
    expect((await moduleFacts(path.join(root, 'd.ts'))).clientApis).toEqual(['useCustom']);
  });

  it('reports marked and inherited leaks', async () => {
    const root = await tempProject({
      'Marked.tsx': `'use client';\nexport function Marked({ n }: { n: number }) { return <b>{n}</b>; }`,
      'Parent.tsx': `'use client';\nimport { useState } from 'react';\nimport { Price } from './Price';\nimport { format } from './format';\nexport function Parent() { const [n] = useState(1); return <Price value={format(n)} />; }`,
      'Price.tsx': `export function Price({ value }: { value: string }) { return <span>{value}</span>; }`,
      'format.ts': `export const format = (n: number) => n.toFixed(2);`,
    });
    const { leaks, clientFiles } = await findClientLeaks([
      path.join(root, 'Marked.tsx'),
      path.join(root, 'Parent.tsx'),
      path.join(root, 'missing.tsx'),
    ]);
    expect(leaks.map((l) => [l.component, l.kind])).toEqual([
      ['Marked', 'marked'],
      ['Price', 'inherited'],
    ]);
    expect(leaks[1]!.reason).toBe("inherited 'use client' from Parent");
    expect([...clientFiles].map((f) => path.basename(f)).sort()).toEqual(['Marked.tsx', 'Parent.tsx', 'Price.tsx', 'format.ts']);
  });

  it('locates modules from bundler ids', () => {
    const options = { rootDir: '/repo', workshopDir: '/repo/app/.rsc-stories/.cache/workshop', distDir: '/nowhere' };
    expect(locateModule('[project]/app/src/Button.tsx [app-client] (ecmascript)', options)).toEqual({
      file: '/repo/app/src/Button.tsx',
      external: false,
    });
    expect(locateModule('[project]/node_modules/next/dist/x.js [app-client] (ecmascript)', options).external).toBe(true);
    expect(locateModule('(app-pages-browser)/../../../src/Card.tsx', options)).toEqual({ file: '/repo/app/src/Card.tsx', external: false });
    expect(locateModule('/abs/file.tsx', options).file).toBe('/abs/file.tsx');
    expect(locateModule('12345', options)).toEqual({ external: true });
  });
});
