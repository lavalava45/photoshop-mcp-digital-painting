import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  SessionStore,
  visualStrategyFingerprint,
} from '../src/core/guard/session-store.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'artistic-recovery-production-'));
  dirs.push(dir);
  const store = new SessionStore(path.join(dir, 'controller'), {
    visualBarrierDirectory: path.join(dir, 'barriers'),
    workspaceRoot: dir,
  });
  return { dir, store };
}

function sha(bytes: string | Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function microplan(
  id: string,
  {
    stepTool = 'photoshop_paint_strokes',
    color = { red: 80, green: 90, blue: 100 },
    opacity = 50,
    strokeCount = 1,
    preset = 'Preset A',
  }: {
    stepTool?: string;
    color?: Record<string, number>;
    opacity?: number;
    strokeCount?: number;
    preset?: string;
  } = {}
) {
  const strokes = Array.from({ length: strokeCount }, (_, index) => ({
    tool: 'BRUSH',
    points: [{ x: 10 + index, y: 10 }, { x: 30 + index, y: 30 }],
    color,
    opacity,
  }));
  return {
    id,
    tool: 'photoshop_execute_visual_microplan',
    args: {
      document_id: 42,
      problem_id: 'cheek-edge',
      stage: 'FORM_AND_LIGHT',
      scale: 'small',
      change_domains: ['local-tone'],
      method_class: stepTool === 'photoshop_paint_regions' ? 'region' : 'stroke',
      paint_strategy: {
        brush_role: 'edge-control',
        preset_name: preset,
      },
      steps: [{
        tool: stepTool,
        method_id: stepTool === 'photoshop_paint_regions' ? 'region-shape' : 'edge-stroke',
        region: 'cheek',
        args: stepTool === 'photoshop_paint_regions'
          ? {
              opacity,
              color,
              regions: [{
                contours: [{
                  points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 30, y: 30 }],
                }],
              }],
            }
          : { opacity, color, strokes },
      }],
    },
    problem_id: 'cheek-edge',
    stage: 'FORM_AND_LIGHT',
    scale: 'small',
    change_domains: ['local-tone'],
    summary: 'Recover the cheek edge.',
    purpose: 'Resolve the same bounded artistic problem.',
  };
}

function failedRecord(request: Record<string, any>, sequence = 1) {
  return {
    ...request,
    hash: 'fixture-' + sequence,
    sequence,
    created_at: new Date(sequence * 1000).toISOString(),
    completed_at: new Date(sequence * 1000 + 1).toISOString(),
    phase: 'completed',
    visual: true,
    failed: false,
    report: {
      did: 'Applied the bounded recovery pass.',
      why: 'Test recovery behavior.',
      result: 'The problem remained unresolved.',
    },
    verdict: {
      verdict: 'neutral',
      disposition: 'correct',
      target_resolved: 'no',
      significance: {
        execution_effect: 'material',
        global: { mean_abs_rgb_delta: 0.02 },
      },
      at: new Date(sequence * 1000 + 2).toISOString(),
    },
  };
}

