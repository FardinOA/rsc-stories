import { existsSync } from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';

/** Options the generator bakes into the workshop's `next.config.mjs`. */
export interface WorkshopNextConfigOptions {
  hostDir: string;
  workshopDir: string;
  /** Host `next.config.*`, if any. */
  hostConfigFile?: string;
  /** Directory Turbopack and output tracing treat as the root (the lockfile directory). */
  rootDir: string;
  /** Specifier → absolute path of the generated shim. */
  aliases: Record<string, string>;
  /** Mocked module file → its shim; webpack swaps them after resolution, whatever the import spelling. */
  moduleShims?: Record<string, string>;
  bundler: 'turbopack' | 'webpack';
  nextMajor: number;
  /** `dev` keeps React debug info inline so the inspector can read component names. */
  phase: 'dev' | 'build';
  /** The build is exported to a static host (`rsc-stories build`). */
  staticExport?: boolean;
}

type NextConfigObject = Record<string, unknown> & {
  experimental?: Record<string, unknown>;
  turbopack?: Record<string, unknown> & { resolveAlias?: Record<string, unknown>; root?: string };
  webpack?: (config: WebpackConfig, context: unknown) => WebpackConfig;
  images?: Record<string, unknown>;
  typescript?: Record<string, unknown>;
  eslint?: Record<string, unknown>;
  serverExternalPackages?: string[];
};

interface WebpackConfig {
  resolve?: { alias?: Record<string, unknown> | unknown[] };
  plugins?: unknown[];
  [key: string]: unknown;
}

interface ResolveData {
  contextInfo?: { issuer?: string };
  createData?: { resource?: string; request?: string; userRequest?: string; context?: string };
}

interface Compiler {
  hooks: {
    normalModuleFactory: {
      tap(
        name: string,
        callback: (factory: { hooks: { afterResolve: { tap(name: string, cb: (data: ResolveData) => void): void } } }) => void,
      ): void;
    };
  };
}

/** Webpack plugin replacing mocked module files by their shims (all import spellings). */
export function moduleShimPlugin(shims: Record<string, string>) {
  const byFile = new Map(Object.entries(shims));
  const shimFiles = new Set(byFile.values());
  return {
    apply(compiler: Compiler) {
      compiler.hooks.normalModuleFactory.tap('rsc-stories-mocks', (factory) => {
        factory.hooks.afterResolve.tap('rsc-stories-mocks', (data) => {
          const created = data.createData;
          const resource = created?.resource?.split('?')[0];
          if (!created || !resource) return;
          const shim = byFile.get(resource);
          // The shim imports the real module; that import must reach the real file.
          if (!shim || shimFiles.has(data.contextInfo?.issuer ?? '')) return;
          created.resource = created.resource!.replace(resource, shim);
          // The shim's own imports resolve relative to the shim, not the file it replaces.
          created.context = path.dirname(shim);
          if (created.request) created.request = created.request.replace(resource, shim);
          if (created.userRequest) created.userRequest = created.userRequest.replace(resource, shim);
        });
      });
    },
  };
}

type NextConfigExport =
  NextConfigObject | ((phase: string, context: { defaultConfig: unknown }) => NextConfigObject | Promise<NextConfigObject>);

const CONFIG_NAMES = ['next.config.ts', 'next.config.mts', 'next.config.mjs', 'next.config.js', 'next.config.cjs'];

/** Finds the host's `next.config.*`. */
export function findNextConfig(hostDir: string): string | undefined {
  return CONFIG_NAMES.map((name) => path.join(hostDir, name)).find((file) => existsSync(file));
}

/** Loads the host config through jiti so TypeScript configs and their imports work. */
export async function loadHostNextConfig(
  file: string | undefined,
  phase: string,
  context: { defaultConfig: unknown },
): Promise<NextConfigObject> {
  if (!file) return {};
  const jiti = createJiti(file, { interopDefault: true, moduleCache: false, fsCache: false });
  const loaded = (await jiti.import(file, { default: true })) as NextConfigExport;
  const config = typeof loaded === 'function' ? await loaded(phase, context) : loaded;
  return { ...(config ?? {}) };
}

