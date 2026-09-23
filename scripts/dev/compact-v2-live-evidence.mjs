#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const DEFAULT_PROCESS_ROOT = path.join(ROOT, 'processes', 'compact-v2-live-acceptance-process');
export const DEFAULT_OPERATION_DIR = path.join(ROOT, '.photoshop-runtime', 'controller', 'operations');

const UXP_ONLY_ACTIONS = new Set([
  'photoshop_create_document', 'photoshop_open_image',
  'photoshop_create_layer', 'photoshop_delete_layer', 'photoshop_duplicate_layer', 'photoshop_rename_layer',
  'photoshop_fill_layer', 'photoshop_paint_regions', 'photoshop_paint_strokes', 'photoshop_paint_dabs',
  'photoshop_select_brush_preset', 'photoshop_set_brush', 'photoshop_set_foreground_color',
  'photoshop_select_rectangle', 'photoshop_select_ellipse', 'photoshop_select_subject', 'photoshop_feather_selection',
  'photoshop_create_layer_mask', 'photoshop_apply_gradient_mask',
  'photoshop_set_layer_opacity', 'photoshop_set_layer_blend_mode', 'photoshop_set_layer_visibility',
  'photoshop_set_layer_locked', 'photoshop_move_layer_to_position', 'photoshop_move_layer_to_top',
  'photoshop_move_layer_to_bottom', 'photoshop_move_layer_up', 'photoshop_move_layer_down',
  'photoshop_get_preview', 'photoshop_undo',
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function existingJson(file) {
  return fs.existsSync(file) ? readJson(file) : null;
}

function sha256File(file) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(file));
  return hash.digest('hex');
}

function parseEmbeddedResult(record) {
  const text = record?.result?.content?.find?.(entry => entry?.type === 'text')?.text;
  if (typeof text !== 'string') return null;
  try { return JSON.parse(text); } catch { return null; }
}

function actionsFor(record) {
  if (Array.isArray(record?.args?.steps)) return record.args.steps.map(step => step?.tool).filter(Boolean);
  if (typeof record?.tool === 'string' && record.tool !== 'photoshop_execute_visual_microplan') return [record.tool];
  return [];
}

function mutationActions(record) {
  return actionsFor(record).filter(tool => tool !== 'photoshop_get_preview');
}

function operationBelongsToRun(record, runName, runDir) {
  const id = String(record?.id ?? '');
  const projectPath = String(record?.preview?.project_path ?? '');
  if (projectPath && path.resolve(projectPath).startsWith(path.resolve(runDir) + path.sep)) return true;
  if (runName === 'run-02') return id.startsWith('live13c-run02-');
  if (runName === 'run-01') return id.startsWith('live13c-') && !id.startsWith('live13c-run02-');
  return false;
}

function loadOperations(operationDir, runName, runDir) {
  if (!fs.existsSync(operationDir)) return [];
  return fs.readdirSync(operationDir)
    .filter(name => name.endsWith('.json'))
    .map(name => ({ file: path.join(operationDir, name), record: readJson(path.join(operationDir, name)) }))
    .filter(item => operationBelongsToRun(item.record, runName, runDir))
    .sort((a, b) => (a.record.sequence ?? 0) - (b.record.sequence ?? 0));
}

function evidenceRef(root, file) {
  if (!file) return null;
  const resolved = path.isAbsolute(file) ? file : path.resolve(root, file);
  return {
    path: resolved,
    exists: fs.existsSync(resolved),
    sha256: fs.existsSync(resolved) && fs.statSync(resolved).isFile() ? sha256File(resolved) : null,
  };
}

function setterEvidence(operation) {
  const result = parseEmbeddedResult(operation.record);
  const details = result?.details;
  if (!details || !['applied', 'not-applied'].includes(details.setter_outcome)) return null;
  return {
    operation_id: operation.record.id,
    operation_file: operation.file,
    setter_outcome: details.setter_outcome,
    requested_settings: details.requested_settings ?? null,
    effective_settings: details.effective_settings ?? details.settings ?? null,
    mismatches: Array.isArray(details.mismatches) ? details.mismatches : [],
    readback_provenance: 'operation.result.content[0].text.details',
  };
}

