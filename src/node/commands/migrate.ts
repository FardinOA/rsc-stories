import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pc from 'picocolors';
import { glob } from 'tinyglobby';
import { findProjectRoot } from '../project';

export interface MigrateOptions {
  cwd: string;
  patterns: string[];
  /** Rewrite the files instead of writing `*.rsc.stories.*` copies. */
  inPlace: boolean;
}

export interface MigrationResult {
  code: string;
  changed: boolean;
  todos: string[];
}

const STORYBOOK_RENDERERS =
  /(['"])(?:@storybook\/(?:react|nextjs|react-vite|nextjs-vite|react-webpack5|experimental-nextjs-vite)|storybook\/internal\/types)\1/g;
const TEST_SOURCES = /(['"])(?:@storybook\/test|storybook\/test)\1/g;
const TEST_ONLY = new Set(['expect', 'userEvent', 'within', 'waitFor', 'screen']);

/**
 * Converts one Storybook CSF file for Client Components (FR-8.3). Text-based on purpose, so the
 * author's formatting and comments survive; anything without an equivalent gets a TODO comment.
 */
export function migrateSource(source: string): MigrationResult {
  const todos: string[] = [];
  let code = source;

  code = code.replace(STORYBOOK_RENDERERS, "'rsc-stories'");

  // `@storybook/test`: `fn` comes from rsc-stories; the play helpers from rsc-stories/test.
  code = code.replace(/import\s*\{([^}]*)\}\s*from\s*(['"])(?:@storybook\/test|storybook\/test)\2;?/g, (_match, names: string) => {
    const list = names
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);
    const testNames = list.filter((n) => TEST_ONLY.has(n.split(/\s+as\s+/)[0]!));
    const other = list.filter((n) => !TEST_ONLY.has(n.split(/\s+as\s+/)[0]!));
    const lines: string[] = [];
    if (other.length) lines.push(`import { ${other.join(', ')} } from 'rsc-stories';`);
    if (testNames.length) lines.push(`import { ${testNames.join(', ')} } from 'rsc-stories/test';`);
    return lines.join('\n');
  });
  code = code.replace(TEST_SOURCES, "'rsc-stories/test'");

  // Next.js framework parameters → mocks.next.
  const navigation = /nextjs\s*:\s*\{[^{}]*navigation\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}[^{}]*\}/;
  const match = navigation.exec(code);
  if (match) {
    const body = match[1]!;
    const pathname = /pathname\s*:\s*(['"][^'"]*['"])/.exec(body)?.[1];
    const query = /query\s*:\s*(\{[^{}]*\})/.exec(body)?.[1];
    const parts = [pathname ? `pathname: ${pathname}` : '', query ? `searchParams: ${query}` : ''].filter(Boolean);
    todos.push(`parameters.nextjs.navigation → move to mocks: { next: { ${parts.join(', ')} } }`);
    code = code.replace(match[0], `${match[0]} /* TODO(rsc-stories): move to \`mocks: { next: { ${parts.join(', ')} } }\` */`);
  } else if (/nextjs\s*:\s*\{/.test(code)) {
    todos.push('parameters.nextjs is Storybook-specific; Next.js runs for real in RSC Stories, so it can usually be removed.');
  }
  if (/\bloaders\s*:/.test(code)) {
    todos.push('loaders are not supported: make the component async, or mock its data with `mocks.modules` / `mocks.fetch`.');
    code = code.replace(/\bloaders\s*:/g, '/* TODO(rsc-stories): loaders are not supported */ loaders:');
  }
  if (/\bbeforeEach\s*:/.test(code)) {
    todos.push('beforeEach is not supported: use a function-form `mocks` for per-render setup.');
  }
  if (/@storybook\//.test(code)) {
    todos.push('Other @storybook/* imports remain; replace them by hand.');
  }
  if (todos.length) {
    code = `// Migrated from Storybook by rsc-stories. Review the TODO(rsc-stories) notes.\n${code}`;
  }
  return { code, changed: code !== source, todos };
}

/** `rsc-stories migrate <glob…>` */
export async function migrate(options: MigrateOptions): Promise<number> {
  const root = findProjectRoot(options.cwd);
  const files = await glob(options.patterns, { cwd: root, absolute: true, ignore: ['**/node_modules/**', '**/*.rsc.stories.*'] });
  let migrated = 0;
  for (const file of files.sort()) {
    const source = await readFile(file, 'utf8');
    if (!/@storybook\/|storybook\/test/.test(source)) continue;
    const result = migrateSource(source);
    if (!result.changed) continue;
    const target = options.inPlace ? file : file.replace(/\.(stories|story)\.([cm]?[jt]sx?)$/, '.rsc.stories.$2');
    await writeFile(target, result.code);
    migrated++;
    console.log(`${pc.green('✓')} ${path.relative(root, file)} → ${path.relative(root, target)}`);
    for (const todo of result.todos) console.log(`    ${pc.yellow('TODO')} ${todo}`);
  }
  console.log(migrated ? `\n${migrated} file(s) migrated.` : 'No Storybook story files found for those patterns.');
  return 0;
}
