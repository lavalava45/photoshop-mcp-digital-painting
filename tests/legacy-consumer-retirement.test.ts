import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

const retiredConsumerTokens = [
  'photoshop-session.mjs',
  'test-session-controller.mjs',
  'test-controller-cycle.mjs',
  'test-stage-a-e2e.mjs',
  'test-stage-c-ux.mjs',
  'test-stage-d-acceptance.mjs',
  'test-mcp-daemon.mjs',
];

const historicalFixtures = [
  'scripts/test-session-controller.mjs',
  'scripts/test-controller-cycle.mjs',
  'scripts/test-stage-a-e2e.mjs',
  'scripts/test-stage-c-ux.mjs',
  'scripts/test-stage-d-acceptance.mjs',
  'scripts/test-mcp-daemon.mjs',
  'scripts/test-layer-api-live.mjs',
  'scripts/test-paint-coordinate-dpi-live.mjs',
  'scripts/test-protected-layer-live.mjs',
];

describe('legacy maintained-consumer retirement', () => {
  it('keeps every maintained package test command on the compact/native path', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const maintainedTests = Object.entries(pkg.scripts ?? {})
      .filter(([name]) => name === 'test:acceptance' || name.startsWith('test:'));

    for (const [name, command] of maintainedTests) {
      for (const token of retiredConsumerTokens) {
        expect(command, `${name} must not invoke retired consumer ${token}`).not.toContain(token);
      }
    }
  });

  it('labels retained legacy controller/daemon fixtures as historical instead of maintained acceptance', () => {
    for (const relative of historicalFixtures) {
      const source = readFileSync(path.join(root, relative), 'utf8');
      expect(source.slice(0, 300), `${relative} must declare its historical-only status`)
        .toMatch(/HISTORICAL LEGACY .*not (?:part of|a) maintained acceptance/i);
    }
  });
});
