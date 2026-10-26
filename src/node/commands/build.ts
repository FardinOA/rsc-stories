import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'picocolors';
import { DEFAULT_VIEWPORTS } from '../../config';
import { META_PREFIX } from '../../shared/state';
import { indexToJson } from '../indexer';
import { payloadRows } from '../inspector/report';
import { startServer } from '../production';
import { packageVersion } from '../server/server';

export interface BuildOptions {
  cwd: string;
  outDir?: string;
  filter?: string;
  dev?: boolean;
}

function uiDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return existsSync(path.join(here, 'ui')) ? path.join(here, 'ui') : path.resolve(here, '../../../dist/ui');
}

/**
 * `rsc-stories build` (FR-6.3): renders every story through a production build and writes a
 * static workshop — UI, pre-rendered canvases with their RSC payloads, descriptors and inspector
 * reports — that any static host can serve from its root.
 */
export async function buildStatic(options: BuildOptions): Promise<number> {
  const started = performance.now();
  console.log(pc.dim('Building the workshop with next build…'));
  const server = await startServer({ cwd: options.cwd, mode: 'build', isStatic: true, ...(options.dev ? { dev: true } : {}) });
  const { project } = server;
  const out = path.resolve(project.root, options.outDir ?? project.config.outDir ?? 'rsc-stories-static');
  try {
    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });
    const index = server.storyIndex;
    const files = index.files.filter((file) => !file.error);
    let count = 0;
    const failures: string[] = [];
    for (const file of files) {
      const response = await fetch(new URL(`${META_PREFIX}/${encodeURIComponent(file.fileKey)}`, server.origin));
      await mkdir(path.join(out, 'meta'), { recursive: true });
      await writeFile(path.join(out, 'meta', `${file.fileKey}.json`), await response.text());
      for (const story of file.stories) {
        if (options.filter && !story.id.includes(options.filter)) continue;
        try {
          const rendered = await server.renderStory(story.id);
          const dir = path.join(out, 'rsc-stories', 'canvas', file.fileKey, story.exportName, '_');
          await mkdir(dir, { recursive: true });
          await writeFile(path.join(dir, 'index.html'), rendered.html);
          await mkdir(path.join(out, 'reports'), { recursive: true });
          await writeFile(path.join(out, 'reports', `${story.id}.json`), JSON.stringify(rendered.report));
          await mkdir(path.join(out, 'payloads'), { recursive: true });
          await writeFile(path.join(out, 'payloads', `${story.id}.json`), JSON.stringify(payloadRows(rendered.record)));
          count++;
          console.log(`${rendered.status < 500 ? pc.green('✓') : pc.red('✗')} ${story.id}`);
          if (rendered.status >= 500) failures.push(story.id);
        } catch (error) {
          failures.push(story.id);
          console.log(`${pc.red('✗')} ${story.id} ${pc.dim((error as Error).message)}`);
        }
      }
    }
    // Next's client assets, and the host's public files the stories reference.
    const nextStatic = path.join(project.workshopDir, '.next', 'static');
    if (existsSync(nextStatic)) await cp(nextStatic, path.join(out, '_next', 'static'), { recursive: true });
    const publicDir = path.join(project.root, 'public');
    if (existsSync(publicDir)) await cp(publicDir, out, { recursive: true, dereference: true });

    // The workshop UI in static mode.
    const ui = uiDir();
    await cp(path.join(ui, 'assets'), path.join(out, '__rsc_stories', 'ui', 'assets'), { recursive: true });
    const require = createRequire(import.meta.url);
    await mkdir(path.join(out, '__rsc_stories', 'static'), { recursive: true });
    await cp(require.resolve('axe-core/axe.min.js'), path.join(out, '__rsc_stories', 'static', 'axe.min.js'));
    let name = path.basename(project.root);
    try {
      name = (JSON.parse(await readFile(path.join(project.root, 'package.json'), 'utf8')) as { name?: string }).name ?? name;
    } catch {
      // keep the directory name
    }
    const config = {
      mode: 'build',
      static: true,
      project: { name, next: project.next.version, react: project.react.version, bundler: project.bundler },
      viewports: { ...DEFAULT_VIEWPORTS, ...project.config.viewports },
      globals: project.config.globals ?? {},
      budgets: project.config.budgets ?? {},
      addons: [],
      version: packageVersion(),
    };
    const html = (await readFile(path.join(ui, 'index.html'), 'utf8')).replace(
      '<!--rsc-stories-config-->',
      `<script>window.__RSC_STORIES_CONFIG__=${JSON.stringify(config).replace(/</g, '\\u003c')}</script>`,
    );
    await writeFile(path.join(out, 'index.html'), html);
    await writeFile(path.join(out, 'stories.json'), JSON.stringify(indexToJson(index)));
    console.log(
      `\n${failures.length ? pc.yellow(`${failures.length} stories failed to render`) : pc.green('done')} · ${count} stories → ${path.relative(process.cwd(), out) || out} · ${Math.round((performance.now() - started) / 100) / 10} s`,
    );
    console.log(pc.dim('Serve the directory from the root of a static host (canvases reference /_next/static).'));
    return failures.length ? 1 : 0;
  } finally {
    await server.close();
  }
}
