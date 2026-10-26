import { existsSync, readdirSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { DEFAULT_VIEWPORTS } from '../../config';
import { installFetchInterceptor } from '../../shared/fetch-mock';
import type { RenderMode } from '../../shared/global';
import { API_PREFIX, CANVAS_PREFIX, canvasPath, decodeState, META_PREFIX, parseCanvasPath, type StoryState } from '../../shared/state';
import { buildIndex, createIndex, findStory, indexFile, indexToJson, type IndexedFile, type StoryIndex } from '../indexer';
import { storySnapshot } from '../inspector/snapshot';
import { diffLines, normalizeHtml, serverStoryHtml } from '../inspector/html';
import { buildReport, payloadRows, type InspectorReport } from '../inspector/report';
import { ChunkSizer } from '../inspector/sizes';
import { generateWorkshop } from '../next/generate';
import { NextHost } from '../next/host';
import { loadProject, type Project } from '../project';
import { ArgTypeInference } from './argtypes';
import { capture } from './capture';
import { applyEnvAllowlist, installConsoleCapture, installHttpGuard } from './interceptors';
import { bundlePlay } from './play';
import { installStorage, RecordStore, recordToJson, storeFor, type RenderRecord } from './records';

/** How a {@link WorkshopServer} runs: render mode, address, static output and file watching. */
export interface WorkshopServerOptions {
  /** `dev` runs `next dev`; `build`/`test` serve a production build made beforehand. */
  mode: RenderMode;
  port?: number;
  host?: string;
  /** Mark canvases as static (no re-render) while capturing a static build. */
  isStatic?: boolean;
  /** Keep server output made during story renders out of the terminal (it is still captured). */
  quiet?: boolean;
  /** Watch story files and regenerate (default: only in dev mode). */
  watch?: boolean;
}

/** Directory of the built package (`dist/`), where the UI and play runtime live. */
function distDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // Running from source in tests: src/node/server → dist.
  return existsSync(path.join(here, 'ui')) ? here : path.resolve(here, '../../../dist');
}

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.map': 'application/json',
};

