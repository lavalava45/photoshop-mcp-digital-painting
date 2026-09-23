import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/core/guard/session-store.js';
import {
  normalizeRefinementCheck,
  REFINEMENT_CRITERIA,
} from '../src/core/refinement-check.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function store() {
  const dir = mkdtempSync(path.join(tmpdir(), 'refinement-check-'));
  dirs.push(dir);
  return new SessionStore(path.join(dir, 'controller'), {
    visualBarrierDirectory: path.join(dir, 'barriers'),
  });
}

function criteria(overrides: Record<string, string> = {}) {
  return Object.fromEntries(REFINEMENT_CRITERIA.map(key => [
    key,
    {
      status: overrides[key] ?? (key === 'selective_detail' ? 'not-applicable' : 'resolved'),
      note: `${key} fixture observation`,
    },
  ]));
}

function passingRefinement(operationId = 'form-frame', sha = 'a'.repeat(64)) {
  return {
    status: 'pass',
    observed: true,
    preview_sha256: sha,
    evidence_operation_id: operationId,
    representation_change: 'meaningful',
    criteria: criteria(),
    confidence: 0.85,
    limitations: [],
  };
}

function directive(refinementCheck: Record<string, unknown>) {
  return {
    directive_id: 'refinement-directive',
    composition_freedom: 'fixed',
    goal: 'Advance from modelled form to selective detail without preserving temporary block-in geometry.',
    artistic_evaluation_contract: {
      contract_id: 'refinement-contract',
      revision: 1,
      positive_criteria: ['Large and secondary forms are modelled before selective detail.'],
      failure_signals: ['Texture or small marks increase while lower-frequency form debt remains.'],
      protected_qualities: ['coherent whole-image structure'],
      stage_transition_expectations: ['DETAIL begins only after durable progressive-refinement evidence passes.'],
      final_evidence_requirements: ['Use the exact current frame for refinement judgement.'],
      provenance: [{ source: 'task-23-fixture', detail: 'Generic controlled representation-transition fixture.' }],
    },
    style_contract: {
      realism_level: 'materially modelled representational target',
      edge_policy: 'intentional hard/firm/soft/lost/broken hierarchy',
      material_treatment: 'surface response follows form and light rather than texture noise',
      detail_density: 'selective focal detail only after lower-frequency structure is resolved',
      primitive_footprint_tolerance: 'temporary block-in primitives should not dominate the finished representation',
    },
    composition_exploration: { hypotheses: [] },
    assessment: {
      composition: 'Stable.',
      focal_hierarchy: 'Stable.',
      large_value_masses: 'Stable.',
      lighting: 'Coherent.',
      silhouette: 'Readable.',
      depth: 'Readable.',
      likeness_main_shape: 'Stable.',
      overall_detail_level: 'Form stage before detail.',
      mood: 'Stable.',
      color_relationships: 'Stable.',
      shape_language: 'Representational masses.',
      edge_hierarchy: 'Mixed by form and depth.',
      intentional_omission: 'Micro detail deferred.',
      next_priority: 'Resolve form debt before detail.',
    },
    value_check: {
      status: 'style-not-applicable',
      observed: false,
      applicability_reason: 'Task 23 fixture isolates refinement-gate mechanics from the independent grayscale Value Gate.',
      limitations: [],
    },
    refinement_check: refinementCheck,
    priorities: ['major form modelling', 'secondary forms', 'residual block-in'],
    review_after_microplans: 5,
    tasks: [{
      task_id: 'detail-pass',
      summary: 'Add only selective structurally useful detail.',
      region: 'focal-region',
      allowed_scales: ['detail', 'small'],
    }],
  };
}

function detailRequest() {
  return {
    id: 'detail-pass-1',
    tool: 'photoshop_execute_visual_microplan',
    args: {
      document_id: 42,
      planner_directive_id: 'refinement-directive',
      planner_task_id: 'detail-pass',
      painter_scope: 'local',
      change_domains: ['local-texture'],
      stage: 'DETAIL',
      scale: 'detail',
      region: 'focal-region',
      problem_id: 'selective-detail',
    },
    summary: 'Selective detail after form refinement.',
    purpose: 'Exercise Task 23 stage gate.',
    problem_id: 'selective-detail',
    stage: 'DETAIL',
    scale: 'detail',
  };
}

function seedCurrentVisualFrame(s: SessionStore, id = 'form-frame', sha = 'a'.repeat(64)) {
  s.write({
    id,
    tool: 'photoshop_execute_visual_microplan',
    args: { document_id: 42, stage: 'FORM_AND_LIGHT' },
    summary: 'Generic form refinement fixture',
    purpose: 'Provide exact current-frame evidence for Task 23',
    hash: 'hash-' + id,
    sequence: 1,
    created_at: new Date(1000).toISOString(),
    completed_at: new Date(1001).toISOString(),
    phase: 'completed',
    visual: true,
    failed: false,
    preview: { sha256: sha, document_id: 42 },
    verdict: { disposition: 'accept', verdict: 'improvement', at: new Date(1002).toISOString() },
  });
  s.updatePaintingState(42, current => ({
    ...current,
    current_frame: {
      operation_id: id,
      sha256: sha,
      accepted: true,
      acceptance_scope: 'pixels_retained_not_goal_confirmation',
      goal_confirmation: 'unresolved',
    },
  }));
}

