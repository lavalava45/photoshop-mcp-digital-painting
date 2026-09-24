import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/core/guard/session-store.js';
import { parseVisualMicroPlan } from '../src/core/visual-microplan.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function store() {
  const dir = mkdtempSync(path.join(tmpdir(), 'planner-painter-'));
  dirs.push(dir);
  return storeAt(dir);
}

function storeAt(dir: string) {
  return new SessionStore(path.join(dir, 'controller'), {
    visualBarrierDirectory: path.join(dir, 'barriers'),
  });
}

function seedClassifiedFrame(
  s: SessionStore,
  id: string,
  sequence: number,
  options: { current?: boolean; accepted?: boolean } = { current: true, accepted: true }
) {
  const frameBytes = Buffer.from('planner-painter-frame:' + id);
  const framePath = path.join(s.directory, 'frames', id + '.jpg');
  mkdirSync(path.dirname(framePath), { recursive: true });
  writeFileSync(framePath, frameBytes);
  const frame = {
    operation_id: id,
    sha256: createHash('sha256').update(frameBytes).digest('hex'),
    path: framePath,
    accepted: options.accepted !== false,
    acceptance_scope: 'pixels_retained_not_goal_confirmation',
    goal_confirmation: 'unresolved',
  };
  s.write({
    id,
    tool: 'photoshop_set_layer_opacity',
    args: { document_id: 42, opacity: 50 },
    summary: 'Fixture ' + id,
    purpose: 'Provide classified artistic frame evidence for Planner tests',
    hash: 'hash-' + id,
    sequence,
    created_at: new Date(sequence * 1000).toISOString(),
    completed_at: new Date(sequence * 1000 + 1).toISOString(),
    phase: 'completed',
    visual: true,
    failed: false,
    preview: {
      sha256: frame.sha256,
      materialized_path: frame.path,
      document_id: 42,
    },
    verdict: {
      disposition: options.accepted === false ? 'correct' : 'accept',
      verdict: options.accepted === false ? 'neutral' : 'improvement',
      at: new Date(sequence * 1000 + 2).toISOString(),
    },
  });
  s.updatePaintingState(42, current => ({
    ...current,
    ...(options.current === false ? {} : { current_frame: frame }),
    ...(options.accepted === false ? {} : { accepted_frame: frame }),
  }));
  return frame;
}

function assessment() {
  return {
    composition: 'Stable centered portrait with enough breathing room.',
    focal_hierarchy: 'Face is primary, hands secondary, background tertiary.',
    large_value_masses: 'Face/light mass needs separation from dark coat and sea.',
    lighting: 'Warm key from upper left; shadow side should stay coherent.',
    silhouette: 'Head and shoulder silhouette is readable against the sea.',
    depth: 'Face forward, hands middle, boat and sea back.',
    likeness_main_shape: 'Main head proportions are stable and must not drift.',
    overall_detail_level: 'Medium development; avoid premature beard detail.',
    mood: 'Quiet, weathered, contemplative rather than theatrical.',
    color_relationships: 'Warm face accents against restrained cool sea and raincoat notes.',
    shape_language: 'Broad naturalistic masses with selective angular weathered accents.',
    edge_hierarchy: 'Hardest edges stay near the face and hands; background transitions remain soft or lost.',
    intentional_omission: 'Background detail and secondary texture stay understated to preserve focus.',
    next_priority: 'Strengthen the face focal hierarchy without moving major masses.',
  };
}

function passingValueCheck() {
  return {
    status: 'style-not-applicable',
    observed: false,
    applicability_reason: 'Planner/Painter unit tests isolate directive routing and do not exercise the separate grayscale evidence gate.',
    limitations: ['Synthetic controller test; value evidence is covered by value-check.test.ts.'],
  };
}

function directive(id = 'face-focus', reviewAfter = 3) {
  return {
    directive_id: id,
    goal: 'Strengthen the face as the primary focal center.',
    style_contract: {
      realism_level: 'naturalistic painterly realism',
      edge_policy: 'selective hard focal edges with soft/lost peripheral transitions',
      color_policy: 'restrained cool-warm harmony with warm focal accents',
      detail_density: 'high only near focal face and hands',
      finish_criteria: 'coherent expressive hierarchy without over-rendering the background',
    },
    artistic_evaluation_contract: {
      contract_id: 'synthetic-planner-brief-contract',
      revision: 1,
      positive_criteria: ['The focal hierarchy and requested local relationship must be visibly readable in the current frame.'],
      failure_signals: ['The requested relationship remains visually unresolved or is replaced by decorative detail.'],
      protected_qualities: ['Preserve the broader coherent composition while resolving the bounded task.'],
      stage_transition_expectations: ['Advance only when the current bounded representation problem is visibly resolved.'],
      final_evidence_requirements: ['Use the exact current full-frame evidence for final brief evaluation.'],
      provenance: [{ source: 'user_brief', detail: 'Synthetic planner fixture standing in for an open-ended user brief.' }],
    },
    composition_freedom: 'fixed',
    composition_exploration: { hypotheses: [] },
    assessment: assessment(),
    value_check: passingValueCheck(),
    refinement_check: {
      status: 'pending',
      observed: false,
      limitations: ['Synthetic Planner/Painter fixture; Task 23 gate is exercised in refinement-check.test.ts.'],
    },
    priorities: ['face value hierarchy', 'cheek edge integration'],
    review_after_microplans: reviewAfter,
    tasks: [
      {
        task_id: 'shadow-side',
        summary: 'Darken the right side of the face locally.',
        region: 'face',
        allowed_scales: ['medium', 'small'],
      },
      {
        task_id: 'cheek-edge',
        summary: 'Lose the cheek edge into the background without changing silhouette.',
        region: 'cheek',
        allowed_scales: ['small'],
      },
    ],
  };
}

function painterRequest(overrides: Record<string, unknown> = {}) {
  const { args: rawArgOverrides, ...restOverrides } = overrides;
  const argOverrides = (rawArgOverrides as Record<string, unknown> | undefined) ?? {};
  return {
    id: 'paint-one',
    tool: 'photoshop_execute_visual_microplan',
    args: {
      document_id: 42,
      planner_directive_id: 'face-focus',
      planner_task_id: 'shadow-side',
      painter_scope: 'medium',
      change_domains: ['local-tone'],
      stage: 'FORM_AND_LIGHT',
      scale: 'medium',
      region: 'face',
      problem_id: 'face-shadow-side',
      ...argOverrides,
    },
    summary: 'Execute one bounded Painter task.',
    purpose: 'Test the Planner/Painter execution contract.',
    problem_id: 'face-shadow-side',
    stage: 'FORM_AND_LIGHT',
    scale: 'medium',
    ...restOverrides,
  };
}