describe('production artistic recovery policy', () => {
  it('does not treat color, opacity, preset, or primitive-count jitter as a distinct strategy', () => {
    const base = microplan('base');
    const jittered = microplan('jittered', {
      color: { red: 200, green: 30, blue: 60 },
      opacity: 83,
      strokeCount: 5,
      preset: 'Preset B',
    });
    const structurallyDifferent = microplan('region-strategy', {
      stepTool: 'photoshop_paint_regions',
      color: { red: 200, green: 30, blue: 60 },
      opacity: 83,
      preset: 'Preset B',
    });

    expect(visualStrategyFingerprint(jittered)).toBe(visualStrategyFingerprint(base));
    expect(visualStrategyFingerprint(structurallyDifferent)).not.toBe(visualStrategyFingerprint(base));
  });

  it('uses the authoritative policy in SessionStore preflight to block a parameter variant and admit a distinct strategy', () => {
    const { store } = fixture();
    const first = microplan('first-attempt');
    store.write(failedRecord(first));

    const jittered = microplan('parameter-variant', {
      color: { red: 210, green: 20, blue: 50 },
      opacity: 91,
      strokeCount: 7,
      preset: 'Different Preset',
    });
    const jitterErrors = store.collectPreflightErrors(jittered, { stateOnly: true });
    expect(jitterErrors.some(error => /artistic_recovery:.*distinct structural strategy/.test(error))).toBe(true);

    const distinct = microplan('distinct-region-strategy', { stepTool: 'photoshop_paint_regions' });
    const distinctErrors = store.collectPreflightErrors(distinct, { stateOnly: true });
    expect(distinctErrors.some(error => /artistic_recovery:/.test(error))).toBe(false);
  });

  it('reaches finite dependent termination after two distinct failed structural strategies while allowing explicit independent work', () => {
    const { store } = fixture();
    store.write(failedRecord(microplan('stroke-failure'), 1));
    store.write(failedRecord(microplan('region-failure', { stepTool: 'photoshop_paint_regions' }), 2));

    const dependent = microplan('third-dependent', { stepTool: 'photoshop_paint_regions' });
    const dependentResolution = store.artisticRecoveryForProblem(
      42,
      'cheek-edge',
      dependent,
      undefined,
      undefined
    );
    expect(dependentResolution).toMatchObject({
      decision: 'block_dependent_problem',
      retry_allowed: false,
    });

    const independent = {
      ...microplan('independent-background'),
      independent_region: true,
      preservation_facts: ['The cheek and face layers are excluded from this background-only pass.'],
    };
    const independentResolution = store.artisticRecoveryForProblem(
      42,
      'cheek-edge',
      independent,
      undefined,
      undefined
    );
    expect(independentResolution).toMatchObject({
      decision: 'continue_independent_work',
      retry_allowed: false,
    });
  });

  it('requires durable anchor bytes plus exact fresh current-frame observation before ignoring a critic alarm', () => {
    const { dir, store } = fixture();
    const anchorBytes = 'durable-anchor';
    const anchorPath = path.join(dir, 'anchor.jpg');
    writeFileSync(anchorPath, anchorBytes);
    const currentBytes = 'current-observation';
    const currentPath = path.join(dir, 'current.jpg');
    writeFileSync(currentPath, currentBytes);
    const currentSha = sha(currentBytes);

    store.updatePaintingState(42, current => ({
      ...current,
      primary_artistic_anchor: {
        operation_id: 'anchor-op',
        sha256: sha(anchorBytes),
        path: anchorPath,
      },
      current_frame: {
        operation_id: 'current-mutation',
        sha256: currentSha,
        path: currentPath,
      },
    }));
    store.write({
      id: 'fresh-observation',
      tool: 'photoshop_get_preview',
      args: { document_id: 42 },
      summary: 'Observe the current frame.',
      purpose: 'Provide exact counterevidence.',
      hash: 'fresh-observation',
      sequence: 1,
      created_at: '2026-09-25T00:00:00.000Z',
      completed_at: '2026-09-25T00:00:01.000Z',
      phase: 'completed',
      visual: false,
      failed: false,
      preview: {
        document_id: 42,
        sha256: currentSha,
        materialized_path: currentPath,
      },
    });

    const bare = store.artisticRecoveryResolution(42, {
      kind: 'critic_alarm',
      critic_alarm_evidence: {
        anchor_operation_id: 'anchor-op',
        observed_counterevidence: 'The current frame still preserves the protected large-value relationship.',
      },
    });
    expect(bare.decision).not.toBe('ignore_false_alarm');

    const verified = store.artisticRecoveryResolution(42, {
      kind: 'critic_alarm',
      critic_alarm_evidence: {
        anchor_operation_id: 'anchor-op',
        observation_operation_id: 'fresh-observation',
        observation_sha256: currentSha,
        observed_counterevidence: 'The current frame still preserves the protected large-value relationship.',
      },
    });
    expect(verified.decision).toBe('ignore_false_alarm');

    writeFileSync(currentPath, 'tampered-current-observation');
    const tampered = store.artisticRecoveryResolution(42, {
      kind: 'critic_alarm',
      critic_alarm_evidence: {
        anchor_operation_id: 'anchor-op',
        observation_operation_id: 'fresh-observation',
        observation_sha256: currentSha,
        observed_counterevidence: 'This prose alone must not override stale bytes.',
      },
    });
    expect(tampered.decision).not.toBe('ignore_false_alarm');
  });

  it('derives the same bounded recovery state after SessionStore restart', () => {
    const { dir, store } = fixture();
    store.write(failedRecord(microplan('restart-stroke-failure'), 1));
    store.write(failedRecord(microplan('restart-region-failure', { stepTool: 'photoshop_paint_regions' }), 2));
    const before = store.artisticRecoveryForProblem(42, 'cheek-edge', microplan('next'), undefined, undefined);

    const restarted = new SessionStore(path.join(dir, 'controller'), {
      visualBarrierDirectory: path.join(dir, 'barriers'),
      workspaceRoot: dir,
    });
    const after = restarted.artisticRecoveryForProblem(42, 'cheek-edge', microplan('next'), undefined, undefined);
    expect(after).toEqual(before);
    expect(after?.decision).toBe('block_dependent_problem');
  });
});
