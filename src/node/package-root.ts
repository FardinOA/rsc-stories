import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findPackageRoot(): string {
  // `dist/` when built, `src/node/` from source: walk up to this package's manifest.
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (true) {
    const manifest = path.join(dir, 'package.json');
    if (existsSync(manifest)) {
      try {
        if ((JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }).name === 'rsc-stories') return dir;
      } catch {
        // keep looking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(fileURLToPath(import.meta.url), '../..');
    dir = parent;
  }
}

/** This package's root directory, wherever it is installed or linked from. */
export const PACKAGE_ROOT = findPackageRoot();

/** `rsc-stories/<path>` for a file of this package itself; undefined for any other file. */
export function ownPackagePath(file: string): string | undefined {
  if (!file.startsWith(PACKAGE_ROOT + path.sep)) return undefined;
  const relative = path.relative(PACKAGE_ROOT, file).split(path.sep).join('/');
  return relative.startsWith('node_modules/') || relative.startsWith('examples/') ? undefined : `rsc-stories/${relative}`;
}
