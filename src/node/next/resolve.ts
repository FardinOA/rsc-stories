import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build, type Plugin } from 'esbuild';

/**
 * Resolves a module specifier the way the host's bundler would: tsconfig `paths`, package
 * `exports`, and file extensions. Returns an absolute path, or `undefined` when unresolvable.
 */
export async function resolveSpecifier(specifier: string, fromDir: string): Promise<string | undefined> {
  let resolved: string | undefined;
  const plugin: Plugin = {
    name: 'rsc-stories-resolve',
    setup(b) {
      b.onStart(async () => {
        const result = await b.resolve(specifier, { kind: 'import-statement', resolveDir: fromDir });
        if (result.errors.length === 0 && result.path && !result.external) resolved = result.path;
      });
    },
  };
  await build({
    stdin: { contents: '', resolveDir: fromDir },
    write: false,
    bundle: false,
    logLevel: 'silent',
    platform: 'node',
    conditions: ['react-server', 'import', 'module', 'default'],
    plugins: [plugin],
  });
  return resolved;
}

/** Leading `'use server'` / `'use client'` directive of a source file, if any. */
export async function readDirective(file: string): Promise<'use server' | 'use client' | undefined> {
  try {
    const source = (await readFile(file, 'utf8')).replace(/^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)\s*/g, '');
    const match = /^\s*['"](use (?:server|client))['"]/.exec(source);
    return match?.[1] as 'use server' | 'use client' | undefined;
  } catch {
    return undefined;
  }
}

const NON_JS = /\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp4|webm|md|mdx)$/;

/**
 * Export names of a module, following `export *` across local files. Packages stay external, so a
 * re-export from a package contributes no names (the mock's own keys fill that gap).
 */
export async function exportNames(file: string): Promise<string[]> {
  try {
    const result = await build({
      entryPoints: [file],
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      platform: 'node',
      packages: 'external',
      logLevel: 'silent',
      outdir: path.join(path.dirname(file), '.rsc-stories-exports'),
      jsx: 'automatic',
      plugins: [
        {
          name: 'rsc-stories-empty-assets',
          setup(b) {
            b.onResolve({ filter: NON_JS }, (args) => ({ path: args.path, namespace: 'empty' }));
            b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
          },
        },
      ],
    });
    const output = Object.values(result.metafile.outputs).find((o) => o.entryPoint);
    return output?.exports ?? [];
  } catch {
    return [];
  }
}
