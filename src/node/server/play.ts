import path from 'node:path';
import { build, type Plugin } from 'esbuild';
import { ownPackagePath } from '../package-root';

/** Imports made by the package's own modules are never stubbed, wherever a tsconfig resolves `rsc-stories` to. */
const isOwnModule = (file: string) => ownPackagePath(file) !== undefined;

/** Imports a play bundle keeps for real; everything else becomes an inert stub. */
const KEEP = /^rsc-stories(\/test)?$|\.json$|(^|[/\\])(__)?(fixtures?|mocks?)(__)?([/\\.]|$)/;

const STUB = `
const handler = {
  get(target, key) {
    if (key === '__esModule') return false;
    if (key === Symbol.toPrimitive) return () => '';
    if (key === 'then') return undefined;
    return stub;
  },
  apply() { return stub; },
  construct() { return stub; },
};
const stub = new Proxy(function stub() {}, handler);
module.exports = stub;
`;

const stubPlugin: Plugin = {
  name: 'rsc-stories-play-stubs',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === 'entry-point') return undefined;
      if (KEEP.test(args.path)) return undefined;
      if (isOwnModule(args.importer)) return undefined;
      return { path: args.path, namespace: 'rsc-stories-stub' };
    });
    b.onLoad({ filter: /.*/, namespace: 'rsc-stories-stub' }, () => ({ contents: STUB, loader: 'js' }));
  },
};

/**
 * Bundles a story file for the canvas so its `play` functions can run in the browser. Components,
 * mocks and server modules are replaced by stubs: a play function only needs the story's args and
 * the testing helpers from `rsc-stories/test`, which read the canvas's play runtime.
 */
export async function bundlePlay(storyFile: string): Promise<string> {
  const result = await build({
    entryPoints: [storyFile],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: 'inline',
    logLevel: 'silent',
    absWorkingDir: path.dirname(storyFile),
    conditions: ['browser', 'import', 'default'],
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.css': 'empty', '.scss': 'empty', '.svg': 'empty', '.png': 'empty' },
    plugins: [stubPlugin],
  });
  return result.outputFiles[0]?.text ?? '';
}
