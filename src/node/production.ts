import { spawn } from 'node:child_process';
import type { RenderMode } from '../shared/global';
import type { Project } from './project';
import { WorkshopServer } from './server/server';

/** Thrown when `next build` of the workshop app fails. */
export class BuildError extends Error {
  override name = 'BuildError';
}

/**
 * Builds the generated workshop app with the host's own `next build` (FR-2.2). Runs as a child
 * process with the already filtered environment, so only allowlisted variables can be inlined.
 */
export function nextBuild(project: Project, log: (line: string) => void = () => {}): Promise<void> {
  const bin = project.require.resolve('next/dist/bin/next');
  const args = [bin, 'build'];
  if (project.next.major >= 16 && project.bundler === 'webpack') args.push('--webpack');
  if (project.next.major < 16 && project.bundler === 'turbopack') args.push('--turbopack');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: project.workshopDir,
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output: string[] = [];
    const collect = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        output.push(line);
        log(line);
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new BuildError(`next build failed (exit ${code}):\n${output.slice(-40).join('\n')}`));
    });
  });
}

/** Options for {@link startServer}. */
export interface StartOptions {
  cwd: string;
  mode: RenderMode;
  /** Use `next dev` instead of a production build (faster for small runs, debug info included). */
  dev?: boolean;
  port?: number;
  isStatic?: boolean;
  quiet?: boolean;
  log?: (line: string) => void;
}

/** A workshop server for non-interactive runs: generated, built (unless `dev`) and listening. */
export async function startServer(options: StartOptions): Promise<WorkshopServer> {
  const server = await WorkshopServer.create(options.cwd, {
    mode: options.dev ? 'dev' : options.mode,
    port: options.port ?? 0,
    watch: false,
    ...(options.isStatic ? { isStatic: true } : {}),
    ...(options.quiet ? { quiet: true } : {}),
  });
  await server.prepare();
  if (!options.dev) await nextBuild(server.project, options.log);
  await server.listen();
  return server;
}
