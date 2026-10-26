// Builds the workshop SPA and the canvas play runtime into dist/ui. Both bundle their own
// dependencies: the UI runs in the workshop frame, never inside the user's Next app.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'ui');
const watch = process.argv.includes('--watch');
const minify = !process.argv.includes('--no-minify');

await mkdir(path.join(out, 'assets'), { recursive: true });

const common = {
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify,
  sourcemap: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
  tsconfig: path.join(root, 'tsconfig.json'),
};

const ui = await build({
  ...common,
  entryPoints: { app: path.join(root, 'src/ui/main.tsx') },
  outdir: path.join(out, 'assets'),
  jsx: 'automatic',
  metafile: true,
  loader: { '.css': 'css' },
});

await build({
  ...common,
  entryPoints: { 'play-runtime': path.join(root, 'src/ui/play-runtime.ts') },
  outdir: out,
  format: 'iife',
  define: { 'process.env.NODE_ENV': '"production"', process: '{"env":{}}' },
});

const template = await readFile(path.join(root, 'src/ui/index.html'), 'utf8');
await writeFile(path.join(out, 'index.html'), template);

const bytes = Object.entries(ui.metafile.outputs)
  .filter(([file]) => file.endsWith('.js'))
  .reduce((sum, [, info]) => sum + info.bytes, 0);
console.log(`workshop UI: ${(bytes / 1024).toFixed(1)} kB min`);
if (watch) console.log('watch mode is not supported; rerun the script');
