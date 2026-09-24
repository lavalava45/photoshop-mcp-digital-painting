import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/core/guard/session-store.js';
import { guardCapabilities } from '../src/core/guard/guard-capabilities.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'visual-review-escalation-state-'));
  dirs.push(dir);
  const controller = path.join(dir, 'controller');
  const store = new SessionStore(controller, {
    visualBarrierDirectory: path.join(dir, 'barriers'),
    workspaceRoot: dir,
  });
  const whole = path.join(dir, 'whole.jpg');
  writeFileSync(whole, 'whole-frame');
  store.write({
    id: 'review-op',
    tool: 'photoshop_set_layer_opacity',
    args: { document_id: 42, opacity: 70 },
    summary: 'Review state fixture',
    purpose: 'Exercise durable multiscale review state',
    hash: 'review-op-hash',
    sequence: 1,
    created_at: '2026-09-24T07:00:00.000Z',
    completed_at: '2026-09-24T07:00:01.000Z',
    phase: 'completed',
    execution: 'completed',
    visual: true,
    failed: false,
    visual_review_profile: {
      level: 'composition',
      whole_max_dimension_px: 1600,
      require_region: false,
      require_before_after: false,
      focus_max_dimension_px: null,
      reasons: ['global scale uses composition review'],
    },
    preview: {
      sha256: 'a'.repeat(64),
      materialized_path: whole,
      document_id: 42,
      width: 400,
      height: 300,
      canvas_width: 400,
      canvas_height: 300,
      scale_x: 1,
      scale_y: 1,
    },
  });
  return { dir, controller, store };
}

function capturedPreview(dir: string, capture: any, patch: Record<string, unknown> = {}) {
  const crop = path.join(dir, `${capture.role}.jpg`);
  const cropBytes = Buffer.from(String(capture.role));
  writeFileSync(crop, cropBytes);
  return {
    sha256: 'a'.repeat(64),
    materialized_path: path.join(dir, 'whole.jpg'),
    document_id: 42,
    width: 400,
    height: 300,
    canvas_width: 400,
    canvas_height: 300,
    focus: {
      sha256: createHash('sha256').update(cropBytes).digest('hex'),
      materialized_path: crop,
      region: capture.effective_region,
      width: capture.effective_region.right - capture.effective_region.left,
      height: capture.effective_region.bottom - capture.effective_region.top,
      scale_x: 1,
      scale_y: 1,
    },
    ...patch,
  };
}