function rebase(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string' && (value.startsWith('./') || value.startsWith('../'))) {
    const relative = path.relative(to, path.resolve(from, value)).split(path.sep).join('/');
    return relative.startsWith('.') ? relative : `./${relative}`;
  }
  if (Array.isArray(value)) return value.map((item) => rebase(item, from, to));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rebase(item, from, to)]));
  }
  return value;
}

/**
 * Merges the host's Next config with what the workshop needs. Host settings that change routing
 * or output (basePath, rewrites, `output: 'export'`, …) are dropped: the workshop app has its own
 * routes and is never deployed as the user's app.
 */
export function mergeNextConfig(host: NextConfigObject, options: WorkshopNextConfigOptions): NextConfigObject {
  const {
    basePath: _basePath,
    assetPrefix: _assetPrefix,
    i18n: _i18n,
    rewrites: _rewrites,
    redirects: _redirects,
    headers: _headers,
    output: _output,
    distDir: _distDir,
    trailingSlash: _trailingSlash,
    typedRoutes: _typedRoutes,
    pageExtensions: _pageExtensions,
    ...rest
  } = host;
  const config: NextConfigObject = { ...rest };

  const relativeAliases = Object.fromEntries(
    Object.entries(options.aliases).map(([specifier, file]) => {
      const relative = path.relative(options.workshopDir, file).split(path.sep).join('/');
      return [specifier, relative.startsWith('.') ? relative : `./${relative}`];
    }),
  );

  config.pageExtensions = ['tsx', 'ts', 'jsx', 'js'];
  config.devIndicators = false;
  config.typescript = { ...(host.typescript ?? {}), ignoreBuildErrors: true };
  if (options.nextMajor < 16) config.eslint = { ...(host.eslint ?? {}), ignoreDuringBuilds: true };
  config.serverExternalPackages = (host.serverExternalPackages ?? []).filter((name) => name !== 'rsc-stories');
  config.outputFileTracingRoot = (host.outputFileTracingRoot as string | undefined) ?? options.rootDir;

  const experimental: Record<string, unknown> = { ...(host.experimental ?? {}) };
  if (options.nextMajor >= 16 && options.phase === 'dev') {
    experimental.reactDebugChannel = false;
    // Turbopack's on-disk dev cache, reused after a short-lived run (`rsc-stories test --dev`, a
    // killed test server) that exited mid-write, makes every later page load a hot-reload restart:
    // the canvas reloads in a loop. The workshop compiles a few small routes; start cold instead.
    if (options.bundler === 'turbopack') experimental.turbopackFileSystemCacheForDev = false;
  }
  if (options.bundler === 'webpack') experimental.externalDir = true;
  config.experimental = experimental;

  if (options.staticExport) {
    // Statically exported canvases have no image optimizer behind them.
    config.images = { ...(host.images ?? {}), unoptimized: true };
  }

  const hostTurbopack = (host.turbopack ?? {}) as NonNullable<NextConfigObject['turbopack']>;
  config.turbopack = {
    ...hostTurbopack,
    root: hostTurbopack.root ?? options.rootDir,
    resolveAlias: {
      ...(rebase(hostTurbopack.resolveAlias ?? {}, options.hostDir, options.workshopDir) as Record<string, unknown>),
      ...relativeAliases,
    },
  };

  const hostWebpack = host.webpack;
  config.webpack = (webpackConfig: WebpackConfig, context: unknown) => {
    const next = hostWebpack ? hostWebpack(webpackConfig, context) : webpackConfig;
    next.resolve ??= {};
    const alias = next.resolve.alias;
    const ours = Object.fromEntries(Object.entries(options.aliases).map(([spec, file]) => [`${spec}$`, file]));
    if (Array.isArray(alias)) {
      for (const [name, file] of Object.entries(ours)) alias.unshift({ name, alias: file, onlyModule: true });
    } else {
      next.resolve.alias = { ...ours, ...(alias ?? {}), ...ours };
    }
    if (options.moduleShims && Object.keys(options.moduleShims).length) {
      next.plugins = [...(next.plugins ?? []), moduleShimPlugin(options.moduleShims)];
    }
    return next;
  };
  return config;
}

/** Entry point for the generated `next.config.mjs`. */
export function createWorkshopNextConfig(options: WorkshopNextConfigOptions) {
  return async (phase: string, context: { defaultConfig: unknown }) => {
    const host = await loadHostNextConfig(options.hostConfigFile, phase, context);
    return mergeNextConfig(host, options);
  };
}
