import http from 'node:http';
import https from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import { format } from 'node:util';
import { FRAMEWORK_HOSTS } from '../../shared/fetch-mock';
import { getStore, sinceStart, type LogEntry, type RenderStore } from '../../shared/global';
import { NAVIGATION_DIGEST } from '../../runtime/mock/next';

let consolePatched = false;
let quietRenders = false;

/** Lines Next prints per request or per compile; noise in a story's Console panel. */
const NEXT_NOISE = /^\s*(?:(?:GET|POST|HEAD|PUT|DELETE|PATCH) \/\S* \d{3} in |[○✓] Compil|✓ Running next\.config|⚠ Fast Refresh)/;

/**
 * Captures server console output made while a story renders and attributes it to that render
 * (FR-4.6). Output still reaches the terminal unchanged, unless `quiet`: test runs report failures
 * themselves, and a story that errors on purpose should not print a stack trace.
 */
export function installConsoleCapture(options: { quiet?: boolean } = {}): void {
  quietRenders = !!options.quiet;
  if (consolePatched) return;
  consolePatched = true;
  const levels: Array<LogEntry['level']> = ['log', 'info', 'warn', 'error', 'debug'];
  for (const level of levels) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      const store = getStore();
      const message = format(...args);
      // Mocked redirect()/notFound() are expected; React and Next still log them as errors.
      if (message.includes(NAVIGATION_DIGEST) || message.includes('StoryNavigationError')) return;
      const noise = NEXT_NOISE.test(message);
      if (!quietRenders || (!store && !noise)) original(...args);
      if (!store || noise) return;
      store.emit({
        type: 'log',
        entry: { origin: 'server', level, message: message.replace(/\u001b\[[0-9;]*m/g, ''), time: sinceStart(store) },
      });
    };
  }
  if (quietRenders) {
    // Next writes its request log lines to stdout directly.
    const write = process.stdout.write.bind(process.stdout) as (...args: unknown[]) => boolean;
    process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk === 'string' && NEXT_NOISE.test(chunk.replace(/\u001b\[[0-9;]*m/g, ''))) {
        const callback = rest.find((arg) => typeof arg === 'function') as (() => void) | undefined;
        callback?.();
        return true;
      }
      return write(chunk, ...rest);
    }) as typeof process.stdout.write;
  }
}

/** Requests the guard lets through: the workshop itself, loopback, and Next's own downloads. */
function isExempt(host: string | null | undefined, store: RenderStore): boolean {
  if (!host) return true;
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  try {
    if (new URL(store.origin).hostname === name) return true;
  } catch {
    // ignore
  }
  return name === 'localhost' || name === '127.0.0.1' || name === '::1' || FRAMEWORK_HOSTS.has(name);
}

let httpPatched = false;

/**
 * Surfaces requests made with `node:http`/`node:https` (axios, SDKs) during a story render. They
 * cannot be mocked like `fetch`, but they are reported, and blocked in strict network mode.
 */
export function installHttpGuard(): void {
  if (httpPatched) return;
  httpPatched = true;
  for (const [protocol, mod] of [
    ['http:', http],
    ['https:', https],
  ] as const) {
    for (const method of ['request', 'get'] as const) {
      const original = mod[method].bind(mod) as (...args: unknown[]) => http.ClientRequest;
      (mod as unknown as Record<string, unknown>)[method] = (...args: unknown[]) => {
        const store = getStore();
        if (store && store.kind !== 'meta') {
          const [first, second] = args;
          const target =
            typeof first === 'string' || first instanceof URL ? new URL(String(first)) : (first as http.RequestOptions | undefined);
          const host = target instanceof URL ? target.host : (target?.hostname ?? target?.host);
          if (!isExempt(host, store)) {
            const href =
              target instanceof URL ? target.href : `${protocol}//${host ?? 'unknown'}${(target?.path as string | undefined) ?? ''}`;
            const verb = (
              (target instanceof URL ? (second as http.RequestOptions | undefined)?.method : target?.method) ?? 'GET'
            ).toUpperCase();
            store.emit({
              type: 'warning',
              warning: {
                type: 'unmocked-request',
                message: `Unmocked request (node:${protocol.slice(0, -1)}): ${verb} ${href}`,
                detail: { method: verb, url: href, via: `node:${protocol.slice(0, -1)}` },
              },
            });
            if (store.strictNetwork) {
              throw new Error(
                `[rsc-stories] Unmocked ${verb} ${href} via node:${protocol.slice(0, -1)} in strict network mode. Wrap the client in a module and mock it.`,
              );
            }
          }
        }
        return original(...args);
      };
    }
  }
}

