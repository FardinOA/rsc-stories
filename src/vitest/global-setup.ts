import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const READY = /RSC Stories ready at (?:\u001b\[\d+m)?(http:\/\/\S+?)(?:\u001b\[\d+m)?\s*$/m;

let child: ChildProcess | undefined;

/**
 * Vitest global setup registered by `rscStories()`. Starts `rsc-stories serve` in a child process
 * (so Next's handles never keep Vitest alive), waits for its origin and exposes it to tests.
 * `RSC_STORIES_MODE=build` serves a production build instead of `next dev`.
 */
export default async function setup(context?: { provide?: (key: string, value: unknown) => void }) {
  if (process.env.RSC_STORIES_ORIGIN) return undefined;
  const require = createRequire(import.meta.url);
  const cli = path.join(path.dirname(require.resolve('rsc-stories/package.json')), 'dist', 'cli.js');
  const args = [cli, 'serve', '--port', '0', '--cwd', process.env.RSC_STORIES_ROOT ?? process.cwd()];
  if (process.env.RSC_STORIES_MODE !== 'build') args.push('--dev');
  child = spawn(process.execPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: undefined } as NodeJS.ProcessEnv,
  });
  const origin = await new Promise<string>((resolve, reject) => {
    let output = '';
    const onData = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      const match = READY.exec(output);
      if (match) resolve(match[1]!);
    };
    child!.stdout!.on('data', onData);
    child!.stderr!.on('data', onData);
    child!.once('exit', (code) => reject(new Error(`rsc-stories serve exited (${code}):\n${output.slice(-4000)}`)));
  });
  process.env.RSC_STORIES_ORIGIN = origin;
  context?.provide?.('rscStoriesOrigin', origin);
  return async () => {
    child?.kill('SIGTERM');
    delete process.env.RSC_STORIES_ORIGIN;
  };
}
