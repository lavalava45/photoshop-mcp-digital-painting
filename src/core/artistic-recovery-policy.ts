export type RecoveryKind = 'technical_uncertainty' | 'artistic_unresolved' | 'critic_alarm' | 'diagnostic_complete';

export interface RecoveryAttempt {
  strategy_id: string;
  materially_corrected: boolean;
  useful_partial_work?: boolean;
  failed: boolean;
}

export interface RecoveryFacts {
  kind: RecoveryKind;
  attempts?: RecoveryAttempt[];
  technical_reconciliation_complete?: boolean;
  dependent_work_remaining?: boolean;
  independent_tasks_available?: boolean;
  critic_alarm_evidence?: {
    anchor_operation_id?: string;
    anchor_sha256?: string;
    observation_operation_id?: string;
    observation_sha256?: string;
    observed_counterevidence?: string;
    evidence_verified?: boolean;
  };
}

export type RecoveryDecision =
  | 'reconcile_technical_state'
  | 'retry_same_strategy_once'
  | 'require_distinct_strategy'
  | 'block_dependent_problem'
  | 'continue_independent_work'
  | 'ignore_false_alarm'
  | 'diagnostic_complete'
  | 'no_retry_needed';

export interface ArtisticRecoveryResolution {
  decision: RecoveryDecision;
  preserve_useful_partial_work: boolean;
  goal_achieved: false;
  retry_allowed: boolean;
  distinct_strategy_required: boolean;
  blocker?: string;
}

function failedAttempts(attempts: RecoveryAttempt[]): RecoveryAttempt[] {
  return attempts.filter(attempt => attempt.failed);
}

export function resolveArtisticRecovery(facts: RecoveryFacts): ArtisticRecoveryResolution {
  const attempts = facts.attempts ?? [];
  const failures = failedAttempts(attempts);
  const preserveUsefulPartialWork = attempts.some(attempt => attempt.useful_partial_work === true);

  if (facts.kind === 'technical_uncertainty') {
    return {
      decision: facts.technical_reconciliation_complete ? 'no_retry_needed' : 'reconcile_technical_state',
      preserve_useful_partial_work: preserveUsefulPartialWork,
      goal_achieved: false,
      retry_allowed: false,
      distinct_strategy_required: false,
    };
  }

  if (facts.kind === 'diagnostic_complete') {
    return {
      decision: 'diagnostic_complete',
      preserve_useful_partial_work: preserveUsefulPartialWork,
      goal_achieved: false,
      retry_allowed: false,
      distinct_strategy_required: false,
    };
  }

  if (facts.kind === 'critic_alarm') {
    const evidence = facts.critic_alarm_evidence;
    const hasEvidence = Boolean(
      evidence?.evidence_verified === true
      && evidence.anchor_operation_id
      && evidence.anchor_sha256
      && evidence.observation_operation_id
      && evidence.observation_sha256
      && evidence.observed_counterevidence
      && evidence.observed_counterevidence.trim().length >= 8
    );
    if (hasEvidence) {
      return {
        decision: 'ignore_false_alarm',
        preserve_useful_partial_work: preserveUsefulPartialWork,
        goal_achieved: false,
        retry_allowed: false,
        distinct_strategy_required: false,
      };
    }
    return {
      decision: failures.length === 0 ? 'retry_same_strategy_once' : 'require_distinct_strategy',
      preserve_useful_partial_work: preserveUsefulPartialWork,
      goal_achieved: false,
      retry_allowed: true,
      distinct_strategy_required: failures.length > 0,
    };
  }

  if (failures.length === 0) {
    return {
      decision: 'retry_same_strategy_once',
      preserve_useful_partial_work: preserveUsefulPartialWork,
      goal_achieved: false,
      retry_allowed: true,
      distinct_strategy_required: false,
    };
  }

  const strategyIds = [...new Set(failures.map(attempt => attempt.strategy_id))];
  const sameStrategyFailures = failures.filter(attempt => attempt.strategy_id === failures[0]?.strategy_id);
  if (strategyIds.length === 1 && sameStrategyFailures.length === 1) {
    if (sameStrategyFailures[0]?.materially_corrected !== true) {
      return {
        decision: 'retry_same_strategy_once',
        preserve_useful_partial_work: preserveUsefulPartialWork,
        goal_achieved: false,
        retry_allowed: true,
        distinct_strategy_required: false,
      };
    }
    return {
      decision: 'require_distinct_strategy',
      preserve_useful_partial_work: preserveUsefulPartialWork,
      goal_achieved: false,
      retry_allowed: true,
      distinct_strategy_required: true,
    };
  }

  if (strategyIds.length >= 2) {
    if (facts.independent_tasks_available === true) {
      return {
        decision: 'continue_independent_work',
        preserve_useful_partial_work: true,
        goal_achieved: false,
        retry_allowed: false,
        distinct_strategy_required: false,
        blocker: facts.dependent_work_remaining === true
          ? 'Dependent artistic problem exhausted two causally distinct failed strategies; continue only independent tasks.'
          : undefined,
      };
    }
    return {
      decision: 'block_dependent_problem',
      preserve_useful_partial_work: preserveUsefulPartialWork,
      goal_achieved: false,
      retry_allowed: false,
      distinct_strategy_required: false,
      blocker: 'Dependent artistic problem exhausted two causally distinct failed strategies.',
    };
  }

  return {
    decision: 'require_distinct_strategy',
    preserve_useful_partial_work: preserveUsefulPartialWork,
    goal_achieved: false,
    retry_allowed: true,
    distinct_strategy_required: true,
  };
}
