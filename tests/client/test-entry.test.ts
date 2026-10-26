// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as browser from '../../src/test/index';
import * as server from '../../src/test/server';

afterEach(() => {
  delete (window as { __RSC_STORIES_TEST__?: unknown }).__RSC_STORIES_TEST__;
});

describe('rsc-stories/test', () => {
  it('forwards to the play runtime in the canvas', async () => {
    const within = vi.fn(() => 'queries');
    const expectFn = Object.assign(
      vi.fn(() => 'assertion'),
      { extend: vi.fn() },
    );
    (window as { __RSC_STORIES_TEST__?: unknown }).__RSC_STORIES_TEST__ = {
      within,
      waitFor: vi.fn(async (cb: () => unknown) => cb()),
      userEvent: { click: vi.fn(async () => {}) },
      screen: { getByText: vi.fn(() => 'node') },
      expect: expectFn,
    };
    expect(browser.within(document.body)).toBe('queries');
    expect(await browser.waitFor(() => 1)).toBe(1);
    await browser.userEvent.click(document.body);
    expect(browser.screen.getByText('x')).toBe('node');
    expect(browser.expect(1)).toBe('assertion');
    browser.expect.extend({});
    expect(expectFn.extend).toHaveBeenCalled();
    expect(browser.fn()()).toBeUndefined();
  });

  it('explains when used outside the canvas', () => {
    expect(() => browser.within(document.body)).toThrow(/play function/);
  });

  it('has a server build that only stubs', () => {
    expect(() => server.within(document.body)).toThrow(/only works inside a play function/);
    expect(() => server.waitFor(() => 1)).toThrow();
    expect(() => (server.userEvent as unknown as { click(): void }).click()).toThrow();
    expect(() => server.expect(1)).toThrow();
    expect(server.fn()()).toBeUndefined();
  });
});
