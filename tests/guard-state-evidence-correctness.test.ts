import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/core/guard/session-store.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function sha(bytes: string | Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'guard-state-evidence-'));
  dirs.push(dir);
  const controller = path.join(dir, 'controller');
  const store = new SessionStore(controller, {
    visualBarrierDirectory: path.join(dir, 'barriers'),
    workspaceRoot: dir,
  });
  return { dir, controller, store };
}

function materialized(dir: string, name: string, bytes: string) {
  const file = path.join(dir, name);
  writeFileSync(file, bytes);
  return { operation_id: name.replace(/\W+/g, '-'), sha256: sha(bytes), path: file };
}

describe('Guard artistic-frame and evidence invariants', () => {
  it('keeps read-only preview observations separate from the last artistic mutation frame across restart', () => {
    const { dir, controller, store } = fixture();
    const artistic = materialized(dir, 'artistic.jpg', 'artistic-mutation-frame');
    store.updatePaintingState(42, current => ({
      ...current,
      document_id: 42,
      current_frame: { ...artistic, accepted: true },
    }));

    const observationPath = path.join(dir, 'observation.jpg');
    const observationBytes = 'read-only-observation';
    writeFileSync(observationPath, observationBytes);
    const record = store.begin({
      id: 'read-only-preview',
      tool: 'photoshop_get_preview',
      args: { document_id: 42, max_dimension_px: 800 },
      summary: 'Observe the current document without changing pixels.',
      purpose: 'Regression-test artistic-frame identity.',
    }).record;

    store.complete(record, {
      content: [{
        type: 'text',
        text: JSON.stringify({
          document_id: 42,
          sha256: sha(observationBytes),
          materialized_path: observationPath,
          width: 800,
          height: 600,
        }),
      }],
    });

    expect(store.paintingState().documents['42'].current_frame).toMatchObject({
      operation_id: artistic.operation_id,
      sha256: artistic.sha256,
      path: artistic.path,
    });
    expect(store.read('read-only-preview')?.preview?.sha256).toBe(sha(observationBytes));

    const restarted = new SessionStore(controller, {
      visualBarrierDirectory: path.join(dir, 'barriers'),
      workspaceRoot: dir,
    });
    expect(restarted.paintingState().documents['42'].current_frame).toMatchObject({
      operation_id: artistic.operation_id,
      sha256: artistic.sha256,
      path: artistic.path,
    });
    expect(restarted.read('read-only-preview')?.preview?.sha256).toBe(sha(observationBytes));
  });

  it('rejects declarative hypothesis reversal until the exact durable rollback anchor is restored', () => {
    const { dir, store } = fixture();
    const anchor = materialized(dir, 'anchor.jpg', 'retained-anchor-bytes');
    const changed = materialized(dir, 'changed.jpg', 'changed-frame-bytes');
    const base: any = {
      primary_artistic_anchor: {
        operation_id: 'anchor-op',
        sha256: anchor.sha256,
        path: anchor.path,
      },
      alternative_artistic_anchors: [],
      current_frame: {
        operation_id: 'changed-op',
        sha256: changed.sha256,
        path: changed.path,
      },
      art_director: {},
    };
    const review = { directive_id: 'directive-1', reviewed_at: '2026-09-25T00:00:00.000Z' };
    const opened = (store as any).applyIncompleteHypothesisReview(base, {
      lost_quality: 'edge rhythm',
      intended_relationship: 'Restore varied edge rhythm after the structural experiment.',
      observable_completion_condition: 'The retained edge rhythm is visible again.',
      max_review_horizon: 3,
    }, undefined, review);

    expect(opened.incomplete_hypothesis).toMatchObject({
      rollback_operation_id: 'anchor-op',
      rollback_path: anchor.path,
      rollback_sha256: anchor.sha256,
    });

    const unresolved = {
      ...base,
      art_director: { incomplete_hypothesis: opened.incomplete_hypothesis },
    };
    expect(() => (store as any).applyIncompleteHypothesisReview(
      unresolved, undefined, 'reversed', review
    )).toThrow(/reversal_unproven/);

    const restoredPath = path.join(dir, 'restored.jpg');
    writeFileSync(restoredPath, 'retained-anchor-bytes');
    const restored = {
      ...unresolved,
      current_frame: {
        operation_id: 'undo-op',
        sha256: anchor.sha256,
        path: restoredPath,
      },
    };
    const resolution = (store as any).applyIncompleteHypothesisReview(
      restored, undefined, 'reversed', review
    );
    expect(resolution.incomplete_hypothesis).toBeNull();
    expect(resolution.last_incomplete_hypothesis_resolution).toMatchObject({
      resolution: 'reversed',
      restored_anchor_operation_id: 'anchor-op',
      restored_anchor_sha256: anchor.sha256,
      restored_frame_operation_id: 'undo-op',
      restored_frame_sha256: anchor.sha256,
    });
  });

  it('requires a pending whole-image glance to match its exact reason and artistic-frame bytes', () => {
    const { dir, store } = fixture();
    const frame = materialized(dir, 'frame.jpg', 'exact-whole-frame');
    const current: any = {
      current_frame: {
        operation_id: 'frame-op',
        sha256: frame.sha256,
        path: frame.path,
      },
      art_director: {
        whole_image_glance: {
          due: true,
          reason: 'global_change',
          required_operation_id: 'frame-op',
          required_frame_sha256: frame.sha256,
          history: [],
        },
      },
    };
    const review = { directive_id: 'directive-2', reviewed_at: '2026-09-25T00:10:00.000Z' };

    expect(() => (store as any).normalizeWholeImageGlance({
      trigger: 'stage_boundary',
      observation: 'The whole frame remains coherent after the global change.',
      operation_id: 'frame-op',
      frame_sha256: frame.sha256,
    }, review, current)).toThrow(/must match pending reason/);

    expect(() => (store as any).normalizeWholeImageGlance({
      trigger: 'global_change',
      observation: 'The whole frame remains coherent after the global change.',
      operation_id: 'frame-op',
      frame_sha256: 'f'.repeat(64),
    }, review, current)).toThrow(/frame_sha256 must match/);

    const accepted = (store as any).normalizeWholeImageGlance({
      trigger: 'global_change',
      observation: 'The whole frame remains coherent after the global change.',
      operation_id: 'frame-op',
      frame_sha256: frame.sha256,
    }, review, current);
    expect(accepted).toMatchObject({
      trigger: 'global_change',
      operation_id: 'frame-op',
      frame_sha256: frame.sha256,
    });

    writeFileSync(frame.path, 'tampered-whole-frame');
    expect(() => (store as any).normalizeWholeImageGlance({
      trigger: 'global_change',
      observation: 'This stale observation must not clear the pending review.',
      operation_id: 'frame-op',
      frame_sha256: frame.sha256,
    }, review, current)).toThrow(/evidence is stale/);
  });

  it('binds a newly due whole-image glance to the exact classified artistic frame', () => {
    const { dir, store } = fixture();
    const frame = materialized(dir, 'boundary.jpg', 'boundary-frame');
    const current: any = {
      current_frame: {
        operation_id: 'boundary-op',
        sha256: frame.sha256,
        path: frame.path,
      },
      art_director: {
        directive_id: 'directive-3',
        status: 'active',
        tasks: [{ task_id: 'task-1', status: 'active' }],
        current_task_id: 'task-1',
        completed_microplans: 0,
        review_after_microplans: 8,
        review_due: false,
        review_reason: null,
        forbidden_without_review: [],
        last_painter_stage: 'FORM',
        whole_image_glance: { due: false, reason: null, history: [] },
      },
    };
    const next = (store as any).advanceArtDirectorAfterVerdict(
      current,
      {
        planner_directive_id: 'directive-3',
        planner_task_id: 'task-1',
        stage: 'DETAIL',
        change_domains: [],
        affected_relations: [],
        affected_qualities: [],
      },
      {
        verdict: 'neutral',
        disposition: 'accept',
        global_readability: 'stable',
        regressions: [],
      },
      {
        id: 'boundary-op',
        preview: { sha256: frame.sha256 },
        verdict: { at: '2026-09-25T00:20:00.000Z', trend_signals: [] },
      }
    );
    expect(next.art_director.whole_image_glance).toMatchObject({
      due: true,
      reason: 'stage_boundary',
      required_operation_id: 'boundary-op',
      required_frame_sha256: frame.sha256,
    });
  });
});
