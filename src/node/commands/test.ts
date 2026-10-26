import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pc from 'picocolors';
import type { CanvasMessage } from '../../shared/protocol';
import { NAVIGATION_DIGEST } from '../../runtime/mock/next';
import { canvasPath } from '../../shared/state';
import { diffLines } from '../inspector/html';
import type { InspectorReport } from '../inspector/report';
import type { StorySnapshot } from '../inspector/snapshot';
import { startServer } from '../production';
import type { WorkshopServer } from '../server/server';

export interface TestOptions {
  cwd: string;
  update: boolean;
  browser: boolean;
  dev: boolean;
  filter?: string;
  json?: string;
  port?: number;
  /** Don't print; return results (used by tests of the command itself). */
  silent?: boolean;
}

export interface StoryResult {
  storyId: string;
  file: string;
  status: 'passed' | 'failed';
  failures: string[];
  warnings: string[];
  snapshot: 'matched' | 'written' | 'updated' | 'mismatch' | 'missing';
  durationMs: number;
  /** The stream was still open when the run stopped waiting (a story that never resolves). */
  incomplete?: boolean;
  report?: InspectorReport;
}

/** Failures that make a story fail, from its report (FR-6.4). */
export function failuresOf(report: InspectorReport, status: number): string[] {
  const failures: string[] = [];
  if (status >= 500) failures.push(`HTTP ${status} from the canvas`);
  for (const error of report.errors) {
    // Mocked redirect()/notFound() are expected outcomes, not failures.
    if (error.digest?.startsWith(NAVIGATION_DIGEST) || error.message.includes(NAVIGATION_DIGEST)) continue;
    if (error.source === 'payload' || /Error|⨯/.test(error.message)) {
      failures.push(`Render error: ${error.message.split('\n')[0]}`);
    }
  }
  for (const item of report.nonSerializable) {
    if (item.severity === 'error') failures.push(`Serialization: ${item.from} → ${item.to} prop "${item.prop}": ${item.reason}`);
  }
  for (const budget of report.budgets) {
    if (!budget.ok) failures.push(`Budget ${budget.name}: ${budget.actual} ${budget.unit} > ${budget.limit} ${budget.unit}`);
  }
  return [...new Set(failures)];
}

interface SnapshotFiles {
  dom: string;
  rsc: string;
  report: string;
}

export function snapshotFiles(storyFile: string, storyId: string, dirName: string): SnapshotFiles {
  const dir = path.join(path.dirname(storyFile), dirName);
  return {
    dom: path.join(dir, `${storyId}.html`),
    rsc: path.join(dir, `${storyId}.rsc.json`),
    report: path.join(dir, `${storyId}.report.json`),
  };
}

function serialize(snapshot: StorySnapshot): SnapshotFiles {
  return {
    dom: `${snapshot.dom}\n`,
    rsc: `${JSON.stringify(snapshot.rsc, null, 2)}\n`,
    report: `${JSON.stringify(snapshot.report, null, 2)}\n`,
  };
}

export async function compareSnapshot(
  files: SnapshotFiles,
  snapshot: StorySnapshot,
  options: { update: boolean; ci: boolean },
): Promise<{ state: StoryResult['snapshot']; diff?: string }> {
  const next = serialize(snapshot);
  const exists = await Promise.all(Object.values(files).map((f) => existsSync(f)));
  if (!exists.every(Boolean) && !options.update) {
    if (options.ci) return { state: 'missing' };
    await writeSnapshot(files, next);
    return { state: 'written' };
  }
  if (options.update) {
    const changed = await Promise.all(
      (Object.keys(files) as Array<keyof SnapshotFiles>).map(async (key) =>
        existsSync(files[key]) ? (await readFile(files[key], 'utf8')) !== next[key] : true,
      ),
    );
    if (changed.some(Boolean)) {
      await writeSnapshot(files, next);
      return { state: 'updated' };
    }
    return { state: 'matched' };
  }
  for (const key of Object.keys(files) as Array<keyof SnapshotFiles>) {
    const previous = await readFile(files[key], 'utf8');
    if (previous !== next[key]) {
      const diff = diffLines(previous.trimEnd(), next[key].trimEnd())
        .filter((line) => line.op !== ' ')
        .slice(0, 12)
        .map((line) => `${line.op === '-' ? pc.red('-') : pc.green('+')} ${line.text}`)
        .join('\n');
      return { state: 'mismatch', diff: `${path.basename(files[key])}:\n${diff}` };
    }
  }
  return { state: 'matched' };
}

