import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createJiti } from 'jiti';
import { DEFAULT_STORY_GLOBS, type RscStoriesConfig } from '../config';
import { findNextConfig } from './next/next-config';
import { readTsconfig, type ResolvedTsconfig } from './next/tsconfig';

/** Everything the CLI knows about the host project. */
export interface Project {
  /** Host project root: the directory with the Next.js app's package.json. */
  root: string;
  /** `.rsc-stories/` */
  configDir: string;
  /** `.rsc-stories/.cache/` (gitignored) */
  cacheDir: string;
  /** Generated Next.js app driven by the workshop. */
  workshopDir: string;
  configFile?: string;
  previewFile?: string;
  config: RscStoriesConfig;
  /** Config fields that apply at render time exist (decorators, mocks, …). */
  configHasRenderFields: boolean;
  storyGlobs: string[];
  next: { version: string; major: number; minor: number; packageDir: string };
  react: { version: string };
  /** Directory of the lockfile (monorepo root in workspaces). */
  rootDir: string;
  tsconfig?: ResolvedTsconfig;
  nextConfigFile?: string;
  bundler: 'turbopack' | 'webpack';
  require: NodeJS.Require;
}

const LOCKFILES = ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb', 'bun.lock', 'pnpm-workspace.yaml'];

/** Closest directory at or above `dir` containing a lockfile; `dir` itself when none. */
export function findRootDir(dir: string): string {
  let current = dir;
  let found: string | undefined;
  for (;;) {
    if (LOCKFILES.some((name) => existsSync(path.join(current, name)))) found = current;
    const parent = path.dirname(current);
    if (parent === current) break;
    if (found) break;
    current = parent;
  }
  return found ?? dir;
}

/** Nearest ancestor (or self) with a package.json that depends on `next`. */
export function findProjectRoot(cwd: string): string {
  // Real paths throughout: bundlers and esbuild report resolved (symlink-free) paths.
  let current = realpathSync(path.resolve(cwd));
  for (;;) {
    const pkgFile = path.join(current, 'package.json');
    if (existsSync(pkgFile)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as Record<string, Record<string, string> | undefined>;
        if (pkg.dependencies?.next || pkg.devDependencies?.next || pkg.peerDependencies?.next) return current;
      } catch {
        // Malformed package.json: keep walking up.
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return realpathSync(path.resolve(cwd));
    current = parent;
  }
}

function firstExisting(dir: string, names: string[]): string | undefined {
  return names.map((name) => path.join(dir, name)).find((file) => existsSync(file));
}

function readVersion(require: NodeJS.Require, name: string): { version: string; packageDir: string } | undefined {
  try {
    const file = require.resolve(`${name}/package.json`);
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version: string };
    return { version: pkg.version, packageDir: path.dirname(file) };
  } catch {
    return undefined;
  }
}

/** Thrown when the host project cannot run the workshop. */
export class ProjectError extends Error {
  override name = 'ProjectError';
}

/** Loads `.rsc-stories/config.*`. Configs that import components should move them to preview.tsx. */
export async function loadConfigFile(file: string): Promise<RscStoriesConfig> {
  const jiti = createJiti(file, { interopDefault: true, moduleCache: false, fsCache: false, jsx: true });
  try {
    const loaded = (await jiti.import(file, { default: true })) as RscStoriesConfig | undefined;
    return loaded ?? {};
  } catch (error) {
    throw new ProjectError(
      `Could not load ${file}: ${(error as Error).message}\n` +
        'Keep config.ts free of component and CSS imports; put decorators and global styles in .rsc-stories/preview.tsx.',
    );
  }
}

const RENDER_FIELDS = ['decorators', 'mocks', 'parameters', 'args', 'argTypes', 'globals'] as const;

/** Detects the host project and loads its workshop config. */
export async function loadProject(cwd: string, overrides: Partial<RscStoriesConfig> & { configDir?: string } = {}): Promise<Project> {
  const root = findProjectRoot(cwd);
  const configDir = path.resolve(root, overrides.configDir ?? '.rsc-stories');
  const cacheDir = path.join(configDir, '.cache');
  const require = createRequire(path.join(root, 'package.json'));
  const nextInfo = readVersion(require, 'next');
  if (!nextInfo) {
    throw new ProjectError(`Next.js is not installed in ${root}. RSC Stories renders through your project's own Next.js (15 or newer).`);
  }
  const reactInfo = readVersion(require, 'react');
  const [major = 0, minor = 0] = nextInfo.version.split('.').map((part) => Number.parseInt(part, 10));
  if (major < 15) {
    throw new ProjectError(`Next.js ${nextInfo.version} found; RSC Stories needs Next.js 15 or newer.`);
  }
  const configFile = firstExisting(configDir, ['config.ts', 'config.mts', 'config.mjs', 'config.js']);
  const loaded = configFile ? await loadConfigFile(configFile) : {};
  const { configDir: _configDir, ...configOverrides } = overrides;
  const config: RscStoriesConfig = { ...loaded, ...configOverrides };
  const tsconfigFile = firstExisting(root, ['tsconfig.json', 'jsconfig.json']);
  let tsconfig: ResolvedTsconfig | undefined;
  if (tsconfigFile) {
    try {
      tsconfig = readTsconfig(tsconfigFile);
    } catch {
      tsconfig = undefined;
    }
  }
  const nextConfigFile = findNextConfig(root);
  return {
    root,
    configDir,
    cacheDir,
    workshopDir: path.join(cacheDir, 'workshop'),
    ...(configFile ? { configFile } : {}),
    ...(() => {
      const previewFile = firstExisting(configDir, ['preview.tsx', 'preview.ts', 'preview.jsx', 'preview.js']);
      return previewFile ? { previewFile } : {};
    })(),
    config,
    configHasRenderFields: RENDER_FIELDS.some((field) => loaded[field] !== undefined),
    storyGlobs: config.stories?.length ? config.stories : DEFAULT_STORY_GLOBS,
    next: { version: nextInfo.version, major, minor, packageDir: nextInfo.packageDir },
    react: { version: reactInfo?.version ?? 'unknown' },
    rootDir: findRootDir(root),
    ...(tsconfig ? { tsconfig } : {}),
    ...(nextConfigFile ? { nextConfigFile } : {}),
    bundler:
      (process.env.RSC_STORIES_BUNDLER as Project['bundler'] | undefined) ?? config.bundler ?? (major >= 16 ? 'turbopack' : 'webpack'),
    require,
  };
}