/** Variables the runtime itself needs; never removed. */
const SYSTEM_ENV =
  /^(PATH|PATHEXT|HOME|USER|USERNAME|LOGNAME|SHELL|TERM|COLORTERM|TMPDIR|TEMP|TMP|LANG|LANGUAGE|LC_\w+|TZ|PWD|OLDPWD|HOSTNAME|NODE_\w+|NODE|npm_\w+|PNPM_\w+|COREPACK_\w+|CI|FORCE_COLOR|NO_COLOR|DEBUG|SystemRoot|SystemDrive|windir|ComSpec|APPDATA|LOCALAPPDATA|PROGRAMDATA|ProgramFiles.*|USERPROFILE|HOMEDRIVE|HOMEPATH|XDG_\w+|__NEXT\w*|NEXT_PRIVATE_\w+|NEXT_RUNTIME|NEXT_TELEMETRY_DISABLED|TURBOPACK\w*|__RSC_STORIES\w*|RSC_STORIES_\w+|__CF\w+|SSH_AUTH_SOCK|DISPLAY|WAYLAND_DISPLAY|EDITOR|VISUAL|PLAYWRIGHT_\w+)$/;

function matches(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern));
}

/**
 * Loads the host's `.env*` files, then removes every variable that is neither allowlisted nor
 * needed by the toolchain (NFR-5.1). Reads of removed variables during a story render are
 * reported as warnings so a missing mock is easy to spot.
 */
export function applyEnvAllowlist(root: string, allow: string[], dev: boolean): string[] {
  try {
    const require = createRequire(path.join(root, 'package.json'));
    const env = require('@next/env') as { loadEnvConfig: (dir: string, dev?: boolean) => unknown };
    env.loadEnvConfig(root, dev);
  } catch {
    // @next/env ships with next; missing only in unusual installs. Shell variables still apply.
  }
  const removed: string[] = [];
  for (const name of Object.keys(process.env)) {
    if (SYSTEM_ENV.test(name) || matches(name, allow)) continue;
    removed.push(name);
    delete process.env[name];
  }
  const blocked = new Set(removed);
  const original = process.env;
  process.env = new Proxy(original, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && blocked.has(prop) && !(prop in target)) {
        const store = getStore();
        if (store && store.kind !== 'meta') {
          store.emit({
            type: 'warning',
            warning: {
              type: 'env-access',
              message: `process.env.${prop} was read but is not in the env allowlist (config.env.allow), so it is undefined in stories.`,
            },
          });
        }
      }
      return Reflect.get(target, prop, receiver);
    },
    // process.env only accepts plain writable data properties; forwarded descriptors from a proxy
    // arrive incomplete, so write the value directly (bundler runtimes define env entries).
    defineProperty(target, prop, descriptor) {
      if (typeof prop !== 'string') return false;
      if ('value' in descriptor) target[prop] = String(descriptor.value);
      else if (descriptor.get) target[prop] = String(descriptor.get());
      return true;
    },
    set(target, prop, value) {
      if (typeof prop !== 'string') return false;
      target[prop] = String(value);
      return true;
    },
  });
  return removed;
}