function context(taskId = 'shadow-side') {
  return {
    problem_id: `problem-${taskId}`,
    region: 'face',
    stage: 'FORM_AND_LIGHT',
    scale: 'medium',
    planner_directive_id: 'face-focus',
    planner_task_id: taskId,
    painter_scope: 'medium',
    change_domains: ['local-tone'],
  };
}

function acceptedVerdict() {
  return {
    verdict: 'improvement',
    disposition: 'accept',
    target_resolved: 'no',
    regressions: [],
    global_readability: 'stable',
  };
}

describe('Art Director / Painter controller contract', () => {
  it('upgrades simple_graphic to nontrivial_painting in place only after stronger obligations are present', () => {
    const s = store();
    s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/profile-upgrade-process/run-01',
      painting_profile: 'simple_graphic',
    });
    expect(() => s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/profile-upgrade-process/run-01',
      painting_profile: 'nontrivial_painting',
      profile_transition_reason: 'The user expanded the task into a materially developed painting.',
    })).toThrow(/unmet_obligations=.*brush_preflight/);

    const upgraded = s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/profile-upgrade-process/run-01',
      painting_profile: 'nontrivial_painting',
      profile_transition_reason: 'The user expanded the task into a materially developed painting.',
      brush_preflight: {
        completed: true,
        inventory_observed: true,
        inventory_total: 3,
        roles: [{
          role_id: 'broad-form',
          purpose: 'Build medium-scale form masses.',
          material_roles: ['form'],
          visual_intents: ['directional-mass'],
          preferred_preset: 'Round Form Brush',
          alternative_presets: [],
          effective_settings: {
            size: 120, hardness: 60, roundness: 100, opacity: 80, flow: 60, spacing: 10,
            use_pressure_size: false, use_pressure_opacity: false, airbrush: false,
            smoothing_enabled: true, smoothing: 10,
          },
          working_scale: 'medium',
          pressure_policy: 'none',
          probe_status: 'pass',
        }],
      },
    });
    expect(upgraded.painting_profile).toBe('nontrivial_painting');
    expect(upgraded.process_dir).toBe('processes/profile-upgrade-process/run-01');
    expect(upgraded.profile_transition).toMatchObject({
      from: 'simple_graphic',
      to: 'nontrivial_painting',
      monotonic: true,
    });
    expect(() => s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/profile-upgrade-process/run-01',
      painting_profile: 'simple_graphic',
    })).toThrow(/downgrade is forbidden/);
  });

  it('binds global brief claims to the exact contract revision, frame SHA and authorized critic', () => {
    const s = store();
    const frame = seedClassifiedFrame(s, 'global-claim-frame', 1);
    const brief = directive('global-claim', 5);
    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: brief,
      global_brief_assessment: {
        outcome: 'satisfied',
        contract_id: brief.artistic_evaluation_contract.contract_id,
        contract_revision: 1,
        frame_sha256: frame.sha256,
        critic_authority: 'shadow',
        critic_result_id: 'shadow-claim',
        reason: 'Shadow critic observed the frame but does not have completion authority.',
      },
    });
    expect(s.paintingState().documents['42'].global_brief_assessment).toMatchObject({
      outcome: 'not-evaluated',
      requested_outcome: 'satisfied',
      validation: 'not-independently-validated',
    });

    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: brief,
      global_brief_assessment: {
        outcome: 'satisfied',
        contract_id: brief.artistic_evaluation_contract.contract_id,
        contract_revision: 1,
        frame_sha256: frame.sha256,
        critic_authority: 'authorized',
        critic_result_id: 'authorized-claim',
        criteria: ['The exact current frame satisfies the active brief criteria.'],
        reason: 'Authorized bounded critic evaluated the exact current frame against the frozen contract.',
      },
    });
    expect(s.statusCompact().documents['42']).toMatchObject({
      global_brief_outcome: 'satisfied',
      global_brief_assessment: { validation: 'independently-validated' },
      art_director: {
        artistic_evaluation_contract: { contract_id: brief.artistic_evaluation_contract.contract_id, revision: 1 },
      },
    });
  });

  it('does not let a relative-best final comparison complete an explicitly unsatisfied global brief', () => {
    const s = store();
    const frame = seedClassifiedFrame(s, 'relative-best-unsatisfied', 1);
    const single = directive('relative-best-directive', 5);
    single.tasks = [single.tasks[0]];
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: single });
    s.updatePaintingState(42, current => ({
      ...current,
      art_director: {
        ...current.art_director,
        tasks: current.art_director.tasks.map(task => ({ ...task, status: 'completed' })),
        current_task_id: null,
      },
    }));
    expect(() => s.setArtDirectorState({
      document_id: 42,
      action: 'complete',
      final_comparison: {
        scope: 'no_previous',
        preferred: 'current',
        reason: 'This is the strongest state seen so far, but that relative preference does not satisfy the brief.',
        criteria: {
          coherence: 'Current state is internally coherent relative to prior work.',
          expressiveness: 'Current state is relatively stronger but still misses the requested read.',
          color: 'Color is the best current attempt but remains insufficient.',
          rhythm: 'Rhythm improved relative to prior attempts.',
          detail_selectivity: 'Detail is selective but cannot cure the global mismatch.',
        },
      },
      global_brief_assessment: {
        outcome: 'unsatisfied',
        contract_id: single.artistic_evaluation_contract.contract_id,
        contract_revision: 1,
        frame_sha256: frame.sha256,
        critic_authority: 'authorized',
        critic_result_id: 'authorized-unsatisfied',
        criteria: ['Current frame is best so far while still materially short of the brief.'],
        reason: 'The exact current frame remains materially short of the active brief despite being relatively strongest.',
      },
    })).toThrow(/global brief outcome is unsatisfied/);
  });

  it('keeps local Painter verification running while global review waits for adaptive cadence', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive('face-focus', 3) });

    for (let i = 1; i <= 2; i++) {
      const current = s.paintingState().documents['42'];
      const record = { id: `local-${i}`, verdict: { trend_signals: [], at: new Date().toISOString() } };
      const next = s.advanceArtDirectorAfterVerdict(current, context(), acceptedVerdict(), record);
      s.updatePaintingState(42, () => next);
      expect(next.art_director.completed_microplans).toBe(i);
      expect(next.art_director.status).toBe('active');
      expect(next.art_director.review_due).toBe(false);
      expect(next.art_director.current_task_id).toBe('shadow-side');
      expect(next.art_director.tasks[0].status).toBe('active');
      expect(next.art_director.tasks[1].status).toBe('pending');
    }

    const current = s.paintingState().documents['42'];
    const third = s.advanceArtDirectorAfterVerdict(
      current,
      context(),
      acceptedVerdict(),
      { id: 'local-3', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    expect(third.art_director.completed_microplans).toBe(3);
    expect(third.art_director.status).toBe('review_due');
    expect(third.art_director.review_reason).toBe('cadence:3_microplans');
  });

  it('keeps the planner task active when only the local operation goal is resolved', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive('scene-directive', 8) });
    const current = s.paintingState().documents['42'];
    const next = s.advanceArtDirectorAfterVerdict(
      current,
      { ...context(), planner_directive_id: 'scene-directive' },
      { ...acceptedVerdict(), target_resolved: 'yes' },
      { id: 'foundation-fill', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );

    expect(next.art_director.tasks[0].status).toBe('active');
    expect(next.art_director.current_task_id).toBe('shadow-side');
    expect(next.art_director.status).toBe('active');
  });

  it('completes the planner task only from explicit task-level evidence', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive('scene-directive', 8) });
    const current = s.paintingState().documents['42'];
    const next = s.advanceArtDirectorAfterVerdict(
      current,
      { ...context(), planner_directive_id: 'scene-directive' },
      {
        ...acceptedVerdict(),
        target_resolved: 'yes',
        planner_task_assessment: {
          status: 'completed',
          evidence_scope: 'task',
          evidence: ['The full bounded task objective is visible in the reviewed frame.'],
        },
      },
      { id: 'task-complete-pass', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );

    expect(next.art_director.tasks[0].status).toBe('completed');
    expect(next.art_director.tasks[1].status).toBe('active');
    expect(next.art_director.current_task_id).toBe('cheek-edge');
  });

  it('interrupts early when a local pass unexpectedly degrades global readability', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive('face-focus', 8) });
    const current = s.paintingState().documents['42'];
    const next = s.advanceArtDirectorAfterVerdict(
      current,
      context(),
      { ...acceptedVerdict(), global_readability: 'degraded' },
      { id: 'bad-local', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    expect(next.art_director.completed_microplans).toBe(1);
    expect(next.art_director.status).toBe('interrupted');
    expect(next.art_director.review_reason).toBe('early_interrupt:unexpected_global_composition_value_shift');
  });

  it('stores declared relation/quality scope only when the pass declares it', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive('relation-scope', 8) });
    const initial = s.paintingState().documents['42'];
    const declared = s.advanceArtDirectorAfterVerdict(
      initial,
      {
        ...context(),
        planner_directive_id: 'relation-scope',
        affected_relations: ['face-to-background separation'],
        affected_qualities: ['quiet focal restraint'],
      },
      acceptedVerdict(),
      { id: 'relation-pass', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    expect(declared.art_director.tasks[0]).toMatchObject({
      affected_relations: ['face-to-background separation'],
      affected_qualities: ['quiet focal restraint'],
    });
    expect(declared.relation_review).toMatchObject({
      operation_id: 'relation-pass',
      affected_relations: ['face-to-background separation'],
      affected_qualities: ['quiet focal restraint'],
    });

    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive('relation-scope-clean', 8) });
    const clean = s.paintingState().documents['42'];
    const undeclared = s.advanceArtDirectorAfterVerdict(
      clean,
      { ...context(), planner_directive_id: 'relation-scope-clean' },
      acceptedVerdict(),
      { id: 'plain-pass', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    expect(undeclared.art_director.tasks[0].affected_relations).toBeUndefined();
    expect(undeclared.art_director.tasks[0].affected_qualities).toBeUndefined();
    expect(undeclared.relation_review).toBeUndefined();
  });

  it('keeps named artistic losses durable until explicitly resolved accepted or reversed', () => {
    const s = store();
    const record = { id: 'loss-pass', verdict: { at: new Date().toISOString() } };
    s.updatePaintingState(42, current => ({
      ...current,
      ...s.applyArtisticLossUpdates(current, [{
        name: 'edge-breathing-room',
        status: 'observed',
        detail: 'The cheek edge became too uniformly hard and lost breathing room.',
      }], record),
    }));
    expect(s.paintingState().documents['42'].artistic_losses['edge-breathing-room']).toMatchObject({
      status: 'observed',
      detail: 'The cheek edge became too uniformly hard and lost breathing room.',
    });

    s.updatePaintingState(42, current => ({
      ...current,
      unrelated_state: 'preserved',
    }));
    expect(s.paintingState().documents['42'].artistic_losses['edge-breathing-room'].status).toBe('observed');

    s.updatePaintingState(42, current => ({
      ...current,
      ...s.applyArtisticLossUpdates(current, [{
        name: 'edge-breathing-room',
        status: 'resolved',
      }], { id: 'loss-repair', verdict: { at: new Date().toISOString() } }),
    }));
    expect(s.paintingState().documents['42'].artistic_losses['edge-breathing-room']).toMatchObject({
      status: 'resolved',
      operation_id: 'loss-repair',
    });
  });

  it('bounds one incomplete artistic hypothesis to a finite review horizon with anchor rollback evidence', () => {
    const s = store();
    const anchor = seedClassifiedFrame(s, 'hypothesis-anchor', 1);
    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('hypothesis-anchor-review', 8),
      anchor_decision: {
        action: 'promote_primary',
        operation_id: anchor.operation_id,
        rationale: 'Whole-image review establishes a safe rollback anchor before the bounded experiment.',
      },
    });
    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('hypothesis-open', 8),
      incomplete_hypothesis: {
        lost_quality: 'quiet edge rhythm',
        intended_relationship: 'cheek edge should dissolve into the background without weakening the face silhouette',
        observable_completion_condition: 'the cheek transition is visibly softer while the head silhouette remains readable',
        max_review_horizon: 2,
      },
    });
    let state = s.paintingState().documents['42'];
    expect(state.art_director.incomplete_hypothesis).toMatchObject({
      rollback_operation_id: anchor.operation_id,
      rollback_path: anchor.path,
      max_review_horizon: 2,
      remaining_reviews: 2,
    });

    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('hypothesis-review-1', 8),
    });
    state = s.paintingState().documents['42'];
    expect(state.art_director.incomplete_hypothesis.remaining_reviews).toBe(1);
    expect(() => s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('hypothesis-review-exhausted', 8),
    })).toThrow(/incomplete_hypothesis_horizon_exhausted/);

    const resolved = s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('hypothesis-resolved', 8),
      incomplete_hypothesis_resolution: 'reversed',
    });
    expect(resolved.art_director.incomplete_hypothesis).toBeNull();
    expect(resolved.art_director.last_incomplete_hypothesis_resolution).toMatchObject({
      resolution: 'reversed',
      rollback_operation_id: anchor.operation_id,
    });
  });

  it('requires dependent Painter work to address an unresolved primary mismatch while allowing preserved independent work', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive('mismatch-gate', 8) });
    s.updatePaintingState(42, current => ({
      ...current,
      last_critique: {
        operation_id: 'mismatch-source',
        problem_id: 'face-shadow-side',
        region: 'face',
        primary_mismatch: 'The face shadow still flattens the cheek plane.',
        target_resolved: 'no',
        uncertainty: 'none observed',
      },
    }));

    expect(() => s.plannerGate(42, painterRequest({
      problem_id: 'unrelated-dependent',
      args: { planner_directive_id: 'mismatch-gate', problem_id: 'unrelated-dependent' },
    }))).toThrow(/primary_mismatch_unresolved/);

    expect(() => s.plannerGate(42, painterRequest({
      args: { planner_directive_id: 'mismatch-gate', problem_id: 'face-shadow-side' },
    }))).not.toThrow();

    expect(() => s.plannerGate(42, painterRequest({
      problem_id: 'background-rain',
      args: {
        planner_directive_id: 'mismatch-gate',
        problem_id: 'background-rain',
        independent_region: true,
        preservation_facts: ['The face layer and silhouette are excluded from this background-only pass.'],
      },
    }))).not.toThrow();

    expect(() => s.plannerGate(42, painterRequest({
      problem_id: 'background-rain',
      args: {
        planner_directive_id: 'mismatch-gate',
        problem_id: 'background-rain',
        independent_region: true,
      },
    }))).toThrow(/requires concrete preservation_facts/);
  });

  it('records whole-image glances only at stage/global/final boundaries and does not require them per local pass', () => {
    const s = store();
    const glanceFrame = seedClassifiedFrame(s, 'glance-frame', 1);
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive('glance-review', 8) });
    let state = s.paintingState().documents['42'];
    state = s.advanceArtDirectorAfterVerdict(
      state,
      { ...context(), planner_directive_id: 'glance-review', stage: 'FORM_AND_LIGHT' },
      acceptedVerdict(),
      { id: 'glance-local-1', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    expect(state.art_director.whole_image_glance.due).toBe(false);

    state = s.advanceArtDirectorAfterVerdict(
      state,
      { ...context(), planner_directive_id: 'glance-review', stage: 'EDGE_CONTROL' },
      acceptedVerdict(),
      { id: 'glance-stage-change', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    expect(state.art_director.whole_image_glance).toMatchObject({
      due: true,
      reason: 'stage_boundary',
    });
    s.updatePaintingState(42, () => state);

    const reviewed = s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('glance-after-stage', 8),
      whole_image_glance: {
        trigger: 'stage_boundary',
        observation: 'The whole image keeps a clear face focus and stable large-value grouping.',
        operation_id: glanceFrame.operation_id,
        frame_sha256: glanceFrame.sha256,
      },
    });
    expect(reviewed.art_director.whole_image_glance).toMatchObject({
      due: false,
      reason: null,
      last_record: expect.objectContaining({ trigger: 'stage_boundary' }),
    });
    expect(reviewed.art_director.whole_image_glance.history).toHaveLength(1);

    let globalState = s.advanceArtDirectorAfterVerdict(
      reviewed,
      {
        ...context(),
        planner_directive_id: 'glance-after-stage',
        stage: 'EDGE_CONTROL',
        change_domains: ['large-value'],
      },
      acceptedVerdict(),
      { id: 'glance-global-change', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    expect(globalState.art_director.whole_image_glance).toMatchObject({
      due: true,
      reason: 'global_change',
    });

    const finalDirective = directive('glance-final', 8);
    finalDirective.tasks = [finalDirective.tasks[0]];
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: finalDirective });
    const beforeFinal = s.paintingState().documents['42'];
    const finalState = s.advanceArtDirectorAfterVerdict(
      beforeFinal,
      { ...context(), planner_directive_id: 'glance-final' },
      {
        ...acceptedVerdict(),
        target_resolved: 'yes',
        planner_task_assessment: {
          status: 'completed',
          evidence_scope: 'task',
          evidence: ['The bounded task is complete at task scope.'],
        },
      },
      { id: 'glance-final-pass', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    expect(finalState.art_director.whole_image_glance).toMatchObject({
      due: true,
      reason: 'final_review',
    });
  });

  it('blocks Painter from global/compositional changes unless the directive task explicitly permits them', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive() });
    expect(() => s.plannerGate(42, painterRequest({
      args: { change_domains: ['composition'] },
    }))).toThrow(/planner_review_required: Painter cannot change composition/);

    const permitted = directive('face-focus-allowed', 5);
    permitted.tasks[0].allowed_global_changes = ['large-value'];
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: permitted });
    expect(() => s.plannerGate(42, painterRequest({
      args: {
        planner_directive_id: 'face-focus-allowed',
        change_domains: ['large-value'],
      },
    }))).not.toThrow();
  });

  it('allows directive-bound standalone Curves while rejecting an unbound artistic adjustment', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive() });

    expect(() => s.plannerGate(42, {
      id: 'curves-bound',
      tool: 'photoshop_adjust_curves',
      args: { document_id: 42, preset: 'auto_tone' },
      planner_directive_id: 'face-focus',
      planner_task_id: 'shadow-side',
      painter_scope: 'medium',
      change_domains: ['local-tone'],
      stage: 'FORM_AND_LIGHT',
      scale: 'medium',
      problem_id: 'face-shadow-side',
    })).not.toThrow();

    expect(() => s.plannerGate(42, {
      id: 'curves-unbound',
      tool: 'photoshop_adjust_curves',
      args: { document_id: 42, preset: 'auto_tone' },
      stage: 'FORM_AND_LIGHT',
      scale: 'medium',
      problem_id: 'face-shadow-side',
    })).toThrow(/painter_contract_gate/);
  });

  it('requires multiple cheap alternatives before committing a free composition', () => {
    const s = store();
    const free = directive();
    free.composition_freedom = 'free';
    free.composition_exploration = {
      hypotheses: [{
        id: 'single',
        summary: 'One centered composition only.',
        large_masses: 'Single centered figure mass.',
        negative_space: 'Balanced space on both sides.',
        light_pattern: 'Single frontal light mass.',
      }],
      selected_id: 'single',
      selection_reason: 'Only one option was considered.',
    };
    expect(() => s.setArtDirectorState({ document_id: 42, action: 'review', directive: free }))
      .toThrow(/at least two cheap structural hypotheses/);

    free.composition_exploration.hypotheses.push({
      id: 'offset',
      summary: 'Offset figure with stronger directional tension.',
      large_masses: 'Figure occupies left third against a broad sea mass.',
      negative_space: 'Open right-side space reinforces gaze direction.',
      light_pattern: 'Diagonal warm light cuts across the face and hands.',
    });
    free.composition_exploration.selected_id = 'offset';
    free.composition_exploration.selection_reason = 'The offset version creates stronger negative-space tension and a clearer directional light rhythm.';
    expect(() => s.setArtDirectorState({ document_id: 42, action: 'review', directive: free })).not.toThrow();
  });

  it('admits fixed/reference composition with zero alternatives and forbids branch ceremony', () => {
    const s = store();
    const fixed = directive('fixed-reference', 5);
    fixed.composition_freedom = 'fixed';
    fixed.composition_exploration = { hypotheses: [] };
    const state = s.setArtDirectorState({ document_id: 42, action: 'review', directive: fixed });
    expect(state.art_director.composition_freedom).toBe('fixed');
    expect(state.art_director.composition_exploration).toMatchObject({
      hypotheses: [],
      selected_id: null,
      selection_reason: null,
      material_choice_unresolved: false,
    });

    fixed.composition_exploration = {
      hypotheses: [{
        id: 'unneeded-branch',
        summary: 'Unneeded variant.',
        large_masses: 'Same reference masses.',
        negative_space: 'Same reference negative space.',
        light_pattern: 'Same reference light pattern.',
      }],
      selected_id: 'unneeded-branch',
      selection_reason: 'This should never be required for a fixed composition.',
    };
    expect(() => s.setArtDirectorState({ document_id: 42, action: 'review', directive: fixed }))
      .toThrow(/fixed forbids composition variant branching/);
  });

  it('allows constrained composition with no unresolved material choice to skip alternatives entirely', () => {
    const s = store();
    const constrained = directive('constrained-no-choice', 5);
    constrained.composition_freedom = 'constrained';
    constrained.composition_exploration = {
      hypotheses: [],
      material_choice_unresolved: false,
    };
    const state = s.setArtDirectorState({ document_id: 42, action: 'review', directive: constrained });
    expect(state.art_director.composition_freedom).toBe('constrained');
    expect(state.art_director.composition_exploration.hypotheses).toEqual([]);
    expect(state.art_director.composition_exploration.material_choice_unresolved).toBe(false);
  });

  it('requires a bounded cheap comparison only when constrained composition declares an unresolved material choice', () => {
    const s = store();
    const constrained = directive('constrained-material-choice', 5);
    constrained.composition_freedom = 'constrained';
    constrained.composition_exploration = {
      hypotheses: [{
        id: 'left-bias',
        summary: 'Figure held left against broad open space.',
        large_masses: 'Primary figure mass on left third.',
        negative_space: 'Open right field remains dominant.',
        light_pattern: 'Warm diagonal enters from upper left.',
      }],
      material_choice_unresolved: true,
      selected_id: 'left-bias',
      selection_reason: 'A material placement choice still needs comparison.',
    };
    expect(() => s.setArtDirectorState({ document_id: 42, action: 'review', directive: constrained }))
      .toThrow(/bounded comparison of 2-4 cheap structural hypotheses/);

    constrained.composition_exploration.hypotheses.push({
      id: 'center-bias',
      summary: 'Figure held centrally with tighter flanking space.',
      large_masses: 'Primary figure mass near center.',
      negative_space: 'Narrower side fields balance the figure.',
      light_pattern: 'Warm light remains diagonal but more symmetrical.',
    });
    constrained.composition_exploration.selected_id = 'left-bias';
    constrained.composition_exploration.selection_reason = 'The left-biased version better preserves directional negative-space tension.';
    const state = s.setArtDirectorState({ document_id: 42, action: 'review', directive: constrained });
    expect(state.art_director.composition_exploration.hypotheses).toHaveLength(2);
    expect(state.art_director.composition_exploration.selected_id).toBe('left-bias');
  });

  it('keeps cheap composition exploration as controller data with zero Photoshop operation records', () => {
    const s = store();
    const free = directive('cheap-data-only', 5);
    free.composition_freedom = 'free';
    free.composition_exploration = {
      hypotheses: [
        {
          id: 'quiet-center',
          summary: 'Quiet centered arrangement.',
          large_masses: 'Centered figure against a broad background mass.',
          negative_space: 'Even lateral breathing room.',
          light_pattern: 'Soft frontal light grouping.',
        },
        {
          id: 'open-right',
          summary: 'Offset figure with open right field.',
          large_masses: 'Figure mass shifted left.',
          negative_space: 'Large open field on right.',
          light_pattern: 'Diagonal light reinforces the offset.',
        },
      ],
      selected_id: 'open-right',
      selection_reason: 'The offset hypothesis produces clearer directional tension before any rendering task starts.',
    };
    expect(s.records()).toHaveLength(0);
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: free });
    expect(s.records()).toHaveLength(0);
  });

  it('persists and reconstructs composition freedom and selected cheap hypotheses across restart/status', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'planner-composition-restart-'));
    dirs.push(dir);
    const first = storeAt(dir);
    const free = directive('restart-free', 5);
    free.composition_freedom = 'free';
    free.composition_exploration = {
      hypotheses: [
        {
          id: 'a',
          summary: 'Centered structural option.',
          large_masses: 'Centered dominant mass.',
          negative_space: 'Balanced flanks.',
          light_pattern: 'Broad centered light.',
        },
        {
          id: 'b',
          summary: 'Offset structural option.',
          large_masses: 'Dominant mass shifted left.',
          negative_space: 'Open right field.',
          light_pattern: 'Diagonal light rhythm.',
        },
      ],
      selected_id: 'b',
      selection_reason: 'The offset structural option creates the clearer large-scale read.',
    };
    first.setArtDirectorState({ document_id: 42, action: 'review', directive: free });

    const restarted = storeAt(dir);
    const compact = restarted.statusCompact() as any;
    expect(compact.documents['42'].art_director.composition_freedom).toBe('free');
    expect(compact.documents['42'].art_director.composition_exploration).toMatchObject({
      selected_id: 'b',
      hypotheses: [expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'b' })],
    });
    const resumed = restarted.resume(42) as any;
    expect(resumed.document.art_director.composition_freedom).toBe('free');
    expect(resumed.document.art_director.composition_exploration.selected_id).toBe('b');
  });

  it('does not infer new composition_freedom semantics from a legacy durable mode on v2 read', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'planner-composition-legacy-'));
    dirs.push(dir);
    const first = storeAt(dir);
    first.updatePaintingState(42, current => ({
      ...current,
      art_director: {
        directive_id: 'legacy-free',
        status: 'active',
        composition_exploration: {
          mode: 'free_composition',
          hypotheses: [{
            id: 'legacy-a',
            summary: 'Legacy option A.',
            large_masses: 'A masses.',
            negative_space: 'A space.',
            light_pattern: 'A light.',
          }, {
            id: 'legacy-b',
            summary: 'Legacy option B.',
            large_masses: 'B masses.',
            negative_space: 'B space.',
            light_pattern: 'B light.',
          }],
          selected_id: 'legacy-b',
          selection_reason: 'Legacy selected structural direction.',
        },
      },
    }));

    const restarted = storeAt(dir);
    const state = restarted.paintingState().documents['42'];
    expect(state.art_director.composition_freedom).toBeUndefined();
    expect(state.art_director.composition_exploration).toMatchObject({
      mode: 'free_composition',
      selected_id: 'legacy-b',
    });
  });

  it('blocks completion when final comparison says a previous accepted state is stronger', () => {
    const s = store();
    const single = directive('compare-finish', 5);
    single.tasks = [single.tasks[0]];
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: single });
    const current = s.paintingState().documents['42'];
    const resolved = s.advanceArtDirectorAfterVerdict(
      current,
      { ...context(), planner_directive_id: 'compare-finish' },
      {
        ...acceptedVerdict(),
        target_resolved: 'yes',
        planner_task_assessment: {
          status: 'completed',
          evidence_scope: 'task',
          evidence: ['The full bounded task objective is complete.'],
        },
      },
      { id: 'resolved-pass', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    s.updatePaintingState(42, () => resolved);
    expect(() => s.setArtDirectorState({
      document_id: 42,
      action: 'complete',
      final_comparison: {
        scope: 'no_previous',
        preferred: 'previous',
        reason: 'The earlier state had stronger unity and a cleaner focal rhythm than the current finish.',
        criteria: {
          coherence: 'Earlier state grouped the masses more clearly.',
          expressiveness: 'Earlier state felt less overworked and more immediate.',
          color: 'Earlier state preserved cleaner warm-cool relationships.',
          rhythm: 'Earlier accents produced a stronger visual cadence.',
          detail_selectivity: 'Earlier state concentrated detail more selectively.',
        },
      },
    })).toThrow(/restore\/reconcile that stronger state/);
  });

  it('keeps a locally accepted weaker frame without overwriting the primary artistic anchor', () => {
    const s = store();
    const anchorFrame = seedClassifiedFrame(s, 'anchor-strong', 1);
    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('anchor-review', 5),
      anchor_decision: {
        action: 'promote_primary',
        operation_id: anchorFrame.operation_id,
        rationale: 'Whole-image review identifies this frame as the strongest coherent direction.',
      },
    });

    const keptFrame = seedClassifiedFrame(s, 'kept-local-repair', 2);
    const state = s.paintingState().documents['42'];
    expect(state.accepted_frame.operation_id).toBe(keptFrame.operation_id);
    expect(state.primary_artistic_anchor).toMatchObject({
      operation_id: anchorFrame.operation_id,
      sha256: anchorFrame.sha256,
      path: anchorFrame.path,
    });
  });

  it('preserves primary and bounded alternative anchors across restart and resume', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'planner-painter-restart-'));
    dirs.push(dir);
    const first = storeAt(dir);
    const primary = seedClassifiedFrame(first, 'primary-anchor', 1);
    first.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('primary-anchor-review', 5),
      anchor_decision: {
        action: 'promote_primary',
        operation_id: primary.operation_id,
        rationale: 'Whole-image review promotes the strongest current composition as the primary anchor.',
      },
    });
    const alternative = seedClassifiedFrame(first, 'atmosphere-alternative', 2);
    first.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('alternative-anchor-review', 5),
      anchor_decision: {
        action: 'preserve_alternative',
        operation_id: alternative.operation_id,
        rationale: 'This variant preserves a distinct atmospheric strength worth retaining as an alternative.',
      },
    });

    const restarted = storeAt(dir);
    const compact = restarted.statusCompact() as any;
    expect(compact.documents['42'].primary_artistic_anchor.operation_id).toBe(primary.operation_id);
    expect(compact.documents['42'].alternative_artistic_anchors).toEqual([
      expect.objectContaining({ operation_id: alternative.operation_id }),
    ]);
    const resumed = restarted.resume(42) as any;
    expect(resumed.document.primary_artistic_anchor.operation_id).toBe(primary.operation_id);
    expect(resumed.document.alternative_artistic_anchors[0].operation_id).toBe(alternative.operation_id);
  });

  it('promotes a new primary while retaining the previous primary as a bounded alternative', () => {
    const s = store();
    const first = seedClassifiedFrame(s, 'first-primary', 1);
    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('first-primary-review', 5),
      anchor_decision: {
        action: 'promote_primary',
        operation_id: first.operation_id,
        rationale: 'Initial whole-image review establishes the first strong artistic reference.',
      },
    });
    const second = seedClassifiedFrame(s, 'second-primary', 2);
    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('second-primary-review', 5),
      anchor_decision: {
        action: 'promote_primary',
        operation_id: second.operation_id,
        preserve_previous_as_alternative: true,
        rationale: 'The new frame is stronger overall while the previous frame retains a distinct useful quality.',
      },
    });
    const state = s.paintingState().documents['42'];
    expect(state.primary_artistic_anchor.operation_id).toBe(second.operation_id);
    expect(state.alternative_artistic_anchors).toEqual([
      expect.objectContaining({ operation_id: first.operation_id }),
    ]);
  });

  it('requires final comparison to reference the durable primary anchor and cannot ignore a stronger anchor', () => {
    const s = store();
    const primary = seedClassifiedFrame(s, 'finish-primary', 1);
    const single = directive('finish-anchor-directive', 5);
    single.tasks = [single.tasks[0]];
    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: single,
      anchor_decision: {
        action: 'promote_primary',
        operation_id: primary.operation_id,
        rationale: 'Whole-image review establishes the strongest prior state for final comparison.',
      },
    });
    const current = seedClassifiedFrame(s, 'finish-current', 2);
    s.updatePaintingState(42, state => ({
      ...state,
      art_director: {
        ...state.art_director,
        tasks: state.art_director.tasks.map(task => ({ ...task, status: 'completed' })),
        current_task_id: null,
      },
    }));

    const finalComparison = {
      scope: 'compared',
      current_operation_id: current.operation_id,
      best_previous_operation_id: primary.operation_id,
      preferred: 'previous',
      reason: 'The primary anchor remains stronger because the current frame is more detailed but less coherent.',
      criteria: {
        coherence: 'The primary anchor groups the large masses more clearly.',
        expressiveness: 'The primary anchor has a more immediate expressive read.',
        color: 'The primary anchor preserves cleaner warm-cool relationships.',
        rhythm: 'The primary anchor retains a stronger visual cadence.',
        detail_selectivity: 'The current frame spreads detail too evenly.',
      },
    };
    expect(() => s.setArtDirectorState({
      document_id: 42,
      action: 'complete',
      final_comparison: finalComparison,
    })).toThrow(/previous artistic anchor/);

    seedClassifiedFrame(s, 'not-an-anchor', 1.5, { current: false, accepted: true });
    expect(() => s.setArtDirectorState({
      document_id: 42,
      action: 'complete',
      final_comparison: {
        ...finalComparison,
        best_previous_operation_id: 'not-an-anchor',
        preferred: 'current',
      },
    })).toThrow(/durable artistic anchor/);

    const completed = s.setArtDirectorState({
      document_id: 42,
      action: 'complete',
      final_comparison: {
        ...finalComparison,
        preferred: 'current',
        reason: 'After explicit comparison, the current state is selected as the stronger final artistic state.',
      },
    });
    expect(completed.final_artistic_frame).toMatchObject({
      operation_id: current.operation_id,
      sha256: current.sha256,
      path: current.path,
      selection: 'current',
    });
  });

  it('allows canonical completion after a failed experiment is really restored to the primary anchor', () => {
    const s = store();
    const primary = seedClassifiedFrame(s, 'restore-primary', 1);
    const single = directive('restore-primary-directive', 5);
    single.tasks = [single.tasks[0]];
    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: single,
      anchor_decision: {
        action: 'promote_primary',
        operation_id: primary.operation_id,
        rationale: 'Establish the strongest verified frame before the bounded reversible experiment.',
      },
    });
    const restored = seedClassifiedFrame(s, 'restore-current', 3);
    s.updatePaintingState(42, state => ({
      ...state,
      current_frame: {
        ...state.current_frame,
        operation_id: restored.operation_id,
        sha256: primary.sha256,
        path: restored.path,
      },
      art_director: {
        ...state.art_director,
        status: 'interrupted',
        tasks: state.art_director.tasks.map(task => ({ ...task, status: 'failed' })),
        current_task_id: state.art_director.tasks[0].task_id,
      },
    }));

    const completed = s.setArtDirectorState({
      document_id: 42,
      action: 'complete',
      final_comparison: {
        scope: 'compared',
        current_operation_id: restored.operation_id,
        best_previous_operation_id: primary.operation_id,
        preferred: 'tie',
        reason: 'A real rollback restored the exact primary-anchor pixels, so the canonical final is the restored anchor state.',
        criteria: {
          coherence: 'Exact anchor restoration preserves the same coherent mass grouping.',
          expressiveness: 'Exact anchor restoration preserves the same expressive state.',
          color: 'Exact anchor restoration preserves the same color relationships.',
          rhythm: 'Exact anchor restoration preserves the same visual rhythm.',
          detail_selectivity: 'Exact anchor restoration preserves the same detail selectivity.',
        },
      },
    });
    expect(completed.final_artistic_frame).toMatchObject({
      operation_id: restored.operation_id,
      sha256: primary.sha256,
      selection: 'tie',
      restored_primary_anchor: true,
      restored_primary_anchor_operation_id: primary.operation_id,
    });
    expect(completed.art_director.final_comparison).toMatchObject({
      restored_primary_anchor: true,
      best_previous_operation_id: primary.operation_id,
    });
  });

  it('does not use anchor hash equality to bypass active unfinished work', () => {
    const s = store();
    const primary = seedClassifiedFrame(s, 'restore-primary-active', 1);
    const single = directive('restore-active-directive', 5);
    single.tasks = [single.tasks[0]];
    s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: single,
      anchor_decision: {
        action: 'promote_primary',
        operation_id: primary.operation_id,
        rationale: 'Establish the primary frame for the active-task bypass regression test.',
      },
    });
    const current = seedClassifiedFrame(s, 'restore-active-current', 2);
    s.updatePaintingState(42, state => ({
      ...state,
      current_frame: { ...state.current_frame, sha256: primary.sha256, path: current.path },
    }));
    expect(() => s.setArtDirectorState({
      document_id: 42,
      action: 'complete',
      final_comparison: {
        scope: 'compared',
        current_operation_id: current.operation_id,
        best_previous_operation_id: primary.operation_id,
        preferred: 'tie',
        reason: 'This should remain blocked because the task is still active despite matching pixels.',
        criteria: {
          coherence: 'same',
          expressiveness: 'same',
          color: 'same',
          rhythm: 'same',
          detail_selectivity: 'same',
        },
      },
    })).toThrow(/unfinished tasks remain/);
  });

  it('requires every Painter mutation to bind to the active directive and bounded task', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive() });
    expect(() => s.plannerGate(42, painterRequest({
      args: { planner_directive_id: undefined, planner_task_id: undefined, painter_scope: undefined, change_domains: [] },
    }))).toThrow(/painter_contract_gate/);
    expect(() => s.plannerGate(42, painterRequest({
      args: { planner_task_id: 'not-a-task' },
    }))).toThrow(/unknown planner_task_id/);
  });

  it('turns a failed directive pass into an early Planner interrupt', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive('face-focus', 8) });
    const current = s.paintingState().documents['42'];
    const next = s.advanceArtDirectorAfterVerdict(
      current,
      context(),
      {
        verdict: 'regression',
        disposition: 'rollback',
        target_resolved: 'no',
        regressions: ['face shape became visibly worse'],
        global_readability: 'stable',
      },
      { id: 'failed-pass', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    expect(next.art_director.tasks[0].status).toBe('failed');
    expect(next.art_director.status).toBe('interrupted');
    expect(next.art_director.review_reason).toBe('early_interrupt:serious_visual_error');
  });

  it('returns a failed Painter task to Art Director review instead of activating a pending task', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive('face-focus', 8) });
    const current = s.paintingState().documents['42'];
    const next = s.advanceArtDirectorAfterVerdict(
      current,
      context(),
      {
        verdict: 'regression',
        disposition: 'rollback',
        target_resolved: 'no',
        regressions: [],
        global_readability: 'stable',
      },
      { id: 'failed-pass-no-interrupt', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    s.updatePaintingState(42, () => next);

    expect(next.art_director.tasks[0].status).toBe('failed');
    expect(next.art_director.tasks[1].status).toBe('pending');
    expect(next.art_director.current_task_id).toBe('shadow-side');
    expect(next.art_director.status).toBe('review_due');
    expect(next.art_director.review_due).toBe(true);
    expect(next.art_director.review_reason).toBe('task_failed:shadow-side');
    expect(() => s.plannerGate(42, painterRequest({
      args: { planner_task_id: 'cheek-edge', scale: 'small', region: 'cheek' },
    }))).toThrow(/review required|planner_review_required/);
  });

  it('supports directive completion and a fresh replan as a new Planner review', () => {
    const s = store();
    const single = directive('single-task', 5);
    single.tasks = [single.tasks[0]];
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: single });
    const current = s.paintingState().documents['42'];
    const resolved = s.advanceArtDirectorAfterVerdict(
      current,
      { ...context(), planner_directive_id: 'single-task' },
      {
        ...acceptedVerdict(),
        target_resolved: 'yes',
        planner_task_assessment: {
          status: 'completed',
          evidence_scope: 'task',
          evidence: ['The full bounded task objective is complete.'],
        },
      },
      { id: 'resolved-pass', verdict: { trend_signals: [], at: new Date().toISOString() } }
    );
    s.updatePaintingState(42, () => resolved);
    expect(resolved.art_director.review_reason).toBe('directive_tasks_completed');
    const completed = s.setArtDirectorState({
      document_id: 42,
      action: 'complete',
      final_comparison: {
        scope: 'no_previous',
        preferred: 'current',
        reason: 'This isolated planner test has no earlier accepted visual state to compare against.',
        criteria: {
          coherence: 'Current state remains internally coherent.',
          expressiveness: 'No contradictory expressive regression is present.',
          color: 'No competing color state exists in this isolated test.',
          rhythm: 'No earlier rhythm variant exists for comparison.',
          detail_selectivity: 'No prior accepted detail state exists for comparison.',
        },
      },
    });
    expect(completed.art_director.status).toBe('completed');

    const replanned = s.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive('next-directive', 6),
    });
    expect(replanned.art_director.directive_id).toBe('next-directive');
    expect(replanned.art_director.status).toBe('active');
    expect(replanned.art_director.completed_microplans).toBe(0);
  });

  it('supports Painter-declared unsafe execution as an event-driven interrupt without a Photoshop mutation', () => {
    const s = store();
    s.setArtDirectorState({ document_id: 42, action: 'review', directive: directive() });
    const interrupted = s.setArtDirectorState({
      document_id: 42,
      action: 'interrupt',
      reason: 'unsafe_to_execute_directive',
      detail: 'The requested cheek edit would require moving the protected head silhouette.',
    });
    expect(interrupted.art_director.status).toBe('interrupted');
    expect(interrupted.art_director.interrupt.reason).toBe('unsafe_to_execute_directive');
  });
});

