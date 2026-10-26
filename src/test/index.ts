// Browser build of `rsc-stories/test`. Play functions run in the canvas, where the workshop loads a
// prebuilt runtime (Testing Library, user-event, expect) onto `window.__RSC_STORIES_TEST__` before
// importing the story's play module. This module forwards to it.
import type { CanvasQueries, UserEventApi } from '../types';

export { fn } from '../helpers';

/** The helpers the play runtime provides. */
export interface TestingRuntime {
  within(element: HTMLElement): CanvasQueries;
  userEvent: UserEventApi & { setup(options?: Record<string, unknown>): UserEventApi };
  expect: ExpectStatic;
  waitFor<T>(callback: () => T | Promise<T>, options?: { timeout?: number; interval?: number }): Promise<T>;
  screen: CanvasQueries;
}

/** Jest-compatible `expect` (Vitest's implementation, with Testing Library DOM matchers). */
export interface ExpectStatic {
  (actual: unknown, message?: string): Matchers;
  extend(matchers: Record<string, unknown>): void;
  any(constructor: unknown): unknown;
  objectContaining(object: Record<string, unknown>): unknown;
  stringContaining(text: string): unknown;
}

/** The matchers stories use most; the runtime supports the full Jest/Vitest set. */
export interface Matchers {
  not: Matchers;
  resolves: Matchers;
  rejects: Matchers;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeDefined(): void;
  toContain(item: unknown): void;
  toHaveLength(length: number): void;
  toMatch(pattern: string | RegExp): void;
  toThrow(message?: string | RegExp): void;
  toHaveBeenCalled(): void;
  toHaveBeenCalledTimes(times: number): void;
  toHaveBeenCalledWith(...args: unknown[]): void;
  toBeInTheDocument(): void;
  toBeVisible(): void;
  toBeDisabled(): void;
  toBeEnabled(): void;
  toHaveTextContent(text: string | RegExp): void;
  toHaveAttribute(name: string, value?: string): void;
  toHaveValue(value: unknown): void;
  toHaveFocus(): void;
  [matcher: string]: unknown;
}

function runtime(): TestingRuntime {
  const testing =
    typeof window === 'undefined' ? undefined : (window as typeof window & { __RSC_STORIES_TEST__?: TestingRuntime }).__RSC_STORIES_TEST__;
  if (!testing) {
    throw new Error('rsc-stories/test helpers are only available inside a play function running in the workshop canvas.');
  }
  return testing;
}

/** Testing Library queries bound to an element. */
export function within(element: HTMLElement): CanvasQueries {
  return runtime().within(element);
}

/** Waits until the callback stops throwing. */
export function waitFor<T>(callback: () => T | Promise<T>, options?: { timeout?: number; interval?: number }): Promise<T> {
  return runtime().waitFor(callback, options);
}

/** `@testing-library/user-event`. */
export const userEvent: TestingRuntime['userEvent'] = new Proxy({} as TestingRuntime['userEvent'], {
  get: (_target, prop) => Reflect.get(runtime().userEvent, prop) as unknown,
});

/** Document-wide Testing Library queries. */
export const screen: CanvasQueries = new Proxy({} as CanvasQueries, {
  get: (_target, prop) => Reflect.get(runtime().screen, prop) as unknown,
});

/** Jest-compatible assertions. */
export const expect: ExpectStatic = new Proxy(function expect() {} as unknown as ExpectStatic, {
  apply: (_target, _this, args: [unknown, string?]) => runtime().expect(...args),
  get: (_target, prop) => Reflect.get(runtime().expect, prop) as unknown,
});
