import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createIndex } from '../../src/node/indexer';
import { generateWorkshop } from '../../src/node/next/generate';
import { exportNames, readDirective, resolveSpecifier } from '../../src/node/next/resolve';
import { loadProject } from '../../src/node/project';
import { tempProject } from '../helpers/project';

describe('generateWorkshop', () => {
  it('writes routes, shims and config for the host project', async () => {
    const root = await tempProject({
      'tsconfig.json': '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }',
      'postcss.config.mjs': 'export default { plugins: {} };',
      'public/logo.svg': '<svg/>',
      '.rsc-stories/config.ts': `export default { mocks: { strictNetwork: true } };`,
      '.rsc-stories/preview.tsx': `export const decorators = [];`,
      'src/lib/db.ts': `export const db = { get: () => 1 }; export function helper() {} export default 1;`,
      'src/actions.ts': `'use server';\nexport async function save() {}`,
      'src/Card.stories.tsx': `export default { title: 'UI/Card', mocks: { modules: { '@/lib/db': {}, '@/actions': {}, 'next/headers': {}, '@/missing': {} } } }; export const Default = {};`,
    });
    const project = await loadProject(root);
    const index = await createIndex(root, project.storyGlobs);
    const result = await generateWorkshop(project, index, 'dev');
    const W = project.workshopDir;
    expect(Object.keys(result.aliases)).toEqual(
      expect.arrayContaining(['next/headers', 'next/dist/api/navigation.react-server', 'next/cache', '@/lib/db']),
    );
    expect(result.aliases['@/actions']).toBeUndefined();
    expect(result.warnings.join('\n')).toMatch(/'use server' module/);
    expect(result.warnings.join('\n')).toMatch(/use mocks.next/);
    expect(result.warnings.join('\n')).toMatch(/"@\/missing" ignored/);
    const shim = readFileSync(path.join(W, 'rsc/mocks/lib-db.ts'), 'utf8');
    expect(shim).toContain(`import * as real from "../../../../../src/lib/db";`);
    expect(shim).toContain(`export const db = mock.get("db")`);
    expect(shim).toContain(`export default mock.get('default');`);
    const page = readFileSync(path.join(W, 'app/rsc-stories/canvas/ui-card/[story]/[state]/page.tsx'), 'utf8');
    expect(page).toContain(`import * as stories from "../../../../../../../../../src/Card.stories";`);
    expect(page).toContain(`export const fetchCache = 'force-no-store';`);
    expect(existsSync(path.join(W, 'app/rsc-stories/meta/ui-card/route.ts'))).toBe(true);
    const workshop = readFileSync(path.join(W, 'rsc/workshop.tsx'), 'utf8');
    expect(workshop).toContain('import * as config');
    expect(workshop).toContain('previews: [preview]');
    expect(readFileSync(path.join(W, 'rsc/client.tsx'), 'utf8')).toContain('NavigationPromisesContext');
    expect(readFileSync(path.join(W, 'next.config.mjs'), 'utf8')).toContain('createWorkshopNextConfig');
    expect(readFileSync(path.join(W, 'postcss.config.mjs'), 'utf8')).toContain('import host from "../../../postcss.config.mjs";');
    expect(existsSync(path.join(W, 'public/logo.svg'))).toBe(true);
    expect(result.configChanged).toBe(true);
    // Regenerating with the same input changes nothing; removed files lose their routes.
    expect((await generateWorkshop(project, index, 'dev')).configChanged).toBe(false);
    await generateWorkshop(project, { ...index, files: [] }, 'dev');
    expect(existsSync(path.join(W, 'app/rsc-stories/canvas/ui-card'))).toBe(false);
  });

  it('resolves specifiers, directives and export names', async () => {
    const root = await tempProject({
      'tsconfig.json': '{ "compilerOptions": { "paths": { "~/*": ["./lib/*"] } } }',
      'lib/a.ts': `export * from './b'; export const a = 1; import './style.css';`,
      'lib/b.ts': `export function b() {}`,
      'lib/style.css': `body{}`,
      'lib/client.tsx': `"use client";\nexport const C = 1;`,
    });
    expect(await resolveSpecifier('~/a', root)).toBe(path.join(root, 'lib/a.ts'));
    expect(await resolveSpecifier('~/nope', root)).toBeUndefined();
    expect((await exportNames(path.join(root, 'lib/a.ts'))).sort()).toEqual(['a', 'b']);
    expect(await exportNames(path.join(root, 'missing.ts'))).toEqual([]);
    expect(await readDirective(path.join(root, 'lib/client.tsx'))).toBe('use client');
    expect(await readDirective(path.join(root, 'lib/a.ts'))).toBeUndefined();
    expect(await readDirective(path.join(root, 'missing.ts'))).toBeUndefined();
  });
});
