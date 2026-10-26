import { spawn } from 'node:child_process';
import pc from 'picocolors';
import { packageVersion, WorkshopServer } from '../server/server';

export interface DevOptions {
  cwd: string;
  port?: number;
  host?: string;
  open?: boolean;
}

function openBrowser(url: string): void {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // No browser available (CI, SSH); the URL is printed anyway.
  }
}

/** `rsc-stories dev` (FR-6.2): generate the workshop app, start Next, serve the workshop. */
export async function dev(options: DevOptions): Promise<WorkshopServer> {
  const started = performance.now();
  const server = await WorkshopServer.create(options.cwd, {
    mode: 'dev',
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.host !== undefined ? { host: options.host } : {}),
  });
  await server.start();
  const { project } = server;
  const stories = server.storyIndex.files.reduce((sum, file) => sum + file.stories.length, 0);
  console.log(
    `\n  ${pc.bold('RSC Stories')} ${pc.dim(`v${packageVersion()}`)}` +
      `\n  ${pc.cyan(server.origin)}  ${pc.dim(`${stories} stories in ${server.storyIndex.files.length} files · Next ${project.next.version} (${project.bundler}) · ready in ${Math.round(performance.now() - started)} ms`)}\n`,
  );
  for (const warning of server.warnings) console.warn(`  ${pc.yellow('!')} ${warning}`);
  for (const skipped of server.storyIndex.skipped) {
    console.warn(`  ${pc.dim('skipped Storybook story')} ${skipped} ${pc.dim('(run `rsc-stories migrate` to convert it)')}`);
  }
  if (options.open) openBrowser(server.origin);
  const shutdown = () => {
    server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  return server;
}
