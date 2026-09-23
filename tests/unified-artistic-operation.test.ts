import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/core/guard/session-store.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function store() {
  const dir = mkdtempSync(path.join(tmpdir(), 'art-op-contract-'));
  dirs.push(dir);
  return new SessionStore(path.join(dir, 'controller'), {
    visualBarrierDirectory: path.join(dir, 'barriers'),
  });
}

function directive() {
  return {
    directive_id: 'unified-operation',
    composition_freedom: 'fixed',
    goal: 'Exercise one bounded artistic operation under the active directive.',
    artistic_evaluation_contract: {
      contract_id: 'unified-operation-contract',
      revision: 1,
      positive_criteria: ['The bounded operation improves its declared local target without changing composition.'],
      failure_signals: ['The operation changes unrelated structure or leaves its declared target unresolved.'],
      protected_qualities: ['overall composition', 'primary subject hierarchy'],
      stage_transition_expectations: ['FORM_AND_LIGHT remains locally bounded until the declared target is resolved.'],
      final_evidence_requirements: ['Inspect the exact resulting frame under the same directive before claiming resolution.'],
      provenance: [{ source: 'test-directive', detail: 'Synthetic fixture derived directly from the directive goal and protected composition constraints.' }],
    },
    style_contract: {
      edge_policy: 'selective edges',
      color_policy: 'preserve palette relationships',
      layer_or_mask_bias: 'prefer editable masks/layers where useful',
    },
    composition_exploration: { hypotheses: [] },
    assessment: {
      composition: 'Stable composition.',
      focal_hierarchy: 'Primary subject remains dominant.',
      large_value_masses: 'Major masses remain readable.',
      lighting: 'Lighting stays coherent.',
      silhouette: 'Silhouette remains readable.',
      depth: 'Depth order remains coherent.',
      likeness_main_shape: 'Main shape remains stable.',
      overall_detail_level: 'Detail remains selective.',
      mood: 'Mood remains restrained.',
      color_relationships: 'Color relationships remain coherent.',
      shape_language: 'Shape language remains consistent.',
      edge_hierarchy: 'Edge hierarchy remains intentional.',
      intentional_omission: 'Secondary detail remains omitted.',
      next_priority: 'Apply one bounded artistic operation.',
    },
    value_check: {
      status: 'style-not-applicable',
      observed: false,
      applicability_reason: 'Synthetic operation-routing fixture.',
      limitations: ['Does not exercise grayscale evidence.'],
    },
    refinement_check: {
      status: 'pending',
      observed: false,
      limitations: ['Synthetic operation-routing fixture; no DETAIL transition is exercised.'],
    },
    priorities: ['bounded operation'],
    review_after_microplans: 5,
    tasks: [{
      task_id: 'bounded-op',
      summary: 'Run one bounded edit without changing composition.',
      region: 'subject',
      allowed_scales: ['medium', 'small'],
      allowed_global_changes: [],
    }],
  };
}

function request(tool: string, args: Record<string, unknown>) {
  return {
    id: 'op-' + tool,
    tool,
    args: { document_id: 42, ...args },
    planner_directive_id: 'unified-operation',
    planner_task_id: 'bounded-op',
    painter_scope: 'medium',
    change_domains: ['local-tone'],
    stage: 'FORM_AND_LIGHT',
    scale: 'medium',
    problem_id: 'bounded-operation',
  };
}

describe('unified artistic-operation planner contract', () => {
  it.each([
    ['photoshop_adjust_curves', { preset: 'auto_tone' }],
    ['photoshop_create_layer_mask', { reveal_all: true }],
    ['photoshop_apply_gradient_mask', { start_x: 0, start_y: 0, end_x: 100, end_y: 100 }],
    ['photoshop_set_layer_blend_mode', { blend_mode: 'multiply' }],
    ['photoshop_move_layer', { delta_x: 4, delta_y: -2 }],
    ['photoshop_scale_layer', { width_percent: 101, height_percent: 101 }],
    ['photoshop_rotate_layer', { angle: 2 }],
  ])('admits directive-bound standalone %s and rejects the same unbound operation', (tool, args) => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive() });

    expect(() => s.plannerGate(42, request(tool, args))).not.toThrow();
    const unbound = request(tool, args) as Record<string, unknown>;
    delete unbound.planner_directive_id;
    expect(() => s.plannerGate(42, unbound)).toThrow(/painter_contract_gate/);
  });
});
