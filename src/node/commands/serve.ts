import pc from 'picocolors';
import { startServer } from '../production';

export interface ServeOptions {
  cwd: string;
  port?: number;
  host?: string;
  /** Serve `next dev` instead of a production build. */
  dev?: boolean;
}

/** Marker line test runners wait for; the origin follows it. */
export const READY_MARKER = 'RSC Stories ready at';

/**
 * `rsc-stories serve`: builds the workshop (unless `--dev`) and serves it without file watching —
 * for Playwright's `webServer`, the Vitest global setup and CI previews.
 */
export async function serve(options: ServeOptions): Promise<void> {
  const server = await startServer({
    cwd: options.cwd,
    mode: options.dev ? 'dev' : 'test',
    ...(options.dev ? { dev: true } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
  });
  console.log(`${READY_MARKER} ${pc.cyan(server.origin)}`);
  const stop = () => {
    server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
