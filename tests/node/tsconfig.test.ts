import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJsonc, readTsconfig, workshopTsconfig } from '../../src/node/next/tsconfig';
import { tempProject } from '../helpers/project';

describe('tsconfig handling', () => {
  it('parses comments and trailing commas', () => {
    expect(parseJsonc('{\n // c\n "a": "x // not a comment", /* b */ "b": [1,2,],\n}')).toEqual({ a: 'x // not a comment', b: [1, 2] });
    expect(parseJsonc('{"s": "with \\"quotes\\""}')).toEqual({ s: 'with "quotes"' });
  });

  it('follows extends and resolves paths where they were declared', async () => {
    const root = await tempProject({
      'configs/base.json': '{ "compilerOptions": { "baseUrl": "..", "paths": { "@/*": ["src/*"] }, "experimentalDecorators": true } }',
      'tsconfig.json': '{ "extends": "./configs/base.json", "compilerOptions": { "strict": true } }',
      'pkg/tsconfig.json': '{ "extends": ["../configs/base.json"], "compilerOptions": { "paths": { "~/*": ["./lib/*"] } } }',
    });
    const resolved = readTsconfig(path.join(root, 'tsconfig.json'));
    expect(resolved.paths).toEqual({ '@/*': ['src/*'] });
    expect(resolved.pathsBase).toBe(root);
    expect(resolved.compilerOptions.strict).toBe(true);
    const nested = readTsconfig(path.join(root, 'pkg/tsconfig.json'));
    expect(nested.paths).toEqual({ '~/*': ['./lib/*'] });
    expect(nested.pathsBase).toBe(root);

    const generated = workshopTsconfig(resolved, path.join(root, '.rsc-stories/.cache/workshop'), root);
    expect(generated.compilerOptions).toMatchObject({
      baseUrl: '../../..',
      paths: { '@/*': ['src/*'] },
      experimentalDecorators: true,
      jsx: 'react-jsx',
    });
    expect(generated.include).toContain('.next/dev/types/**/*.ts');
    expect(workshopTsconfig(undefined, '/w', '/h').compilerOptions.paths).toBeUndefined();
    expect(workshopTsconfig(undefined, '/w', '/h', 15).compilerOptions.jsx).toBe('preserve');
  });

  it('rebases paths without introducing a baseUrl the host does not have', async () => {
    const root = await tempProject({ 'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"], "~ui": ["lib/ui.ts"] } } }' });
    const generated = workshopTsconfig(
      readTsconfig(path.join(root, 'tsconfig.json')),
      path.join(root, '.rsc-stories/.cache/workshop'),
      root,
    );
    expect(generated.compilerOptions.baseUrl).toBeUndefined();
    expect(generated.compilerOptions.paths).toEqual({ '@/*': ['../../../src/*'], '~ui': ['../../../lib/ui.ts'] });
  });
});