describe('durable multiscale review escalation state', () => {
  it('bounds each round to two captures, prioritizes blocking findings and deduplicates overlapping regions', () => {
    const { store } = fixture();
    const plan = store.planReviewEscalation('review-op', [
      {
        kind: 'object_readability',
        severity: 'must-fix',
        region_bounds: { left: 50, top: 50, right: 150, bottom: 150 },
      },
      {
        kind: 'edge_transition',
        severity: 'should-fix',
        region_bounds: { left: 60, top: 60, right: 140, bottom: 140 },
      },
      {
        kind: 'proportion',
        severity: 'should-fix',
        region_bounds: { left: 220, top: 80, right: 300, bottom: 180 },
      },
      {
        kind: 'small_artifact',
        severity: 'optional',
        region_bounds: { left: 320, top: 200, right: 350, bottom: 230 },
      },
    ]) as any;

    expect(plan.required).toBe(true);
    expect(plan.captures).toHaveLength(2);
    expect(plan.captures[0]).toMatchObject({
      kind: 'edge_transition',
      severity: 'must-fix',
      level: 'micro',
      requested_region: { left: 50, top: 50, right: 150, bottom: 150 },
    });
    expect(plan.captures[1]).toMatchObject({ kind: 'proportion', level: 'object' });
    expect(plan.remaining_after_round).toBe(1);
  });

  it('rejects wrong-document and stale-whole-SHA crop evidence', () => {
    const { dir, store } = fixture();
    const plan = store.planReviewEscalation('review-op', [{
      kind: 'edge_transition',
      region_bounds: { left: 100, top: 80, right: 160, bottom: 140 },
    }], { persist: true }) as any;
    const capture = plan.captures[0];

    expect(() => store.attachReviewEvidence('review-op', capture, capturedPreview(dir, capture, {
      document_id: 99,
    }))).toThrow(/does not match pinned document/);
    expect(() => store.attachReviewEvidence('review-op', capture, capturedPreview(dir, capture, {
      sha256: 'd'.repeat(64),
    }))).toThrow(/whole-frame SHA changed/);
  });

  it('restores pending review requirements and exact crop evidence after restart without replaying mutation state', () => {
    const { dir, controller, store } = fixture();
    const requested = { left: 100, top: 80, right: 160, bottom: 140 };
    const plan = store.planReviewEscalation('review-op', [{
      kind: 'edge_transition',
      severity: 'must-fix',
      region_bounds: requested,
    }], { persist: true }) as any;
    const capture = plan.captures[0];
    store.attachReviewEvidence('review-op', capture, capturedPreview(dir, capture));

    const restarted = new SessionStore(controller, {
      visualBarrierDirectory: path.join(dir, 'barriers'),
      workspaceRoot: dir,
    });
    const status = restarted.statusCompact() as any;
    const pending = status.pending_visual_verdict_details.find((item: any) => item.operation_id === 'review-op');
    expect(pending.review_state).toMatchObject({
      operation_id: 'review-op',
      document_id: 42,
      bound_whole_sha256: 'a'.repeat(64),
      required_review_level: 'micro',
      state: 'awaiting_observation',
    });
    expect(pending.review_evidence[0]).toMatchObject({
      requested_region: requested,
      effective_region: { left: 88, top: 68, right: 172, bottom: 152 },
      bound_whole_sha256: 'a'.repeat(64),
      review_level: 'micro',
    });
    expect((restarted.planReviewEscalation as any)('review-op', [], { persist: false }).required).toBe(false);
    expect((restarted.resume(42) as any).pending_visual_verdict.review_state.state).toBe('awaiting_observation');
  });

  it('invalidates persisted crop evidence after deletion or byte replacement and accepts only the unchanged file', () => {
    const { dir, controller, store } = fixture();
    const finding = {
      kind: 'edge_transition',
      severity: 'must-fix',
      region_bounds: { left: 100, top: 80, right: 160, bottom: 140 },
    };
    const plan = store.planReviewEscalation('review-op', [finding], { persist: true }) as any;
    const capture = plan.captures[0];
    const preview = capturedPreview(dir, capture);
    store.attachReviewEvidence('review-op', capture, preview);
    const cropPath = preview.focus.materialized_path;

    const unchanged = new SessionStore(controller, {
      visualBarrierDirectory: path.join(dir, 'barriers'),
      workspaceRoot: dir,
    });
    expect((unchanged.planReviewEscalation as any)('review-op', [], { persist: false }).required).toBe(false);

    rmSync(cropPath);
    const afterDeletion = new SessionStore(controller, {
      visualBarrierDirectory: path.join(dir, 'barriers'),
      workspaceRoot: dir,
    });
    expect((afterDeletion.planReviewEscalation as any)('review-op', [], { persist: false }).required).toBe(true);

    writeFileSync(cropPath, 'replacement-bytes');
    const afterReplacement = new SessionStore(controller, {
      visualBarrierDirectory: path.join(dir, 'barriers'),
      workspaceRoot: dir,
    });
    expect((afterReplacement.planReviewEscalation as any)('review-op', [], { persist: false }).required).toBe(true);
  });

  it('requires fresh evidence when the requested region changes', () => {
    const { dir, store } = fixture();
    const firstPlan = store.planReviewEscalation('review-op', [{
      kind: 'edge_transition',
      region_bounds: { left: 100, top: 80, right: 160, bottom: 140 },
    }], { persist: true }) as any;
    store.attachReviewEvidence('review-op', firstPlan.captures[0], capturedPreview(dir, firstPlan.captures[0]));

    const changed = store.planReviewEscalation('review-op', [{
      kind: 'edge_transition',
      region_bounds: { left: 220, top: 120, right: 270, bottom: 170 },
    }], { persist: false }) as any;
    expect(changed.required).toBe(true);
    expect(changed.captures.some((capture: any) => capture.requested_region.left === 220)).toBe(true);
  });

  it('reports review_findings as an additive compact-v2 capability rather than a protocol replacement', () => {
    const caps = guardCapabilities() as any;
    const compact = caps.cycle_compiler.compact_model_contract;
    expect(compact.optional_previous_observation).toContain('review_findings');
    expect(compact.multiscale_visual_review).toMatchObject({
      levels: ['composition', 'object', 'micro'],
      whole_frame_always_required: true,
      structured_review_findings: true,
      read_only_crop_escalation_same_operation: true,
      review_findings_additive_to_compact_v2: true,
      max_new_escalation_crops_per_round: 2,
    });
  });
});
