import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resetStaleDevState } from '../../src/node/next/host';
import type { Project } from '../../src/node/project';

describe('resetStaleDevState', () => {
  it('clears .next when the bundler or Next version changes, and only then', () => {
    const workshopDir = mkdtempSync(path.join(os.tmpdir(), 'host-'));
    const project = (bundler: string, version: string) => ({ workshopDir, bundler, next: { version } }) as unknown as Project;
    const leaveBuildState = () => {
      mkdirSync(path.join(workshopDir, '.next', 'dev'), { recursive: true });
      writeFileSync(path.join(workshopDir, '.next', 'dev', 'build-manifest.json'), '{}');
    };

    // A cache without a stamp may come from either bundler.
    leaveBuildState();
    expect(resetStaleDevState(project('turbopack', '16.4.3'))).toBe(true);
    expect(existsSync(path.join(workshopDir, '.next'))).toBe(false);

    leaveBuildState();
    expect(resetStaleDevState(project('turbopack', '16.4.3'))).toBe(false);
    expect(existsSync(path.join(workshopDir, '.next', 'dev', 'build-manifest.json'))).toBe(true);

    expect(resetStaleDevState(project('webpack', '16.4.3'))).toBe(true);
    leaveBuildState();
    expect(resetStaleDevState(project('webpack', '16.5.0'))).toBe(true);
  });
});
