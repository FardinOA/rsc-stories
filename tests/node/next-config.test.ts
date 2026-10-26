import { describe, expect, it } from 'vitest';
import { createWorkshopNextConfig, findNextConfig, loadHostNextConfig, mergeNextConfig } from '../../src/node/next/next-config';
import { tempProject } from '../helpers/project';

const options = {
  hostDir: '/app',
  workshopDir: '/app/.rsc-stories/.cache/workshop',
  rootDir: '/',
  aliases: { '@/lib/db': '/app/.rsc-stories/.cache/workshop/rsc/mocks/lib-db.ts' },
  bundler: 'turbopack' as const,
  nextMajor: 16,
  phase: 'dev' as const,
};

describe('mergeNextConfig (FR-2.2)', () => {
  it('keeps compile settings and drops routing/output settings', () => {
    const config = mergeNextConfig(
      {
        basePath: '/docs',
        output: 'export',
        rewrites: async () => [],
        distDir: 'build',
        images: { remotePatterns: [{ hostname: 'cdn.test' }] },
        reactStrictMode: true,
        serverExternalPackages: ['prisma', 'rsc-stories'],
        turbopack: { resolveAlias: { '~/x': './src/x.ts', pkg: 'other' }, rules: { '*.svg': { loaders: ['@svgr/webpack'] } } },
        experimental: { typedEnv: true },
      },
      options,
    );
    expect(config.basePath).toBeUndefined();
    expect(config.output).toBeUndefined();
    expect(config.rewrites).toBeUndefined();
    expect(config.distDir).toBeUndefined();
    expect(config.reactStrictMode).toBe(true);
    expect(config.images).toEqual({ remotePatterns: [{ hostname: 'cdn.test' }] });
    expect(config.serverExternalPackages).toEqual(['prisma']);
    expect(config.devIndicators).toBe(false);
    expect(config.experimental).toEqual({ typedEnv: true, reactDebugChannel: false, turbopackFileSystemCacheForDev: false });
    expect(config.turbopack).toEqual({
      root: '/',
      rules: { '*.svg': { loaders: ['@svgr/webpack'] } },
      resolveAlias: { '~/x': '../../../src/x.ts', pkg: 'other', '@/lib/db': './rsc/mocks/lib-db.ts' },
    });
  });

  it('handles build phase, Next 15 and webpack', () => {
    const config = mergeNextConfig({ images: { domains: ['a'] } }, { ...options, phase: 'build', nextMajor: 15, bundler: 'webpack' });
    // Production builds keep the image optimizer; only static exports turn it off.
    expect(config.images).toEqual({ domains: ['a'] });
    expect(mergeNextConfig({ images: { domains: ['a'] } }, { ...options, phase: 'build', staticExport: true }).images).toEqual({
      domains: ['a'],
      unoptimized: true,
    });
    expect(config.eslint).toEqual({ ignoreDuringBuilds: true });
    expect(config.experimental).toEqual({ externalDir: true });
    const hostWebpack = (c: { resolve?: { alias?: Record<string, unknown> } }) => ({ ...c, touched: true });
    const merged = mergeNextConfig({ webpack: hostWebpack as never }, options);
    const out = (merged.webpack as (c: unknown, ctx: unknown) => { resolve: { alias: Record<string, string> }; touched: boolean })(
      { resolve: { alias: { x: 'y' } } },
      {},
    );
    expect(out.touched).toBe(true);
    expect(out.resolve.alias).toEqual({ '@/lib/db$': options.aliases['@/lib/db'], x: 'y' });
    const arrayAlias = (merged.webpack as (c: unknown, ctx: unknown) => { resolve: { alias: unknown[] } })({ resolve: { alias: [] } }, {});
    expect(arrayAlias.resolve.alias).toEqual([{ name: '@/lib/db$', alias: options.aliases['@/lib/db'], onlyModule: true }]);
  });

  it('loads TypeScript and function configs from the host', async () => {
    const root = await tempProject({ 'next.config.ts': `const config = { reactStrictMode: false as boolean }; export default config;` });
    expect(findNextConfig(root)).toMatch(/next\.config\.ts$/);
    expect(await loadHostNextConfig(findNextConfig(root), 'phase', { defaultConfig: {} })).toEqual({ reactStrictMode: false });
    const fnRoot = await tempProject({ 'next.config.mjs': `export default (phase) => ({ env: { PHASE: phase } });` });
    const create = createWorkshopNextConfig({ ...options, hostConfigFile: findNextConfig(fnRoot)! });
    expect((await create('phase-dev', { defaultConfig: {} })).env).toEqual({ PHASE: 'phase-dev' });
    expect(await loadHostNextConfig(undefined, 'p', { defaultConfig: {} })).toEqual({});
  });
});

describe('moduleShimPlugin', () => {
  it('swaps resolved mocked files for their shims, except for the shim itself', async () => {
    const { moduleShimPlugin } = await import('../../src/node/next/next-config');
    let afterResolve: ((data: unknown) => void) | undefined;
    moduleShimPlugin({ '/app/src/lib/db.ts': '/w/rsc/mocks/lib-db.ts' }).apply({
      hooks: {
        normalModuleFactory: { tap: (_n, cb) => cb({ hooks: { afterResolve: { tap: (_m, fn) => (afterResolve = fn as never) } } }) },
      },
    });
    const data = (issuer: string, resource = '/app/src/lib/db.ts') => ({
      contextInfo: { issuer },
      createData: { resource, request: `loader!${resource}`, userRequest: resource },
    });
    const fromApp = data('/app/src/Feed.tsx');
    afterResolve!(fromApp);
    expect(fromApp.createData).toEqual({
      resource: '/w/rsc/mocks/lib-db.ts',
      request: 'loader!/w/rsc/mocks/lib-db.ts',
      userRequest: '/w/rsc/mocks/lib-db.ts',
      context: '/w/rsc/mocks',
    });
    const fromShim = data('/w/rsc/mocks/lib-db.ts');
    afterResolve!(fromShim);
    expect(fromShim.createData.resource).toBe('/app/src/lib/db.ts');
    const other = data('/app/src/Feed.tsx', '/app/src/other.ts');
    afterResolve!(other);
    expect(other.createData.resource).toBe('/app/src/other.ts');
    afterResolve!({});
  });
});
