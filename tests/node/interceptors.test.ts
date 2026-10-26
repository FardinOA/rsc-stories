import http from 'node:http';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { applyEnvAllowlist, installConsoleCapture, installHttpGuard } from '../../src/node/server/interceptors';
import { makeStore, storage } from '../helpers/store';
import { tempProject } from '../helpers/project';

describe('environment allowlist (NFR-5.1)', () => {
  const saved = { ...process.env };
  afterAll(() => {
    process.env = saved;
  });

  it('removes non-allowlisted variables, keeps toolchain ones, warns on reads in stories', async () => {
    const root = await tempProject({ '.env': 'SECRET_FROM_FILE=s3cr3t\nNEXT_PUBLIC_API=https://api.test\n' });
    process.env.MY_TOKEN = 'abc';
    process.env.ALLOWED_ONE = 'yes';
    const removed = applyEnvAllowlist(root, ['NEXT_PUBLIC_*', 'ALLOWED_ONE'], true);
    expect(removed).toEqual(expect.arrayContaining(['MY_TOKEN', 'SECRET_FROM_FILE']));
    expect(process.env.MY_TOKEN).toBeUndefined();
    expect(process.env.NEXT_PUBLIC_API).toBe('https://api.test');
    expect(process.env.ALLOWED_ONE).toBe('yes');
    expect(process.env.PATH).toBeTruthy();
    const store = makeStore();
    storage.run(store, () => {
      expect(process.env.SECRET_FROM_FILE).toBeUndefined();
    });
    expect(store.events[0]).toMatchObject({ type: 'warning', warning: { type: 'env-access' } });
    // Bundler runtimes define env entries; the proxy must accept that.
    Object.defineProperty(process.env, 'TURBOPACK_TEST', { value: '1', configurable: true, enumerable: true, writable: true });
    process.env.SET_LATER = 'x';
    expect(process.env.TURBOPACK_TEST).toBe('1');
    expect(process.env.SET_LATER).toBe('x');
  });
});

describe('console and http capture (FR-4.6, FR-3.6)', () => {
  it('attributes console output to the render and hides mocked navigation noise', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    installConsoleCapture();
    const store = makeStore();
    storage.run(store, () => {
      console.log('hello', { a: 1 });
      console.error('Error: RSC_STORIES_NAV;redirect;/x;');
      console.log(' GET /rsc-stories/canvas/x 200 in 5ms');
    });
    console.log('outside');
    write.mockRestore();
    const logs = store.events.filter((e) => e.type === 'log');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ entry: { origin: 'server', level: 'log', message: 'hello { a: 1 }' } });
  });

  it('reports node:http requests during stories and blocks them in strict mode', () => {
    installHttpGuard();
    const store = makeStore();
    storage.run(store, () => {
      const req = http.request('http://example.invalid/data');
      req.on('error', () => {});
      req.destroy();
      const local = http.request({ hostname: 'localhost', port: 1, path: '/' });
      local.on('error', () => {});
      local.destroy();
    });
    expect(store.events.filter((e) => e.type === 'warning')).toHaveLength(1);
    const strict = makeStore({ strictNetwork: true });
    storage.run(strict, () => {
      expect(() => http.get({ hostname: 'example.invalid', path: '/x' })).toThrow(/strict network mode/);
    });
  });
});
