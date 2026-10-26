import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import pc from 'picocolors';
import { createIndex } from '../indexer';
import { readDirective, resolveSpecifier } from '../next/resolve';
import { loadProject, type Project } from '../project';

type Level = 'ok' | 'info' | 'warn' | 'error';

export interface Check {
  level: Level;
  title: string;
  detail?: string;
}

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
}

function tryResolve(project: Project, name: string): string | undefined {
  try {
    return JSON.parse(readFileSync(project.require.resolve(`${name}/package.json`), 'utf8')).version as string;
  } catch {
    return undefined;
  }
}

/** Runs every check; never throws. */
export async function runChecks(cwd: string): Promise<Check[]> {
  const checks: Check[] = [];
  const [major = 0] = process.versions.node.split('.').map(Number);
  checks.push(
    major >= 20
      ? { level: 'ok', title: `Node.js ${process.versions.node}` }
      : { level: 'error', title: `Node.js ${process.versions.node}`, detail: 'RSC Stories needs Node.js 20 or newer.' },
  );
  let project: Project;
  try {
    project = await loadProject(cwd);
  } catch (error) {
    checks.push({ level: 'error', title: 'Project', detail: (error as Error).message });
    return checks;
  }
  const { next } = project;
  checks.push(
    next.major === 15 || next.major === 16
      ? { level: 'ok', title: `Next.js ${next.version} (${project.bundler})` }
      : { level: 'warn', title: `Next.js ${next.version}`, detail: 'Tested with Next.js 15.x and 16.x; other versions may work.' },
  );
  const reactDom = tryResolve(project, 'react-dom');
  const reactMajor = Number(project.react.version.split('.')[0]);
  if (reactMajor < 19) checks.push({ level: 'error', title: `React ${project.react.version}`, detail: 'React 19 or newer is required.' });
  else if (reactDom && reactDom !== project.react.version) {
    checks.push({
      level: 'warn',
      title: `React ${project.react.version} / react-dom ${reactDom}`,
      detail: 'react and react-dom versions differ.',
    });
  } else checks.push({ level: 'ok', title: `React ${project.react.version}` });

  checks.push(
    project.configFile
      ? { level: 'ok', title: `Config ${path.relative(project.root, project.configFile)}` }
      : { level: 'info', title: 'No .rsc-stories/config.ts', detail: 'Defaults apply. Run `rsc-stories init` to scaffold one.' },
  );
  checks.push(
    project.previewFile
      ? { level: 'ok', title: `Preview ${path.relative(project.root, project.previewFile)}` }
      : {
          level: 'info',
          title: 'No .rsc-stories/preview.tsx',
          detail: 'Global CSS from your root layout is not loaded in stories without one.',
        },
  );
  checks.push(
    project.tsconfig
      ? {
          level: 'ok',
          title: `tsconfig ${path.relative(project.root, project.tsconfig.file)}${project.tsconfig.paths ? ` (${Object.keys(project.tsconfig.paths).length} path aliases)` : ''}`,
        }
      : { level: 'info', title: 'No tsconfig.json/jsconfig.json' },
  );
  if (project.rootDir !== project.root) {
    checks.push({
      level: 'info',
      title: `Monorepo root ${project.rootDir}`,
      detail: 'Used as the Turbopack root and output tracing root.',
    });
  }

  const index = await createIndex(project.root, project.storyGlobs);
  const stories = index.files.reduce((sum, f) => sum + f.stories.length, 0);
  checks.push(
    stories
      ? { level: 'ok', title: `${stories} stories in ${index.files.length} files` }
      : { level: 'warn', title: 'No stories found', detail: `Globs: ${project.storyGlobs.join(', ')}` },
  );
  for (const file of index.files) {
    if (file.error) checks.push({ level: 'error', title: `Cannot parse ${file.relativePath}`, detail: file.error });
    for (const warning of file.warnings) checks.push({ level: 'warn', title: file.relativePath, detail: warning });
  }
  for (const problem of index.problems) checks.push({ level: 'error', title: 'Story ids', detail: problem });
  if (index.skipped.length) {
    checks.push({
      level: 'info',
      title: `${index.skipped.length} Storybook story files skipped`,
      detail: 'They import @storybook/*. Run `rsc-stories migrate` to convert them.',
    });
  }
  for (const specifier of index.mockSpecifiers) {
    const resolved = await resolveSpecifier(specifier, project.root);
    if (!resolved)
      checks.push({ level: 'error', title: `Mocked module "${specifier}"`, detail: 'Does not resolve from the project root.' });
    else if ((await readDirective(resolved)) === 'use server') {
      checks.push({
        level: 'warn',
        title: `Mocked module "${specifier}"`,
        detail: "It is a 'use server' module; mock what its actions call instead.",
      });
    } else checks.push({ level: 'ok', title: `Mocked module "${specifier}"`, detail: path.relative(project.root, resolved) });
  }

  checks.push(
    tryResolve(project, 'typescript')
      ? { level: 'ok', title: `TypeScript ${tryResolve(project, 'typescript')} (controls are inferred from prop types)` }
      : { level: 'info', title: 'TypeScript not installed', detail: 'Controls fall back to inference from arg values.' },
  );
  checks.push(
    tryResolve(project, 'playwright') || tryResolve(project, '@playwright/test')
      ? { level: 'ok', title: 'Playwright available (rsc-stories test --browser)' }
      : { level: 'info', title: 'Playwright not installed', detail: '`rsc-stories test --browser` needs it.' },
  );
  const ignore = existsSync(path.join(project.root, '.gitignore')) ? readFileSync(path.join(project.root, '.gitignore'), 'utf8') : '';
  if (!/\.rsc-stories\/\.cache/.test(ignore)) {
    checks.push({ level: 'warn', title: '.gitignore', detail: 'Add `.rsc-stories/.cache` (generated files).' });
  }
  if (existsSync(path.join(project.root, '.storybook'))) {
    checks.push({ level: 'info', title: 'Storybook detected', detail: 'Both can coexist: separate config directory, CLI and port.' });
  }
  const host = project.config.host ?? 'localhost';
  const port = project.config.port ?? 6006;
  if (!(await portFree(port, host)))
    checks.push({ level: 'warn', title: `Port ${port} is in use`, detail: 'Pass --port to `rsc-stories dev`.' });
  return checks;
}

const ICON: Record<Level, string> = { ok: pc.green('✓'), info: pc.cyan('i'), warn: pc.yellow('!'), error: pc.red('✗') };

/** `rsc-stories doctor` (FR-6.5). Exit code 1 when any check is an error. */
export async function doctor(options: { cwd: string }): Promise<number> {
  const checks = await runChecks(options.cwd);
  console.log(`\n${pc.bold('rsc-stories doctor')}\n`);
  for (const check of checks) {
    console.log(`  ${ICON[check.level]} ${check.title}${check.detail ? pc.dim(` — ${check.detail}`) : ''}`);
  }
  const errors = checks.filter((c) => c.level === 'error').length;
  const warnings = checks.filter((c) => c.level === 'warn').length;
  console.log(`\n  ${errors ? pc.red(`${errors} error(s)`) : pc.green('no errors')}, ${warnings} warning(s)\n`);
  return errors ? 1 : 0;
}
