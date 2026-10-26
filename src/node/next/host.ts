import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import type { Project } from '../project';

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;
type UpgradeHandler = (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>;

interface NextApp {
  prepare(): Promise<void>;
  close(): Promise<void>;
  getRequestHandler(): RequestHandler;
  getUpgradeHandler(): UpgradeHandler;
}

type CreateNext = (options: Record<string, unknown>) => NextApp;

/**
 * Next keeps bundler-specific development state in `.next`. Reused after a switch of bundler, Next
 * version or NODE_ENV, its stale manifests make the dev client reload the page in a loop, so the
 * generated app starts clean whenever one of them differs from the last run.
 */
export function resetStaleDevState(project: Project): boolean {
  const stampFile = path.join(project.workshopDir, '.rsc-stories-dev');
  // NODE_ENV=test (e.g. under Vitest) makes Next lay out its development output differently.
  const stamp = `${project.bundler} ${project.next.version} ${process.env.NODE_ENV ?? 'development'}`;
  let previous: string | undefined;
  try {
    previous = readFileSync(stampFile, 'utf8');
  } catch {
    // first run, or a cache from before the stamp existed
  }
  if (previous === stamp) return false;
  const dist = path.join(project.workshopDir, '.next');
  const reset = existsSync(dist);
  if (reset) rmSync(dist, { recursive: true, force: true });
  writeFileSync(stampFile, stamp);
  return reset;
}

/**
 * The host project's Next.js, running the generated workshop app in this process. Running
 * in-process is what lets `AsyncLocalStorage` carry the story context from the workshop server
 * into server components, actions and mocks.
 */
export class NextHost {
  private app?: NextApp;
  private handler?: RequestHandler;
  private upgrade?: UpgradeHandler;
  private starting?: Promise<void>;

  constructor(
    private readonly project: Project,
    private readonly options: { dev: boolean; hostname: string; port: number },
  ) {}

  /** Starts (or returns the pending start of) Next. */
  start(): Promise<void> {
    this.starting ??= this.boot();
    return this.starting;
  }

  private async boot(): Promise<void> {
    const required = this.project.require('next') as CreateNext | { default: CreateNext };
    const createNext = typeof required === 'function' ? required : required.default;
    const bundler: Record<string, boolean> =
      this.project.bundler === 'turbopack'
        ? this.project.next.major >= 16
          ? { turbopack: true }
          : { turbo: true, turbopack: true }
        : this.project.next.major >= 16
          ? { webpack: true }
          : {};
    if (this.options.dev) resetStaleDevState(this.project);
    const app = createNext({
      dev: this.options.dev,
      dir: this.project.workshopDir,
      hostname: this.options.hostname,
      port: this.options.port,
      customServer: true,
      ...bundler,
    });
    await app.prepare();
    this.app = app;
    this.handler = app.getRequestHandler();
    this.upgrade = app.getUpgradeHandler();
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await this.start();
    await this.handler!(req, res);
  }

  async handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    await this.start();
    await this.upgrade!(req, socket, head);
  }

  /** Restarts Next, e.g. after the set of mocked modules (bundler aliases) changed. */
  async restart(): Promise<void> {
    const previous = this.app;
    this.starting = undefined;
    this.app = undefined;
    if (previous) await previous.close().catch(() => undefined);
    await this.start();
  }

  async close(): Promise<void> {
    await this.starting?.catch(() => undefined);
    await this.app?.close().catch(() => undefined);
  }
}
