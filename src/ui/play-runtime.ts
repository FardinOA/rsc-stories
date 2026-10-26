// Loaded into the canvas on demand before a play function runs. Bundles the testing helpers so
// projects do not need them installed; `rsc-stories/test` forwards to `window.__RSC_STORIES_TEST__`.
import { screen, waitFor, within } from '@testing-library/dom';
import * as matchers from '@testing-library/jest-dom/matchers';
import { userEvent } from '@testing-library/user-event';
import { JestAsymmetricMatchers, JestChaiExpect, JestExtend } from '@vitest/expect';
import * as chai from 'chai';

chai.use(JestExtend);
chai.use(JestChaiExpect);
chai.use(JestAsymmetricMatchers);

const expect = ((value: unknown, message?: string) => chai.expect(value, message)) as ((value: unknown, message?: string) => unknown) &
  Record<string, unknown>;
Object.assign(expect, chai.expect);
(expect as unknown as { extend: (m: unknown) => void }).extend = (m: unknown) =>
  (chai.expect as unknown as { extend: (e: unknown, m: unknown) => void }).extend(expect, m);
(expect as unknown as { extend: (m: unknown) => void }).extend(matchers);

(window as unknown as { __RSC_STORIES_TEST__: unknown }).__RSC_STORIES_TEST__ = {
  within,
  screen,
  waitFor,
  userEvent,
  expect,
};
