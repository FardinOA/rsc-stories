// `react-server` build of `rsc-stories/test`. Story files are evaluated on the server to render
// stories, so their play-function imports must load there without pulling in DOM libraries. Play
// functions themselves only ever run in the canvas.
import type { CanvasQueries } from '../types';
import type { ExpectStatic, TestingRuntime } from './index';

export { fn } from '../helpers';

function browserOnly(name: string): never {
  throw new Error(`${name} from rsc-stories/test only works inside a play function in the canvas.`);
}

// Same types as the browser build: either may be picked by a type checker.
export function within(_element: HTMLElement): CanvasQueries {
  return browserOnly('within');
}

export function waitFor<T>(_callback: () => T | Promise<T>, _options?: { timeout?: number; interval?: number }): Promise<T> {
  return browserOnly('waitFor');
}

const stub = (name: string) =>
  new Proxy(function stub() {}, {
    get: () => () => browserOnly(name),
    apply: () => browserOnly(name),
  });

export const userEvent = stub('userEvent') as unknown as TestingRuntime['userEvent'];
export const screen = stub('screen') as unknown as CanvasQueries;
export const expect = stub('expect') as unknown as ExpectStatic;