function regionExpectations(record) {
  const rows = [];
  for (const step of record?.args?.steps ?? []) {
    if (step?.tool !== 'photoshop_paint_regions') continue;
    for (const region of step?.args?.regions ?? []) {
      const points = (region?.contours ?? []).flatMap(contour => contour?.points ?? []);
      if (!points.length) continue;
      rows.push({
        region_id: region.id ?? null,
        expected_bbox: {
          left: Math.min(...points.map(p => p.x)),
          top: Math.min(...points.map(p => p.y)),
          right: Math.max(...points.map(p => p.x)),
          bottom: Math.max(...points.map(p => p.y)),
        },
        source: `operation.args.steps[${step.id ?? 'paint_regions'}].args.regions`,
      });
    }
  }
  return rows;
}

function placementEvidence(operation) {
  const expectations = regionExpectations(operation.record);
  if (!expectations.length) return null;
  const observed = operation.record?.verdict?.observed_change ?? null;
  const hasIndependentMeasurement = typeof observed === 'string' && /independent raster measurement|bbox\s*\[/i.test(observed);
  return {
    operation_id: operation.record.id,
    operation_file: operation.file,
    expected_regions: expectations,
    preview_reference: evidenceRef(ROOT, operation.record?.preview?.project_path ?? operation.record?.preview?.materialized_path),
    measurement_reference: observed ? {
      provenance: 'operation.verdict.observed_change',
      text: observed,
      independently_measured_claim_present: hasIndependentMeasurement,
    } : null,
    validation_status: hasIndependentMeasurement ? 'recorded-independent-measurement' : 'reference-only-no-independent-measurement-in-journal',
  };
}

function previewEvidence(record) {
  if (!record?.preview) return null;
  const ref = evidenceRef(ROOT, record.preview.project_path ?? record.preview.materialized_path);
  return {
    sha256: record.preview.sha256 ?? null,
    project_path: record.preview.project_path ?? null,
    materialized_path: record.preview.materialized_path ?? null,
    file_reference: ref,
    sha_matches_file: ref?.sha256 && record.preview.sha256 ? ref.sha256 === record.preview.sha256 : null,
  };
}

function buildCallLedger(operations) {
  return operations.map(({ file, record }) => ({
    sequence: record.sequence ?? null,
    request_key: record.id ?? null,
    operation_id: record.id ?? null,
    operation_journal: file,
    document_id: record.args?.document_id ?? record.preview?.document_id ?? record.bootstrap_outcome?.document_id ?? null,
    durable_phase: record.phase ?? null,
    pid: record.pid ?? null,
    runtime_state_version: record.runtime_state_version ?? null,
    stage: record.stage ?? record.args?.stage ?? null,
    scale: record.scale ?? record.args?.scale ?? null,
    actions: actionsFor(record),
    mutation_actions: mutationActions(record),
    uxp_only_route: mutationActions(record).every(tool => UXP_ONLY_ACTIONS.has(tool)),
    non_uxp_actions: mutationActions(record).filter(tool => !UXP_ONLY_ACTIONS.has(tool)),
    operation_receipt_protocol: record.operation_receipt?.protocol ?? null,
    operation_execution: record.operation_receipt?.execution ?? null,
    preview: previewEvidence(record),
    guard_cycle_total_ms: record.latency?.guard_cycle_total_ms ?? null,
    guard_preflight_ms: record.latency?.guard_preflight_ms ?? null,
    photoshop_dispatch_wall_ms: record.latency?.photoshop_dispatch_wall_ms ?? null,
    report_ack_closure_ms: record.latency?.report_ack_closure_ms ?? null,
    guard_invocation_count_observed: record.latency?.guard_invocation_count_observed ?? null,
    execution_outcome: record.verdict?.execution_outcome ?? null,
    artistic_outcome: record.verdict?.artistic_outcome ?? null,
    human_visual_judgment: null,
    human_visual_judgment_provenance: 'not-generated-by-consolidator',
  }));
}

function cadenceChecks(ledger) {
  const sequence = ledger.map(row => row.sequence).filter(Number.isFinite);
  const sorted = [...sequence].sort((a, b) => a - b);
  return {
    operation_sequences_monotonic: JSON.stringify(sequence) === JSON.stringify(sorted),
    duplicate_sequences: sorted.filter((value, index) => index > 0 && value === sorted[index - 1]),
    guard_invocation_counts: ledger.map(row => ({ operation_id: row.operation_id, observed: row.guard_invocation_count_observed })),
    note: 'Invocation counts are journal observations; no model-call count is inferred.',
  };
}

function buildOperatorPreflight({ operations, supplied }) {
  const pids = [...new Set(operations.map(item => item.record.pid).filter(Number.isInteger))];
  const runtimes = [...new Set(operations.map(item => item.record.runtime_state_version).filter(Boolean))];
  const suppliedRoute = supplied?.route ?? supplied?.no_com ?? {};
  return {
    schema: 'photoshop.compact-v2.operator-preflight.v1',
    repository_commit: supplied?.repository_commit ?? null,
    dist_entry_sha256: supplied?.dist_entry_sha256 ?? null,
    dist_entry_mtime: supplied?.dist_entry_mtime ?? null,
    pre_cutover_child_pid: supplied?.pre_cutover_child_pid ?? null,
    live_child_pid: supplied?.live_child_pid ?? (pids.length === 1 ? pids[0] : null),
    observed_operation_pids: pids,
    compact_guard_protocol_version: supplied?.compact_guard_protocol_version ?? null,
    runtime_state_version: supplied?.runtime_state_version ?? (runtimes.length === 1 ? runtimes[0] : null),
    expected_uxp_bridge_revision: supplied?.expected_uxp_bridge_revision ?? null,
    actual_uxp_bridge_revision: supplied?.actual_uxp_bridge_revision ?? null,
    uxp_revision_match: supplied?.expected_uxp_bridge_revision && supplied?.actual_uxp_bridge_revision
      ? supplied.expected_uxp_bridge_revision === supplied.actual_uxp_bridge_revision : null,
    guard_mode: supplied?.guard_mode ?? null,
    raw_mutation_bypass_blocked: supplied?.raw_mutation_bypass_blocked ?? null,
    no_com_operator_evidence: suppliedRoute?.process_snapshot ?? suppliedRoute?.no_com_process_evidence ?? null,
    supplied_operator_evidence: supplied ? true : false,
    note: 'Null operator-only fields were not present in supplied evidence and are not inferred from operation journals or the repository state at consolidation time.',
  };
}

function buildTask21(operations, paintingState) {
  const byId = new Map(operations.map(item => [item.record.id, item.record]));
  const anchorId = paintingState?.primary_artistic_anchor?.operation_id ?? 'live13c-run02-nontrivial-pass-20260922-06';
  const weakId = 'live13c-run02-anchor-weaker-20260922-07b';
  const restoreId = paintingState?.last_rollback?.operation_id ?? 'live13c-run02-anchor-restore-20260922-08';
  const anchor = byId.get(anchorId);
  const weak = byId.get(weakId);
  const restore = byId.get(restoreId);
  if (!anchor && !weak && !restore) return null;
  const anchorSha = anchor?.preview?.sha256 ?? paintingState?.primary_artistic_anchor?.sha256 ?? null;
  const weakSha = weak?.preview?.sha256 ?? null;
  const restoreSha = restore?.preview?.sha256 ?? null;
  return {
    anchor: { operation_id: anchorId, sha256: anchorSha, preview_path: anchor?.preview?.project_path ?? paintingState?.primary_artistic_anchor?.path ?? null },
    weaker: { operation_id: weakId, sha256: weakSha, preview_path: weak?.preview?.project_path ?? null },
    restore: {
      operation_id: restoreId,
      sha256: restoreSha,
      preview_path: restore?.preview?.project_path ?? null,
      mutation_actions: restore ? mutationActions(restore) : [],
      rollback_source_operation_id: paintingState?.last_rollback?.source_operation_id ?? null,
    },
    exact_sha_restore: Boolean(anchorSha && restoreSha && anchorSha === restoreSha),
    weaker_differs_from_anchor: Boolean(anchorSha && weakSha && anchorSha !== weakSha),
    required_known_sha_check: {
      anchor_matches_expected: anchorSha === '4b8a2bdd0b4c8df8d76833ee0cf73f23be8acae53f16d515ebadaa83d2488ca7',
      weaker_matches_expected: weakSha === '140ca417a3b8dbbba700d60c60a44e729e0fa5372c915b0e613533cdca6aec80',
      restore_matches_expected: restoreSha === '4b8a2bdd0b4c8df8d76833ee0cf73f23be8acae53f16d515ebadaa83d2488ca7',
    },
  };
}

export function consolidateRun({
  root = ROOT,
  processRoot = DEFAULT_PROCESS_ROOT,
  operationDir = DEFAULT_OPERATION_DIR,
  runName,
  operatorEvidencePath = null,
} = {}) {
  if (!runName) throw new Error('runName is required');
  const runDir = path.resolve(processRoot, runName);
  if (!fs.existsSync(runDir)) throw new Error(`missing run directory: ${runDir}`);
  const operations = loadOperations(operationDir, runName, runDir);
  if (!operations.length) throw new Error(`no live13c operation journals found for ${runName}`);
  const statePath = path.join(runDir, 'painting-state.json');
  const paintingState = existingJson(statePath);
  const defaultOperatorPaths = [
    path.join(runDir, 'evidence', 'operator-evidence.json'),
    path.join(runDir, 'operator-evidence.source.json'),
  ];
  const rawOperatorInput = operatorEvidencePath
    ? existingJson(path.resolve(operatorEvidencePath))
    : defaultOperatorPaths.map(existingJson).find(Boolean) ?? null;
  const operatorInput = rawOperatorInput?.runs?.[runName] ?? rawOperatorInput;
  const callLedger = buildCallLedger(operations);
  const operatorPreflight = buildOperatorPreflight({ operations, supplied: operatorInput });
  const setterReadbacks = operations.map(setterEvidence).filter(Boolean);
  const placements = operations.map(placementEvidence).filter(Boolean);
  const noComRoute = {
    passed: callLedger.every(row => row.uxp_only_route),
    non_uxp_actions: [...new Set(callLedger.flatMap(row => row.non_uxp_actions))],
    operator_process_evidence_status: operatorPreflight.no_com_operator_evidence ? 'supplied' : 'not-supplied',
    assertion_scope: 'canonical mutation route from durable operation journals; absence of COM helper processes requires separate operator evidence',
  };
  const ledger = {
    schema: 'photoshop.compact-v2.live-acceptance-ledger.v1',
    run: runName,
    process_dir: paintingState?.process_dir ?? path.relative(root, runDir),
    source_operation_count: operations.length,
    source_operation_journals: operations.map(item => item.file),
    operator_preflight_file: path.join(runDir, 'operator-preflight.json'),
    call_ledger_file: path.join(runDir, 'call-ledger.ndjson'),
    route_no_com_assertions: noComRoute,
    setter_readbacks: setterReadbacks,
    profile_transition: paintingState?.profile_transition ?? null,
    placement_measurement_evidence: placements,
    cadence_checks: cadenceChecks(callLedger),
    preview_sha_paths: callLedger.filter(row => row.preview).map(row => ({
      operation_id: row.operation_id,
      sha256: row.preview.sha256,
      project_path: row.preview.project_path,
      materialized_path: row.preview.materialized_path,
      sha_matches_file: row.preview.sha_matches_file,
    })),
    task21_restore_evidence: buildTask21(operations, paintingState),
    human_judgments: {
      generated: false,
      note: 'This consolidator never creates, upgrades, or infers human visual judgments.',
    },
  };
  return { runDir, operatorPreflight, callLedger, ledger };
}

function stableJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

function writeHistorical(file, content) {
  if (fs.existsSync(file)) {
    const old = fs.readFileSync(file, 'utf8');
    if (old !== content) throw new Error(`refusing to overwrite historical evidence with different content: ${file}`);
    return 'unchanged';
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return 'created';
}

export function writeConsolidatedRun(result) {
  const preflightPath = path.join(result.runDir, 'operator-preflight.json');
  const callPath = path.join(result.runDir, 'call-ledger.ndjson');
  const ledgerPath = path.join(result.runDir, 'live-acceptance-ledger.json');
  const callText = result.callLedger.map(row => JSON.stringify(row)).join('\n') + '\n';
  return {
    operator_preflight: { path: preflightPath, status: writeHistorical(preflightPath, stableJson(result.operatorPreflight)) },
    call_ledger: { path: callPath, status: writeHistorical(callPath, callText) },
    live_acceptance_ledger: { path: ledgerPath, status: writeHistorical(ledgerPath, stableJson(result.ledger)) },
  };
}

export function validateConsolidatedRun(result) {
  const errors = [];
  const preflight = result.operatorPreflight;
  if (!result.callLedger.length) errors.push('empty call ledger');
  if (!result.ledger.route_no_com_assertions.passed) errors.push(`non-UXP mutation actions: ${result.ledger.route_no_com_assertions.non_uxp_actions.join(', ')}`);
  for (const row of result.callLedger) {
    if (row.preview?.sha_matches_file === false) errors.push(`preview SHA mismatch: ${row.operation_id}`);
    if (row.human_visual_judgment !== null) errors.push(`fabricated human judgment: ${row.operation_id}`);
  }
  for (const setter of result.ledger.setter_readbacks) {
    if (setter.setter_outcome === 'applied' && setter.mismatches.length) errors.push(`applied setter has mismatches: ${setter.operation_id}`);
    if (setter.setter_outcome === 'not-applied' && !setter.mismatches.length) errors.push(`not-applied setter lacks mismatch evidence: ${setter.operation_id}`);
  }
  if (preflight.supplied_operator_evidence) {
    if (preflight.live_child_pid != null && (!Number.isInteger(preflight.live_child_pid) || preflight.live_child_pid <= 0)) {
      errors.push('operator live_child_pid must be a positive integer');
    }
    if (preflight.pre_cutover_child_pid != null && preflight.live_child_pid != null && preflight.pre_cutover_child_pid === preflight.live_child_pid) {
      errors.push('operator pre-cutover and live child PID are identical');
    }
    if (preflight.repository_commit != null && !/^[0-9a-f]{7,64}$/i.test(preflight.repository_commit)) {
      errors.push('operator repository_commit is not a commit-like hex id');
    }
    if (preflight.dist_entry_sha256 != null && !/^[0-9a-f]{64}$/i.test(preflight.dist_entry_sha256)) {
      errors.push('operator dist_entry_sha256 is not a SHA-256 hex digest');
    }
    if ((preflight.expected_uxp_bridge_revision == null) !== (preflight.actual_uxp_bridge_revision == null)) {
      errors.push('operator bridge revision evidence is incomplete');
    }
    if (preflight.expected_uxp_bridge_revision != null && preflight.uxp_revision_match !== true) {
      errors.push('operator expected/actual UXP bridge revision mismatch');
    }
    if (preflight.raw_mutation_bypass_blocked === false) errors.push('operator evidence says raw mutation bypass is not blocked');
  }
  const task21 = result.ledger.task21_restore_evidence;
  if (task21) {
    if (!task21.exact_sha_restore) errors.push('Task21 restore SHA does not equal anchor SHA');
    if (!task21.weaker_differs_from_anchor) errors.push('Task21 weaker SHA does not differ from anchor');
    if (!task21.restore.mutation_actions.includes('photoshop_undo')) errors.push('Task21 restore does not record a real photoshop_undo mutation');
  }
  return { ok: errors.length === 0, errors };
}

function usage() {
  process.stderr.write('Usage: node scripts/dev/compact-v2-live-evidence.mjs [consolidate|validate] [--run run-01|run-02|all] [--operator-evidence FILE]\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const command = args[0] && !args[0].startsWith('--') ? args.shift() : 'consolidate';
  const take = flag => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : null;
  };
  const requested = take('--run') ?? 'all';
  const operatorEvidence = take('--operator-evidence');
  if (!['consolidate', 'validate'].includes(command) || !['all', 'run-01', 'run-02'].includes(requested)) {
    usage();
    process.exitCode = 2;
  } else {
    const runs = requested === 'all' ? ['run-01', 'run-02'] : [requested];
    const output = [];
    let failed = false;
    for (const runName of runs) {
      const result = consolidateRun({ runName, operatorEvidencePath: operatorEvidence });
      const validation = validateConsolidatedRun(result);
      const writes = command === 'consolidate' ? writeConsolidatedRun(result) : null;
      output.push({ run: runName, validation, writes });
      if (!validation.ok) failed = true;
    }
    process.stdout.write(stableJson({ ok: !failed, runs: output }));
    process.exitCode = failed ? 1 : 0;
  }
}
