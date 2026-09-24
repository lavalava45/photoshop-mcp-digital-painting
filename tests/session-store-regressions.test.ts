import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/core/guard/session-store.js';
import { createJob, writeJobCompleted } from '../src/core/guard/async-job.js';
import { RUNTIME_STATE_VERSION } from '../src/core/guard/protocol-version.js';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function store() {
  const dir = mkdtempSync(path.join(tmpdir(), 'session-store-regression-'));
  dirs.push(dir);
  return new SessionStore(path.join(dir, 'controller'), {
    visualBarrierDirectory: path.join(dir, 'barriers'),
    workspaceRoot: dir,
  });
}

function request(id: string, tool: string, args: Record<string, unknown> = {}) {
  return {
    id,
    tool,
    args,
    summary: `Run ${tool} for regression coverage`,
    purpose: 'Exercise Guard recovery contract with durable evidence',
  };
}

function closeReportAndAck(s: SessionStore, id: string) {
  s.report({
    id,
    did: 'Recorded the operation outcome for regression coverage',
    why: 'Allow the following evidence operation to enter the Guard journal',
    result: 'The prior operation remains durably recorded for reconciliation',
  });
  const record = s.read(id)!;
  if (record.operation_receipt && !record.operation_ack) {
    s.ackOperation({ id, token: record.operation_receipt.token });
  }
}

function writeProjectionPaintingState(s: SessionStore, documentIds: number[]) {
  mkdirSync(path.dirname(s.paintingStateFile()), { recursive: true });
  writeFileSync(s.paintingStateFile(), JSON.stringify({
    schema_version: RUNTIME_STATE_VERSION,
    version: 2,
    revision: 1,
    documents: Object.fromEntries(documentIds.map(documentId => [String(documentId), {
      document_id: documentId,
      current_stage: 'ACCEPTANCE',
    }])),
  }, null, 2));
}

function createProjectionJob(s: SessionStore, id: string, documentId: number) {
  return createJob(s.directory, {
    next_operation: {
      id,
      tool: 'photoshop_get_state',
      args: { document_id: documentId },
      summary: `Projection job ${id}`,
      purpose: 'Exercise request-local active-job projection',
    },
  }, {
    progress_id: `projection:${id}`,
    operation_id: id,
    state: 'starting',
    now: 'projection test job',
    why: 'regression coverage',
    photoshop: 'not dispatched',
    next: 'poll',
    text: 'projection test job',
  });
}

function writeProjectionRecord(
  s: SessionStore,
  input: {
    id: string;
    documentId: number;
    sequence: number;
    phase?: string;
    visual?: boolean;
    report?: boolean;
    ack?: boolean;
    verdict?: boolean;
  }
) {
  const createdAt = new Date(Date.UTC(2026, 8, 20, 12, 0, input.sequence)).toISOString();
  const record: Record<string, any> = {
    id: input.id,
    tool: input.visual ? 'photoshop_set_layer_opacity' : 'photoshop_get_state',
    args: { document_id: input.documentId },
    summary: `Projection fixture ${input.id}`,
    purpose: 'Compare legacy nested projection semantics with request-local projection semantics',
    hash: `hash-${input.id}`,
    sequence: input.sequence,
    created_at: createdAt,
    completed_at: input.phase === 'started' ? undefined : createdAt,
    phase: input.phase ?? 'completed',
    visual: !!input.visual,
    guard_ack_required: true,
    execution: input.phase === 'started' ? 'uncertain' : 'completed',
    failed: false,
  };
  if (input.report) {
    record.report = {
      id: input.id,
      did: 'Fixture report',
      why: 'Fixture parity',
      result: 'Fixture result',
      recorded_at: createdAt,
    };
  }
  if (input.ack || input.visual) {
    record.operation_receipt = {
      protocol: 'photoshop.guard.operation_receipt.v1',
      operation_id: input.id,
      token: `token-${input.id}`,
      issued_at: createdAt,
      phase: 'completed',
      execution: 'completed',
    };
  }
  if (input.ack) {
    record.operation_ack = {
      protocol: 'photoshop.guard.operation_ack.v1',
      receipt_protocol: 'photoshop.guard.operation_receipt.v1',
      receipt_token: `token-${input.id}`,
      acknowledged_at: createdAt,
    };
  }
  if (input.visual) {
    record.problem_id = `problem-${input.id}`;
    record.preview = {
      sha256: 'a'.repeat(64),
      materialized_path: path.join(s.directory, `${input.id}.jpg`),
    };
    if (input.verdict) {
      record.verdict = {
        verdict: 'improvement',
        disposition: 'accept',
        target_resolved: 'yes',
        significance: {
          execution_effect: 'meaningful',
          decoded_comparison_available: true,
          global: { changed_ratio_delta_ge_6: 0.1 },
        },
        at: createdAt,
      };
    }
  }
  s.write(record);
}

function brushPreflight() {
  return {
    completed: true,
    inventory_observed: true,
    inventory_total: 123,
    roles: [{
      role_id: 'water-flow',
      purpose: 'Broad directional water and reflected-light strokes.',
      material_roles: ['water'],
      visual_intents: ['surface-flow', 'directional-mass'],
      preferred_preset: 'Water Brush',
      alternative_presets: ['Dry Brush'],
      effective_settings: {
        size: 120, hardness: 35, roundness: 100, opacity: 75, flow: 45, spacing: 12,
        use_pressure_size: false, use_pressure_opacity: false, airbrush: false,
        smoothing_enabled: true, smoothing: 10,
      },
      working_scale: 'medium',
      pressure_policy: 'simulated-size-opacity',
      probe_status: 'pass',
    }],
  };
}

