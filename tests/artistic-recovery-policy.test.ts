import { describe, expect, it } from 'vitest';
import { resolveArtisticRecovery } from '../src/core/artistic-recovery-policy.js';

describe('resolveArtisticRecovery', () => {
  it('bounds repeated disagreement: one corrected same-strategy retry, then distinct strategy', () => {
    expect(resolveArtisticRecovery({
      kind: 'artistic_unresolved',
      attempts: [],
    })).toMatchObject({
      decision: 'retry_same_strategy_once',
      retry_allowed: true,
      distinct_strategy_required: false,
      goal_achieved: false,
    });

    expect(resolveArtisticRecovery({
      kind: 'artistic_unresolved',
      attempts: [{
        strategy_id: 'soft-edge-pass',
        materially_corrected: false,
        failed: true,
      }],
    })).toMatchObject({
      decision: 'retry_same_strategy_once',
      retry_allowed: true,
      distinct_strategy_required: false,
    });

    expect(resolveArtisticRecovery({
      kind: 'artistic_unresolved',
      attempts: [{
        strategy_id: 'soft-edge-pass',
        materially_corrected: true,
        failed: true,
      }],
    })).toMatchObject({
      decision: 'require_distinct_strategy',
      retry_allowed: true,
      distinct_strategy_required: true,
    });
  });

  it('ignores a false critic alarm only when anchor and current observation evidence were verified upstream', () => {
    expect(resolveArtisticRecovery({
      kind: 'critic_alarm',
      critic_alarm_evidence: {
        anchor_operation_id: 'anchor-42',
        anchor_sha256: 'a'.repeat(64),
        observation_operation_id: 'observation-43',
        observation_sha256: 'b'.repeat(64),
        observed_counterevidence: 'The protected silhouette and large-value grouping match the retained anchor.',
        evidence_verified: true,
      },
    }).decision).toBe('ignore_false_alarm');

    expect(resolveArtisticRecovery({
      kind: 'critic_alarm',
      critic_alarm_evidence: {
        anchor_operation_id: 'anchor-42',
        observed_counterevidence: 'Bare anchor id plus prose is not durable visual evidence.',
      },
    }).decision).not.toBe('ignore_false_alarm');

    expect(resolveArtisticRecovery({
      kind: 'critic_alarm',
    }).decision).not.toBe('ignore_false_alarm');
  });

  it('continues independent tasks after two causally distinct failures while preserving useful partial work', () => {
    const result = resolveArtisticRecovery({
      kind: 'artistic_unresolved',
      attempts: [
        {
          strategy_id: 'paint-value-repair',
          materially_corrected: true,
          useful_partial_work: true,
          failed: true,
        },
        {
          strategy_id: 'structural-mask-repair',
          materially_corrected: true,
          useful_partial_work: true,
          failed: true,
        },
      ],
      dependent_work_remaining: true,
      independent_tasks_available: true,
    });
    expect(result).toMatchObject({
      decision: 'continue_independent_work',
      preserve_useful_partial_work: true,
      retry_allowed: false,
      goal_achieved: false,
    });
    expect(result.blocker).toMatch(/two causally distinct failed strategies/);
  });

  it('returns an explicit blocker when dependency is exhausted and no independent task remains', () => {
    const result = resolveArtisticRecovery({
      kind: 'artistic_unresolved',
      attempts: [
        { strategy_id: 'strategy-a', materially_corrected: true, failed: true },
        { strategy_id: 'strategy-b', materially_corrected: true, failed: true },
      ],
      dependent_work_remaining: true,
      independent_tasks_available: false,
    });
    expect(result.decision).toBe('block_dependent_problem');
    expect(result.retry_allowed).toBe(false);
    expect(result.blocker).toMatch(/exhausted two causally distinct/);
    expect(result.goal_achieved).toBe(false);
  });

  it('completed diagnostics terminate without requiring a dummy mutation', () => {
    expect(resolveArtisticRecovery({
      kind: 'diagnostic_complete',
      attempts: [],
    })).toEqual({
      decision: 'diagnostic_complete',
      preserve_useful_partial_work: false,
      goal_achieved: false,
      retry_allowed: false,
      distinct_strategy_required: false,
    });
  });

  it('technical uncertainty never enters artistic retry policy before reconciliation', () => {
    expect(resolveArtisticRecovery({
      kind: 'technical_uncertainty',
      attempts: [{ strategy_id: 'any', materially_corrected: true, failed: true }],
      technical_reconciliation_complete: false,
    })).toMatchObject({
      decision: 'reconcile_technical_state',
      retry_allowed: false,
      distinct_strategy_required: false,
    });
  });

  it('finite termination is stable after two distinct failures', () => {
    const facts = {
      kind: 'artistic_unresolved' as const,
      attempts: [
        { strategy_id: 'a', materially_corrected: true, failed: true },
        { strategy_id: 'b', materially_corrected: true, failed: true },
      ],
      independent_tasks_available: false,
      dependent_work_remaining: true,
    };
    const first = resolveArtisticRecovery(facts);
    const second = resolveArtisticRecovery(facts);
    expect(second).toEqual(first);
    expect(second.decision).toBe('block_dependent_problem');
    expect(second.retry_allowed).toBe(false);
  });
});
