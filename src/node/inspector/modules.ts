import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { build, transform } from 'esbuild';

/** Where a client reference's module lives on disk. */
export interface ModuleLocation {
  /** Absolute path, when the module is a source file. */
  file?: string;
  /** `true` for Next.js internals and other node_modules code. */
  external: boolean;
}

const manifestCache = new Map<string, { mtime: number; map: Map<string, string> }>();

/** Reads every `*client-reference-manifest.js` under a Next build directory into id → file. */
function manifestMap(distDir: string): Map<string, string> {
  const map = new Map<string, string>();
  const serverApp = path.join(distDir, 'server', 'app');
  if (!existsSync(serverApp)) return map;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('client-reference-manifest.js')) files.push(full);
    }
  };
  walk(serverApp);
  for (const file of files) {
    const mtime = statSync(file).mtimeMs;
    let cached = manifestCache.get(file);
    if (!cached || cached.mtime !== mtime) {
      const sandbox: {
        globalThis?: unknown;
        __RSC_MANIFEST?: Record<string, { clientModules?: Record<string, { id: string | number }> }>;
      } = {};
      sandbox.globalThis = sandbox;
      const entries = new Map<string, string>();
      try {
        vm.runInNewContext(readFileSync(file, 'utf8'), sandbox, { timeout: 1000 });
        for (const manifest of Object.values(sandbox.__RSC_MANIFEST ?? {})) {
          for (const [key, entry] of Object.entries(manifest.clientModules ?? {})) {
            const filePart = key.replace(/#.*$/, '').replace(/ <module evaluation>$/, '');
            entries.set(String(entry.id), filePart);
          }
        }
      } catch {
        // An unreadable manifest only costs file attribution.
      }
      cached = { mtime, map: entries };
      manifestCache.set(file, cached);
    }
    for (const [id, value] of cached.map) map.set(id, value);
  }
  return map;
}

/**
 * Maps a client reference module id to a file. Handles Turbopack (`[project]/src/x.tsx [app-client]
 * (ecmascript)`), webpack (`(app-pages-browser)/./src/x.tsx`) and numeric production ids.
 */
export function locateModule(moduleId: string, options: { rootDir: string; workshopDir: string; distDir: string }): ModuleLocation {
  let candidate: string | undefined;
  const turbopack = /^\[project\]\/(.+?)(?: \[[^\]]+\])?(?: \([^)]*\))?$/.exec(moduleId);
  const webpack = /^\([^)]+\)\/(.+)$/.exec(moduleId);
  if (turbopack) candidate = path.join(options.rootDir, turbopack[1]!);
  else if (webpack) candidate = path.resolve(options.workshopDir, webpack[1]!);
  else if (path.isAbsolute(moduleId)) candidate = moduleId;
  else {
    const mapped = manifestMap(options.distDir).get(moduleId);
    if (mapped) {
      const turbopackMapped = /^\[project\]\/(.+?)(?: \[|$)/.exec(mapped);
      candidate = turbopackMapped ? path.join(options.rootDir, turbopackMapped[1]!) : mapped;
    }
  }
  if (!candidate) return { external: true };
  const external = candidate.includes(`${path.sep}node_modules${path.sep}`);
  return { file: candidate, external };
}

/** Why a module is in the client bundle without needing to be. */
export interface ClientLeak {
  /** Exported component names of the module. */
  component: string;
  file: string;
  kind: 'marked' | 'inherited';
  reason: string;
  fix: string;
  /** For inherited leaks: the `'use client'` module that pulls this one in. */
  via?: string;
}

/** Per-file analysis of client-only API usage. */
export interface ModuleFacts {
  file: string;
  directive?: 'use client' | 'use server';
  /** Client-only APIs found (hook names, `onClick`, `window`, …). */
  clientApis: string[];
  /** Exported names that look like components (capitalized). */
  components: string[];
  imports: string[];
}

const HOOKS =
  /\b(useState|useEffect|useLayoutEffect|useInsertionEffect|useReducer|useRef|useContext|useTransition|useDeferredValue|useSyncExternalStore|useImperativeHandle|useOptimistic|useActionState|useFormStatus|useEffectEvent|useRouter|usePathname|useSearchParams|useParams|useSelectedLayoutSegments?)\b/g;