describe('Guard session-store regressions', () => {
  it('uses mutation-risk checkpoint debt instead of wall-clock age or a fixed visual-pass count', () => {
    const s = store();
    for (let sequence = 1; sequence <= 7; sequence++) {
      const id = `checkpoint-low-${sequence}`;
      writeProjectionRecord(s, { id, documentId: 42, sequence, visual: true, report: true, ack: true, verdict: true });
      const record = s.read(id)!;
      record.tool = 'photoshop_execute_visual_microplan';
      record.args = {
        document_id: 42,
        risk: 'low',
        action_class: 'ADD',
        steps: [
          { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
          { id: 'preview', tool: 'photoshop_get_preview', args: {} },
        ],
      };
      s.write(record);
    }
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 20, 12, 30, 0));
    const aged = s.checkpointState(42);
    expect(aged.age_seconds).toBeGreaterThan(5 * 60);
    expect(aged.uncheckpointed_visual_operations).toBe(7);
    expect(aged.debt_points).toBe(7);
    expect(aged.due).toBe(false);

    writeProjectionRecord(s, {
      id: 'checkpoint-high-risk', documentId: 42, sequence: 8,
      visual: true, report: true, ack: true, verdict: true,
    });
    const high = s.read('checkpoint-high-risk')!;
    high.tool = 'photoshop_execute_visual_microplan';
    high.args = {
      document_id: 42,
      risk: 'high',
      action_class: 'ERASE',
      steps: [
        { id: 'erase', tool: 'photoshop_paint_strokes', args: { strokes: [{ tool: 'ERASER' }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    };
    s.write(high);
    const risky = s.checkpointState(42);
    expect(risky.debt_points).toBeGreaterThanOrEqual(risky.debt_limit);
    expect(risky.due).toBe(true);
    expect(risky.reason).toMatch(/checkpoint debt/);
  });

  it('does not allow legacy replan prose to bypass the stage-priority gate', () => {
    const s = store();
    s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/priority-gate-process/run-01',
      commentary_mode: 'technical',
      painting_profile: 'simple_graphic',
    });
    s.updatePaintingState(42, (current: any) => ({
      ...current,
      visual_problems: {
        'global-shape': {
          problem_id: 'global-shape', scale: 'global', severity: 'must-fix', status: 'open',
        },
      },
      active_problem: {
        problem_id: 'global-shape', scale: 'global', severity: 'must-fix', status: 'open',
      },
    }));

    const errors = s.collectPreflightErrors({
      ...request('legacy-replan-override', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        stage: 'DETAIL',
        scale: 'small',
      }),
      problem_id: 'detail-pass',
      stage: 'DETAIL',
      scale: 'small',
      replan: 'override diagnostic probe test',
    });
    expect(errors.join('\n')).toMatch(/stage_priority_gate/);
  });

  it('requires a structural executable strategy change after an insufficient pass', () => {
    const s = store();
    s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/strategy-change-process/run-01',
      commentary_mode: 'technical',
      painting_profile: 'simple_graphic',
    });
    writeProjectionRecord(s, {
      id: 'insufficient-pass', documentId: 42, sequence: 1,
      visual: true, report: true, ack: true, verdict: true,
    });
    const prior = s.read('insufficient-pass')!;
    prior.tool = 'photoshop_execute_visual_microplan';
    prior.problem_id = 'form-problem';
    prior.stage = 'FORM';
    prior.scale = 'medium';
    prior.args = {
      document_id: 42,
      problem_id: 'form-problem',
      region: 'form',
      stage: 'FORM',
      scale: 'medium',
      method_class: 'paint',
      action_class: 'ADD',
      risk: 'low',
      steps: [
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { layer_id: 7, dabs: [{ x: 10, y: 10 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    };
    prior.verdict.verdict = 'neutral';
    prior.verdict.target_resolved = 'no';
    prior.verdict.significance.execution_effect = 'insufficient';
    s.write(prior);

    const same = s.collectPreflightErrors({
      ...request('same-strategy', 'photoshop_execute_visual_microplan', structuredClone(prior.args)),
      problem_id: 'form-problem',
      stage: 'FORM',
      scale: 'medium',
      replan: 'different words only',
    });
    expect(same.join('\n')).toMatch(/visual_significance_gate/);

    const changedArgs = structuredClone(prior.args);
    changedArgs.method_class = 'region';
    changedArgs.steps = [
      { id: 'block', tool: 'photoshop_paint_regions', args: { regions: [{ layer_id: 7 }] } },
      { id: 'preview', tool: 'photoshop_get_preview', args: {} },
    ];
    const changed = s.collectPreflightErrors({
      ...request('changed-strategy', 'photoshop_execute_visual_microplan', changedArgs),
      problem_id: 'form-problem',
      stage: 'FORM',
      scale: 'medium',
    });
    expect(changed.join('\n')).not.toMatch(/visual_significance_gate/);
  });

  it('recovers a completed document bootstrap from an exact command receipt and preserves the returned document id', () => {
    const s = store();
    const record = s.begin(request('bootstrap-completed', 'photoshop_create_document', {
      width: 1000,
      height: 700,
      resolution: 72,
      colorMode: 'RGB',
    })).record;
    s.markDispatched(record);
    const publicResult = {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          summary: 'Document created',
          details: {
            transport: 'uxp',
            command_id: 'bootstrap-completed',
            document: { id: 731, name: 'Untitled-1', width: 1000, height: 700, resolution: 72, colorMode: 'RGB' },
          },
        }),
      }],
    };
    const recovered = s.recoverDocumentBootstrap('bootstrap-completed', {
      command_id: 'bootstrap-completed',
      state: 'completed',
      result: { id: 'bootstrap-completed', ok: true },
    }, publicResult);

    expect(recovered).toMatchObject({
      phase: 'completed',
      failed: false,
      execution: 'completed',
      visual: false,
      bootstrap_outcome: { document_id: 731, command_id: 'bootstrap-completed' },
      resolved: { outcome: 'completed', evidence_mode: 'uxp_command_receipt' },
    });
    expect(recovered.operation_receipt?.token).toEqual(expect.any(String));
  });

  it('terminalizes an exact failed bootstrap without report, acknowledgement, preview, or visual debt', () => {
    const s = store();
    const record = s.begin(request('bootstrap-failed', 'photoshop_create_document', {
      width: 1000,
      height: 700,
    })).record;
    s.markDispatched(record);
    const recovered = s.recoverDocumentBootstrap('bootstrap-failed', {
      command_id: 'bootstrap-failed',
      state: 'failed',
      result: { id: 'bootstrap-failed', ok: false, error: 'photoshop_create_failed' },
    });
    const status = s.status();

    expect(recovered).toMatchObject({
      phase: 'completed', failed: true, execution: 'failed', visual: false, guard_ack_required: false,
      resolved: { outcome: 'failed', evidence_mode: 'uxp_command_receipt' },
    });
    expect(recovered.operation_receipt).toBeUndefined();
    expect(recovered.operation_ack).toBeUndefined();
    expect(recovered.preview).toBeUndefined();
    expect(status.pending_reports).not.toContain('bootstrap-failed');
    expect(status.pending_operation_acks).not.toContain('bootstrap-failed');
    expect(status.pending_visual_verdicts).not.toContain('bootstrap-failed');
    expect(status.uncertain).not.toContain('bootstrap-failed');
  });

  it('terminalizes a durable not-claimed bootstrap as not-executed with no closure debt', () => {
    const s = store();
    const record = s.begin(request('bootstrap-not-claimed', 'photoshop_create_document', {
      width: 1000,
      height: 700,
    })).record;
    s.markDispatched(record);
    const recovered = s.recoverDocumentBootstrap('bootstrap-not-claimed', {
      command_id: 'bootstrap-not-claimed',
      state: 'not-claimed',
      result: { id: 'bootstrap-not-claimed', ok: false, error: 'uxp_bridge_timeout' },
    });
    const status = s.status();

    expect(recovered).toMatchObject({
      phase: 'completed', failed: true, execution: 'not-executed', visual: false, guard_ack_required: false,
      resolved: { outcome: 'not-executed', evidence_mode: 'uxp_command_receipt' },
    });
    expect(s.hasDurableNotExecutedProof(recovered)).toBe(true);
    expect(status.pending_reports).not.toContain('bootstrap-not-claimed');
    expect(status.pending_operation_acks).not.toContain('bootstrap-not-claimed');
    expect(status.pending_visual_verdicts).not.toContain('bootstrap-not-claimed');
    expect(status.uncertain).not.toContain('bootstrap-not-claimed');
  });

  it('restores closure snapshot paths that were absent back to absent', () => {
    const s = store();
    const root = path.dirname(s.directory);
    const commentaryPath = path.join(root, 'processes', 'snapshot-absent-process', 'run-01', 'frames', 'frame-001.txt');
    const record = s.begin(request('snapshot-absent', 'photoshop_get_state', { document_id: 42 })).record;
    record.preview = { commentary_path: commentaryPath };
    s.write(record);

    const snapshot = s.snapshotClosureState(record.id);
    const barrier = s.visualBarrierFile(42);
    expect(snapshot.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: barrier, existed: false }),
      expect.objectContaining({ file: commentaryPath, existed: false }),
    ]));

    mkdirSync(path.dirname(barrier), { recursive: true });
    mkdirSync(path.dirname(commentaryPath), { recursive: true });
    writeFileSync(barrier, '{"planId":"created","requiresExternalPreview":true}');
    writeFileSync(commentaryPath, 'created during closure');
    expect(s.restoreClosureState(snapshot)).toBe(true);

    expect(existsSync(barrier)).toBe(false);
    expect(existsSync(commentaryPath)).toBe(false);
  });

  it('restores exact bytes for existing controller, barrier, commentary, and project-local painting state', () => {
    const s = store();
    const root = path.dirname(s.directory);
    const processDir = 'processes/snapshot-exact-process/run-01';
    s.setArtRunState({
      document_id: 42,
      process_dir: processDir,
      commentary_mode: 'technical',
      painting_profile: 'simple_graphic',
    });
    const projectState = path.join(root, ...processDir.split('/'), 'painting-state.json');
    const commentaryPath = path.join(root, ...processDir.split('/'), 'frames', 'frame-002.txt');
    const record = s.begin(request('snapshot-exact', 'photoshop_get_state', { document_id: 42 })).record;
    record.preview = { commentary_path: commentaryPath };
    s.write(record);

    const controllerBytes = Buffer.from(JSON.stringify({
      schema_version: RUNTIME_STATE_VERSION,
      version: 2,
      revision: 7,
      documents: { '42': { document_id: 42, process_dir: 'processes/snapshot-exact-process/run-01', painting_profile: 'simple_graphic', commentary_mode: 'technical', commentary_detail: 'normal' } },
    }, null, 2) + '\n');
    const barrierBytes = Buffer.from('{\n  "planId": "before",\n  "operationId": "snapshot-exact",\n  "requiresExternalPreview": true\n}\n');
    const commentaryBytes = Buffer.from('before closure\r\nsecond line\n');
    const projectBytes = Buffer.from([0x7b, 0x22, 0x70, 0x72, 0x6f, 0x6a, 0x65, 0x63, 0x74, 0x22, 0x3a, 0x31, 0x7d, 0x0a]);
    mkdirSync(path.dirname(s.visualBarrierFile(42)), { recursive: true });
    writeFileSync(s.paintingStateFile(), controllerBytes);
    writeFileSync(s.visualBarrierFile(42), barrierBytes);
    writeFileSync(commentaryPath, commentaryBytes);
    writeFileSync(projectState, projectBytes);

    const snapshot = s.snapshotClosureState(record.id);
    expect(snapshot.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: s.paintingStateFile(), existed: true }),
      expect.objectContaining({ file: s.visualBarrierFile(42), existed: true }),
      expect.objectContaining({ file: commentaryPath, existed: true }),
      expect.objectContaining({ file: projectState, existed: true }),
    ]));

    writeFileSync(s.paintingStateFile(), 'mutated-controller');
    writeFileSync(s.visualBarrierFile(42), 'mutated-barrier');
    writeFileSync(commentaryPath, 'mutated-commentary');
    writeFileSync(projectState, 'mutated-project');
    s.restoreClosureState(snapshot);

    expect(readFileSync(s.paintingStateFile())).toEqual(controllerBytes);
    expect(readFileSync(s.visualBarrierFile(42))).toEqual(barrierBytes);
    expect(readFileSync(commentaryPath)).toEqual(commentaryBytes);
    expect(readFileSync(projectState)).toEqual(projectBytes);
  });

  it('restores the operation journal and removes closure-created side state without leaving a partial closure', () => {
    const s = store();
    const root = path.dirname(s.directory);
    const processDir = 'processes/snapshot-atomic-process/run-01';
    s.setArtRunState({
      document_id: 42,
      process_dir: processDir,
      commentary_mode: 'technical',
      painting_profile: 'simple_graphic',
    });
    const projectState = path.join(root, ...processDir.split('/'), 'painting-state.json');
    rmSync(projectState, { force: true });
    const commentaryPath = path.join(root, ...processDir.split('/'), 'frames', 'frame-003.txt');
    const record = s.begin(request('snapshot-atomic', 'photoshop_get_state', { document_id: 42 })).record;
    record.preview = { commentary_path: commentaryPath };
    s.write(record);
    const operationBefore = readFileSync(s.file(record.id));
    const controllerBefore = readFileSync(s.paintingStateFile());
    const snapshot = s.snapshotClosureState(record.id);
    expect(snapshot.files).toEqual(expect.arrayContaining([
      expect.objectContaining({ file: projectState, existed: false }),
      expect.objectContaining({ file: s.visualBarrierFile(42), existed: false }),
      expect.objectContaining({ file: commentaryPath, existed: false }),
    ]));

    s.write({ ...record, report: { did: 'partial', why: 'partial', result: 'partial' }, operation_ack: { token: 'partial' } });
    mkdirSync(path.dirname(s.visualBarrierFile(42)), { recursive: true });
    writeFileSync(s.paintingStateFile(), '{"partial":true}');
    writeFileSync(projectState, '{"partial":true}');
    writeFileSync(s.visualBarrierFile(42), '{"planId":"partial","requiresExternalPreview":true}');
    writeFileSync(commentaryPath, 'partial commentary');

    s.restoreClosureState(snapshot);
    expect(readFileSync(s.file(record.id))).toEqual(operationBefore);
    expect(readFileSync(s.paintingStateFile())).toEqual(controllerBefore);
    expect(existsSync(projectState)).toBe(false);
    expect(existsSync(s.visualBarrierFile(42))).toBe(false);
    expect(existsSync(commentaryPath)).toBe(false);
  });

  it('allows a region-only scaffold before brush discovery, but not a mixed brush pass', () => {
    const s = store();
    s.setArtRunState({ document_id: 42, process_dir: 'processes/early-scaffold-process/run-01',
      commentary_mode: 'technical', painting_profile: 'nontrivial_painting' });
    const operation = {
      ...request('early-scaffold', 'photoshop_execute_visual_microplan', {
        document_id: 42, plan_id: 'scaffold', stage: 'GLOBAL_BLOCK_IN', method_class: 'region',
        steps: [{ tool: 'photoshop_paint_regions' }, { tool: 'photoshop_get_preview' }],
      }), problem_id: 'whole-image-masses', stage: 'GLOBAL_BLOCK_IN', scale: 'global',
    };
    expect(() => s.begin({ ...operation, args: { ...operation.args,
      steps: [
        { tool: 'photoshop_paint_regions' },
        { tool: 'photoshop_paint_strokes', args: { strokes: [{ tool: 'BRUSH', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] } },
        { tool: 'photoshop_get_preview' },
      ],
    } })).toThrow(/brush_preflight_required/);
    expect(s.begin(operation).record.phase).toBe('started');
  });
  it('fails closed on non-trivial painting until live brush preflight is persisted and blocks raw paint bypass', () => {
    const s = store();
    s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/brush-gate-process/run-01',
      commentary_mode: 'technical',
      painting_profile: 'nontrivial_painting',
    });

    expect(() => s.begin({
      ...request('before-preflight', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'before-preflight-plan',
        stage: 'FORM',
        scale: 'medium',
        method_class: 'paint',
        steps: [{ tool: 'photoshop_paint_strokes', args: { strokes: [{ tool: 'BRUSH', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] } }],
      }),
      problem_id: 'brush-form',
      stage: 'FORM',
      scale: 'medium',
    })).toThrow(/brush_preflight_required/);

    const configured = s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/brush-gate-process/run-01',
      brush_preflight: brushPreflight(),
    });
    expect(configured.brush_preflight.completed).toBe(true);

    expect(() => s.begin({
      ...request('unknown-brush-role', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'unknown-brush-role-plan',
        stage: 'FORM',
        scale: 'medium',
        method_class: 'preset-brush',
        paint_strategy: {
          material_role: 'water',
          visual_intent: 'surface-flow',
          brush_role: 'invented-role',
          preset_name: 'Water Brush',
          pressure_policy: 'simulated-size-opacity',
        },
      }),
      problem_id: 'water-flow',
      stage: 'FORM',
      scale: 'medium',
    })).toThrow(/brush_role_not_preflighted/);

    expect(() => s.begin({
      ...request('wrong-brush-preset', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'wrong-brush-preset-plan',
        stage: 'FORM',
        scale: 'medium',
        method_class: 'preset-brush',
        paint_strategy: {
          material_role: 'water',
          visual_intent: 'surface-flow',
          brush_role: 'water-flow',
          preset_name: 'Uninventoried Brush',
          pressure_policy: 'simulated-size-opacity',
        },
      }),
      problem_id: 'water-flow',
      stage: 'FORM',
      scale: 'medium',
    })).toThrow(/brush_preset_not_preflighted/);

    expect(() => s.begin({
      ...request('raw-paint-bypass', 'photoshop_paint_strokes', {
        document_id: 42,
        strokes: [{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }],
      }),
      problem_id: 'water-flow',
      stage: 'FORM',
      scale: 'medium',
    })).toThrow(/visual_microplan_required/);

    expect(() => s.begin({
      ...request('missing-paint-strategy', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'missing-paint-strategy-plan',
        stage: 'FORM',
        scale: 'medium',
        method_class: 'paint',
      }),
      problem_id: 'water-flow',
      stage: 'FORM',
      scale: 'medium',
    })).toThrow(/paint_strategy_required/);

    const admitted = s.begin({
      ...request('preflighted-brush-plan', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'preflighted-brush-plan',
        stage: 'FORM',
        scale: 'medium',
        method_class: 'preset-brush',
        paint_strategy: {
          material_role: 'water',
          visual_intent: 'surface-flow',
          brush_role: 'water-flow',
          preset_name: 'Water Brush',
          pressure_policy: 'simulated-size-opacity',
        },
      }),
      problem_id: 'water-flow',
      stage: 'FORM',
      scale: 'medium',
    }).record;
    expect(admitted.phase).toBe('started');
  });

  it('validates brush-preflight intents and restores the durable role map in a fresh SessionStore', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'session-store-brush-preflight-reload-'));
    dirs.push(dir);
    const options = {
      visualBarrierDirectory: path.join(dir, 'barriers'),
      workspaceRoot: dir,
    };
    const controller = path.join(dir, 'controller');
    const first = new SessionStore(controller, options);

    const invalid = brushPreflight();
    invalid.roles[0]!.visual_intents = ['invented-polygon-painter'];
    expect(() => first.setArtRunState({
      document_id: 42,
      process_dir: 'processes/brush-reload-process/run-01',
      painting_profile: 'nontrivial_painting',
      brush_preflight: invalid,
    })).toThrow(/unsupported intent/);

    first.setArtRunState({
      document_id: 42,
      process_dir: 'processes/brush-reload-process/run-01',
      painting_profile: 'nontrivial_painting',
      brush_preflight: brushPreflight(),
    });

    const restarted = new SessionStore(controller, options);
    expect(restarted.artRunState(42)?.brush_preflight).toMatchObject({
      completed: true,
      inventory_observed: true,
      inventory_total: 123,
      roles: [expect.objectContaining({
        role_id: 'water-flow',
        preferred_preset: 'Water Brush',
        pressure_policy: 'simulated-size-opacity',
      })],
    });
  });

  it('admits a known-good microplan wrapper only after art-run and clean-state Guard prerequisites are satisfied', () => {
    const s = store();
    s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/session-regression-process/known-good-run',
      commentary_mode: 'artistic',
      painting_profile: 'simple_graphic',
    });
    const record = s.begin({
      ...request('known-good-guard', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'known-good-region-plan',
      }),
      problem_id: 'recognition-atmosphere',
      stage: 'recognition-block-in',
      scale: 'global',
      severity: 'must-fix',
      artistic_commentary: 'Закладываю общую атмосферу крупным спокойным цветовым полем.',
    }).record;
    expect(record.phase).toBe('started');
    expect(record.visual).toBe(true);
    expect(s.visualBarrier(42)).toBeUndefined();
    s.markDispatched(record);
    expect(s.visualBarrier(42)).toMatchObject({
      planId: 'known-good-region-plan',
      operationId: 'known-good-guard',
      operationSequence: record.sequence,
      requiresExternalPreview: true,
    });
  });

  it('auto-closes a legacy invalid-plan barrier as not-executed without report, ack, preview, or verdict debt', () => {
    const s = store();
    s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/session-regression-process/run-01',
      commentary_mode: 'technical',
      painting_profile: 'simple_graphic',
    });
    const uncertain = s.begin({
      ...request('invalid-plan', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'invalid-plan',
      }),
      problem_id: 'invalid-plan-validation',
    }).record;
    s.markDispatched(uncertain);
    s.complete(uncertain, {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: false,
          code: 'invalid_visual_microplan',
          message: 'simulated legacy parser rejection before mutation dispatch',
        }),
      }],
    });
    expect(s.visualBarrier(42)?.planId).toBe('invalid-plan');
    expect(s.visualBarrier(42)?.operationId).toBe('invalid-plan');
    const status = s.status();
    const resolved = s.read('invalid-plan')!;
    expect(resolved.phase).toBe('completed');
    expect(resolved.visual).toBe(false);
    expect(resolved.execution).toBe('not-executed');
    expect(s.visualBarrier(42)).toBeUndefined();
    expect(status.pending_reports).not.toContain('invalid-plan');
    expect(status.pending_operation_acks).not.toContain('invalid-plan');
    expect(status.pending_visual_verdicts).not.toContain('invalid-plan');
    expect(status.uncertain).not.toContain('invalid-plan');

    const next = s.begin(request('state-after-invalid', 'photoshop_get_state', { document_id: 42 })).record;
    expect(next.phase).toBe('started');
  });

  it('never classifies a successful visual mutation as not-executed', () => {
    const s = store();
    s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/session-regression-process/successful-mutation',
      commentary_mode: 'technical',
      painting_profile: 'simple_graphic',
    });
    const record = s.begin({
      ...request('successful-plan', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'successful-plan',
      }),
      problem_id: 'successful-plan-test',
    }).record;
    s.markDispatched(record);
    s.complete(record, {
      content: [{ type: 'text', text: JSON.stringify({
        ok: true,
        mutation_ok: true,
        mutation_count: 1,
        mutation_results: { paint: { ok: true } },
      }) }],
    });

    const completed = s.read('successful-plan')!;
    expect(s.hasDurableNotExecutedProof(completed)).toBe(false);
    expect(completed.execution).not.toBe('not-executed');
    const status = s.status();
    expect(status.pending_visual_verdicts).toContain('successful-plan');
    expect(s.visualBarrier(42)?.operationId).toBe('successful-plan');
  });

  it('does not treat matching post-state and preview as proof of not-executed after a generic uncertain failure', () => {
    const s = store();
    s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/session-regression-process/run-02',
      commentary_mode: 'technical',
      painting_profile: 'simple_graphic',
    });
    const uncertain = s.begin({
      ...request('timeout-plan', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'timeout-plan',
      }),
      problem_id: 'timeout-validation',
    }).record;
    s.markDispatched(uncertain);
    s.fail(uncertain, new Error('simulated timeout after dispatch'));
    closeReportAndAck(s, 'timeout-plan');

    const state = s.begin(request('state-after-timeout', 'photoshop_get_state', { document_id: 42 })).record;
    s.complete(state, { content: [{ type: 'text', text: JSON.stringify({ ok: true, hasDocument: true }) }] });
    closeReportAndAck(s, 'state-after-timeout');

    const previewPath = path.join(s.directory, 'same-looking-frame.jpg');
    writeFileSync(previewPath, 'same-looking-frame');
    const sha256 = createHash('sha256').update('same-looking-frame').digest('hex');
    const preview = s.begin(request('preview-after-timeout', 'photoshop_get_preview', { document_id: 42 })).record;
    s.complete(preview, {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, sha256, materialized_path: previewPath, width: 1, height: 1, mime_type: 'image/jpeg' }),
      }],
    });
    closeReportAndAck(s, 'preview-after-timeout');

    expect(() => s.reconcile({
      id: 'timeout-plan',
      state_id: 'state-after-timeout',
      preview_id: 'preview-after-timeout',
      outcome: 'not-executed',
      reason: 'The fresh state and preview look unchanged, but no original pre-dispatch execution proof exists',
    })).toThrow(/durable pre-dispatch evidence/);
    expect(s.visualBarrier(42)?.operationId).toBe('timeout-plan');
  });

  it('attaches fresh recovery preview when a visual timeout is reconciled as partial', () => {
    const s = store();
    s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/session-regression-process/partial-preview-recovery',
      commentary_mode: 'technical',
      painting_profile: 'simple_graphic',
    });
    const uncertain = s.begin({
      ...request('partial-preview-plan', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'partial-preview-plan',
      }),
      problem_id: 'partial-preview-recovery',
    }).record;
    s.markDispatched(uncertain);
    s.fail(uncertain, new Error('simulated timeout after partial visual mutation'));
    closeReportAndAck(s, 'partial-preview-plan');

    const state = s.begin(request('partial-preview-state', 'photoshop_get_state', { document_id: 42 })).record;
    s.complete(state, { content: [{ type: 'text', text: JSON.stringify({ ok: true, hasDocument: true }) }] });
    closeReportAndAck(s, 'partial-preview-state');

    const previewPath = path.join(s.directory, 'partial-recovery-frame.jpg');
    writeFileSync(previewPath, 'partial-recovery-frame');
    const sha256 = createHash('sha256').update('partial-recovery-frame').digest('hex');
    const preview = s.begin(request('partial-preview-frame', 'photoshop_get_preview', { document_id: 42 })).record;
    s.complete(preview, {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, sha256, materialized_path: previewPath, width: 1, height: 1, mime_type: 'image/jpeg' }),
      }],
    });
    closeReportAndAck(s, 'partial-preview-frame');

    s.reconcile({
      id: 'partial-preview-plan',
      state_id: 'partial-preview-state',
      preview_id: 'partial-preview-frame',
      outcome: 'partial',
      reason: 'Fresh same-document state and preview prove that a partial visual result remains and is safe to classify.',
    });

    const recovered = s.read('partial-preview-plan')!;
    expect(recovered.phase).toBe('completed');
    expect(recovered.execution).toBe('partial');
    expect(recovered.preview?.sha256).toBe(sha256);
    expect(recovered.preview?.document_id).toBe(42);
    expect(s.visualBarrier(42)).toMatchObject({
      operationId: 'partial-preview-plan',
      sha256,
      requiresExternalPreview: false,
    });
  });

  it('upgrades a legacy reconciled partial visual record that is missing its attached recovery preview', () => {
    const s = store();
    s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/session-regression-process/legacy-partial-preview-recovery',
      commentary_mode: 'technical',
      painting_profile: 'simple_graphic',
    });
    const uncertain = s.begin({
      ...request('legacy-partial-preview-plan', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'legacy-partial-preview-plan',
      }),
      problem_id: 'legacy-partial-preview-recovery',
    }).record;
    s.markDispatched(uncertain);
    s.fail(uncertain, new Error('simulated timeout after partial visual mutation'));
    closeReportAndAck(s, 'legacy-partial-preview-plan');

    const state = s.begin(request('legacy-partial-preview-state', 'photoshop_get_state', { document_id: 42 })).record;
    s.complete(state, { content: [{ type: 'text', text: JSON.stringify({ ok: true, hasDocument: true }) }] });
    closeReportAndAck(s, 'legacy-partial-preview-state');

    const previewPath = path.join(s.directory, 'legacy-partial-recovery-frame.jpg');
    writeFileSync(previewPath, 'legacy-partial-recovery-frame');
    const sha256 = createHash('sha256').update('legacy-partial-recovery-frame').digest('hex');
    const preview = s.begin(request('legacy-partial-preview-frame', 'photoshop_get_preview', { document_id: 42 })).record;
    s.complete(preview, {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, sha256, materialized_path: previewPath, width: 1, height: 1, mime_type: 'image/jpeg' }),
      }],
    });
    closeReportAndAck(s, 'legacy-partial-preview-frame');

    const legacy = s.read('legacy-partial-preview-plan')!;
    legacy.phase = 'completed';
    legacy.failed = false;
    legacy.execution = 'partial';
    legacy.resolved = {
      id: 'legacy-partial-preview-plan',
      state_id: 'legacy-partial-preview-state',
      preview_id: 'legacy-partial-preview-frame',
      outcome: 'partial',
      reason: 'Legacy runtime settled the partial execution but failed to attach its recovery preview.',
      at: new Date().toISOString(),
    };
    if (legacy.error) {
      legacy.recovery_original_error = legacy.error;
      delete legacy.error;
    }
    delete legacy.preview;
    delete legacy.preview_attached_at;
    s.write(legacy);

    s.reconcile({
      id: 'legacy-partial-preview-plan',
      state_id: 'legacy-partial-preview-state',
      preview_id: 'legacy-partial-preview-frame',
      outcome: 'partial',
      reason: 'Idempotent recovery upgrade attaches the already verified fresh preview without changing the settled partial outcome.',
    });

    const recovered = s.read('legacy-partial-preview-plan')!;
    expect(recovered.phase).toBe('completed');
    expect(recovered.execution).toBe('partial');
    expect(recovered.preview?.sha256).toBe(sha256);
    expect(recovered.preview?.document_id).toBe(42);
    expect(s.visualBarrier(42)).toMatchObject({
      operationId: 'legacy-partial-preview-plan',
      sha256,
      requiresExternalPreview: false,
    });
    expect(() => s.reconcile({
      id: 'legacy-partial-preview-plan',
      state_id: 'legacy-partial-preview-state',
      preview_id: 'legacy-partial-preview-frame',
      outcome: 'completed',
      reason: 'A legacy preview attachment must not be allowed to upgrade the already settled execution outcome.',
    })).toThrow('Expected an interrupted or uncertain operation');
  });

  it('does not clear a newer barrier that reuses the same plan id', () => {
    const s = store();
    s.setArtRunState({
      document_id: 42,
      process_dir: 'processes/session-regression-process/run-03',
      commentary_mode: 'technical',
      painting_profile: 'simple_graphic',
    });
    const uncertain = s.begin({
      ...request('old-operation', 'photoshop_execute_visual_microplan', {
        document_id: 42,
        plan_id: 'reused-plan',
      }),
      problem_id: 'legacy-validation',
    }).record;
    s.markDispatched(uncertain);
    s.complete(uncertain, {
      isError: true,
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: false, code: 'invalid_visual_microplan', message: 'legacy parser rejection' }),
      }],
    });
    closeReportAndAck(s, 'old-operation');

    const state = s.begin(request('state-after-old', 'photoshop_get_state', { document_id: 42 })).record;
    s.complete(state, { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] });
    closeReportAndAck(s, 'state-after-old');
    const previewPath = path.join(s.directory, 'old-frame.jpg');
    writeFileSync(previewPath, 'old-frame');
    const sha256 = createHash('sha256').update('old-frame').digest('hex');
    const preview = s.begin(request('preview-after-old', 'photoshop_get_preview', { document_id: 42 })).record;
    s.complete(preview, {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, sha256, materialized_path: previewPath, width: 1, height: 1, mime_type: 'image/jpeg' }),
      }],
    });
    closeReportAndAck(s, 'preview-after-old');

    s.setVisualBarrier(42, {
      planId: 'reused-plan',
      operationId: 'newer-operation',
      operationSequence: 999,
      requiresExternalPreview: true,
    });
    s.reconcile({
      id: 'old-operation',
      state_id: 'state-after-old',
      preview_id: 'preview-after-old',
      outcome: 'not-executed',
      reason: 'The original parser result proves the old operation never reached mutation dispatch',
    });
    expect(s.visualBarrier(42)?.operationId).toBe('newer-operation');
  });

  it('accepts root-level documents arrays as closed-document reconciliation evidence', () => {
    const s = store();
    const uncertain = s.begin(request('uncertain-save', 'photoshop_save_document', {
      document_id: 42,
      path: 'unused-test-path.psd',
      format: 'PSD',
    })).record;
    uncertain.dispatched = true;
    s.fail(uncertain, new Error('simulated interrupted save'));
    closeReportAndAck(s, 'uncertain-save');

    const documents = s.begin(request('documents-after-close', 'photoshop_list_documents')).record;
    s.complete(documents, {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, count: 0, documents: [], active_document_id: null }),
      }],
    });

    const resolved = s.reconcile({
      id: 'uncertain-save',
      documents_id: 'documents-after-close',
      document_closed_confirmed: true,
      outcome: 'abandoned',
      reason: 'The user confirmed document 42 was closed and fresh root-level document evidence shows it absent',
    });

    expect(resolved.resolved.evidence_mode).toBe('document_absent');
    expect(resolved.resolved.target_document_id).toBe(42);
  });

  it('allows fresh read-only reconciliation evidence before report debt is closed on an uncertain operation', () => {
    const s = store();
    const uncertain = s.begin({
      ...request('uncertain-selection', 'photoshop_select_rectangle', {
        document_id: 42,
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
      }),
      problem_id: 'uncertain-selection-problem',
    }).record;
    s.markDispatched(uncertain);
    s.fail(uncertain, new Error('simulated uncertain selection failure'));

    const stateErrors = s.collectPreflightErrors(request('reconcile-state', 'photoshop_get_state', {
      document_id: 42,
    }));
    const previewErrors = s.collectPreflightErrors(request('reconcile-preview', 'photoshop_get_preview', {
      document_id: 42,
    }));
    expect(stateErrors.some(error => error.includes('Report required for uncertain-selection'))).toBe(false);
    expect(previewErrors.some(error => error.includes('Report required for uncertain-selection'))).toBe(false);
    expect(stateErrors.some(error => error.includes('Uncertain operation uncertain-selection'))).toBe(false);
    expect(previewErrors.some(error => error.includes('Uncertain operation uncertain-selection'))).toBe(false);

    const mutationErrors = s.collectPreflightErrors(request('blocked-mutation', 'photoshop_fill_layer', {
      document_id: 42,
      red: 10,
      green: 20,
      blue: 30,
    }));
    expect(mutationErrors.some(error => error.includes('Report required for uncertain-selection'))).toBe(true);
    expect(mutationErrors.some(error => error.includes('Uncertain operation uncertain-selection'))).toBe(true);
  });

  it('reclassifies a reconciled selection as completed non-visual configuration state', () => {
    const s = store();
    const uncertain = s.begin({
      ...request('selection-reconcile-completed', 'photoshop_select_rectangle', {
        document_id: 42,
        left: 0,
        top: 0,
        right: 100,
        bottom: 100,
      }),
      problem_id: 'selection-reconcile-problem',
    }).record;
    s.markDispatched(uncertain);
    s.fail(uncertain, new Error('simulated transport/modal response ambiguity'));

    const state = s.begin(request('selection-reconcile-state', 'photoshop_get_state', { document_id: 42 })).record;
    s.complete(state, { content: [{ type: 'text', text: JSON.stringify({ ok: true, document: { id: 42 }, hasSelection: true }) }] });
    closeReportAndAck(s, 'selection-reconcile-state');
    const previewPath = path.join(s.directory, 'selection-reconcile-preview.jpg');
    writeFileSync(previewPath, 'selection-reconcile-preview');
    const previewSha = createHash('sha256').update('selection-reconcile-preview').digest('hex');
    const preview = s.begin(request('selection-reconcile-preview', 'photoshop_get_preview', { document_id: 42 })).record;
    s.complete(preview, {
      content: [{ type: 'text', text: JSON.stringify({ ok: true, sha256: previewSha, materialized_path: previewPath }) }],
    });
    closeReportAndAck(s, 'selection-reconcile-preview');

    s.reconcile({
      id: 'selection-reconcile-completed',
      state_id: 'selection-reconcile-state',
      preview_id: 'selection-reconcile-preview',
      outcome: 'completed',
      reason: 'Fresh same-document evidence proves the requested selection postcondition is present.',
    });

    const record = s.read('selection-reconcile-completed')!;
    expect(record).toMatchObject({
      phase: 'completed',
      failed: false,
      execution: 'completed',
      visual: false,
      resolved: { outcome: 'completed' },
    });
    expect(s.statusCompact().pending_visual_verdicts).not.toContain('selection-reconcile-completed');
  });

  it('treats closed-document abandonment as terminal for report, ack, verdict, resume, and preflight debt', () => {
    const s = store();
    const abandoned = s.begin({
      ...request('abandoned-visual', 'photoshop_delete_layer', {
        document_id: 42,
        layer_id: 7,
      }),
      problem_id: 'abandoned-visual-problem',
    }).record;
    abandoned.dispatched = true;
    abandoned.preview = {
      sha256: 'a'.repeat(64),
      materialized_path: path.join(s.directory, 'abandoned-visual.jpg'),
    };
    s.fail(abandoned, new Error('simulated interrupted visual mutation'));
    closeReportAndAck(s, 'abandoned-visual');

    const documents = s.begin(request('documents-after-abandoned-visual', 'photoshop_list_documents')).record;
    s.complete(documents, {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, details: { count: 0, documents: [], active_document_id: null } }),
      }],
    });

    s.reconcile({
      id: 'abandoned-visual',
      documents_id: 'documents-after-abandoned-visual',
      document_closed_confirmed: true,
      outcome: 'abandoned',
      reason: 'The user confirmed document 42 was closed and fresh document evidence proves it is absent',
    });

    const historical = s.read('abandoned-visual')!;
    delete historical.report;
    historical.operation_receipt = {
      protocol: 'photoshop.guard.operation_receipt.v1',
      operation_id: 'abandoned-visual',
      token: 'historical-abandoned-token',
      issued_at: new Date().toISOString(),
      phase: 'completed',
      execution: 'completed',
    };
    delete historical.operation_ack;
    s.write(historical);

    const compact = s.statusCompact();
    expect(compact.uncertain).not.toContain('abandoned-visual');
    expect(compact.pending_reports).not.toContain('abandoned-visual');
    expect(compact.pending_operation_acks).not.toContain('abandoned-visual');
    expect(compact.pending_visual_verdicts).not.toContain('abandoned-visual');
    expect(compact.documents['42']?.continuation_watch?.phase).not.toBe('awaiting_report');
    expect(compact.documents['42']?.continuation_watch?.phase).not.toBe('awaiting_operation_ack');
    expect(compact.documents['42']?.workflow_lifecycle).toMatchObject({
      status: 'stopped',
      reason: 'abandoned_document_absent',
      operation_id: 'abandoned-visual',
    });
    expect(compact.documents['42']?.visual_cadence?.active_visual_workflow).toBe(false);
    expect(s.resume(42).pending_visual_verdict).toBeNull();

    const errors = s.collectPreflightErrors(request('fresh-read-after-abandonment', 'photoshop_get_state', {
      document_id: 42,
    }));
    expect(errors.some(error => error.includes('Report required for abandoned-visual'))).toBe(false);
  });

  it('scans operation records, painting state, and all jobs once per statusCompact projection request', () => {
    const s = store();
    writeProjectionPaintingState(s, [11, 22, 33]);
    createProjectionJob(s, 'projection-job-a', 11);
    createProjectionJob(s, 'projection-job-b', 22);
    const completed = createProjectionJob(s, 'projection-job-completed', 33);
    writeJobCompleted(completed.dir, 0);

    const recordsSpy = vi.spyOn(s, 'records');
    const paintingSpy = vi.spyOn(s, 'paintingState');
    const activeJobsSpy = vi.spyOn(s, 'activeJobs');
    const readJobSpy = vi.spyOn(s, 'readJobProjection');

    const compact = s.statusCompact();

    expect(recordsSpy).toHaveBeenCalledTimes(1);
    expect(paintingSpy).toHaveBeenCalledTimes(1);
    expect(activeJobsSpy).toHaveBeenCalledTimes(1);
    expect(readJobSpy).toHaveBeenCalledTimes(3);
    expect(compact.active_jobs.map((job: any) => job.operation_id)).toEqual([
      'projection-job-a',
      'projection-job-b',
    ]);
  });

  it('captures one fresh projection for full status and one fresh projection for resume', () => {
    const s = store();
    writeProjectionPaintingState(s, [34]);
    createProjectionJob(s, 'projection-job-status-resume', 34);
    writeProjectionRecord(s, {
      id: 'projection-record-status-resume',
      documentId: 34,
      sequence: 1,
      report: true,
      ack: true,
    });

    const recordsSpy = vi.spyOn(s, 'records');
    const paintingSpy = vi.spyOn(s, 'paintingState');
    const activeJobsSpy = vi.spyOn(s, 'activeJobs');
    const readJobSpy = vi.spyOn(s, 'readJobProjection');

    s.status();
    expect(recordsSpy).toHaveBeenCalledTimes(1);
    expect(paintingSpy).toHaveBeenCalledTimes(1);
    expect(activeJobsSpy).toHaveBeenCalledTimes(1);
    expect(readJobSpy).toHaveBeenCalledTimes(1);

    recordsSpy.mockClear();
    paintingSpy.mockClear();
    activeJobsSpy.mockClear();
    readJobSpy.mockClear();

    s.resume(34);
    expect(recordsSpy).toHaveBeenCalledTimes(1);
    expect(paintingSpy).toHaveBeenCalledTimes(1);
    expect(activeJobsSpy).toHaveBeenCalledTimes(1);
    expect(readJobSpy).toHaveBeenCalledTimes(1);
  });

  it('reuses supplied projection snapshots throughout cadence, continuation watch, and next-action calculations', () => {
    const s = store();
    writeProjectionPaintingState(s, [41, 42]);
    createProjectionJob(s, 'projection-job-nested', 41);
    writeProjectionRecord(s, {
      id: 'projection-record-nested',
      documentId: 41,
      sequence: 1,
      report: true,
      ack: true,
    });
    const context = s.captureProjectionContext();

    const recordsSpy = vi.spyOn(s, 'records');
    const paintingSpy = vi.spyOn(s, 'paintingState');
    const activeJobsSpy = vi.spyOn(s, 'activeJobs');
    const readJobSpy = vi.spyOn(s, 'readJobProjection');

    s.visualCadenceState(41, context.records, context);
    s.continuationWatchState(41, context.records, context);
    s.documentNextRequiredAction(41, context.records, context);
    s.checkpointState(41, context.records, context);
    s.recognitionMetrics(41, context.records, context);
    s.latencySummary(41, context.records, context);
    s.synchronizeVisualBarrier(41, context.records, context);

    expect(recordsSpy).not.toHaveBeenCalled();
    expect(paintingSpy).not.toHaveBeenCalled();
    expect(activeJobsSpy).not.toHaveBeenCalled();
    expect(readJobSpy).not.toHaveBeenCalled();
  });

  it('filters document active jobs from an in-memory snapshot with the same result as a fresh filtered scan', () => {
    const s = store();
    writeProjectionPaintingState(s, [51, 52]);
    createProjectionJob(s, 'projection-job-51-a', 51);
    createProjectionJob(s, 'projection-job-52', 52);
    createProjectionJob(s, 'projection-job-51-b', 51);

    const context = s.captureProjectionContext();
    const fromSnapshot = s.activeJobs(51, context.activeJobs, context.capturedAt);
    const fromFreshScan = s.activeJobs(51, undefined, context.capturedAt);

    expect(fromSnapshot).toEqual(fromFreshScan);
    expect(fromSnapshot.map((job: any) => job.operation_id)).toEqual([
      'projection-job-51-a',
      'projection-job-51-b',
    ]);
  });

  it('captures fresh active-job state on each separate statusCompact request', () => {
    const s = store();
    writeProjectionPaintingState(s, [61]);
    const created = createProjectionJob(s, 'projection-job-freshness', 61);

    const first = s.statusCompact();
    expect(first.active_jobs.map((job: any) => job.operation_id)).toContain('projection-job-freshness');
    expect(first.documents['61']?.visual_cadence?.blockers?.active_job).toBe(created.jobId);

    writeJobCompleted(created.dir, 0);

    const second = s.statusCompact();
    expect(second.active_jobs.map((job: any) => job.operation_id)).not.toContain('projection-job-freshness');
    expect(second.documents['61']?.visual_cadence?.blockers?.active_job).toBeNull();
  });

  it('keeps corrupt or partial jobs isolated while returning healthy jobs from status projection', () => {
    const s = store();
    writeProjectionPaintingState(s, [71]);
    createProjectionJob(s, 'projection-job-healthy', 71);
    const corruptDir = path.join(s.directory, 'jobs', 'job-corrupt-partial');
    mkdirSync(corruptDir, { recursive: true });
    writeFileSync(path.join(corruptDir, 'job.json'), '{not-json');
    writeFileSync(path.join(corruptDir, 'input.json'), JSON.stringify({
      next_operation: {
        id: 'projection-job-corrupt',
        tool: 'photoshop_get_state',
        args: { document_id: 71 },
        summary: 'Corrupt job fixture',
        purpose: 'Must not make status unavailable',
      },
    }));

    expect(() => s.statusCompact()).not.toThrow();
    const compact = s.statusCompact();
    expect(compact.active_jobs.map((job: any) => job.operation_id)).toEqual(['projection-job-healthy']);
  });

  it('preserves legacy nested status semantics when the same records, painting state, jobs, and clock are projected once', () => {
    const s = store();
    const fixedNow = Date.UTC(2026, 8, 20, 12, 10, 0);
    vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    writeProjectionPaintingState(s, [81, 82]);
    writeProjectionRecord(s, {
      id: 'projection-accepted-visual',
      documentId: 81,
      sequence: 1,
      visual: true,
      report: true,
      ack: true,
      verdict: true,
    });
    writeProjectionRecord(s, {
      id: 'projection-pending-visual',
      documentId: 81,
      sequence: 2,
      visual: true,
      report: true,
      ack: true,
      verdict: false,
    });
    writeProjectionRecord(s, {
      id: 'projection-uncertain-read',
      documentId: 82,
      sequence: 3,
      phase: 'started',
      report: false,
      ack: false,
    });
    createProjectionJob(s, 'projection-job-parity', 82);

    const legacyRecords = s.records();
    const legacyState = s.paintingState();
    const legacyActiveJobs = s.activeJobs(undefined, undefined, fixedNow);
    const legacyDocumentIds = [...new Set([
      ...legacyRecords.map((record: any) => record.args?.document_id).filter((id: any) => Number.isSafeInteger(id) && id > 0),
      ...Object.keys(legacyState.documents ?? {}).map(Number).filter(id => Number.isSafeInteger(id) && id > 0),
    ])];
    const legacyDocuments = Object.fromEntries(legacyDocumentIds.map(documentId => [String(documentId), {
      visual_cadence: s.visualCadenceState(documentId, legacyRecords),
      continuation_watch: s.continuationWatchState(documentId, legacyRecords),
      next_required_action: s.documentNextRequiredAction(documentId, legacyRecords),
      recognition_metrics: s.recognitionMetrics(documentId, legacyRecords),
      latency_summary: s.latencySummary(documentId, legacyRecords),
    }]));

    const compact = s.statusCompact();

    expect(compact.pending_reports).toEqual(
      legacyRecords
        .filter((record: any) => record.execution !== 'not-executed' && record.resolved?.outcome !== 'abandoned' && !record.report)
        .map((record: any) => record.id)
    );
    expect(compact.pending_operation_acks).toEqual(
      legacyRecords
        .filter((record: any) => record.execution !== 'not-executed' && record.resolved?.outcome !== 'abandoned'
          && record.operation_receipt && !record.operation_ack)
        .map((record: any) => record.id)
    );
    expect(compact.pending_visual_verdicts).toEqual(
      legacyRecords.filter((record: any) => record.visual && !record.verdict).map((record: any) => record.id)
    );
    expect(compact.uncertain).toEqual(
      legacyRecords.filter((record: any) => record.phase !== 'completed' && !record.resolved).map((record: any) => record.id)
    );
    expect(compact.active_jobs).toEqual(legacyActiveJobs);
    for (const documentId of legacyDocumentIds) {
      expect(compact.documents[String(documentId)]?.visual_cadence).toEqual(legacyDocuments[String(documentId)].visual_cadence);
      expect(compact.documents[String(documentId)]?.continuation_watch).toEqual(legacyDocuments[String(documentId)].continuation_watch);
      expect(compact.documents[String(documentId)]?.next_required_action).toBe(legacyDocuments[String(documentId)].next_required_action);
      expect(compact.documents[String(documentId)]?.recognition_metrics).toEqual(legacyDocuments[String(documentId)].recognition_metrics);
      expect(compact.documents[String(documentId)]?.latency_summary).toEqual(legacyDocuments[String(documentId)].latency_summary);
    }
    expect(compact.next_required_action).toBe(legacyActiveJobs.at(-1)?.poll_command);
  });

  it('reads a closed legacy visual verdict without creating new closure debt and does not keep a run active from current_stage alone', () => {
    const s = store();
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 20, 12, 0, 30));
    writeProjectionPaintingState(s, [91]);
    writeProjectionRecord(s, {
      id: 'legacy-closed-visual',
      documentId: 91,
      sequence: 1,
      visual: true,
      report: true,
      ack: true,
      verdict: true,
    });

    const legacy = s.read('legacy-closed-visual')!;
    expect(legacy.verdict?.observations).toBeUndefined();
    expect(legacy.verdict?.goal_assessment).toBeUndefined();

    const compact = s.statusCompact();
    expect(compact.pending_reports).not.toContain('legacy-closed-visual');
    expect(compact.pending_operation_acks).not.toContain('legacy-closed-visual');
    expect(compact.pending_visual_verdicts).not.toContain('legacy-closed-visual');
    expect(compact.documents['91'].visual_cadence.active_visual_workflow).toBe(false);
    expect(compact.documents['91'].continuation_watch.active_visual_workflow).toBe(false);
    expect(compact.documents['91'].next_required_action).toBe('ready');

    const resumed = s.resume(91);
    expect(resumed.pending_visual_verdict).toBeNull();
    expect(resumed.next_required_action).toBe('ready');
  });

  it('stops legacy diagnostic-style continuation after a later closed save without resolving open visual problems', () => {
    const s = store();
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 20, 12, 1, 0));
    mkdirSync(path.dirname(s.paintingStateFile()), { recursive: true });
    writeFileSync(s.paintingStateFile(), JSON.stringify({
      schema_version: RUNTIME_STATE_VERSION,
      version: 2,
      revision: 1,
      documents: {
        '5003': {
          document_id: 5003,
          process_dir: 'processes/brush-trace-diagnostic-process/run-01',
          painting_profile: 'simple_graphic',
          current_stage: 'SHAPE',
          active_scale: 'global',
          visual_problems: {
            'brush-diag-round-trace': {
              problem_id: 'brush-diag-round-trace',
              scale: 'global',
              severity: 'must-fix',
              status: 'open',
            },
            'brush-diag-soft-trace': {
              problem_id: 'brush-diag-soft-trace',
              scale: 'global',
              severity: 'must-fix',
              status: 'open',
            },
            'cumulative-trend-pressure-taper-visible': {
              problem_id: 'cumulative-trend-pressure-taper-visible',
              scale: 'global',
              severity: 'must-fix',
              status: 'open',
            },
          },
          active_problem: {
            problem_id: 'cumulative-trend-pressure-taper-visible',
            scale: 'global',
            severity: 'must-fix',
            status: 'open',
          },
          last_critique: {
            operation_id: 'brush_diag_soft_ab_005',
            verdict: 'neutral',
            disposition: 'accept',
            target_resolved: 'uncertain',
            uncertainty: 'Brush diagnostic evidence remains intentionally inconclusive.',
          },
        },
      },
    }, null, 2));

    writeProjectionRecord(s, {
      id: 'brush_diag_round_ab_003', documentId: 5003, sequence: 1,
      visual: true, report: true, ack: true, verdict: true,
    });
    writeProjectionRecord(s, {
      id: 'brush_diag_soft_ab_005', documentId: 5003, sequence: 2,
      visual: true, report: true, ack: true, verdict: true,
    });
    for (const id of ['brush_diag_round_ab_003', 'brush_diag_soft_ab_005']) {
      const record = s.read(id)!;
      record.verdict.verdict = 'neutral';
      record.verdict.disposition = 'accept';
      record.verdict.target_resolved = 'uncertain';
      s.write(record);
    }
    writeProjectionRecord(s, {
      id: 'brush_diag_save_contact_006', documentId: 5003, sequence: 3,
      report: true, ack: true,
    });
    const save = s.read('brush_diag_save_contact_006')!;
    save.tool = 'photoshop_save_document';
    save.args.path = path.join(
      path.dirname(s.paintingStateFile()),
      'processes', 'brush-trace-diagnostic-process', 'run-01', 'final', 'brush-trace-contact-sheet.png'
    );
    save.args.format = 'PNG';
    s.write(save);

    const compact = s.statusCompact();
    const doc = compact.documents['5003'];
    expect(doc.largest_open_must_fix?.status).toBe('open');
    expect(doc.last_critique.target_resolved).toBe('uncertain');
    expect(doc.unresolved_visual_basis.status).toBe('uncertain');
    expect(doc.visual_cadence.active_visual_workflow).toBe(false);
    expect(doc.continuation_watch.active_visual_workflow).toBe(false);
    expect(doc.continuation_watch.phase).toBe('ready');
    expect(doc.workflow_lifecycle).toMatchObject({
      status: 'stopped',
      reason: 'legacy_inferred_closed_continuation',
    });
    expect(doc.next_required_action).toBe('ready');

    const rawState = s.paintingState().documents['5003'];
    expect(Object.values(rawState.visual_problems).every((problem: any) => problem.status === 'open')).toBe(true);
    expect(s.read('brush_diag_soft_ab_005')?.verdict?.target_resolved).toBe('uncertain');
  });

  it('does not infer legacy workflow completion from an ordinary closed preparation step', () => {
    const s = store();
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 20, 12, 1, 0));
    mkdirSync(path.dirname(s.paintingStateFile()), { recursive: true });
    writeFileSync(s.paintingStateFile(), JSON.stringify({
      schema_version: RUNTIME_STATE_VERSION,
      version: 2,
      revision: 1,
      documents: {
        '5004': {
          document_id: 5004,
          current_stage: 'SHAPE',
          active_scale: 'global',
          visual_problems: {
            'shape-open': {
              problem_id: 'shape-open',
              scale: 'global',
              severity: 'must-fix',
              status: 'open',
            },
          },
          active_problem: {
            problem_id: 'shape-open',
            scale: 'global',
            severity: 'must-fix',
            status: 'open',
          },
          last_critique: {
            operation_id: 'legacy-live-visual',
            verdict: 'neutral',
            disposition: 'accept',
            target_resolved: 'uncertain',
            uncertainty: 'The shape still needs another pass.',
          },
        },
      },
    }, null, 2));

    writeProjectionRecord(s, {
      id: 'legacy-live-visual', documentId: 5004, sequence: 1,
      visual: true, report: true, ack: true, verdict: true,
    });
    const visual = s.read('legacy-live-visual')!;
    visual.verdict.verdict = 'neutral';
    visual.verdict.disposition = 'accept';
    visual.verdict.target_resolved = 'uncertain';
    s.write(visual);

    writeProjectionRecord(s, {
      id: 'legacy-brush-preparation', documentId: 5004, sequence: 2,
      report: true, ack: true,
    });
    const prep = s.read('legacy-brush-preparation')!;
    prep.tool = 'photoshop_set_brush';
    s.write(prep);

    const compact = s.statusCompact();
    const doc = compact.documents['5004'];
    expect(doc.workflow_lifecycle).toMatchObject({
      status: 'active',
      reason: 'legacy_inferred_visual_continuation',
    });
    expect(doc.visual_cadence.active_visual_workflow).toBe(true);
    expect(doc.continuation_watch.active_visual_workflow).toBe(true);
    expect(doc.next_required_action).not.toBe('ready');
    expect(s.paintingState().documents['5004'].visual_problems['shape-open'].status).toBe('open');
  });

  it('prioritizes a pending Art Director review over a stopped lifecycle ready state', () => {
    const s = store();
    writeProjectionRecord(s, {
      id: 'review-due-visual', documentId: 42, sequence: 1,
      visual: true, report: true, ack: true, verdict: true,
    });
    s.updatePaintingState(42, current => ({
      ...current,
      document_id: 42,
      workflow_lifecycle: {
        status: 'stopped',
        reason: 'close_only_finalization',
        operation_id: 'read-only-check',
        at: new Date().toISOString(),
      },
      art_director: {
        directive_id: 'review-priority-regression',
        status: 'review_due',
        review_due: true,
        review_reason: 'cadence:5_microplans',
        current_task_id: 'foliage-light',
        tasks: [{ task_id: 'foliage-light', status: 'active' }],
      },
    }));

    expect(s.documentNextRequiredAction(42)).toBe(
      'Art Director review required for directive review-priority-regression: cadence:5_microplans'
    );
  });

  it('detects nonvisual progress stall without letting read-only churn reset the visual clock', () => {
    const s = store();
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 20, 12, 3, 40));
    writeProjectionRecord(s, {
      id: 'last-visual-before-read-churn', documentId: 77, sequence: 1,
      visual: true, report: true, ack: true, verdict: true,
    });
    writeProjectionRecord(s, {
      id: 'late-read-only-check', documentId: 77, sequence: 200,
      report: true, ack: true,
    });
    s.updatePaintingState(77, current => ({
      ...current,
      document_id: 77,
      workflow_lifecycle: {
        status: 'active',
        reason: 'operation_dispatched',
        operation_id: 'last-visual-before-read-churn',
        at: new Date(Date.UTC(2026, 8, 20, 12, 0, 1)).toISOString(),
      },
      art_director: {
        directive_id: 'nonvisual-stall-regression',
        status: 'active',
        review_due: false,
        current_task_id: 'foliage-light',
        tasks: [
          { task_id: 'foliage-light', status: 'active' },
          { task_id: 'focal-details', status: 'pending' },
        ],
      },
    }));

    const watch = s.continuationWatchState(77);
    expect(watch.seconds_since_last_visual_change).toBeGreaterThanOrEqual(210);
    expect(watch.seconds_since_last_advancement).toBeGreaterThanOrEqual(210);
    expect(watch.nonvisual_progress_stall).toBe(true);
    expect(watch.nonvisual_progress_stall_reason).toBe('unfinished_painting_without_visual_pass');
    expect(watch.next_required_action).toBe(
      'Painter: execute bounded task foliage-light under directive nonvisual-stall-regression'
    );
  });

  it('does not infer legacy workflow completion from a mid-run PSD checkpoint save', () => {
    const s = store();
    vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 8, 20, 12, 1, 0));
    mkdirSync(path.dirname(s.paintingStateFile()), { recursive: true });
    writeFileSync(s.paintingStateFile(), JSON.stringify({
      schema_version: RUNTIME_STATE_VERSION,
      version: 2,
      revision: 1,
      documents: {
        '5005': {
          document_id: 5005,
          current_stage: 'SHAPE',
          visual_problems: {
            'shape-open': { problem_id: 'shape-open', scale: 'global', severity: 'must-fix', status: 'open' },
          },
          active_problem: { problem_id: 'shape-open', scale: 'global', severity: 'must-fix', status: 'open' },
          last_critique: {
            operation_id: 'legacy-checkpoint-visual',
            verdict: 'neutral',
            disposition: 'accept',
            target_resolved: 'uncertain',
            uncertainty: 'The painting continues after this checkpoint.',
          },
        },
      },
    }, null, 2));

    writeProjectionRecord(s, {
      id: 'legacy-checkpoint-visual', documentId: 5005, sequence: 1,
      visual: true, report: true, ack: true, verdict: true,
    });
    const visual = s.read('legacy-checkpoint-visual')!;
    visual.verdict.verdict = 'neutral';
    visual.verdict.disposition = 'accept';
    visual.verdict.target_resolved = 'uncertain';
    s.write(visual);

    writeProjectionRecord(s, {
      id: 'legacy-midrun-checkpoint', documentId: 5005, sequence: 2,
      report: true, ack: true,
    });
    const checkpoint = s.read('legacy-midrun-checkpoint')!;
    checkpoint.tool = 'photoshop_save_document';
    checkpoint.args.path = path.join(s.directory, 'checkpoints', 'midrun.psd');
    checkpoint.args.format = 'PSD';
    checkpoint.checkpoint = checkpoint.args.path;
    s.write(checkpoint);

    const doc = s.statusCompact().documents['5005'];
    expect(doc.workflow_lifecycle).toMatchObject({
      status: 'active',
      reason: 'legacy_inferred_visual_continuation',
    });
    expect(doc.visual_cadence.active_visual_workflow).toBe(true);
    expect(doc.next_required_action).not.toBe('ready');
  });
});
