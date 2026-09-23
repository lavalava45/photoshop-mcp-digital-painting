import { describe, expect, it } from 'vitest';
import manifest from './fixtures/task8a-heldout-manifest.json';
import {
  buildRunnableEvaluationPlan,
  criticPacketForCase,
  labeledCaseIds,
  pendingCaseIds,
  scoreCompletedCalibration,
  validateManifest,
} from '../scripts/task8a-calibration.mjs';

describe('Task 8/8a held-out calibration infrastructure', () => {
  it('has neutral ids/filenames, existing sources, balanced equal evidence budget, and no producer narrative in critic packets', () => {
    expect(validateManifest(manifest)).toEqual([]);
    expect(manifest.evidence_budget.baseline).toEqual(manifest.evidence_budget.critic);
    expect(manifest.evidence_budget.producer_reports_withheld).toBe(true);
    expect(manifest.evidence_budget.producer_verdicts_withheld).toBe(true);
    for (const item of manifest.cases) {
      const packet = criticPacketForCase(item);
      expect(Object.keys(packet).sort()).toEqual([
        'after_filename',
        'before_filename',
        'brief',
        'case_id',
        'pass_goal',
        'preservation_constraints',
      ]);
      expect(JSON.stringify(packet)).not.toContain('sampling_stratum');
      expect(JSON.stringify(packet)).not.toContain('source_notes');
      expect(JSON.stringify(packet)).not.toMatch(/producer|verdict|improvement_candidate|regression_candidate/);
    }
  });

  it('covers required held-out strata without converting them into human truth', () => {
    const strata = new Set(manifest.cases.map(item => item.sampling_stratum));
    expect(strata.has('acceptable_unfinished_candidate')).toBe(true);
    expect(strata.has('improvement_candidate')).toBe(true);
    expect(strata.has('regression_candidate')).toBe(true);
    expect(strata.has('ambiguous_tradeoff_candidate')).toBe(true);
    expect(strata.has('identical_pair_control')).toBe(true);
    expect(strata.has('explicit_surreal_negative_control')).toBe(true);
    expect(new Set(manifest.cases.map(item => item.subject_style)).size).toBeGreaterThanOrEqual(7);
    expect(manifest.cases.every(item => item.human_reference === null)).toBe(true);
  });

  it('keeps pending-label cases out of any runnable critic plan', () => {
    const emptyHuman = { references: {} };
    expect(labeledCaseIds(manifest, emptyHuman)).toEqual([]);
    expect(pendingCaseIds(manifest, emptyHuman)).toEqual(manifest.cases.map(item => item.case_id));
    expect(buildRunnableEvaluationPlan(manifest, emptyHuman)).toEqual({ baseline: [], critic: [] });
  });

  it('supports balanced order and repeated subset for later consistency checks', () => {
    expect(manifest.orders.baseline).toHaveLength(manifest.orders.critic.length);
    expect([...manifest.orders.baseline].sort()).toEqual([...manifest.orders.critic].sort());
    expect(manifest.repeats.map(item => item.case_id).sort()).toEqual(['case-003', 'case-007']);
  });

  it('only emits labeled cases into a future evaluation plan', () => {
    const human = {
      references: {
        'case-001': {
          status: 'complete',
          finding_expected: false,
          ambiguity_expected: false,
          useful_action: 'keep'
        }
      }
    };
    const plan = buildRunnableEvaluationPlan(manifest, human);
    expect(plan.baseline.map(row => row.packet.case_id)).toEqual(['case-001']);
    expect(plan.critic.map(row => row.packet.case_id)).toEqual(['case-001']);
  });

  it('refuses scoring until all human references are complete', () => {
    expect(() => scoreCompletedCalibration(
      manifest,
      { references: {} },
      { baseline: [], critic: [] },
    )).toThrow(/human references incomplete/);
  });

  it('later scores detections, false alarms, abstentions, usefulness and latency without ranking', () => {
    const references: Record<string, {
      status: string;
      finding_expected: boolean;
      ambiguity_expected: boolean;
      useful_action: string;
    }> = {};
    for (const item of manifest.cases) {
      references[item.case_id] = {
        status: 'complete',
        finding_expected: item.case_id === 'case-003',
        ambiguity_expected: item.case_id === 'case-004',
        useful_action: item.case_id === 'case-003' ? 'rollback' : 'keep',
      };
    }
    const results = {
      baseline: [
        { case_id: 'case-003', decision: 'finding', suggested_action: 'rollback', latency_ms: 10 },
        { case_id: 'case-004', decision: 'abstain', suggested_action: 'keep', latency_ms: 20 },
      ],
      critic: [
        { case_id: 'case-003', decision: 'finding', suggested_action: 'rollback', latency_ms: 12 },
        { case_id: 'case-004', decision: 'finding', suggested_action: 'keep', latency_ms: 18 },
      ],
    };
    const scored = scoreCompletedCalibration(manifest, { references }, results);
    expect(scored.baseline).toMatchObject({
      true_detections: 1,
      false_alarms: 0,
      abstentions: 1,
      appropriate_abstentions: 1,
      usefulness: { action_matches: 2, eligible: 2 },
      latency: { total_ms: 30, mean_ms: 15 },
    });
    expect(scored.critic).toMatchObject({
      true_detections: 1,
      false_alarms: 1,
      abstentions: 0,
      usefulness: { action_matches: 2, eligible: 2 },
      latency: { total_ms: 30, mean_ms: 15 },
    });
    expect(JSON.stringify(scored)).not.toMatch(/rank|winner|best/);
  });
});