async function writeSnapshot(files: SnapshotFiles, content: SnapshotFiles): Promise<void> {
  await mkdir(path.dirname(files.dom), { recursive: true });
  await Promise.all((Object.keys(files) as Array<keyof SnapshotFiles>).map((key) => writeFile(files[key], content[key])));
}

type Browser = { newPage(): Promise<Page>; close(): Promise<void> };
type Page = {
  goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  waitForFunction(fn: string, arg?: unknown, options?: { timeout?: number }): Promise<unknown>;
  evaluate<T>(fn: string): Promise<T>;
  close(): Promise<void>;
};

type PlaywrightModule = { chromium: { launch(): Promise<Browser> } };

async function loadPlaywright(root: string): Promise<PlaywrightModule> {
  for (const require of [createRequire(path.join(root, 'package.json')), createRequire(import.meta.url)]) {
    let resolved: string;
    try {
      resolved = require.resolve('playwright');
    } catch {
      continue;
    }
    // CommonJS: the API is on `default` when imported from ESM.
    const module = (await import(pathToFileURL(resolved).href)) as PlaywrightModule & {
      default?: PlaywrightModule;
    };
    return module.default ?? module;
  }
  throw new Error('--browser needs Playwright: install `playwright` and run `npx playwright install chromium`.');
}

async function launchBrowser(root: string): Promise<Browser> {
  // Launch errors (a missing browser binary) carry Playwright's own instructions.
  return (await loadPlaywright(root)).chromium.launch();
}

/** Hydrates a story in Chromium: hydration mismatches, client errors and the play function. */
async function browserCheck(browser: Browser, url: string, hasPlay: boolean): Promise<string[]> {
  const page = await browser.newPage();
  const failures: string[] = [];
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await page.waitForFunction('window.__RSC_STORIES__ && window.__RSC_STORIES__.hydrated', undefined, { timeout: 60_000 });
    // Let streamed boundaries hydrate and late effects log.
    await page.evaluate('new Promise((r) => setTimeout(r, 300))');
    if (hasPlay) {
      const result = await page.evaluate<CanvasMessage | undefined>('window.__RSC_STORIES__.runPlay()');
      if (result?.type === 'play' && result.status === 'failed') failures.push(`Play function failed: ${result.error ?? 'unknown error'}`);
    }
    const messages = await page.evaluate<CanvasMessage[]>('window.__RSC_STORIES__.messages');
    for (const message of messages) {
      if (message.type === 'hydration-mismatch') failures.push(`Hydration mismatch: ${message.message.split('\n')[0]}`);
      if (message.type === 'error' && !message.navigation) failures.push(`Client error: ${message.message}`);
    }
  } catch (error) {
    failures.push(`Browser check failed: ${(error as Error).message.split('\n')[0]}`);
  } finally {
    await page.close();
  }
  return [...new Set(failures)];
}

async function mapLimit<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await run(items[index]!);
      }
    }),
  );
  return results;
}