describe('Painter VisualMicroPlan envelope', () => {
  it('requires complete planner binding when a micro-plan is Painter-bound', () => {
    const base = {
      plan_id: 'planner-bound-plan',
      summary: 'Bounded face correction',
      stage: 'FORM_AND_LIGHT',
      scale: 'medium',
      region: 'face',
      intent: 'darken local face shadow',
      method_class: 'paint',
      risk: 'low',
      expected_visual_delta: 'Right face shadow becomes slightly darker.',
      verification_envelope: { mode: 'after_only' },
      layer_separation_check: {
        change_kind: 'continuation',
        substantial: true,
        rollback_value: 'low',
        independent_adjustment_expected: false,
        reasons: ['This bounded Painter pass continues the existing face shadow unit.'],
      },
      planner_directive_id: 'face-focus',
      planner_task_id: 'shadow-side',
      painter_scope: 'medium',
      change_domains: ['local-tone'],
      problem_id: 'face-shadow-side',
      action_class: 'REFINE',
      expected_visual_result: 'Local face shadow is darker.',
      document_id: 42,
      steps: [
        { id: 'dab', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 20, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    };
    const parsed = parseVisualMicroPlan(base);
    expect(parsed.plannerDirectiveId).toBe('face-focus');
    expect(parsed.plannerTaskId).toBe('shadow-side');
    expect(parsed.changeDomains).toEqual(['local-tone']);

    expect(() => parseVisualMicroPlan({ ...base, planner_task_id: undefined })).toThrow(/supplied together/);
    expect(() => parseVisualMicroPlan({ ...base, change_domains: [] })).toThrow(/requires at least one change_domains/);
  });
});
