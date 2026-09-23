import { describe, expect, it } from 'vitest';
import {
  projectPaintingStagePolicy,
  serializePaintingStagePolicy,
} from '../src/core/painting-stage-policy.js';

describe('stage-scoped painting policy projection', () => {
  it('early block-in activates invariants plus recognition policy and excludes detail/final modules', () => {
    const policy = projectPaintingStagePolicy({ stage: 'RECOGNITION_BLOCK_IN' });
    expect(policy.activeModules).toEqual(['invariants', 'recognition_block_in']);
    expect(policy.activeModules).not.toContain('detail');
    expect(policy.activeModules).not.toContain('final_selection');
    expect(policy.compactPolicy.stage_rules.join(' ')).toMatch(/recognizability|large masses/i);
    expect(policy.compactPolicy.stage_rules.join(' ')).not.toMatch(/final selection|micro-detail.*after/i);
  });

  it('detail activates invariant plus detail only, not unrelated stage modules', () => {
    const policy = projectPaintingStagePolicy({ stage: 'DETAIL' });
    expect(policy.activeModules).toEqual(['invariants', 'detail']);
    expect(policy.activeModules).not.toEqual(expect.arrayContaining([
      'composition',
      'value_form',
      'edge_control',
      'material_texture',
      'final_selection',
    ]));
    expect(policy.compactPolicy.stage_rules.join(' ')).toMatch(/selective local detail/i);
  });

  it('final stage includes final-only criteria while preserving always-on invariants', () => {
    const policy = projectPaintingStagePolicy({ stage: 'FINAL_SELECTION' });
    expect(policy.activeModules).toEqual(['invariants', 'final_selection']);
    expect(policy.compactPolicy.invariant_rules.length).toBeGreaterThan(0);
    expect(policy.compactPolicy.stage_rules.join(' ')).toMatch(/whole painting|strongest artistic anchor|brief/i);
    expect(policy.compactPolicy.stage_rules.join(' ')).not.toMatch(/large masses|texture and material cues/i);
  });

  it('switching stages deterministically activates only the relevant module', () => {
    expect(projectPaintingStagePolicy({ stage: 'VALUE' }).activeModules)
      .toEqual(['invariants', 'value_form']);
    expect(projectPaintingStagePolicy({ stage: 'EDGE' }).activeModules)
      .toEqual(['invariants', 'edge_control']);
    expect(projectPaintingStagePolicy({ stage: 'MATERIAL' }).activeModules)
      .toEqual(['invariants', 'material_texture']);
  });

  it('same persisted facts reconstruct byte-identical policy after restart', () => {
    const persisted = {
      stage: 'DETAIL',
      recoveryActive: true,
      referenceMeasurementActive: false,
    };
    const beforeRestart = serializePaintingStagePolicy(persisted);
    const reconstructedFacts = JSON.parse(JSON.stringify(persisted));
    const afterRestart = serializePaintingStagePolicy(reconstructedFacts);
    expect(afterRestart).toBe(beforeRestart);
    expect(projectPaintingStagePolicy(reconstructedFacts).activeModules)
      .toEqual(['invariants', 'detail', 'recovery_diagnostics']);
  });

  it('unknown stage fails closed to invariant kernel plus explicit unknown marker', () => {
    const policy = projectPaintingStagePolicy({ stage: 'ALIEN_POLISH_STAGE' });
    expect(policy.unknownStage).toBe(true);
    expect(policy.activeModules).toEqual(['invariants']);
    expect(policy.compactPolicy.stage_rules).toEqual([]);
    expect(policy.compactPolicy.unknown_stage_marker).toBe(
      'UNKNOWN_STAGE:ALIEN_POLISH_STAGE; invariant kernel only',
    );
  });

  it('policy projection is compact and contains no later-stage detail rule during block-in', () => {
    const blockIn = serializePaintingStagePolicy({ stage: 'GLOBAL_BLOCK_IN' });
    const detail = serializePaintingStagePolicy({ stage: 'DETAIL' });
    expect(blockIn.length).toBeLessThan(detail.length + 1200);
    expect(blockIn).not.toContain('Add only selective local detail');
    expect(blockIn).not.toContain('Evaluate the whole painting against the brief');
  });

  it('materially reduces active context versus loading every stage module', () => {
    const stages = [
      'GLOBAL_BLOCK_IN',
      'COMPOSITION',
      'FORM_AND_LIGHT',
      'EDGE',
      'MATERIAL',
      'DETAIL',
      'FINAL_SELECTION',
      'RECOVERY',
    ];
    const projections = stages.map(stage => projectPaintingStagePolicy({ stage }));
    const allStageRules = [...new Set(projections.flatMap(policy => policy.compactPolicy.stage_rules))];
    const invariantRules = projections[0]!.compactPolicy.invariant_rules;
    const eagerFullContext = JSON.stringify({ invariant_rules: invariantRules, stage_rules: allStageRules });
    const ordinaryDetailContext = serializePaintingStagePolicy({ stage: 'DETAIL' });

    expect(ordinaryDetailContext.length).toBeLessThan(eagerFullContext.length * 0.65);
    expect(projectPaintingStagePolicy({ stage: 'DETAIL' }).activeModules)
      .toEqual(['invariants', 'detail']);
  });
});
