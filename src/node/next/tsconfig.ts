import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

/** Parses JSON with comments and trailing commas (tsconfig/jsconfig syntax). */
export function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    const next = text[i + 1];
    if (inString) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        i++;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      out += char;
    } else if (char === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (char === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += char;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Compiler options that matter to the generated app, with paths made absolute. */
export interface ResolvedTsconfig {
  file: string;
  compilerOptions: Record<string, unknown>;
  /** Absolute directory `paths` entries are relative to. */
  pathsBase?: string;
  paths?: Record<string, string[]>;
}

interface RawTsconfig {
  extends?: string | string[];
  compilerOptions?: Record<string, unknown>;
}

function resolveExtends(from: string, specifier: string): string | undefined {
  const dir = path.dirname(from);
  if (specifier.startsWith('.') || path.isAbsolute(specifier)) {
    const candidate = path.resolve(dir, specifier);
    for (const file of [candidate, `${candidate}.json`, path.join(candidate, 'tsconfig.json')]) {
      if (existsSync(file) && !file.endsWith(path.sep)) return file;
    }
    return undefined;
  }
  const require = createRequire(from);
  for (const request of [specifier, `${specifier}.json`, `${specifier}/tsconfig.json`]) {
    try {
      return require.resolve(request);
    } catch {
      // try the next form
    }
  }
  return undefined;
}

/** Reads a tsconfig and its `extends` chain the way TypeScript resolves `baseUrl` and `paths`. */
export function readTsconfig(file: string, seen = new Set<string>()): ResolvedTsconfig {
  if (seen.has(file)) return { file, compilerOptions: {} };
  seen.add(file);
  const raw = parseJsonc(readFileSync(file, 'utf8')) as RawTsconfig;
  let result: ResolvedTsconfig = { file, compilerOptions: {} };
  const bases = raw.extends === undefined ? [] : Array.isArray(raw.extends) ? raw.extends : [raw.extends];
  for (const base of bases) {
    const baseFile = resolveExtends(file, base);
    if (!baseFile) continue;
    const parent = readTsconfig(baseFile, seen);
    result = {
      file,
      compilerOptions: { ...result.compilerOptions, ...parent.compilerOptions },
      ...((parent.pathsBase ?? result.pathsBase) ? { pathsBase: parent.pathsBase ?? result.pathsBase } : {}),
      ...((parent.paths ?? result.paths) ? { paths: parent.paths ?? result.paths } : {}),
    };
  }
  const own = raw.compilerOptions ?? {};
  const dir = path.dirname(file);
  const compilerOptions = { ...result.compilerOptions, ...own };
  if (typeof own.baseUrl === 'string') {
    compilerOptions.baseUrl = path.resolve(dir, own.baseUrl);
  }
  let pathsBase = result.pathsBase;
  let paths = result.paths;
  if (own.paths && typeof own.paths === 'object') {
    paths = own.paths as Record<string, string[]>;
    pathsBase = typeof compilerOptions.baseUrl === 'string' ? (compilerOptions.baseUrl as string) : dir;
  } else if (typeof own.baseUrl === 'string' && paths) {
    pathsBase = compilerOptions.baseUrl as string;
  }
  return {
    file,
    compilerOptions,
    ...(pathsBase ? { pathsBase } : {}),
    ...(paths ? { paths } : {}),
  };
}

/** Compiler options copied from the host because they change how code compiles. */
const COPIED_OPTIONS = [
  'experimentalDecorators',
  'emitDecoratorMetadata',
  'jsxImportSource',
  'useDefineForClassFields',
  'allowImportingTsExtensions',
];

/** The generated app's tsconfig: host aliases rebased onto the workshop directory. */
export function workshopTsconfig(host: ResolvedTsconfig | undefined, workshopDir: string, hostDir: string, nextMajor = 16) {
  const toWorkshop = (absolute: string) => {
    const relative = path.relative(workshopDir, absolute).split(path.sep).join('/');
    return relative || '.';
  };
  const compilerOptions: Record<string, unknown> = {
    target: 'ES2022',
    lib: ['dom', 'dom.iterable', 'esnext'],
    allowJs: true,
    skipLibCheck: true,
    strict: false,
    noEmit: true,
    esModuleInterop: true,
    module: 'esnext',
    moduleResolution: 'bundler',
    resolveJsonModule: true,
    isolatedModules: true,
    // What each Next version insists on; anything else and it rewrites the file on startup.
    jsx: nextMajor >= 16 ? 'react-jsx' : 'preserve',
    incremental: true,
    plugins: [{ name: 'next' }],
  };
  for (const key of COPIED_OPTIONS) {
    if (host?.compilerOptions[key] !== undefined) compilerOptions[key] = host.compilerOptions[key];
  }
  if (typeof host?.compilerOptions.baseUrl === 'string') {
    // The host resolves bare imports from baseUrl, so the workshop must too; paths stay relative to it.
    compilerOptions.baseUrl = toWorkshop(host.compilerOptions.baseUrl);
    if (host.paths) compilerOptions.paths = host.paths;
  } else if (host?.paths && host.pathsBase) {
    // No baseUrl: paths are relative to this file. A baseUrl pointing at the host root would make the
    // bundler resolve bare imports against that directory too, and every file written there (the
    // app's own `next dev`, editors) would invalidate the workshop and loop its hot reload.
    const pathsBase = host.pathsBase;
    compilerOptions.paths = Object.fromEntries(
      Object.entries(host.paths).map(([pattern, targets]) => [
        pattern,
        targets.map((target) => {
          const relative = toWorkshop(path.resolve(pathsBase, target));
          return relative.startsWith('.') ? relative : `./${relative}`;
        }),
      ]),
    );
  }
  return {
    compilerOptions,
    // Everything Next would add on startup, so it never rewrites this file (and reloads) itself.
    include: [
      'next-env.d.ts',
      '**/*.ts',
      '**/*.tsx',
      '.next/types/**/*.ts',
      '.next/dev/types/**/*.ts',
      // Next 16 nests the dev build once more when NODE_ENV is "test" (e.g. under Vitest).
      '.next/dev/dev/types/**/*.ts',
      `${toWorkshop(hostDir)}/**/*.d.ts`,
    ],
    exclude: ['node_modules'],
  };
}