const CUSTOM_HOOK = /(?<!function\s+)\buse[A-Z][A-Za-z0-9]*(?=\s*\()/g;
const EVENTS = /\b(on[A-Z][A-Za-z]+)\s*:/g;
const BROWSER =
  /\b(window|document|localStorage|sessionStorage|navigator|matchMedia|requestAnimationFrame|IntersectionObserver|ResizeObserver|MutationObserver)\b/g;
const CLASS = /extends\s+(?:React\.)?(Component|PureComponent)\b/g;

const factsCache = new Map<string, { mtime: number; facts: ModuleFacts }>();

function unique(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

/** Reads a source file and records the client-only APIs it uses. */
export async function moduleFacts(file: string): Promise<ModuleFacts> {
  const mtime = statSync(file).mtimeMs;
  const cached = factsCache.get(file);
  if (cached && cached.mtime === mtime) return cached.facts;
  const source = await readFile(file, 'utf8');
  const directive = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*['"](use client|use server)['"]/.exec(source)?.[1] as
    'use client' | 'use server' | undefined;
  let code = source;
  try {
    const loader = /\.tsx$/.test(file) ? 'tsx' : /\.[cm]?ts$/.test(file) ? 'ts' : 'jsx';
    code = (await transform(source, { loader, jsx: 'automatic', format: 'esm', legalComments: 'none' })).code;
  } catch {
    // Fall back to scanning the raw source.
  }
  const apis: string[] = [];
  for (const match of code.matchAll(HOOKS)) apis.push(match[1]!);
  for (const match of code.matchAll(CUSTOM_HOOK)) if (match[0] !== 'useId') apis.push(match[0]);
  for (const match of code.matchAll(EVENTS)) apis.push(match[1]!);
  for (const match of code.matchAll(BROWSER)) apis.push(match[1]!);
  for (const match of code.matchAll(CLASS)) apis.push(`class ${match[1]!}`);
  if (/\bcreateContext\s*\(/.test(code)) apis.push('createContext');
  if (/from\s+['"]client-only['"]|import\s+['"]client-only['"]/.test(code)) apis.push('client-only');
  const components: string[] = [];
  for (const match of code.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Z][A-Za-z0-9_]*)/g)) {
    components.push(match[1]!);
  }
  for (const match of code.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of match[1]!.split(',')) {
      const name = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name && /^[A-Z]/.test(name)) components.push(name);
    }
  }
  if (/export\s+default\s+function\s*\(/.test(code) || /export\s+default\s+\(/.test(code)) {
    components.push(path.basename(file).replace(/\.[^.]+$/, ''));
  }
  const imports = unique([...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!));
  const facts: ModuleFacts = {
    file,
    ...(directive ? { directive } : {}),
    clientApis: unique(apis),
    components: unique(components),
    imports,
  };
  factsCache.set(file, { mtime, facts });
  return facts;
}

/** Local files in a module's import graph (packages excluded). */
export async function localGraph(entry: string): Promise<Map<string, string[]>> {
  const graph = new Map<string, string[]>();
  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      metafile: true,
      format: 'esm',
      platform: 'browser',
      packages: 'external',
      logLevel: 'silent',
      outdir: path.join(path.dirname(entry), '.rsc-stories-graph'),
      jsx: 'automatic',
      loader: { '.css': 'empty', '.scss': 'empty', '.svg': 'empty', '.png': 'empty', '.jpg': 'empty', '.webp': 'empty' },
    });
    const cwd = process.cwd();
    for (const [input, info] of Object.entries(result.metafile.inputs)) {
      if (input.includes('node_modules') || input.startsWith('(disabled)')) continue;
      const file = path.resolve(cwd, input);
      graph.set(
        file,
        info.imports.filter((i) => !i.external && !i.path.includes('node_modules')).map((i) => path.resolve(cwd, i.path)),
      );
    }
  } catch {
    graph.set(entry, []);
  }
  return graph;
}

/**
 * Finds client leaks (FR-5.5) across the client modules a story renders: `'use client'` modules
 * with no client-only APIs, and components pulled into the client bundle only because a client
 * module imports them.
 */
export async function findClientLeaks(clientEntries: string[]): Promise<{ leaks: ClientLeak[]; clientFiles: Set<string> }> {
  const leaks: ClientLeak[] = [];
  const clientFiles = new Set<string>();
  const reported = new Set<string>();
  for (const entry of unique(clientEntries)) {
    if (!existsSync(entry)) continue;
    const graph = await localGraph(entry);
    const entryFacts = await moduleFacts(entry);
    const entryName = entryFacts.components[0] ?? path.basename(entry);
    for (const file of graph.keys()) {
      clientFiles.add(file);
      if (reported.has(file) || !/\.[cm]?[jt]sx?$/.test(file)) continue;
      const facts = await moduleFacts(file);
      if (facts.components.length === 0 || facts.clientApis.length > 0) continue;
      reported.add(file);
      if (file === entry || facts.directive === 'use client') {
        leaks.push({
          component: facts.components.join(', '),
          file,
          kind: 'marked',
          reason: "marked 'use client' but uses no client-only APIs",
          fix: "Remove the 'use client' directive. It can render on the server, and still works when a Client Component imports it.",
        });
      } else {
        leaks.push({
          component: facts.components.join(', '),
          file,
          kind: 'inherited',
          reason: `inherited 'use client' from ${entryName}`,
          fix: `${facts.components[0]} has no client-only APIs but ships to the browser because ${entryName} imports it. Render it in a Server Component and pass it to ${entryName} as children or a prop.`,
          via: entry,
        });
      }
    }
  }
  return { leaks, clientFiles };
}
