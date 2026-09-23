import { describe, expect, it } from 'vitest';
import { median, runBenchmark, summarize } from '../scripts/dev/task19-cache-ab-benchmark.mjs';

describe('Task19 preparation-cache A/B benchmark harness', () => {
  it('computes deterministic medians', () => {
    expect(median([9, 1, 5])).toBe(5);
    expect(median([1, 3, 5, 7])).toBe(4);
    expect(summarize([
      { condition: 'cold', preparation_host_calls: 2, preparation_cache_events: [{ reason: 'miss_empty' }], guard_preflight_ms: 4, photoshop_dispatch_ms: 8, semantic_cycle_wall_ms: 20 },
      { condition: 'warm', preparation_host_calls: 0, preparation_cache_events: [{ reason: 'hit' }, { reason: 'hit' }], guard_preflight_ms: 3, photoshop_dispatch_ms: 8, semantic_cycle_wall_ms: 10 },
    ] as never[]).warm.preparation_host_calls_median).toBe(0);
  });

  it('runs three isolated child-process cold/warm pairs without Photoshop and observes real cache reuse', () => {
    const result = runBenchmark({ pairs: 3 });
    expect(result.rows).toHaveLength(6);
    expect(result.child_process_cold_reset).toBe(true);
    expect(new Set(result.child_pids).size).toBe(3);
    expect(result.safety).toMatchObject({ photoshop_invoked: false, artwork_mutation: false });
    const cold = result.rows.filter(row => row.condition === 'cold');
    const warm = result.rows.filter(row => row.condition === 'warm');
    expect(cold.every(row => row.preparation_host_calls === 2)).toBe(true);
    expect(warm.every(row => row.preparation_host_calls === 0)).toBe(true);
    expect(warm.every(row => row.preparation_cache_events.filter(event => event.reason === 'hit').length === 2)).toBe(true);
    expect(result.observed_improvement.preparation_host_calls).toBe(true);
    expect(result.observed_improvement.semantic_cycle_wall_ms).toBe(true);
  }, 30_000);
});
