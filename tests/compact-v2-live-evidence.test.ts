import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  consolidateRun,
  validateConsolidatedRun,
  writeConsolidatedRun,
} from '../scripts/dev/compact-v2-live-evidence.mjs';

const tempDirs: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compact-live-evidence-'));
  tempDirs.push(root);
  const processRoot = path.join(root, 'processes');
  const runDir = path.join(processRoot, 'run-02');
  const operationDir = path.join(root, 'operations');
  const frames = path.join(runDir, 'frames');
  fs.mkdirSync(operationDir, { recursive: true });
  fs.mkdirSync(frames, { recursive: true });
  const anchorPath = path.join(frames, 'anchor.jpg');
  const weakPath = path.join(frames, 'weak.jpg');
  const restoredPath = path.join(frames, 'restored.jpg');
  fs.writeFileSync(anchorPath, 'anchor');
  fs.writeFileSync(weakPath, 'weak');
  fs.writeFileSync(restoredPath, 'anchor');
  const sha = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const operation = (id: string, sequence: number, action: string, previewPath: string, extra: Record<string, unknown> = {}) => ({
    id, sequence, phase: 'completed', pid: 1234, runtime_state_version: 'photoshop.guard.runtime-state.v2',
    tool: 'photoshop_execute_visual_microplan',
    args: { document_id: 62, steps: [{ id: 'mutate', tool: action, args: {} }, { id: 'preview', tool: 'photoshop_get_preview', args: {} }] },
    operation_receipt: { protocol: 'photoshop.guard.operation_receipt.v1', execution: 'completed' },
    preview: { sha256: sha(previewPath), project_path: previewPath, document_id: 62 },
    latency: { guard_invocation_count_observed: 2, guard_cycle_total_ms: 100 },
    ...extra,
  });
  const records = [
    operation('live13c-run02-nontrivial-pass-20260922-06', 6, 'photoshop_paint_regions', anchorPath),
    operation('live13c-run02-anchor-weaker-20260922-07b', 7, 'photoshop_paint_regions', weakPath),
    operation('live13c-run02-anchor-restore-20260922-08', 8, 'photoshop_undo', restoredPath),
  ];
  for (const record of records) fs.writeFileSync(path.join(operationDir, `${record.id}.json`), JSON.stringify(record));
  fs.writeFileSync(path.join(runDir, 'painting-state.json'), JSON.stringify({
    process_dir: 'processes/run-02',
    profile_transition: { from: 'simple_graphic', to: 'nontrivial_painting', monotonic: true },
    primary_artistic_anchor: { operation_id: records[0].id, sha256: records[0].preview.sha256, path: anchorPath },
    last_rollback: { operation_id: records[2].id, source_operation_id: records[1].id },
  }));
  return { root, processRoot, operationDir, runDir };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('compact-v2 live evidence consolidator', () => {
  it('consolidates journals offline, preserves null human judgments, and proves an exact real-undo restore', () => {
    const f = fixture();
    const result = consolidateRun({ root: f.root, processRoot: f.processRoot, operationDir: f.operationDir, runName: 'run-02' });
    const validation = validateConsolidatedRun(result);
    expect(validation).toEqual({ ok: true, errors: [] });
    expect(result.callLedger.every(row => row.human_visual_judgment === null)).toBe(true);
    expect(result.ledger.task21_restore_evidence.exact_sha_restore).toBe(true);
    expect(result.ledger.task21_restore_evidence.weaker_differs_from_anchor).toBe(true);
    expect(result.ledger.task21_restore_evidence.restore.mutation_actions).toContain('photoshop_undo');
    expect(result.ledger.profile_transition).toMatchObject({ from: 'simple_graphic', to: 'nontrivial_painting' });
  });

  it('parses applied/not-applied setter readback without upgrading either result', () => {
    const f = fixture();
    for (const [id, outcome, mismatches] of [
      ['live13c-run02-brush-setter-20260922-03', 'not-applied', [{ key: 'hardness', expected: 70, actual: 100 }]],
      ['live13c-run02-brush-setter-applied-20260922-05', 'applied', []],
    ] as const) {
      const payload = {
        id, sequence: outcome === 'applied' ? 5 : 3, phase: 'completed', pid: 1234,
        runtime_state_version: 'photoshop.guard.runtime-state.v2', tool: 'photoshop_set_brush',
        args: {}, operation_receipt: { protocol: 'photoshop.guard.operation_receipt.v1', execution: 'completed' },
        result: { content: [{ type: 'text', text: JSON.stringify({ ok: true, details: {
          setter_outcome: outcome, requested_settings: { hardness: 70 }, effective_settings: { hardness: outcome === 'applied' ? 70 : 100 }, mismatches,
        } }) }] },
      };
      fs.writeFileSync(path.join(f.operationDir, `${id}.json`), JSON.stringify(payload));
    }
    const result = consolidateRun({ root: f.root, processRoot: f.processRoot, operationDir: f.operationDir, runName: 'run-02' });
    expect(result.ledger.setter_readbacks.map(row => row.setter_outcome).sort()).toEqual(['applied', 'not-applied']);
    expect(validateConsolidatedRun(result).ok).toBe(true);
  });

  it('refuses to overwrite historical evidence when regenerated content differs', () => {
    const f = fixture();
    const first = consolidateRun({ root: f.root, processRoot: f.processRoot, operationDir: f.operationDir, runName: 'run-02' });
    writeConsolidatedRun(first);
    expect(writeConsolidatedRun(first).operator_preflight.status).toBe('unchanged');
    fs.appendFileSync(path.join(f.runDir, 'operator-preflight.json'), 'historical-change');
    expect(() => writeConsolidatedRun(first)).toThrow(/refusing to overwrite historical evidence/);
  });

  it('fails validation for a non-UXP mutation route', () => {
    const f = fixture();
    const bad = {
      id: 'live13c-run02-legacy-09', sequence: 9, phase: 'completed', pid: 1234,
      runtime_state_version: 'photoshop.guard.runtime-state.v2', tool: 'photoshop_move_layer', args: {},
    };
    fs.writeFileSync(path.join(f.operationDir, 'live13c-run02-legacy-09.json'), JSON.stringify(bad));
    const result = consolidateRun({ root: f.root, processRoot: f.processRoot, operationDir: f.operationDir, runName: 'run-02' });
    expect(result.ledger.route_no_com_assertions.passed).toBe(false);
    expect(validateConsolidatedRun(result).errors.join('\n')).toMatch(/non-UXP mutation actions/);
  });

  it('does not absorb another process merely because its directory is also named run-02', () => {
    const f = fixture();
    const foreignDir = path.join(f.root, 'foreign-process', 'run-02', 'frames');
    fs.mkdirSync(foreignDir, { recursive: true });
    const foreignPreview = path.join(foreignDir, 'foreign.jpg');
    fs.writeFileSync(foreignPreview, 'foreign');
    const foreign = {
      id: 'foreign-live-operation', sequence: 99, phase: 'completed', pid: 9999,
      runtime_state_version: 'photoshop.guard.runtime-state.v2', tool: 'photoshop_fill_layer',
      args: {}, preview: { project_path: foreignPreview, sha256: crypto.createHash('sha256').update('foreign').digest('hex') },
    };
    fs.writeFileSync(path.join(f.operationDir, 'foreign-live-operation.json'), JSON.stringify(foreign));
    const result = consolidateRun({ root: f.root, processRoot: f.processRoot, operationDir: f.operationDir, runName: 'run-02' });
    expect(result.callLedger.some(row => row.operation_id === foreign.id)).toBe(false);
  });

  it('merges and validates run-scoped operator PID/build/protocol/bridge evidence', () => {
    const f = fixture();
    const operator = path.join(f.root, 'operator.json');
    fs.writeFileSync(operator, JSON.stringify({ runs: { 'run-02': {
      pre_cutover_child_pid: 1000,
      live_child_pid: 1234,
      repository_commit: '67c0c00a94e0',
      dist_entry_sha256: 'a'.repeat(64),
      compact_guard_protocol_version: 'photoshop.guard.compact.v2',
      runtime_state_version: 'photoshop.guard.runtime-state.v2',
      expected_uxp_bridge_revision: 'compact-v2-20260922',
      actual_uxp_bridge_revision: 'compact-v2-20260922',
      guard_mode: 'compact-v2',
      raw_mutation_bypass_blocked: true,
      no_com: { process_snapshot: { legacy_helpers_seen: [] } },
    } } }));
    const result = consolidateRun({
      root: f.root, processRoot: f.processRoot, operationDir: f.operationDir, runName: 'run-02', operatorEvidencePath: operator,
    });
    expect(result.operatorPreflight).toMatchObject({
      live_child_pid: 1234,
      repository_commit: '67c0c00a94e0',
      uxp_revision_match: true,
      supplied_operator_evidence: true,
    });
    expect(validateConsolidatedRun(result)).toEqual({ ok: true, errors: [] });
  });

  it('rejects supplied bridge-revision mismatch instead of laundering it into acceptance', () => {
    const f = fixture();
    const operator = path.join(f.root, 'operator-bad.json');
    fs.writeFileSync(operator, JSON.stringify({
      live_child_pid: 1234,
      expected_uxp_bridge_revision: 'expected',
      actual_uxp_bridge_revision: 'stale',
      raw_mutation_bypass_blocked: true,
    }));
    const result = consolidateRun({
      root: f.root, processRoot: f.processRoot, operationDir: f.operationDir, runName: 'run-02', operatorEvidencePath: operator,
    });
    expect(validateConsolidatedRun(result).errors).toContain('operator expected/actual UXP bridge revision mismatch');
  });
});