describe('Task 23 progressive refinement contract', () => {
  it('accepts meaningful generic form refinement evidence', () => {
    expect(normalizeRefinementCheck(passingRefinement())).toMatchObject({
      status: 'pass',
      representation_change: 'meaningful',
    });
  });

  it('rejects texture-only pseudo-refinement even when every criterion is claimed resolved', () => {
    expect(() => normalizeRefinementCheck({
      ...passingRefinement(),
      representation_change: 'texture-only',
    })).toThrow(/representation_change=meaningful/);
  });

  it('rejects a pass while major or secondary form debt remains', () => {
    expect(() => normalizeRefinementCheck({
      ...passingRefinement(),
      criteria: criteria({ secondary_forms: 'debt' }),
    })).toThrow(/lower-frequency refinement debt.*secondary_forms/i);
  });

  it('rejects a pass while residual block-in geometry remains unresolved', () => {
    expect(() => normalizeRefinementCheck({
      ...passingRefinement(),
      criteria: criteria({ residual_block_in: 'uncertain' }),
    })).toThrow(/lower-frequency refinement debt.*residual_block_in/i);
  });

  it('permits explicit stylized control only when it is anchored to an exact style-contract criterion', () => {
    const s = store();
    expect(() => s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: {
        ...directive({
          status: 'style-not-applicable',
          observed: false,
          applicability_reason: 'The declared flat graphic treatment intentionally preserves simplified planar representation.',
          style_contract_basis: {
            field: 'primitive_footprint_tolerance',
            criterion: 'temporary block-in primitives should not dominate the finished representation',
          },
        }),
        style_contract: {
          realism_level: 'intentionally flat graphic treatment',
          edge_policy: 'clean hard graphic contours',
          detail_density: 'minimal',
          primitive_footprint_tolerance: 'intentional flat primitives are part of the final graphic language',
        },
      },
    })).toThrow(/exactly match/);

    const stylized = directive({
      status: 'style-not-applicable',
      observed: false,
      applicability_reason: 'The declared flat graphic treatment intentionally preserves simplified planar representation.',
      style_contract_basis: {
        field: 'primitive_footprint_tolerance',
        criterion: 'intentional flat primitives are part of the final graphic language',
      },
    });
    stylized.style_contract = {
      realism_level: 'intentionally flat graphic treatment',
      edge_policy: 'clean hard graphic contours',
      detail_density: 'minimal',
      primitive_footprint_tolerance: 'intentional flat primitives are part of the final graphic language',
    };
    expect(() => s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: stylized,
    })).not.toThrow();
    expect(() => s.plannerGate(42, detailRequest())).not.toThrow();
  });

  it('fails closed at DETAIL while refinement evidence is pending', () => {
    const s = store();
    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive({ status: 'pending', observed: false }),
    });
    expect(() => s.plannerGate(42, detailRequest())).toThrow(/refinement_check_required/);
  });

  it('blocks DETAIL for durable texture-only/form debt and admits it after a current-frame pass', () => {
    const s = store();
    seedCurrentVisualFrame(s);
    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive({
        status: 'fail',
        observed: true,
        preview_sha256: 'a'.repeat(64),
        evidence_operation_id: 'form-frame',
        representation_change: 'texture-only',
        criteria: criteria({ major_form_modelling: 'debt', secondary_forms: 'debt' }),
        confidence: 0.9,
      }),
    });
    expect(() => s.plannerGate(42, detailRequest())).toThrow(/refinement_debt_unresolved/);

    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive(passingRefinement()),
    });
    expect(() => s.plannerGate(42, detailRequest())).not.toThrow();
  });

  it('rejects stale refinement evidence after the current frame changes', () => {
    const s = store();
    seedCurrentVisualFrame(s);
    s.updatePaintingState(42, current => ({
      ...current,
      current_frame: {
        ...current.current_frame,
        operation_id: 'newer-frame',
        sha256: 'b'.repeat(64),
      },
    }));
    expect(() => s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive(passingRefinement()),
    })).toThrow(/stale|current document frame/);
  });

  it('persists the same refinement gate state across a SessionStore restart', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'refinement-restart-'));
    dirs.push(dir);
    const controllerDir = path.join(dir, 'controller');
    const options = { visualBarrierDirectory: path.join(dir, 'barriers') };
    const first = new SessionStore(controllerDir, options);
    seedCurrentVisualFrame(first);
    first.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive(passingRefinement()),
    });
    const before = first.paintingState().documents['42'].art_director.refinement_check;

    const second = new SessionStore(controllerDir, options);
    const after = second.paintingState().documents['42'].art_director.refinement_check;
    expect(after).toEqual(before);
    expect(() => second.plannerGate(42, detailRequest())).not.toThrow();
  });

  it('contains no subject-specific implementation conditions in the refinement contract module', async () => {
    const source = await import('node:fs/promises').then(fs =>
      fs.readFile(new URL('../src/core/refinement-check.ts', import.meta.url), 'utf8')
    );
    for (const forbidden of ['horse', 'face', 'hand', 'car', 'house']) {
      expect(source.toLowerCase()).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});
