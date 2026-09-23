import { describe, expect, it } from 'vitest';
import { executionTimeoutMs, withToolExecutionContext } from './execution-context.js';

describe('logical Photoshop execution deadline', () => {
  it('preserves the historical fallback without a logical deadline', () => {
    expect(executionTimeoutMs()).toBe(30_000);
    expect(executionTimeoutMs(1_234)).toBe(1_234);
  });

  it('clamps nested script timeouts to the remaining shared deadline', async () => {
    await withToolExecutionContext({ deadlineAt: Date.now() + 3_000 }, async () => {
      const inherited = executionTimeoutMs(undefined, 30_000, 0);
      expect(inherited).toBeGreaterThan(2_000);
      expect(inherited).toBeLessThanOrEqual(3_000);
      expect(executionTimeoutMs(500, 30_000, 0)).toBeLessThanOrEqual(500);
    });
  });

  it('fails before dispatch when the logical deadline is already exhausted', async () => {
    await withToolExecutionContext({ deadlineAt: Date.now() - 1 }, async () => {
      expect(() => executionTimeoutMs()).toThrow(/deadline exhausted.*not executed/i);
    });
  });
});