function send(res: ServerResponse, status: number, body: string | Buffer, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  send(res, status, JSON.stringify(value), 'application/json');
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** The workshop dev/preview server (FR-6.2). */
export class WorkshopServer {
  readonly records = new RecordStore();
  private server?: http.Server;
  private next?: NextHost;
  private index: StoryIndex = { files: [], mockSpecifiers: [], skipped: [], problems: [] };
  private aliases = '';
  private readonly sse = new Set<ServerResponse>();
  private readonly reports = new Map<string, Promise<InspectorReport>>();
  private watchers: FSWatcher[] = [];
  private argTypes?: ArgTypeInference;
  private sizer?: ChunkSizer;
  private generation = Promise.resolve();
  warnings: string[] = [];
  origin = '';
  /** Lifecycle of the embedded Next server, replayed to every new event subscriber. */
  nextStatus: { status: 'starting' | 'ready' | 'restarting' | 'error'; message?: string } = { status: 'starting' };

  constructor(
    readonly project: Project,
    readonly options: WorkshopServerOptions,
  ) {
    // Dev and production builds get separate generated apps, so `rsc-stories dev` and
    // `rsc-stories test` can run side by side without rewriting each other's config.
    if (options.mode !== 'dev') project.workshopDir = path.join(project.cacheDir, 'workshop-build');
  }

  /** Loads the project from `cwd` and creates a server for it. */
  static async create(cwd: string, options: WorkshopServerOptions): Promise<WorkshopServer> {
    return new WorkshopServer(await loadProject(cwd), options);
  }

  get storyIndex(): StoryIndex {
    return this.index;
  }

  get port(): number {
    const address = this.server?.address();
    return typeof address === 'object' && address ? address.port : 0;
  }

  private prepared = false;

  /**
   * Installs the interceptors, applies the env allowlist and generates the workshop app. Separate
   * from {@link listen} so a production build can run in between.
   */
  async prepare(): Promise<void> {
    if (this.prepared) return;
    this.prepared = true;
    const { project, options } = this;
    process.chdir(project.root);
    installStorage();
    installConsoleCapture({ quiet: options.quiet ?? false });
    installHttpGuard();
    installFetchInterceptor();
    applyEnvAllowlist(project.root, project.config.env?.allow ?? ['NEXT_PUBLIC_*'], options.mode === 'dev');
    this.argTypes = new ArgTypeInference(project.root, project.require, project.tsconfig?.file);
    await this.reindex();
  }

  /** Starts listening and boots Next (awaited outside dev, where the build must already exist). */
  async listen(): Promise<void> {
    await this.prepare();
    const { project, options } = this;
    const host = options.host ?? project.config.host ?? 'localhost';
    const port = options.port ?? project.config.port ?? 6006;
    this.server = http.createServer((req, res) => {
      this.route(req, res).catch((error: unknown) => {
        if (!res.headersSent) send(res, 500, `rsc-stories: ${(error as Error).stack ?? String(error)}`);
        else res.end();
      });
    });
    this.server.on('upgrade', (req, socket, head) => {
      this.next?.handleUpgrade(req, socket, head).catch(() => socket.destroy());
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, host, () => resolve());
    });
    this.origin = `http://${host.includes(':') ? `[${host}]` : host}:${this.port}`;
    this.sizer = new ChunkSizer(this.origin);
    this.next = new NextHost(project, { dev: options.mode === 'dev', hostname: host, port: this.port });
    const ready = this.next.start().then(
      () => {
        this.nextStatus = { status: 'ready' };
        this.broadcast('next:ready', {});
      },
      (error: unknown) => {
        this.nextStatus = { status: 'error', message: (error as Error).message };
        this.broadcast('next:error', { message: (error as Error).message });
        throw error;
      },
    );
    if (options.mode !== 'dev') await ready;
    else ready.catch(() => undefined);
    if (options.watch ?? options.mode === 'dev') this.watch();
  }

  /** `prepare()` + `listen()`. */
  async start(): Promise<void> {
    await this.prepare();
    await this.listen();
  }

  private snapshotOptions() {
    return {
      rootDir: this.project.rootDir,
      projectRoot: this.project.root,
      workshopDir: this.project.workshopDir,
      distDir: path.join(this.project.workshopDir, '.next', this.options.mode === 'dev' ? 'dev' : ''),
    };
  }

  /**
   * Renders one story through the running server, exactly as the canvas would, and returns its
   * record, report and snapshot. Used by `build`, `test` and the Vitest helper.
   */
  async renderStory(storyId: string, state: StoryState = {}, options: { idleTimeoutMs?: number; timeoutMs?: number } = {}) {
    const found = findStory(this.index, storyId);
    if (!found) throw new Error(`Unknown story "${storyId}".`);
    const idleTimeoutMs = options.idleTimeoutMs ?? 5_000;
    const timeoutMs = options.timeoutMs ?? 60_000;
    const controller = new AbortController();
    const response = await fetch(new URL(canvasPath(found.file.fileKey, found.story.exportName, state), this.origin), {
      headers: { accept: 'text/html' },
      signal: controller.signal,
    });
    // Stories that never resolve (loading states) keep streaming forever: stop once the stream
    // goes quiet and keep what arrived — the shell with its fallbacks.
    const decoder = new TextDecoder();
    let html = '';
    let incomplete = false;
    const started = performance.now();
    const reader = response.body?.getReader();
    while (reader) {
      let timer: NodeJS.Timeout | undefined;
      const idle = new Promise<'idle'>((resolve) => {
        timer = setTimeout(() => resolve('idle'), Math.min(idleTimeoutMs, Math.max(0, timeoutMs - (performance.now() - started))));
      });
      const next = await Promise.race([reader.read(), idle]);
      clearTimeout(timer);
      if (next === 'idle') {
        incomplete = true;
        controller.abort();
        break;
      }
      if (next.done) break;
      html += decoder.decode(next.value, { stream: true });
    }
    html += decoder.decode();
    const renderId = response.headers.get('x-rsc-stories-render');
    const record = renderId ? this.records.get(renderId) : undefined;
    if (!record) throw new Error(`The render of "${storyId}" was not recorded (HTTP ${response.status}).`);
    if (incomplete) {
      record.endedAt ??= performance.now();
      this.records.finish(record);
    }
    const report = await this.report(record.renderId)!;
    const snapshot = storySnapshot(record, report, this.snapshotOptions());
    return { storyId, file: found.file, story: found.story, status: response.status, html, incomplete, record, report, snapshot };
  }

  async close(): Promise<void> {
    for (const watcher of this.watchers) watcher.close();
    for (const res of this.sse) res.end();
    await this.next?.close();
    // Keep-alive connections from fetch clients would otherwise hold the process open.
    this.server?.closeAllConnections();
    await new Promise<void>((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** Re-scans story files and regenerates the workshop app; restarts Next if aliases changed. */
  reindex(changed?: string[]): Promise<void> {
    this.generation = this.generation.then(async () => {
      const { project } = this;
      if (changed && this.index.files.length) {
        const byFile = new Map(this.index.files.map((file) => [file.file, file] as const));
        const existing = await createIndex(
          project.root,
          project.storyGlobs,
          project.config.mocks?.modules ? Object.keys(project.config.mocks.modules) : [],
        );
        const merged: IndexedFile[] = [];
        for (const file of existing.files) {
          merged.push(
            changed.includes(file.file) || !byFile.has(file.file) ? await indexFile(project.root, file.file) : byFile.get(file.file)!,
          );
        }
        this.index = buildIndex(merged, Object.keys(project.config.mocks?.modules ?? {}));
      } else {
        this.index = await createIndex(project.root, project.storyGlobs, Object.keys(project.config.mocks?.modules ?? {}));
      }
      const result = await generateWorkshop(project, this.index, this.options.mode);
      this.warnings = [...result.warnings, ...this.index.problems];
      const aliasKey = JSON.stringify(result.aliases);
      const restart = this.aliases !== '' && (aliasKey !== this.aliases || result.configChanged);
      this.aliases = aliasKey;
      this.broadcast('index', indexToJson(this.index));
      if (restart && this.next) {
        this.nextStatus = { status: 'restarting' };
        this.broadcast('next:restart', {});
        await this.next.restart();
        this.nextStatus = { status: 'ready' };
        this.broadcast('next:ready', {});
      }
    });
    return this.generation;
  }

  private watch(): void {
    const { project } = this;
    let pending = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const IGNORED = /(^|[/\\])(node_modules|\.next|\.git|\.rsc-stories[/\\]\.cache|dist|coverage|__rsc_snapshots__)([/\\]|$)/;
    const onChange = (dir: string) => (_event: string, name: string | Buffer | null) => {
      if (!name) return;
      const file = path.join(dir, name.toString());
      if (IGNORED.test(path.relative(project.root, file))) return;
      // Only the user's config and preview count; Next writes its build output under .rsc-stories/.cache.
      const isConfig = path.dirname(file) === project.configDir && /^(config|preview)\.[cm]?[jt]sx?$/.test(path.basename(file));
      if (!isConfig && !/\.(stories|story)\.[cm]?[jt]sx?$/.test(file)) return;
      pending.add(file);
      clearTimeout(timer);
      timer = setTimeout(() => {
        const files = [...pending];
        pending = new Set();
        const configChanged = files.some((f) => path.dirname(f) === project.configDir);
        const run = async () => {
          if (configChanged) {
            const fresh = await loadProject(project.root);
            Object.assign(this.project, fresh);
          }
          await this.reindex(configChanged ? undefined : files);
        };
        run().catch((error: unknown) => this.broadcast('error', { message: (error as Error).message }));
      }, 150);
    };
    const add = (dir: string, recursive: boolean) => {
      try {
        this.watchers.push(watch(dir, { recursive }, onChange(dir)));
      } catch {
        // Unwatchable directory (permissions); stories there update on restart.
      }
    };
    add(project.root, false);
    try {
      for (const entry of readdirSync(project.root)) {
        if (/^(node_modules|\.next|\.git|dist|coverage|\.turbo)$/.test(entry)) continue;
        const full = path.join(project.root, entry);
        if (entry === '.rsc-stories') add(full, false);
        else add(full, true);
      }
    } catch {
      add(project.root, true);
    }
    for (const glob of project.storyGlobs) {
      const base = glob.split('/').filter((part, i, all) => !/[*?{[]/.test(part) && i < all.length - 1);
      const dir = path.resolve(project.root, base.join('/'));
      if (!dir.startsWith(project.root + path.sep) && existsSync(dir)) add(dir, true);
    }
  }

  broadcast(event: string, data: unknown): void {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.sse) res.write(message);
  }

  /** Report for a finished render; computed once and cached. */
  report(renderId: string): Promise<InspectorReport> | undefined {
    const record = this.records.get(renderId);
    if (!record) return undefined;
    let report = this.reports.get(renderId);
    if (!report) {
      // A render may still be streaming when the UI asks; build from the complete body only.
      const finished = record.done
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            const timer = setTimeout(done, 60_000);
            function done() {
              clearTimeout(timer);
              resolve();
            }
            const onEnd = (ended: RenderRecord) => {
              if (ended !== record) return;
              records.off('render:end', onEnd);
              done();
            };
            const records = this.records;
            records.on('render:end', onEnd);
          });
      report = finished.then(() =>
        buildReport(record, {
          rootDir: this.project.rootDir,
          projectRoot: this.project.root,
          workshopDir: this.project.workshopDir,
          distDir: this.snapshotOptions().distDir,
          sizer: this.sizer!,
          mode: this.options.mode,
          ...(this.project.config.budgets ? { budgets: this.project.config.budgets } : {}),
        }),
      );
      this.reports.set(renderId, report);
      if (this.reports.size > 100) this.reports.delete(this.reports.keys().next().value!);
    }
    return report;
  }

  private uiConfig() {
    const { project } = this;
    let name = path.basename(project.root);
    try {
      name = (JSON.parse(readFileSync(path.join(project.root, 'package.json'), 'utf8')) as { name?: string }).name ?? name;
    } catch {
      // keep directory name
    }
    return {
      mode: this.options.mode,
      static: false,
      project: { name, next: project.next.version, react: project.react.version, bundler: project.bundler },
      viewports: { ...DEFAULT_VIEWPORTS, ...project.config.viewports },
      globals: project.config.globals ?? {},
      budgets: project.config.budgets ?? {},
      addons: (project.config.addons ?? [])
        .filter((addon) => addon.manager)
        .map((addon) => ({ name: addon.name, url: `${API_PREFIX}/addons/${encodeURIComponent(addon.name)}.js` })),
      version: packageVersion(),
    };
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const pathname = url.pathname;
    if (pathname === '/' || pathname === '/index.html') return this.serveIndex(res);
    if (pathname.startsWith(API_PREFIX + '/')) return this.api(req, res, url);
    if (pathname.startsWith(CANVAS_PREFIX + '/') || pathname.startsWith(META_PREFIX + '/')) {
      return this.renderThroughNext(req, res, url);
    }
    if (!this.next) return send(res, 503, 'Starting…');
    return this.next.handle(req, res);
  }

  private async serveIndex(res: ServerResponse): Promise<void> {
    const file = path.join(distDir(), 'ui', 'index.html');
    if (!existsSync(file)) return send(res, 500, 'The workshop UI is not built. Run `pnpm build` in rsc-stories.');
    const html = (await readFile(file, 'utf8')).replace(
      '<!--rsc-stories-config-->',
      `<script>window.__RSC_STORIES_CONFIG__=${JSON.stringify(this.uiConfig()).replace(/</g, '\\u003c')}</script>`,
    );
    send(res, 200, html, 'text/html; charset=utf-8');
  }

  private async renderThroughNext(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    if (!this.next) return send(res, 503, 'Starting…');
    const canvas = parseCanvasPath(url.pathname);
    const isAction = req.method === 'POST' && !!req.headers['next-action'];
    let fileKey: string;
    let exportName: string;
    let state = canvas?.state ?? {};
    if (canvas) {
      fileKey = canvas.fileKey;
      exportName = canvas.exportName;
    } else {
      fileKey = decodeURIComponent(url.pathname.slice(META_PREFIX.length + 1).split('/')[0] ?? '');
      exportName = '';
      state = {};
    }
    const kind = canvas ? (isAction ? 'action' : 'canvas') : 'meta';
    const record = this.records.create({
      kind,
      method: req.method ?? 'GET',
      url: url.pathname + url.search,
      fileKey,
      exportName,
      state,
    });
    const store = storeFor(record, this.records, {
      mode: this.options.mode,
      strictNetwork: this.project.config.mocks?.strictNetwork ?? false,
      origin: this.origin,
      ...(this.options.isStatic ? { isStatic: true } : {}),
    });
    res.setHeader('x-rsc-stories-render', record.renderId);
    // The inspector reads the body as it streams; compression would hide the payload. The
    // workshop runs locally, so nothing is lost.
    delete req.headers['accept-encoding'];
    capture(
      res,
      record,
      () => {
        if (record.done) return;
        this.records.finish(record);
        if (kind !== 'meta') this.broadcast('render:end', recordToJson(record));
      },
      // Story switches in the workshop are RSC navigations of the canvas.
      kind === 'canvas' && req.headers.rsc === '1',
    );
    if (kind !== 'meta') this.broadcast('render:start', { renderId: record.renderId, url: record.url, kind });
    const storage = installStorage();
    await storage.run(store, () => this.next!.handle(req, res));
  }

  private async api(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const route = url.pathname.slice(API_PREFIX.length);
    if (route === '/api/config') return json(res, this.uiConfig());
    if (route === '/api/index') {
      await this.generation;
      return json(res, { ...indexToJson(this.index), warnings: this.warnings });
    }
    if (route === '/api/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(`event: hello\ndata: ${JSON.stringify(this.nextStatus)}\n\n`);
      this.sse.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(ping);
        this.sse.delete(res);
      });
      return;
    }
    let match = /^\/api\/render\/([\w-]+)$/.exec(route);
    if (match) {
      const record = this.records.get(match[1]!);
      return record ? json(res, recordToJson(record)) : json(res, { error: 'Unknown render' }, 404);
    }
    match = /^\/api\/report\/([\w-]+)$/.exec(route);
    if (match) {
      const report = this.report(match[1]!);
      if (!report) return json(res, { error: 'Unknown render' }, 404);
      return json(res, await report);
    }
    if (route === '/api/diff' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req)) as { renderId?: string; html?: string };
      const report = body.renderId ? this.report(body.renderId) : undefined;
      if (!report || typeof body.html !== 'string') return json(res, { error: 'renderId and html are required' }, 400);
      const server = (await report).serverHtml;
      if (server === null) return json(res, { available: false, lines: [] });
      const client = normalizeHtml(body.html);
      const lines = diffLines(server, client);
      return json(res, { available: true, matches: lines.every((line) => line.op === ' '), lines });
    }
    if (route === '/api/render-story') {
      const id = url.searchParams.get('id');
      if (!id) return json(res, { error: 'id is required' }, 400);
      try {
        const result = await this.renderStory(id, decodeState(url.searchParams.get('state')));
        return json(res, {
          storyId: result.storyId,
          status: result.status,
          renderId: result.record.renderId,
          html: result.html,
          storyHtml: result.record.contentType === 'html' ? (serverStoryHtml(result.html) ?? null) : null,
          record: recordToJson(result.record),
          report: result.report,
          snapshot: result.snapshot,
        });
      } catch (error) {
        return json(res, { error: (error as Error).message }, 404);
      }
    }
    match = /^\/api\/snapshot\/([\w-]+)$/.exec(route);
    if (match) {
      const record = this.records.get(match[1]!);
      const report = record ? this.report(record.renderId) : undefined;
      if (!record || !report) return json(res, { error: 'Unknown render' }, 404);
      return json(res, storySnapshot(record, await report, this.snapshotOptions()));
    }
    match = /^\/api\/payload\/([\w-]+)$/.exec(route);
    if (match) {
      const record = this.records.get(match[1]!);
      return record ? json(res, payloadRows(record)) : json(res, { error: 'Unknown render' }, 404);
    }
    match = /^\/api\/argtypes\/([^/]+)$/.exec(route);
    if (match) {
      const file = this.index.files.find((f) => f.fileKey === decodeURIComponent(match![1]!));
      if (!file) return json(res, { error: 'Unknown story file' }, 404);
      return json(res, { argTypes: this.argTypes?.infer(file.file) ?? null });
    }
    match = /^\/play\/([^/]+)\.js$/.exec(route);
    if (match) {
      const file = this.index.files.find((f) => f.fileKey === decodeURIComponent(match![1]!));
      if (!file) return send(res, 404, 'Unknown story file');
      try {
        return send(res, 200, await bundlePlay(file.file), MIME['.js']);
      } catch (error) {
        return send(res, 500, `throw new Error(${JSON.stringify((error as Error).message)})`, MIME['.js']);
      }
    }
    match = /^\/addons\/([^/]+)\.js$/.exec(route);
    if (match) {
      const addon = this.project.config.addons?.find((a) => a.name === decodeURIComponent(match![1]!));
      if (!addon?.manager) return send(res, 404, 'Unknown addon');
      const result = await build({
        entryPoints: [path.resolve(this.project.root, addon.manager)],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        logLevel: 'silent',
      });
      return send(res, 200, result.outputFiles[0]?.text ?? '', MIME['.js']);
    }
    if (route === '/static/axe.min.js') {
      const require = createRequire(import.meta.url);
      return send(res, 200, await readFile(require.resolve('axe-core/axe.min.js')), MIME['.js']);
    }
    match = /^\/(ui|static)\/([\w.\-/]+)$/.exec(route);
    if (match) {
      const base = path.join(distDir(), 'ui');
      const file = path.join(base, match[2]!);
      if (!file.startsWith(base) || !existsSync(file)) return send(res, 404, 'Not found');
      return send(res, 200, await readFile(file), MIME[path.extname(file)] ?? 'application/octet-stream');
    }
    return json(res, { error: `Unknown endpoint ${route}` }, 404);
  }
}

const require = createRequire(import.meta.url);

let version: string | undefined;
/** Version of the installed rsc-stories package. */
export function packageVersion(): string {
  if (version) return version;
  try {
    version = (require('rsc-stories/package.json') as { version: string }).version;
  } catch {
    version = '0.0.0';
  }
  return version;
}