/** Runs every story through the pipeline and checks it (FR-6.4). */
export async function runStoryTests(server: WorkshopServer, options: TestOptions, print: (line: string) => void): Promise<StoryResult[]> {
  const { project } = server;
  const dirName = project.config.snapshotDir ?? '__rsc_snapshots__';
  const ci = !!process.env.CI;
  const stories = server.storyIndex.files.flatMap((file) =>
    file.stories
      .filter((story) => !story.tags.includes('!test'))
      .filter((story) => !options.filter || story.id.includes(options.filter))
      .map((story) => ({ file, story })),
  );
  const browser = options.browser ? await launchBrowser(project.root) : undefined;
  const testOne = async ({ file, story }: (typeof stories)[number]): Promise<StoryResult> => {
    const started = performance.now();
    const result: StoryResult = {
      storyId: story.id,
      file: file.relativePath,
      status: 'passed',
      failures: [],
      warnings: [],
      snapshot: 'matched',
      durationMs: 0,
    };
    const expectError = story.tags.includes('expect-error');
    try {
      const rendered = await server.renderStory(story.id);
      result.report = rendered.report;
      if (rendered.incomplete) {
        result.incomplete = true;
        result.warnings.push('The stream was still open after 5 s of silence; snapshotted the shell (a story that never resolves?).');
      }
      const failures = failuresOf(rendered.report, rendered.status);
      if (expectError) {
        // `expect-error` stories pass by failing to render; anything else about them still counts.
        const errors = failures.filter((f) => f.startsWith('Render error') || f.startsWith('HTTP '));
        if (errors.length === 0) result.failures.push('Expected a render error (tag "expect-error"), but the story rendered.');
        result.failures.push(...failures.filter((f) => !errors.includes(f)));
      } else {
        result.failures.push(...failures);
      }
      result.warnings.push(...rendered.report.warnings.map((w) => w.message));
      const compared = await compareSnapshot(snapshotFiles(file.file, story.id, dirName), rendered.snapshot, {
        update: options.update,
        ci,
      });
      result.snapshot = compared.state;
      if (compared.state === 'mismatch') result.failures.push(`Snapshot mismatch (run with -u to update)\n${compared.diff ?? ''}`);
      if (compared.state === 'missing') result.failures.push('Snapshot missing (CI does not write new snapshots)');
      if (browser && !result.incomplete) {
        const url = new URL(canvasPath(file.fileKey, story.exportName), server.origin).href;
        const browserFailures = await browserCheck(browser, url, story.hasPlay);
        result.failures.push(...(expectError ? browserFailures.filter((f) => !f.startsWith('Client error')) : browserFailures));
      }
    } catch (error) {
      result.failures.push((error as Error).message);
    }
    result.durationMs = Math.round(performance.now() - started);
    result.status = result.failures.length ? 'failed' : 'passed';
    const r = result.report;
    const facts = r
      ? pc.dim(
          ` ${(r.storyPayloadBytes / 1024).toFixed(1)} kB rsc · ${(r.clientJsGzipBytes / 1024).toFixed(1)} kB js · ${result.durationMs} ms${result.snapshot !== 'matched' ? ` · snapshot ${result.snapshot}` : ''}`,
        )
      : '';
    print(`${result.status === 'passed' ? pc.green('✓') : pc.red('✗')} ${story.id}${facts}`);
    for (const failure of result.failures) print(`    ${pc.red(failure.replace(/\n/g, '\n    '))}`);
    return result;
  };
  try {
    // `next dev` compiles on first request; the first compile writes shared manifests, which
    // Next 15 can read half-written when several routes compile at once. Let it finish alone.
    const [first, ...rest] = server.options.mode === 'dev' ? stories : [];
    if (first) return [await testOne(first), ...(await mapLimit(rest, 4, testOne))];
    return await mapLimit(stories, 4, testOne);
  } finally {
    await browser?.close();
  }
}

/** `rsc-stories test`. Exit code 1 when any story fails. */
export async function test(options: TestOptions): Promise<number> {
  const print = options.silent ? () => {} : (line: string) => console.log(line);
  const started = performance.now();
  // Fail before a production build, not after it.
  if (options.browser) await loadPlaywright(options.cwd);
  print(pc.dim(options.dev ? 'Starting next dev…' : 'Building the workshop with next build…'));
  const server = await startServer({
    cwd: options.cwd,
    mode: 'test',
    quiet: true,
    ...(options.dev ? { dev: true } : {}),
    ...(options.port ? { port: options.port } : {}),
  });
  try {
    const results = await runStoryTests(server, options, print);
    const failed = results.filter((r) => r.status === 'failed');
    const written = results.filter((r) => r.snapshot === 'written' || r.snapshot === 'updated').length;
    print(
      `\n${failed.length ? pc.red(`${failed.length} failed`) : pc.green('all passed')} · ${results.length} stories · ${written} snapshots written · ${Math.round((performance.now() - started) / 100) / 10} s`,
    );
    if (options.json) {
      const file = path.resolve(options.cwd, options.json);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        JSON.stringify(
          {
            summary: {
              total: results.length,
              failed: failed.length,
              durationMs: Math.round(performance.now() - started),
            },
            results,
          },
          null,
          2,
        ),
      );
      print(pc.dim(`results written to ${path.relative(options.cwd, file)}`));
    }
    return failed.length ? 1 : 0;
  } finally {
    await server.close();
  }
}
