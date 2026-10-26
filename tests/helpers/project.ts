import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A throwaway Next.js project using the minimal example's node_modules. */
export async function tempProject(files: Record<string, string>): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'rsc-stories-test-')));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'temp-app', dependencies: { next: '*' } }));
  await symlink(path.join(repo, 'examples/minimal/node_modules'), path.join(root, 'node_modules'), 'dir');
  for (const [file, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), content);
  }
  return root;
}
