import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  guardExecutionClass,
  guardToolIsExecutable,
} from '../src/core/guard/execution-policy.js';

function inventoryTools(): string[] {
  const inventory = readFileSync(
    new URL('../docs/uxp-migration-inventory.md', import.meta.url),
    'utf8'
  );
  return [...inventory.matchAll(/^\| `(photoshop_[^`]+)`/gm)].map((match) => match[1]);
}

describe('Guard execution policy', () => {
  it('classifies every current atomic production tool explicitly instead of trusting registration', () => {
    const tools = inventoryTools();
    expect(tools.length).toBeGreaterThan(100);

    for (const tool of tools) {
      if (tool === 'photoshop_execute_script') {
        expect(guardExecutionClass(tool), tool).toBe('retired');
        expect(guardToolIsExecutable(tool), tool).toBe(false);
        continue;
      }
      if (tool.startsWith('photoshop_guard_') || tool.startsWith('photoshop_recipe_')) {
        expect(guardExecutionClass(tool), tool).toBe('forbidden');
        expect(guardToolIsExecutable(tool), tool).toBe(false);
        continue;
      }
      expect(guardExecutionClass(tool), tool).not.toBe('forbidden');
      expect(guardToolIsExecutable(tool), tool).toBe(true);
    }
  });

  it('default-denies newly registered/debug-looking names', () => {
    expect(guardExecutionClass('photoshop_debug_future_tool')).toBe('forbidden');
    expect(guardToolIsExecutable('photoshop_debug_future_tool')).toBe(false);
  });
});
