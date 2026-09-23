// @ts-nocheck
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  assessVisualSignificance,
  VISUAL_SIGNIFICANCE_MODES,
} from './visual-significance.mjs';
import { operationNarrative } from './operation-narrative.mjs';
import { jobsDirectory, readJob } from './async-job.mjs';
import { OPERATION_ACK_PROTOCOL, OPERATION_RECEIPT_PROTOCOL } from './guard-capabilities.mjs';
import { parseEdgeIntents, validateEdgeObservations } from './edge-control.mjs';
import { VALUE_CHECK_CRITERIA, VALUE_CHECK_STATUSES, VALUE_CRITERION_STATUSES, isDetailStage } from './value-check.mjs';

export const ROUTE = 'Chat_On_Steroids_Core -> direct stdio -> this fork/dist/index.js -> Photoshop';
const READS = new Set([
  'photoshop_ping', 'photoshop_get_version', 'photoshop_get_capabilities',
  'photoshop_get_state', 'photoshop_get_preview', 'photoshop_list_documents',
  'photoshop_get_document_info', 'photoshop_get_layers', 'photoshop_get_history',
  'photoshop_get_selection_bounds', 'photoshop_list_fonts', 'photoshop_list_brush_presets',
  'photoshop_get_brush_settings', 'photoshop_sample_color', 'photoshop_sample_colors',
  'photoshop_get_painting_method_capabilities', 'photoshop_select_painting_method',
  'photoshop_analyze_value_structure',
  'photoshop_measure_points', 'photoshop_transform_landmarks', 'photoshop_compare_landmarks',
  'photoshop_list_guides', 'photoshop_list_datasets',
]);
const PREPARATION = new Set([
  'photoshop_set_brush', 'photoshop_set_foreground_color', 'photoshop_select_brush_preset',
  'photoshop_select_layer_by_name',
  'photoshop_create_document', 'photoshop_open_image', 'photoshop_create_layer',
]);
export function isRead(tool) { return READS.has(tool); }
export function isVisual(tool) {
  return !isRead(tool)
    && !PREPARATION.has(tool)
    && tool !== 'photoshop_save_document'
    && tool !== 'photoshop_close_document';
}
function isRollbackMutation(request) {
  return request?.tool === 'photoshop_undo'
    || (request?.tool === 'photoshop_execute_visual_microplan'
      && String(request?.args?.action_class ?? '').toUpperCase() === 'ROLLBACK');
}
const idPattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
function validId(id) { if (!idPattern.test(id ?? '')) throw new Error('Use an operation id of 1-80 letters, digits, hyphens or underscores'); return id; }
function textOrUndefined(value) { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
const SCALE_RANK = { global: 0, medium: 1, small: 2, detail: 2, local: 2, micro: 2 };
const SEVERITIES = new Set(['must-fix', 'should-fix', 'optional']);
const ART_DIRECTOR_INTERRUPT_REASONS = new Set([
  'serious_visual_error',
  'unexpected_global_composition_value_shift',
  'likeness_main_shape_degraded',
  'unsafe_to_execute_directive',
]);
const GLOBAL_CHANGE_DOMAINS = new Set([
  'composition',
  'large-value',
  'lighting-structure',
  'silhouette',
  'depth-structure',
  'likeness-main-shape',
  'background-scope',
]);
const PAINTER_SCOPES = new Set(['local', 'medium']);
const ART_DIRECTOR_ASSESSMENT_FIELDS = [
  'composition',
  'focal_hierarchy',
  'large_value_masses',
  'lighting',
  'silhouette',
  'depth',
  'likeness_main_shape',
  'overall_detail_level',
  'mood',
  'color_relationships',
  'shape_language',
  'edge_hierarchy',
  'intentional_omission',
  'next_priority',
];
const STYLE_CONTRACT_FIELDS = [
  'realism_level', 'shape_language', 'composition_bias', 'edge_policy', 'contour_role',
  'mark_visibility', 'value_policy', 'color_policy', 'spatial_treatment', 'material_treatment',
  'detail_density', 'texture_policy', 'primitive_footprint_tolerance', 'layer_or_mask_bias',
  'finish_criteria',
];
const COMPOSITION_MODES = new Set(['reference_reproduction', 'free_composition', 'stylized_painting']);
const FINAL_COMPARISON_CRITERIA = ['coherence', 'expressiveness', 'color', 'rhythm', 'detail_selectivity'];

function parseValueCheck(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('directive.value_check is required');
  }
  const status = textOrUndefined(raw.status)?.toLowerCase();
  if (!VALUE_CHECK_STATUSES.includes(status)) {
    throw new Error(`directive.value_check.status must be one of ${VALUE_CHECK_STATUSES.join(', ')}`);
  }
  const observed = raw.observed === true;
  const previewSha = textOrUndefined(raw.preview_sha256);
  const evidenceOperationId = textOrUndefined(raw.evidence_operation_id);
  const limitations = Array.isArray(raw.limitations)
    ? raw.limitations.map((value, index) => {
        const parsed = textOrUndefined(value);
        if (!parsed) throw new Error(`directive.value_check.limitations[${index}] must be non-empty`);
        return parsed;
      })
    : [];
  const confidence = raw.confidence === undefined ? undefined : Number(raw.confidence);
  if (confidence !== undefined && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new Error('directive.value_check.confidence must be between 0 and 1');
  }

  if (status === 'style-not-applicable') {
    const reason = textOrUndefined(raw.applicability_reason);
    if (!reason || reason.length < 12) throw new Error('style-not-applicable requires a concrete applicability_reason');
    return {
      status,
      observed,
      preview_sha256: previewSha ?? null,
      criteria: {},
      confidence: confidence ?? null,
      limitations,
      applicability_reason: reason,
      override_reason: null,
    };
  }

  if (!observed || !previewSha || !/^[0-9a-f]{64}$/i.test(previewSha) || !evidenceOperationId || !idPattern.test(evidenceOperationId)) {
    throw new Error('value check PASS/FAIL/override requires observed=true, a 64-hex preview_sha256, and evidence_operation_id from real grayscale evidence');
  }
  const rawCriteria = raw.criteria;
  if (!rawCriteria || typeof rawCriteria !== 'object' || Array.isArray(rawCriteria)) {
    throw new Error('directive.value_check.criteria is required');
  }
  const criteria = {};
  for (const key of VALUE_CHECK_CRITERIA) {
    const row = rawCriteria[key];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`directive.value_check.criteria.${key} is required`);
    }
    const criterionStatus = textOrUndefined(row.status)?.toLowerCase();
    const note = textOrUndefined(row.note);
    if (!VALUE_CRITERION_STATUSES.includes(criterionStatus)) {
      throw new Error(`directive.value_check.criteria.${key}.status must be one of ${VALUE_CRITERION_STATUSES.join(', ')}`);
    }
    if (!note) throw new Error(`directive.value_check.criteria.${key}.note is required`);
    criteria[key] = { status: criterionStatus, note };
  }
  if (status === 'pass' && Object.values(criteria).some(row => row.status === 'fail' || row.status === 'uncertain')) {
    throw new Error('value_check.status=pass is inconsistent with failed/uncertain criteria');
  }
  if (status === 'fail' && !Object.values(criteria).some(row => row.status === 'fail' || row.status === 'uncertain')) {
    throw new Error('value_check.status=fail requires at least one failed/uncertain criterion');
  }
  const overrideReason = status === 'override' ? textOrUndefined(raw.override_reason) : undefined;
  if (status === 'override' && (!overrideReason || overrideReason.length < 12)) {
    throw new Error('value_check.status=override requires a concrete override_reason');
  }
  return {
    status,
    observed,
    preview_sha256: previewSha.toLowerCase(),
    evidence_operation_id: evidenceOperationId,
    criteria,
    confidence: confidence ?? null,
    limitations,
    applicability_reason: null,
    override_reason: overrideReason ?? null,
  };
}
function normalizeScale(value) {
  const scale = textOrUndefined(value)?.toLowerCase();
  return scale && Object.prototype.hasOwnProperty.call(SCALE_RANK, scale) ? scale : undefined;
}
function normalizeSeverity(value) {
  const severity = textOrUndefined(value)?.toLowerCase();
  return severity && SEVERITIES.has(severity) ? severity : undefined;
}
function visualContext(request) {
  const micro = request?.tool === 'photoshop_execute_visual_microplan' && request.args && typeof request.args === 'object'
    ? request.args : {};
  return {
    problem_id: textOrUndefined(request?.problem_id) ?? textOrUndefined(micro.problem_id),
    region: textOrUndefined(request?.region) ?? textOrUndefined(micro.region),
    hypothesis: textOrUndefined(request?.hypothesis) ?? textOrUndefined(micro.expected_visual_result),
    failure_signals: Array.isArray(request?.failure_signals) ? request.failure_signals
      : Array.isArray(micro.failure_signals) ? micro.failure_signals : [],
    stage: textOrUndefined(request?.stage) ?? textOrUndefined(micro.stage),
    scale: normalizeScale(request?.scale) ?? normalizeScale(micro.scale),
    severity: normalizeSeverity(request?.severity),
    planner_directive_id: textOrUndefined(micro.planner_directive_id) ?? textOrUndefined(request?.planner_directive_id),
    planner_task_id: textOrUndefined(micro.planner_task_id) ?? textOrUndefined(request?.planner_task_id),
    painter_scope: (textOrUndefined(micro.painter_scope) ?? textOrUndefined(request?.painter_scope))?.toLowerCase(),
    change_domains: Array.isArray(micro.change_domains)
      ? [...new Set(micro.change_domains.map(value => textOrUndefined(value)?.toLowerCase()).filter(Boolean))]
      : Array.isArray(request?.change_domains)
        ? [...new Set(request.change_domains.map(value => textOrUndefined(value)?.toLowerCase()).filter(Boolean))]
      : [],
  };
}
function problemIdentity(request) {
  const context = visualContext(request);
  return context.problem_id;
}
function canonical(x) {
  if (Array.isArray(x)) return x.map(canonical);
  if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, canonical(x[k])]));
  return x;
}
export function fingerprint(request) { return createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex'); }
export function atomicJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(data, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
export function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid lock owner; inspect the lock manually');
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; return true; }
}
export function parseTexts(result) {
  return (result?.content ?? []).filter(c => c.type === 'text').map(c => {
    try { return JSON.parse(c.text); } catch { return { text: c.text }; }
  });
}
export function previewOf(result) {
  for (const body of parseTexts(result)) {
    const p = body.preview ?? body;
    if (typeof p.sha256 === 'string' && typeof p.materialized_path === 'string') return p;
  }
  return undefined;
}
function bindPreviewDocument(preview, documentId) {
  if (!preview) return preview;
  if (!Number.isSafeInteger(documentId) || documentId <= 0) {
    throw new Error('Preview provenance requires a positive pinned document_id');
  }
  if (preview.document_id !== undefined && preview.document_id !== documentId) {
    throw new Error(`Preview document_id ${preview.document_id} does not match pinned document ${documentId}`);
  }
  return { ...preview, document_id: documentId };
}
function beforePreviewOf(result) {
  for (const body of parseTexts(result)) {
    const p = body?.before_preview;
    if (p && typeof p.sha256 === 'string' && typeof p.materialized_path === 'string') return p;
  }
  return undefined;
}
function significanceModeOf(request) {
  const micro = request?.tool === 'photoshop_execute_visual_microplan' && request.args && typeof request.args === 'object'
    ? request.args : {};
  return textOrUndefined(request?.significance_mode) ?? textOrUndefined(micro.significance_mode) ?? 'normal';
}
const WORKFLOW_STALL_ACTION_LIMIT = 8;
const WORKFLOW_STALL_INSUFFICIENT_LIMIT = 2;
const DECISION_LOOP_STALL_SECONDS = 90;
const SILENT_STALL_SECONDS = 90;
const CHECKPOINT_VISUAL_LIMIT = 5;
const CHECKPOINT_AGE_MS = 300_000;
const TREND_SIGNAL_WINDOW = 3;
const TREND_SIGNAL_REPEAT_LIMIT = 2;
const GLOBAL_READABILITY = new Set(['improved', 'stable', 'degraded']);
const PRIMITIVE_FOOTPRINT = new Set(['none', 'acceptable', 'suspect']);
const RECOGNITION_SUBJECT = new Set(['yes', 'no', 'uncertain']);
const RECOGNITION_STYLE = new Set(['yes', 'no', 'uncertain', 'not_applicable']);
const RECOGNITION_EVALUATOR = new Set(['producer', 'blinded', 'human', 'external']);
function normalizeTrendSignal(value) {
  if (typeof value !== 'string') return undefined;
  const signal = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return signal.length >= 3 ? signal.slice(0, 80) : undefined;
}
function ageSeconds(value, nowMs = Date.now()) {
  const parsed = Date.parse(value ?? '');
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / 1000));
}
function latestTimestamp(values = []) {
  let latest;
  let latestMs = -Infinity;
  for (const value of values) {
    const parsed = Date.parse(value ?? '');
    if (!Number.isFinite(parsed) || parsed <= latestMs) continue;
    latestMs = parsed;
    latest = new Date(parsed).toISOString();
  }
  return latest ?? null;
}
function isRecognitionBlockInStage(value) {
  const stage = textOrUndefined(value)?.toUpperCase().replace(/[\s-]+/g, '_');
  return stage === 'RECOGNITION_BLOCK_IN';
}
function recognitionStringArray(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${name} must be an array of non-empty strings`);
  }
  return [...new Set(value.map(item => item.trim()))];
}
function normalizeRecognitionVerdict(value, required = false) {
  if (value === undefined) {
    if (required) throw new Error('recognition verdict is required for RECOGNITION_BLOCK_IN');
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('recognition must be an object');
  }
  const subject = textOrUndefined(value.subject)?.toLowerCase();
  const style = textOrUndefined(value.style)?.toLowerCase();
  const evaluator = (textOrUndefined(value.evaluator)?.toLowerCase() ?? 'producer');
  if (!RECOGNITION_SUBJECT.has(subject)) throw new Error('recognition.subject must be yes|no|uncertain');
  if (!RECOGNITION_STYLE.has(style)) throw new Error('recognition.style must be yes|no|uncertain|not_applicable');
  if (!RECOGNITION_EVALUATOR.has(evaluator)) throw new Error('recognition.evaluator must be producer|blinded|human|external');
  return {
    subject,
    style,
    evaluator,
    visible_features: recognitionStringArray(value.visible_features, 'recognition.visible_features'),
    lost_features: recognitionStringArray(value.lost_features, 'recognition.lost_features'),
  };
}
function significanceHasDetectedChange(significance) {
  for (const metrics of [significance?.global, significance?.local]) {
    if (!metrics) continue;
    if (Number(metrics.mean_abs_rgb_delta) > 0.001) return true;
    if (Number(metrics.p95_abs_rgb_delta) > 0) return true;
    if (Number(metrics.changed_ratio_delta_ge_2) > 0) return true;
  }
  return false;
}
function elapsedMs(start, end) {
  const a = Date.parse(start ?? '');
  const b = Date.parse(end ?? '');
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, b - a) : null;
}
function reportedToolExecutionMs(record) {
  for (const body of parseTexts(record?.result)) {
    for (const candidate of [
      body?.execution_duration_ms,
      body?.details?.execution_duration_ms,
      body?.mutation_result?.execution_duration_ms,
      body?.mutation_result?.details?.execution_duration_ms,
    ]) {
      if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0) return candidate;
    }
  }
  return null;
}
export class SessionStore {
  constructor(directory, options = {}) {
    this.directory = directory;
    this.visualBarrierDirectory = options.visualBarrierDirectory
      ?? path.join(directory, 'preview-barriers');
  }
  file(id) { return path.join(this.directory, 'operations', `${validId(id)}.json`); }
  paintingStateFile() { return path.join(this.directory, 'painting-state.json'); }
  visualBarrierFile(documentId) {
    if (!Number.isSafeInteger(documentId) || documentId <= 0) throw new Error('Positive document_id required for visual barrier');
    return path.join(this.visualBarrierDirectory, `${documentId}.json`);
  }
  visualBarrier(documentId) {
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return undefined;
    try {
      const value = JSON.parse(fs.readFileSync(this.visualBarrierFile(documentId), 'utf8'));
      if (typeof value.planId !== 'string' || typeof value.requiresExternalPreview !== 'boolean' ||
          (value.operationId !== undefined && typeof value.operationId !== 'string') ||
          (value.operationSequence !== undefined && (!Number.isSafeInteger(value.operationSequence) || value.operationSequence <= 0)) ||
          (value.sha256 !== undefined && typeof value.sha256 !== 'string')) {
        throw new Error(`Corrupt visual barrier for document ${documentId}`);
      }
      return value;
    } catch (error) {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    }
  }
  setVisualBarrier(documentId, value) {
    atomicJson(this.visualBarrierFile(documentId), value);
    return value;
  }
  clearVisualBarrier(documentId) {
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return false;
    try { fs.unlinkSync(this.visualBarrierFile(documentId)); return true; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  visualPlanId(record) {
    return textOrUndefined(record?.args?.plan_id) ?? record?.id;
  }
  barrierOwnedByRecord(barrier, record, suppliedRecords) {
    if (!barrier || !record) return false;
    if (barrier.operationId !== undefined) {
      if (barrier.operationId !== record.id) return false;
      return barrier.operationSequence === undefined || barrier.operationSequence === record.sequence;
    }
    if (barrier.planId !== this.visualPlanId(record)) return false;
    const records = suppliedRecords ?? this.records();
    const sequence = Number(record.sequence ?? 0);
    return !records.some(candidate =>
      candidate.id !== record.id &&
      candidate.args?.document_id === record.args?.document_id &&
      candidate.visual &&
      this.visualPlanId(candidate) === barrier.planId &&
      Number(candidate.sequence ?? 0) > sequence &&
      !candidate.verdict &&
      candidate.resolved?.outcome !== 'abandoned'
    );
  }
  hasDurableNotExecutedProof(record) {
    if (record?.execution === 'not-executed') return true;
    const guaranteedPreDispatchCodes = new Set([
      'invalid_visual_microplan',
      'preview_verdict_required',
      'method_execution_preflight_failed',
    ]);
    return parseTexts(record?.result).some(body =>
      body?.execution === 'not-executed' ||
      (body?.visual_mutation_started === false && guaranteedPreDispatchCodes.has(body?.code)) ||
      guaranteedPreDispatchCodes.has(body?.code)
    );
  }
  synchronizeVisualBarrier(documentId, suppliedRecords) {
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return undefined;
    const records = suppliedRecords ?? this.records();
    let barrier = this.visualBarrier(documentId);
    if (barrier) {
      const owner = barrier.operationId
        ? records.find(r => r.args?.document_id === documentId && r.id === barrier.operationId)
        : [...records].reverse().find(r => r.args?.document_id === documentId &&
          (r.id === barrier.planId || this.visualPlanId(r) === barrier.planId));
      // Legacy split-brain repair: the journal already contains the authoritative
      // classification, so an old server barrier must not resurrect that verdict.
      if (owner?.verdict) {
        this.clearVisualBarrier(documentId);
        barrier = undefined;
      }
    }
    if (!barrier) {
      const pending = [...records].reverse().find(r =>
        r.args?.document_id === documentId && r.visual && !r.verdict && r.resolved?.outcome !== 'abandoned'
      );
      if (pending) {
        barrier = this.setVisualBarrier(documentId, {
          planId: this.visualPlanId(pending),
          operationId: pending.id,
          operationSequence: pending.sequence,
          ...(pending.preview?.sha256 ? { sha256: pending.preview.sha256 } : {}),
          requiresExternalPreview: !pending.preview?.sha256,
        });
      }
    }
    return barrier;
  }
  paintingState() {
    try { return JSON.parse(fs.readFileSync(this.paintingStateFile(), 'utf8')); }
    catch (e) { if (e.code === 'ENOENT') return { version: 1, revision: 0, documents: {} }; throw e; }
  }
  updatePaintingState(documentId, updater) {
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return undefined;
    const state = this.paintingState();
    const key = String(documentId);
    const current = state.documents?.[key] ?? { document_id: documentId };
    state.documents ??= {};
    state.documents[key] = updater(current);
    state.revision = Number(state.revision ?? 0) + 1;
    state.updated_at = new Date().toISOString();
    atomicJson(this.paintingStateFile(), state);
    return state.documents[key];
  }
  setArtDirectorState(input) {
    const documentId = Number(input?.document_id);
    if (!Number.isSafeInteger(documentId) || documentId <= 0) throw new Error('Art Director state requires a positive document_id');
    const action = textOrUndefined(input?.action)?.toLowerCase();
    if (!['review', 'interrupt', 'complete'].includes(action)) {
      throw new Error('Art Director action must be review|interrupt|complete');
    }

    if (action === 'interrupt') {
      const reason = textOrUndefined(input.reason)?.toLowerCase();
      const detail = textOrUndefined(input.detail);
      if (!ART_DIRECTOR_INTERRUPT_REASONS.has(reason)) {
        throw new Error(`Art Director interrupt reason must be one of ${[...ART_DIRECTOR_INTERRUPT_REASONS].join(', ')}`);
      }
      if (!detail || detail.length < 10) throw new Error('Art Director interrupt requires concrete detail');
      return this.updatePaintingState(documentId, current => {
        const existing = current.art_director;
        if (!existing?.directive_id || existing.status === 'completed') {
          throw new Error('No active Art Director directive to interrupt');
        }
        return {
          ...current,
          art_director: {
            ...existing,
            status: 'interrupted',
            review_due: true,
            review_reason: `early_interrupt:${reason}`,
            interrupt: { reason, detail, at: new Date().toISOString() },
          },
        };
      });
    }

    if (action === 'complete') {
      return this.updatePaintingState(documentId, current => {
        const existing = current.art_director;
        if (!existing?.directive_id) throw new Error('No Art Director directive to complete');
        const unfinished = (existing.tasks ?? []).filter(task => task.status !== 'completed');
        if (unfinished.length) {
          throw new Error(`Cannot complete Art Director directive while unfinished tasks remain: ${unfinished.map(task => task.task_id).join(', ')}`);
        }
        const comparison = input?.final_comparison;
        if (!comparison || typeof comparison !== 'object' || Array.isArray(comparison)) {
          throw new Error('Art Director completion requires final_comparison against the strongest previous accepted state');
        }
        const scope = textOrUndefined(comparison.scope)?.toLowerCase();
        if (!['compared', 'no_previous'].includes(scope)) throw new Error('final_comparison.scope must be compared|no_previous');
        const preferred = textOrUndefined(comparison.preferred)?.toLowerCase();
        if (!['current', 'previous', 'tie'].includes(preferred)) throw new Error('final_comparison.preferred must be current|previous|tie');
        const reason = textOrUndefined(comparison.reason);
        if (!reason || reason.length < 12) throw new Error('final_comparison.reason must be concrete');
        const criteria = comparison.criteria;
        if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) throw new Error('final_comparison.criteria is required');
        const normalizedCriteria = {};
        for (const field of FINAL_COMPARISON_CRITERIA) {
          const value = textOrUndefined(criteria[field]);
          if (!value) throw new Error(`final_comparison.criteria.${field} is required`);
          normalizedCriteria[field] = value;
        }
        const acceptedVisuals = this.records().filter(record =>
          record.args?.document_id === documentId
          && record.visual
          && record.verdict?.disposition === 'accept'
          && record.verdict?.verdict === 'improvement'
        );
        if (scope === 'no_previous' && acceptedVisuals.length > 1) {
          throw new Error('final_comparison.scope=no_previous is invalid when multiple accepted visual states exist');
        }
        if (preferred === 'previous') {
          throw new Error('final_comparison prefers the previous accepted state; restore/reconcile that stronger state before completing');
        }
        return {
          ...current,
          art_director: {
            ...existing,
            status: 'completed',
            review_due: false,
            review_reason: null,
            final_comparison: { scope, preferred, reason, criteria: normalizedCriteria, at: new Date().toISOString() },
            completed_at: new Date().toISOString(),
          },
        };
      });
    }

    const directive = input?.directive;
    if (!directive || typeof directive !== 'object' || Array.isArray(directive)) {
      throw new Error('Art Director review requires directive object');
    }
    const directiveId = textOrUndefined(directive.directive_id);
    const goal = textOrUndefined(directive.goal);
    if (!directiveId || !idPattern.test(directiveId)) throw new Error('directive.directive_id must be a stable 1-80 character id');
    if (!goal) throw new Error('directive.goal is required');
    const assessment = directive.assessment;
    if (!assessment || typeof assessment !== 'object' || Array.isArray(assessment)) {
      throw new Error('directive.assessment is required');
    }
    const normalizedAssessment = {};
    for (const field of ART_DIRECTOR_ASSESSMENT_FIELDS) {
      const value = textOrUndefined(assessment[field]);
      if (!value) throw new Error(`directive.assessment.${field} is required`);
      normalizedAssessment[field] = value;
    }
    const rawStyleContract = directive.style_contract;
    if (!rawStyleContract || typeof rawStyleContract !== 'object' || Array.isArray(rawStyleContract)) {
      throw new Error('directive.style_contract is required');
    }
    const styleContract = {};
    for (const field of STYLE_CONTRACT_FIELDS) {
      const value = textOrUndefined(rawStyleContract[field]);
      if (value) styleContract[field] = value;
    }
    if (Object.keys(styleContract).length < 3) {
      throw new Error('directive.style_contract must define at least three relevant artistic constraints');
    }
    const rawComposition = directive.composition_exploration;
    if (!rawComposition || typeof rawComposition !== 'object' || Array.isArray(rawComposition)) {
      throw new Error('directive.composition_exploration is required');
    }
    const compositionMode = textOrUndefined(rawComposition.mode)?.toLowerCase();
    if (!COMPOSITION_MODES.has(compositionMode)) {
      throw new Error('directive.composition_exploration.mode must be reference_reproduction|free_composition|stylized_painting');
    }
    const rawHypotheses = Array.isArray(rawComposition.hypotheses) ? rawComposition.hypotheses : [];
    const hypotheses = rawHypotheses.map((hypothesis, index) => {
      if (!hypothesis || typeof hypothesis !== 'object' || Array.isArray(hypothesis)) throw new Error(`directive.composition_exploration.hypotheses[${index}] must be an object`);
      const id = textOrUndefined(hypothesis.id);
      const summary = textOrUndefined(hypothesis.summary);
      const largeMasses = textOrUndefined(hypothesis.large_masses);
      const negativeSpace = textOrUndefined(hypothesis.negative_space);
      const lightPattern = textOrUndefined(hypothesis.light_pattern);
      if (!id || !idPattern.test(id) || !summary || !largeMasses || !negativeSpace || !lightPattern) throw new Error(`directive.composition_exploration.hypotheses[${index}] requires id, summary, large_masses, negative_space and light_pattern`);
      return { id, summary, large_masses: largeMasses, negative_space: negativeSpace, light_pattern: lightPattern };
    });
    const selectedId = textOrUndefined(rawComposition.selected_id);
    const selectionReason = textOrUndefined(rawComposition.selection_reason);
    if (compositionMode === 'free_composition') {
      if (hypotheses.length < 2) throw new Error('free_composition requires at least two cheap composition hypotheses before commitment');
      if (!selectedId || !hypotheses.some(hypothesis => hypothesis.id === selectedId)) throw new Error('free_composition selected_id must reference one declared hypothesis');
      if (!selectionReason || selectionReason.length < 12) throw new Error('free_composition requires a concrete selection_reason');
    }
    const compositionExploration = { mode: compositionMode, hypotheses, selected_id: selectedId ?? null, selection_reason: selectionReason ?? null };
    const valueCheck = parseValueCheck(directive.value_check);
    if (valueCheck.status !== 'style-not-applicable') {
      this.validateValueCheckEvidence(documentId, valueCheck);
    }
    if (!Array.isArray(directive.priorities) || directive.priorities.length < 1 || directive.priorities.length > 6) {
      throw new Error('directive.priorities must contain 1-6 items');
    }
    const priorities = directive.priorities.map((value, index) => {
      const parsed = textOrUndefined(value);
      if (!parsed) throw new Error(`directive.priorities[${index}] must be non-empty`);
      return parsed;
    });
    if (!Array.isArray(directive.tasks) || directive.tasks.length < 1 || directive.tasks.length > 8) {
      throw new Error('directive.tasks must contain 1-8 bounded Painter tasks');
    }
    const taskIds = new Set();
    const tasks = directive.tasks.map((task, index) => {
      if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error(`directive.tasks[${index}] must be an object`);
      const taskId = textOrUndefined(task.task_id);
      const summary = textOrUndefined(task.summary);
      if (!taskId || !idPattern.test(taskId)) throw new Error(`directive.tasks[${index}].task_id must be a stable id`);
      if (taskIds.has(taskId)) throw new Error(`duplicate directive task_id ${taskId}`);
      taskIds.add(taskId);
      if (!summary) throw new Error(`directive.tasks[${index}].summary is required`);
      const allowedScales = Array.isArray(task.allowed_scales) && task.allowed_scales.length
        ? [...new Set(task.allowed_scales.map(value => normalizeScale(value)).filter(Boolean))]
        : ['medium', 'small'];
      if (!allowedScales.length || allowedScales.includes('global')) {
        throw new Error(`directive.tasks[${index}].allowed_scales must remain within Painter medium/local scope`);
      }
      const allowedGlobalChanges = Array.isArray(task.allowed_global_changes)
        ? [...new Set(task.allowed_global_changes.map(value => textOrUndefined(value)?.toLowerCase()).filter(Boolean))]
        : [];
      for (const domain of allowedGlobalChanges) {
        if (!GLOBAL_CHANGE_DOMAINS.has(domain)) throw new Error(`Unknown allowed_global_changes domain ${domain}`);
      }
      return {
        task_id: taskId,
        summary,
        ...(textOrUndefined(task.region) ? { region: task.region.trim() } : {}),
        allowed_scales: allowedScales,
        allowed_global_changes: allowedGlobalChanges,
        status: index === 0 ? 'active' : 'pending',
      };
    });
    const reviewAfter = Number(directive.review_after_microplans);
    if (!Number.isSafeInteger(reviewAfter) || reviewAfter < 1 || reviewAfter > 20) {
      throw new Error('directive.review_after_microplans must be an adaptive integer between 1 and 20 (normally around 5-10)');
    }
    const forbidden = Array.isArray(directive.forbidden_without_review) && directive.forbidden_without_review.length
      ? [...new Set(directive.forbidden_without_review.map(value => textOrUndefined(value)?.toLowerCase()).filter(Boolean))]
      : [...GLOBAL_CHANGE_DOMAINS];
    for (const domain of forbidden) {
      if (!GLOBAL_CHANGE_DOMAINS.has(domain)) throw new Error(`Unknown forbidden_without_review domain ${domain}`);
    }
    const now = new Date().toISOString();
    return this.updatePaintingState(documentId, current => {
      const previous = current.art_director;
      const revision = previous?.directive_id === directiveId ? Number(previous.revision ?? 0) + 1 : 1;
      return {
        ...current,
        art_director: {
          directive_id: directiveId,
          revision,
          status: 'active',
          goal,
          style_contract: styleContract,
          composition_exploration: compositionExploration,
          assessment: normalizedAssessment,
          value_check: valueCheck,
          priorities,
          tasks,
          current_task_id: tasks[0].task_id,
          review_after_microplans: reviewAfter,
          completed_microplans: 0,
          review_due: false,
          review_reason: null,
          forbidden_without_review: forbidden,
          issued_at: now,
          reviewed_at: now,
          interrupt: null,
        },
      };
    });
  }
  validateValueCheckEvidence(documentId, valueCheck) {
    const evidence = this.read(valueCheck.evidence_operation_id);
    if (!evidence || evidence.phase !== 'completed' || evidence.failed) {
      throw new Error('value_check evidence_operation_id must reference a successful completed grayscale analysis');
    }
    if (evidence.tool !== 'photoshop_analyze_value_structure') {
      throw new Error('value_check evidence_operation_id must reference photoshop_analyze_value_structure');
    }
    if (evidence.args?.document_id !== documentId) {
      throw new Error('value_check grayscale evidence must target the same pinned document');
    }
    const body = parseTexts(evidence.result).find(row =>
      row?.ok === true && typeof row?.source_preview_sha256 === 'string' && typeof row?.grayscale_sha256 === 'string'
    );
    if (!body) throw new Error('value_check grayscale evidence record is missing analyzer hashes');
    const sourceSha = String(body.source_preview_sha256).toLowerCase();
    const grayscaleSha = String(body.grayscale_sha256).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sourceSha) || sourceSha !== valueCheck.preview_sha256) {
      throw new Error('value_check preview_sha256 does not match the analyzer source preview');
    }
    if (!/^[0-9a-f]{64}$/.test(grayscaleSha)) {
      throw new Error('value_check analyzer grayscale_sha256 is invalid');
    }
    const grayscalePath = textOrUndefined(body.materialized_path);
    if (!grayscalePath || !fs.existsSync(grayscalePath) || !fs.statSync(grayscalePath).isFile()) {
      throw new Error('value_check requires a materialized grayscale evidence file');
    }
    if (fingerprintFile(grayscalePath) !== grayscaleSha) {
      throw new Error('value_check grayscale evidence file SHA mismatch');
    }
    const currentFrame = this.paintingState().documents?.[String(documentId)]?.current_frame;
    if (currentFrame?.sha256 && currentFrame.sha256 !== sourceSha) {
      throw new Error('value_check evidence is stale: analyzer source preview is not the current document frame');
    }
    if (currentFrame?.path) {
      if (!fs.existsSync(currentFrame.path) || !fs.statSync(currentFrame.path).isFile()) {
        throw new Error('value_check current document frame is missing from disk');
      }
      if (fingerprintFile(currentFrame.path) !== sourceSha) {
        throw new Error('value_check current document frame SHA mismatch');
      }
    }
    if (currentFrame?.at && evidence.created_at < currentFrame.at) {
      throw new Error('value_check evidence is stale: grayscale analysis predates the current document frame');
    }
    valueCheck.grayscale_sha256 = grayscaleSha;
    valueCheck.grayscale_path = grayscalePath;
    valueCheck.evidence_created_at = evidence.created_at;
    return valueCheck;
  }
  plannerGate(documentId, request) {
    if (!isVisual(request.tool)) return null;
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return null;
    const art = this.paintingState().documents?.[String(documentId)]?.art_director;
    if (!art?.directive_id) return null;
    if (art.status === 'interrupted' || art.review_due) {
      throw new Error(`planner_review_required: directive ${art.directive_id} requires Art Director review before another Painter mutation (${art.review_reason ?? art.status})`);
    }
    if (art.status === 'completed') {
      throw new Error(`planner_review_required: directive ${art.directive_id} is completed; issue a new Art Director directive before more Painter work`);
    }
    const context = visualContext(request);
    if (isDetailStage(context.stage)) {
      const valueCheck = art.value_check;
      if (!valueCheck) {
        throw new Error(`value_check_required: DETAIL is blocked until Art Director records an observed grayscale/value check for directive ${art.directive_id}`);
      }
      if (valueCheck.status === 'fail') {
        throw new Error(`value_structure_unstable: DETAIL is blocked by failed grayscale/value check for directive ${art.directive_id}`);
      }
      if (!['pass', 'override', 'style-not-applicable'].includes(valueCheck.status)) {
        throw new Error(`value_check_required: DETAIL is blocked by unresolved value-check status ${valueCheck.status}`);
      }
    }
    if (!context.planner_directive_id || !context.planner_task_id || !context.painter_scope) {
      throw new Error(`painter_contract_gate: active directive ${art.directive_id} requires planner_directive_id, planner_task_id and painter_scope on every visual micro-plan`);
    }
    if (context.planner_directive_id !== art.directive_id) {
      throw new Error(`painter_contract_gate: micro-plan directive ${context.planner_directive_id} does not match active directive ${art.directive_id}`);
    }
    if (!PAINTER_SCOPES.has(context.painter_scope)) throw new Error('painter_contract_gate: painter_scope must be local|medium');
    const task = (art.tasks ?? []).find(row => row.task_id === context.planner_task_id);
    if (!task) throw new Error(`painter_contract_gate: unknown planner_task_id ${context.planner_task_id}`);
    if (task.status !== 'active') {
      throw new Error(`painter_contract_gate: task ${task.task_id} is ${task.status}; only the active task may be executed`);
    }
    const requestScale = normalizeScale(context.scale);
    if (!requestScale || requestScale === 'global' || !(task.allowed_scales ?? []).includes(requestScale)) {
      throw new Error(`painter_contract_gate: scale ${requestScale ?? 'missing'} is outside task ${task.task_id} allowed_scales=${(task.allowed_scales ?? []).join(',')}`);
    }
    if (!context.change_domains.length) throw new Error('painter_contract_gate: Painter micro-plan requires change_domains');
    const allowedGlobal = new Set(task.allowed_global_changes ?? []);
    const blocked = context.change_domains.filter(domain =>
      (art.forbidden_without_review ?? []).includes(domain) && !allowedGlobal.has(domain)
    );
    if (blocked.length) {
      throw new Error(`planner_review_required: Painter cannot change ${blocked.join(', ')} under directive ${art.directive_id}; return to Art Director before dispatch`);
    }
    return { directive: art, task, context };
  }
  advanceArtDirectorAfterVerdict(current, context, input, record) {
    const art = current.art_director;
    if (!art?.directive_id || art.status !== 'active') return current;
    if (!context.planner_directive_id || context.planner_directive_id !== art.directive_id) return current;
    const taskId = context.planner_task_id;
    const tasks = (art.tasks ?? []).map(task => ({ ...task }));
    const task = tasks.find(row => row.task_id === taskId);
    if (!task) return current;

    const completedMicroplans = Number(art.completed_microplans ?? 0) + 1;
    const taskAssessment = record.verdict?.planner_task_assessment ?? input.planner_task_assessment;
    const taskResolved = taskAssessment?.status === 'completed';
    const taskBlocked = taskAssessment?.status === 'blocked';
    const taskFailed = input.verdict === 'regression' && input.disposition === 'rollback';
    if (taskResolved) task.status = 'completed';
    else if (taskBlocked) task.status = 'blocked';
    else if (taskFailed) task.status = 'failed';

    let interruptReason = textOrUndefined(input.planner_interrupt_reason)?.toLowerCase();
    if (interruptReason && !ART_DIRECTOR_INTERRUPT_REASONS.has(interruptReason)) interruptReason = undefined;
    if (!interruptReason && input.global_readability === 'degraded') {
      interruptReason = 'unexpected_global_composition_value_shift';
    }
    if (!interruptReason && input.verdict === 'regression' && input.regressions?.length) {
      interruptReason = 'serious_visual_error';
    }
    const normalizedSignals = new Set((record.verdict?.trend_signals ?? []).map(normalizeTrendSignal).filter(Boolean));
    if (!interruptReason && [...normalizedSignals].some(signal => /likeness|main-shape|mainshape/.test(signal))) {
      interruptReason = 'likeness_main_shape_degraded';
    }

    const reviewAfter = Number(art.review_after_microplans ?? 0);
    const cadenceDue = reviewAfter > 0 && completedMicroplans >= reviewAfter;
    let nextTask;
    if (taskResolved) {
      nextTask = tasks.find(row => row.status === 'pending');
      if (nextTask) nextTask.status = 'active';
    } else if (taskBlocked) {
      status = 'review_due';
      reviewDue = true;
      reviewReason = `task_blocked:${task.task_id}`;
    } else if (taskFailed) {
      nextTask = task;
    } else {
      nextTask = task.status === 'active' ? task : tasks.find(row => row.status === 'active');
    }
    const allCompleted = tasks.length > 0 && tasks.every(row => row.status === 'completed');

    let status = art.status;
    let reviewDue = !!art.review_due;
    let reviewReason = art.review_reason ?? null;
    let interrupt = art.interrupt ?? null;
    if (interruptReason) {
      status = 'interrupted';
      reviewDue = true;
      reviewReason = `early_interrupt:${interruptReason}`;
      interrupt = {
        reason: interruptReason,
        detail: textOrUndefined(input.planner_interrupt_detail)
          ?? `Triggered by classified Painter micro-plan ${record.id}`,
        operation_id: record.id,
        at: record.verdict?.at ?? new Date().toISOString(),
      };
    } else if (taskFailed) {
      status = 'review_due';
      reviewDue = true;
      reviewReason = `task_failed:${task.task_id}`;
    } else if (allCompleted) {
      status = 'review_due';
      reviewDue = true;
      reviewReason = 'directive_tasks_completed';
    } else if (cadenceDue) {
      status = 'review_due';
      reviewDue = true;
      reviewReason = `cadence:${completedMicroplans}_microplans`;
    }

    return {
      ...current,
      art_director: {
        ...art,
        status,
        tasks,
        current_task_id: nextTask?.task_id ?? null,
        completed_microplans: completedMicroplans,
        review_due: reviewDue,
        review_reason: reviewReason,
        interrupt,
        last_painter_operation_id: record.id,
        last_painter_verdict_at: record.verdict?.at ?? new Date().toISOString(),
      },
    };
  }
  setPriorityState(input) {
    const documentId = Number(input?.document_id);
    if (!Number.isSafeInteger(documentId) || documentId <= 0) throw new Error('priority state requires a positive document_id');
    if (!Array.isArray(input?.problems)) throw new Error('priority state requires problems[]');
    const currentStage = textOrUndefined(input.current_stage);
    const normalized = {};
    for (const problem of input.problems) {
      const problemId = textOrUndefined(problem?.problem_id);
      const scale = normalizeScale(problem?.scale);
      const severity = normalizeSeverity(problem?.severity);
      if (!problemId || !scale || !severity) throw new Error('Each priority problem requires problem_id, scale and severity');
      const status = problem.status ?? 'open';
      if (!['open', 'resolved'].includes(status)) throw new Error('priority problem status must be open|resolved');
      normalized[problemId] = {
        problem_id: problemId, scale, severity, status,
        ...(textOrUndefined(problem.region) ? { region: problem.region.trim() } : {}),
        ...(textOrUndefined(problem.hypothesis) ? { hypothesis: problem.hypothesis.trim() } : {}),
      };
    }
    const nextMustFix = this.largestOpenMustFix(normalized);
    return this.updatePaintingState(documentId, current => ({
      ...current,
      ...(currentStage ? { current_stage: currentStage } : {}),
      visual_problems: normalized,
      active_problem: nextMustFix ?? current.active_problem,
      ...(nextMustFix?.scale ? { active_scale: nextMustFix.scale } : {}),
      priority_review_required: false,
    }));
  }
  largestOpenMustFix(problems) {
    const values = Object.values(problems ?? {}).filter(p => p?.status !== 'resolved' && p?.severity === 'must-fix' && normalizeScale(p?.scale));
    values.sort((a, b) => SCALE_RANK[normalizeScale(a.scale)] - SCALE_RANK[normalizeScale(b.scale)]);
    return values[0];
  }
  priorityGate(documentId, request) {
    if (!isVisual(request.tool)) return null;
    const context = visualContext(request);
    const requestScale = normalizeScale(context.scale);
    const doc = this.paintingState().documents?.[String(documentId)];
    const blocker = this.largestOpenMustFix(doc?.visual_problems);
    if (!blocker) return null;
    if (!requestScale) throw new Error(`stage_priority_gate: visual mutation must declare scale=global|medium|small while unresolved must-fix "${blocker.problem_id}" is open`);
    const blockerScale = normalizeScale(blocker.scale);
    if (SCALE_RANK[requestScale] <= SCALE_RANK[blockerScale]) return null;
    if (request.replan && /override|diagnostic|probe|test/i.test(request.replan)) return null;
    throw new Error(`stage_priority_gate: ${requestScale} mutation blocked by unresolved ${blockerScale} must-fix "${blocker.problem_id}". Resolve/reclassify the larger problem first, or supply an explicit diagnostic override in replan.`);
  }
  cumulativeTrendState(documentId, suppliedRecords) {
    const records = (suppliedRecords ?? this.records())
      .filter(r => r.args?.document_id === documentId && r.visual && r.verdict)
      .slice(-TREND_SIGNAL_WINDOW);
    const counts = new Map();
    for (const record of records) {
      const signals = new Set((record.verdict?.trend_signals ?? []).map(normalizeTrendSignal).filter(Boolean));
      if (record.verdict?.global_readability === 'degraded') signals.add('global-readability-degraded');
      if (record.verdict?.primitive_footprint === 'suspect') signals.add('primitive-footprint-repeating');
      for (const signal of signals) counts.set(signal, (counts.get(signal) ?? 0) + 1);
    }
    const repeated = [...counts.entries()]
      .filter(([, count]) => count >= TREND_SIGNAL_REPEAT_LIMIT)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    return {
      window: records.map(r => r.id),
      repeated_signals: repeated.map(([signal, count]) => ({ signal, count })),
      triggered: repeated.length > 0,
    };
  }
  promoteCumulativeTrendProblem(documentId, current, trendState) {
    if (!trendState?.triggered) return current;
    const signal = trendState.repeated_signals[0].signal;
    const problemId = `cumulative-trend-${signal}`.slice(0, 80);
    const problems = { ...(current.visual_problems ?? {}) };
    const existing = problems[problemId];
    problems[problemId] = {
      ...(existing ?? {}),
      problem_id: problemId,
      scale: 'global',
      severity: 'must-fix',
      status: 'open',
      region: 'whole image',
      hypothesis: `Repeated visual trend detected across recent classified passes: ${signal}. Resolve the cumulative global degradation before finer work.`,
      trend_signal: signal,
      trend_count: trendState.repeated_signals[0].count,
      source_operations: trendState.window,
    };
    return {
      ...current,
      visual_problems: problems,
      active_problem: problems[problemId],
      active_scale: 'global',
      priority_review_required: true,
      cumulative_trend_guard: {
        triggered: true,
        problem_id: problemId,
        signal,
        count: trendState.repeated_signals[0].count,
        window: trendState.window,
      },
    };
  }
  read(id) { try { return JSON.parse(fs.readFileSync(this.file(id), 'utf8')); } catch (e) { if (e.code === 'ENOENT') return undefined; throw e; } }
  write(record) { atomicJson(this.file(record.id), record); }
  records() {
    const dir = path.join(this.directory, 'operations');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter(f => f.endsWith('.json')).map(f => {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!r.id || !r.phase || !r.created_at) throw new Error(`Corrupt operation journal: ${f}`);
      return r;
    }).sort((a, b) => (a.sequence && b.sequence ? a.sequence - b.sequence : a.created_at.localeCompare(b.created_at)) || a.id.localeCompare(b.id));
  }
  workflowMetrics(documentId, suppliedRecords) {
    const empty = {
      tracking_started: false,
      primary_metric: 'resolved_visual_problems',
      resolved_visual_problems: 0,
      resolved_problem_ids: [],
      open_problem_ids: [],
      resolution_events: 0,
      meaningful_visual_passes: 0,
      insufficient_visual_passes: 0,
      consecutive_insufficient_visual_passes: 0,
      external_actions_since_last_meaningful_visual_change: 0,
      last_visual_operation_id: null,
      last_visual_verdict_at: null,
      last_meaningful_visual_change_at: null,
      seconds_since_last_visual_operation: null,
      seconds_since_last_meaningful_visual_change: null,
      workflow_stall: false,
      stall_reasons: [],
    };
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return empty;
    const records = (suppliedRecords ?? this.records()).filter(r => r.args?.document_id === documentId);
    const tracked = records.filter(r => r.visual && r.verdict?.significance?.execution_effect);
    if (!tracked.length) return empty;

    const problems = new Map();
    let resolutionEvents = 0;
    let meaningful = 0;
    let insufficient = 0;
    let consecutiveInsufficient = 0;
    for (const record of tracked) {
      const effect = record.verdict.significance.execution_effect;
      const artisticProgress = record.verdict.verdict === 'improvement'
        && record.verdict.disposition === 'accept'
        && significanceHasDetectedChange(record.verdict.significance);
      if (artisticProgress) {
        meaningful++;
        consecutiveInsufficient = 0;
      } else if (effect === 'insufficient') {
        insufficient++;
        consecutiveInsufficient++;
      } else {
        consecutiveInsufficient = 0;
      }
      const problemId = problemIdentity(record);
      if (!problemId) continue;
      const resolved = artisticProgress
        && record.verdict.verdict === 'improvement'
        && record.verdict.disposition === 'accept'
        && record.verdict.target_resolved === 'yes';
      const explicitlyOpen = record.verdict.target_resolved === 'no'
        || record.verdict.verdict === 'regression';
      if (resolved) {
        if (problems.get(problemId) !== 'resolved') resolutionEvents++;
        problems.set(problemId, 'resolved');
      } else if (explicitlyOpen) {
        problems.set(problemId, 'open');
      }
    }

    const lastMeaningful = [...tracked].reverse().find(r =>
      r.verdict?.verdict === 'improvement'
      && r.verdict?.disposition === 'accept'
      && significanceHasDetectedChange(r.verdict?.significance)
    );
    const lastVisual = [...records].reverse().find(r => r.visual);
    const lastVisualAt = lastVisual?.completed_at ?? lastVisual?.created_at;
    const lastMeaningfulAt = lastMeaningful?.completed_at ?? lastMeaningful?.created_at;
    const anchorSequence = lastMeaningful?.sequence ?? ((tracked[0]?.sequence ?? 1) - 1);
    const externalActionsSince = records.filter(r => (r.sequence ?? 0) > anchorSequence).length;
    const stallReasons = [];
    if (externalActionsSince >= WORKFLOW_STALL_ACTION_LIMIT) {
      stallReasons.push(`${externalActionsSince} external actions since the last meaningful visual change`);
    }
    if (consecutiveInsufficient >= WORKFLOW_STALL_INSUFFICIENT_LIMIT) {
      stallReasons.push(`${consecutiveInsufficient} consecutive visually insufficient passes`);
    }
    const resolvedIds = [...problems.entries()].filter(([, status]) => status === 'resolved').map(([id]) => id);
    const openIds = [...problems.entries()].filter(([, status]) => status === 'open').map(([id]) => id);
    return {
      tracking_started: true,
      primary_metric: 'resolved_visual_problems',
      resolved_visual_problems: resolvedIds.length,
      resolved_problem_ids: resolvedIds,
      open_problem_ids: openIds,
      resolution_events: resolutionEvents,
      meaningful_visual_passes: meaningful,
      insufficient_visual_passes: insufficient,
      consecutive_insufficient_visual_passes: consecutiveInsufficient,
      external_actions_since_last_meaningful_visual_change: externalActionsSince,
      last_meaningful_visual_operation_id: lastMeaningful?.id,
      last_visual_operation_id: lastVisual?.id ?? null,
      last_visual_verdict_at: lastVisual?.verdict?.at ?? null,
      last_meaningful_visual_change_at: lastMeaningfulAt ?? null,
      seconds_since_last_visual_operation: ageSeconds(lastVisualAt),
      seconds_since_last_meaningful_visual_change: ageSeconds(lastMeaningfulAt),
      workflow_stall: stallReasons.length > 0,
      stall_reasons: stallReasons,
    };
  }
  recognitionMetrics(documentId, suppliedRecords) {
    const empty = {
      tracking_started: false,
      tracking_started_at: null,
      first_detected_visual_change_at: null,
      seconds_to_first_detected_visual_change: null,
      first_subject_recognizable_at: null,
      seconds_to_subject_recognizable: null,
      first_subject_and_style_recognizable_at: null,
      seconds_to_subject_and_style_recognizable: null,
      recognition_feature_destruction_passes: 0,
      recognition_features_lost_count: 0,
      recognition_features_lost: [],
      recorded_operation_ms: 0,
      between_operation_gap_ms: 0,
      reported_tool_execution_ms: 0,
      reported_tool_execution_operations: 0,
    };
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return empty;
    const records = (suppliedRecords ?? this.records()).filter(r => r.args?.document_id === documentId);
    if (!records.length) return empty;
    const startedAt = records[0].created_at;
    const classifiedVisual = records.filter(r => r.visual && r.verdict);
    const milestoneAt = record => {
      const previewId = record?.verdict?.preview_id;
      const previewRecord = previewId ? records.find(r => r.id === previewId) : undefined;
      return previewRecord?.completed_at ?? record?.completed_at ?? record?.verdict?.at ?? null;
    };
    const firstChange = classifiedVisual.find(r => significanceHasDetectedChange(r.verdict?.significance));
    const firstSubject = classifiedVisual.find(r => r.verdict?.recognition?.subject === 'yes');
    const firstSubjectStyle = classifiedVisual.find(r =>
      r.verdict?.recognition?.subject === 'yes' && r.verdict?.recognition?.style === 'yes'
    );
    const firstChangeAt = firstChange ? milestoneAt(firstChange) : null;
    const firstSubjectAt = firstSubject ? milestoneAt(firstSubject) : null;
    const firstSubjectStyleAt = firstSubjectStyle ? milestoneAt(firstSubjectStyle) : null;
    const destruction = classifiedVisual.filter(r => (r.verdict?.recognition?.lost_features?.length ?? 0) > 0);
    const lost = destruction.flatMap(r => r.verdict.recognition.lost_features);

    let recordedOperationMs = 0;
    let betweenOperationGapMs = 0;
    let reportedExecutionMs = 0;
    let reportedExecutionOperations = 0;
    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      const duration = elapsedMs(record.created_at, record.completed_at);
      if (duration !== null) recordedOperationMs += duration;
      const reported = reportedToolExecutionMs(record);
      if (reported !== null) {
        reportedExecutionMs += reported;
        reportedExecutionOperations++;
      }
      if (i > 0) {
        const priorEnd = records[i - 1].completed_at ?? records[i - 1].created_at;
        const gap = elapsedMs(priorEnd, record.created_at);
        if (gap !== null) betweenOperationGapMs += gap;
      }
    }

    const secondsFromStart = at => {
      const ms = elapsedMs(startedAt, at);
      return ms === null ? null : Math.round(ms / 100) / 10;
    };
    return {
      tracking_started: true,
      tracking_started_at: startedAt,
      first_detected_visual_change_at: firstChangeAt,
      seconds_to_first_detected_visual_change: secondsFromStart(firstChangeAt),
      first_subject_recognizable_at: firstSubjectAt,
      seconds_to_subject_recognizable: secondsFromStart(firstSubjectAt),
      first_subject_and_style_recognizable_at: firstSubjectStyleAt,
      seconds_to_subject_and_style_recognizable: secondsFromStart(firstSubjectStyleAt),
      recognition_feature_destruction_passes: destruction.length,
      recognition_features_lost_count: lost.length,
      recognition_features_lost: [...new Set(lost)],
      recorded_operation_ms: recordedOperationMs,
      between_operation_gap_ms: betweenOperationGapMs,
      reported_tool_execution_ms: reportedExecutionMs,
      reported_tool_execution_operations: reportedExecutionOperations,
    };
  }
  checkpointState(documentId, suppliedRecords) {
    if (!Number.isSafeInteger(documentId) || documentId <= 0) {
      return { due: false, uncheckpointed_visual_operations: 0, age_seconds: null, reason: null };
    }
    const records = (suppliedRecords ?? this.records()).filter(r => r.args?.document_id === documentId);
    const lastCheckpointIndex = records.findLastIndex(r => r.checkpoint);
    const uncheckpointed = records.slice(lastCheckpointIndex + 1).filter(r => r.visual);
    if (!uncheckpointed.length) {
      return { due: false, uncheckpointed_visual_operations: 0, age_seconds: null, reason: null };
    }
    const ageMs = Date.now() - Date.parse(uncheckpointed[0].created_at);
    const dueByCount = uncheckpointed.length >= CHECKPOINT_VISUAL_LIMIT;
    const dueByAge = Number.isFinite(ageMs) && ageMs > CHECKPOINT_AGE_MS;
    return {
      due: dueByCount || dueByAge,
      uncheckpointed_visual_operations: uncheckpointed.length,
      age_seconds: Number.isFinite(ageMs) ? Math.max(0, Math.floor(ageMs / 1000)) : null,
      reason: dueByCount
        ? `${uncheckpointed.length} uncheckpointed visual operations`
        : dueByAge ? `${Math.floor(ageMs / 1000)} seconds since the first uncheckpointed visual operation` : null,
    };
  }
  visualCadenceState(documentId, suppliedRecords) {
    const all = suppliedRecords ?? this.records();
    const records = all.filter(r => r.args?.document_id === documentId);
    const metrics = this.workflowMetrics(documentId, all);
    const documentState = this.paintingState().documents?.[String(documentId)];
    const activeJobs = this.activeJobs(documentId);
    const barrier = this.synchronizeVisualBarrier(documentId, all) ?? null;
    const checkpoint = this.checkpointState(documentId, all);
    const artDirector = documentState?.art_director;
    const pendingReport = records.find(r => !r.report)?.id ?? null;
    const pendingAck = records.find(r => r.operation_receipt && !r.operation_ack)?.id ?? null;
    const uncertain = records.find(r => r.phase !== 'completed' && !r.resolved)?.id ?? null;
    const lastClassifiedVisual = [...records].reverse().find(r => r.visual && r.verdict);
    const hasOpenProblem = Object.values(documentState?.visual_problems ?? {}).some(problem => problem?.status !== 'resolved');
    const activeVisualWorkflow = metrics.tracking_started && !!lastClassifiedVisual && !!(
      documentState?.current_stage || documentState?.active_problem || hasOpenProblem || lastClassifiedVisual.verdict?.target_resolved !== 'yes'
    );
    const blockers = {
      active_job: activeJobs.at(-1)?.job_id ?? null,
      pending_report: pendingReport,
      pending_operation_ack: pendingAck,
      uncertain_operation: uncertain,
      pending_visual_barrier: barrier?.planId ?? null,
      checkpoint_due: checkpoint.due,
      planner_review_due: !!artDirector?.review_due || artDirector?.status === 'interrupted' || artDirector?.status === 'review_due',
      workflow_stall: metrics.workflow_stall,
    };
    const hasBlocker = !!(blockers.active_job || blockers.pending_report || blockers.pending_operation_ack ||
      blockers.uncertain_operation || blockers.pending_visual_barrier || blockers.checkpoint_due || blockers.planner_review_due || blockers.workflow_stall);
    const secondsSinceVerdict = ageSeconds(lastClassifiedVisual?.verdict?.at ?? lastClassifiedVisual?.completed_at ?? lastClassifiedVisual?.created_at);
    const decisionLoopStall = activeVisualWorkflow
      && !hasBlocker
      && Number.isFinite(secondsSinceVerdict)
      && secondsSinceVerdict >= DECISION_LOOP_STALL_SECONDS;
    return {
      active_visual_workflow: activeVisualWorkflow,
      threshold_seconds: DECISION_LOOP_STALL_SECONDS,
      seconds_since_last_visual_verdict: secondsSinceVerdict,
      decision_loop_stall: decisionLoopStall,
      blockers,
      checkpoint,
    };
  }
  continuationWatchState(documentId, suppliedRecords) {
    const empty = {
      active_visual_workflow: false,
      threshold_seconds: SILENT_STALL_SECONDS,
      phase: 'ready',
      last_advancement_at: null,
      seconds_since_last_advancement: null,
      silent_stall: false,
      silent_stall_reason: null,
      next_required_action: 'ready',
    };
    if (!Number.isSafeInteger(documentId) || documentId <= 0) return empty;
    const all = suppliedRecords ?? this.records();
    const records = all.filter(r => r.args?.document_id === documentId);
    if (!records.length) return empty;

    const documentState = this.paintingState().documents?.[String(documentId)];
    const activeJobs = this.activeJobs(documentId);
    const barrier = this.synchronizeVisualBarrier(documentId, all) ?? null;
    const checkpoint = this.checkpointState(documentId, all);
    const pendingReport = records.find(r => !r.report);
    const pendingAck = records.find(r => r.operation_receipt && !r.operation_ack);
    const uncertain = records.find(r => r.phase !== 'completed' && !r.resolved);
    const pendingVisual = records.find(r => r.visual && !r.verdict);
    const latestClassifiedVisual = [...records].reverse().find(r => r.visual && r.verdict);
    const hasOpenProblem = Object.values(documentState?.visual_problems ?? {}).some(problem => problem?.status !== 'resolved');
    const activeVisualWorkflow = !!pendingVisual || !!(latestClassifiedVisual && (
      documentState?.current_stage || documentState?.active_problem || hasOpenProblem || latestClassifiedVisual.verdict?.target_resolved !== 'yes'
    ));
    const nextRequiredAction = this.documentNextRequiredAction(documentId, all);

    let phase = 'ready';
    if (activeJobs.length) phase = 'active_job';
    else if (pendingReport) phase = 'awaiting_report';
    else if (pendingAck) phase = 'awaiting_operation_ack';
    else if (uncertain) phase = 'awaiting_reconcile';
    else if (barrier) phase = 'awaiting_visual_verdict';
    else if (checkpoint.due) phase = 'awaiting_checkpoint';
    else if (/Art Director review required/i.test(nextRequiredAction)) phase = 'awaiting_art_director_review';
    else if (/replan/i.test(nextRequiredAction)) phase = 'awaiting_replan';
    else if (activeVisualWorkflow && nextRequiredAction !== 'ready') phase = 'awaiting_next_visual_pass';

    const advancementTimes = [];
    for (const record of records) {
      // Ordinary reads are intentionally excluded: status/state/schema/preview churn
      // must not hide a stalled continuation loop. A required preview is counted
      // separately below only when it is the evidence attached to the live barrier.
      if (!isRead(record.tool)) {
        advancementTimes.push(record.created_at, record.completed_at);
        advancementTimes.push(record.report?.recorded_at, record.operation_ack?.acknowledged_at, record.verdict?.at);
      }
      // Reconciliation is semantic progress even when its evidence was read-only.
      advancementTimes.push(record.resolved?.at);
    }
    if (barrier?.sha256) {
      const barrierPreview = [...records].reverse().find(record => record.preview?.sha256 === barrier.sha256);
      advancementTimes.push(barrierPreview?.preview_attached_at, barrierPreview?.completed_at);
    }
    const lastAdvancementAt = latestTimestamp(advancementTimes);
    const secondsSinceAdvancement = ageSeconds(lastAdvancementAt);
    const silentStall = activeVisualWorkflow
      && activeJobs.length === 0
      && nextRequiredAction !== 'ready'
      && Number.isFinite(secondsSinceAdvancement)
      && secondsSinceAdvancement >= SILENT_STALL_SECONDS;

    return {
      active_visual_workflow: activeVisualWorkflow,
      threshold_seconds: SILENT_STALL_SECONDS,
      phase,
      last_advancement_at: lastAdvancementAt,
      seconds_since_last_advancement: secondsSinceAdvancement,
      silent_stall: silentStall,
      silent_stall_reason: silentStall ? phase : null,
      next_required_action: nextRequiredAction,
    };
  }
  documentNextRequiredAction(documentId, suppliedRecords) {
    const all = suppliedRecords ?? this.records();
    const records = all.filter(r => r.args?.document_id === documentId);
    const state = this.paintingState().documents?.[String(documentId)] ?? { document_id: documentId };
    const metrics = this.workflowMetrics(documentId, all);
    const cadence = this.visualCadenceState(documentId, all);
    const activeJob = this.activeJobs(documentId).at(-1);
    if (activeJob) return activeJob.poll_command;
    const pendingReport = records.find(r => !r.report);
    if (pendingReport) return `emit/record report for ${pendingReport.id}`;
    const pendingAck = records.find(r => r.operation_receipt && !r.operation_ack);
    if (pendingAck) return `acknowledge Guard operation receipt for ${pendingAck.id}`;
    const uncertain = records.find(r => r.phase !== 'completed' && !r.resolved);
    if (uncertain) return `reconcile uncertain operation ${uncertain.id}`;
    if (state.pending_rollback) {
      return `rollback required for ${state.pending_rollback.operation_id}: execute photoshop_undo or a VisualMicroPlan with action_class=ROLLBACK before any further visual mutation`;
    }
    const barrier = this.synchronizeVisualBarrier(documentId, all);
    if (barrier) return barrier.sha256
      ? 'inspect/classify preview before another visual mutation'
      : 'obtain recovery/required preview before another visual mutation';
    const checkpoint = this.checkpointState(documentId, all);
    if (checkpoint.due) return 'save required checkpoint, then dispatch next meaningful visual pass';
    const art = state.art_director;
    if (art?.status === 'interrupted' || art?.status === 'review_due' || art?.review_due) {
      return `Art Director review required for directive ${art.directive_id}: ${art.review_reason ?? art.status}`;
    }
    if (art?.status === 'completed') {
      return `Art Director directive ${art.directive_id} completed; issue the next directive or end the painting stage`;
    }
    if (metrics.workflow_stall) return 'supply a concrete replan, then dispatch next meaningful visual pass';
    const activeProblemId = textOrUndefined(state.active_problem?.problem_id);
    if (activeProblemId) {
      const attempts = records.filter(r => r.visual && problemIdentity(r) === activeProblemId);
      const latestAttempt = attempts.at(-1);
      if (latestAttempt?.verdict?.significance?.execution_effect === 'insufficient'
        && !(latestAttempt.verdict?.verdict === 'improvement' && latestAttempt.verdict?.disposition === 'accept'
          && significanceHasDetectedChange(latestAttempt.verdict?.significance))) {
        return `supply a concrete replan for ${activeProblemId}, then dispatch next meaningful visual pass`;
      }
      const lastThree = attempts.slice(-3);
      if (lastThree.length === 3 && lastThree.every(r => r.verdict?.verdict !== 'improvement')) {
        return `supply a concrete replan for ${activeProblemId} after three non-improving attempts, then dispatch next meaningful visual pass`;
      }
    }
    const largestMustFix = this.largestOpenMustFix(state.visual_problems);
    if (largestMustFix && state.active_problem?.scale && SCALE_RANK[normalizeScale(state.active_problem.scale)] > SCALE_RANK[normalizeScale(largestMustFix.scale)]) {
      return `review whole-frame priorities; unresolved ${largestMustFix.scale} must-fix ${largestMustFix.problem_id}`;
    }
    if (cadence.decision_loop_stall) return 'decision-loop stall: dispatch next meaningful visual pass or enter explicit diagnostic mode';
    if (art?.status === 'active' && art?.directive_id) {
      return `Painter: execute bounded task ${art.current_task_id ?? 'from directive'} under directive ${art.directive_id}`;
    }
    if (cadence.active_visual_workflow) return 'dispatch next meaningful visual pass';
    return 'ready';
  }
  lock() {
    fs.mkdirSync(this.directory, { recursive: true });
    const file = path.join(this.directory, 'controller.lock');
    let fd;
    try { fd = fs.openSync(file, 'wx'); }
    catch (e) { if (e.code === 'EEXIST') throw new Error('Another controller owns the session. Use status; never start replacement work.'); throw e; }
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); fs.fsyncSync(fd); }
    finally { fs.closeSync(fd); }
    return () => fs.unlinkSync(file);
  }
  recoverLock(file = path.join(this.directory, 'controller.lock')) {
    if (!fs.existsSync(file)) return { recovered: false };
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (alive(owner.pid)) throw new Error('Controller is still running; poll it, do not clear its lock');
    // No mutation is re-run. Started records remain uncertain until reconciled.
    fs.renameSync(file, `${file}.${randomUUID()}.abandoned`);
    return { recovered: true, owner, warning: 'Photoshop may still be executing. Read state/preview, then reconcile; never replay.' };
  }
  begin(request) {
    const allowed = new Set([
      'id', 'tool', 'args', 'summary', 'purpose', 'replan', 'timeout_ms',
      'problem_id', 'region', 'hypothesis', 'failure_signals', 'significance_mode',
      'stage', 'scale', 'severity',
      'planner_directive_id', 'planner_task_id', 'painter_scope', 'change_domains',
      'preview_args',
    ]);
    for (const key of Object.keys(request)) if (!allowed.has(key)) throw new Error(`Unsupported request field: ${key}`);
    if (request.args !== undefined && (!request.args || typeof request.args !== 'object' || Array.isArray(request.args))) throw new Error('args must be an object');
    if (request.preview_args !== undefined && (!request.preview_args || typeof request.preview_args !== 'object' || Array.isArray(request.preview_args))) throw new Error('preview_args must be an object');
    if (request.preview_args?.document_id !== undefined) {
      if (request.preview_args.document_id !== request.args?.document_id) {
        throw new Error(`preview_args.document_id=${request.preview_args.document_id} does not match pinned request.args.document_id=${request.args?.document_id}`);
      }
      delete request.preview_args.document_id;
    }
    if (request.replan !== undefined && (typeof request.replan !== 'string' || request.replan.trim().length < 10)) throw new Error('replan must explain a concrete change');
    const significanceMode = significanceModeOf(request);
    if (!VISUAL_SIGNIFICANCE_MODES.includes(significanceMode)) throw new Error(`significance_mode must be one of ${VISUAL_SIGNIFICANCE_MODES.join(', ')}`);
    validId(request.id);
    if (!/^photoshop_[a-z0-9_]+$/.test(request.tool ?? '')) throw new Error('Expected a photoshop_* tool');
    for (const key of ['summary', 'purpose']) if (typeof request[key] !== 'string' || !request[key].trim()) throw new Error(`${key} is required`);
    const hash = fingerprint(request);
    const existing = this.read(request.id);
    if (existing) {
      if (existing.hash !== hash) throw new Error('Operation id already belongs to a different request');
      if (existing.phase !== 'completed') throw new Error('Operation outcome uncertain; inspect and reconcile, never replay');
      return { replay: true, record: existing };
    }
    const records = this.records();
    const unreported = records.find(r => !r.report || (r.operation_receipt && !r.operation_ack));
    if (unreported) {
      const suffix = unreported.report && unreported.operation_receipt && !unreported.operation_ack
        ? 'Guard operation acknowledgement is still required'
        : 'emit real assistant prose, then record it with report';
      throw new Error(`Report required for ${unreported.id}: ${suffix}`);
    }
    const uncertain = records.find(r => !r.resolved && r.phase !== 'completed');
    if (uncertain && !isRead(request.tool)) throw new Error(`Uncertain operation ${uncertain.id}: read current state/preview and reconcile first`);
    const documentId = request.args?.document_id;
    const documentState = this.paintingState().documents?.[String(documentId)];
    const rollbackMutation = isRollbackMutation(request);
    if (documentState?.pending_rollback && isVisual(request.tool) && !rollbackMutation) {
      throw new Error(
        `rollback_required: operation ${documentState.pending_rollback.operation_id} was classified for rollback; execute photoshop_undo or a VisualMicroPlan with action_class=ROLLBACK before another visual mutation`
      );
    }
    const problemId = problemIdentity(request);
    if (isVisual(request.tool) && !rollbackMutation && !problemId) {
      throw new Error('Visual mutations require a stable problem_id so progress is measured by resolved visual problems, not tool-call count');
    }
    if (!rollbackMutation) {
      this.plannerGate(documentId, request);
      this.priorityGate(documentId, request);
    }
    const visualBarrier = this.synchronizeVisualBarrier(documentId, records);
    if (isVisual(request.tool) && visualBarrier) {
      const detail = visualBarrier.sha256
        ? `preview ${visualBarrier.sha256} is awaiting verdict`
        : 'a visual mutation is awaiting a verified preview and verdict';
      throw new Error(`Visual barrier for document ${documentId} (${visualBarrier.planId}): ${detail}`);
    }
    const workflow = this.workflowMetrics(documentId, records);
    if (isVisual(request.tool) && !rollbackMutation && workflow.workflow_stall && !request.replan) {
      throw new Error(`workflow_stall: ${workflow.stall_reasons.join('; ')}. Supply a concrete replan before another visual mutation`);
    }
    const latestSameProblem = problemId
      ? records.filter(r => r.visual && problemIdentity(r) === problemId && r.verdict?.significance).at(-1)
      : undefined;
    if (isVisual(request.tool) && !rollbackMutation
      && latestSameProblem?.verdict?.significance?.execution_effect === 'insufficient'
      && !(latestSameProblem.verdict?.verdict === 'improvement' && latestSameProblem.verdict?.disposition === 'accept'
        && significanceHasDetectedChange(latestSameProblem.verdict?.significance))
      && !request.replan) {
      throw new Error(`visual_significance_gate: previous pass on "${problemId}" was insufficient; supply a concrete replan before another mutation`);
    }
    const sameProblemAttempts = problemId
      ? records.filter(r => r.visual && problemIdentity(r) === problemId).slice(-3)
      : [];
    if (isVisual(request.tool) && !rollbackMutation && sameProblemAttempts.length === 3 && sameProblemAttempts.every(r => r.verdict?.verdict !== 'improvement') && !request.replan) {
      throw new Error(`Three visual attempts on problem "${problemId}" without confirmed improvement: supply a concrete replan before another mutation`);
    }
    const checkpoint = this.checkpointState(documentId, records);
    if (isVisual(request.tool) && !rollbackMutation && checkpoint.due) {
      throw new Error('Checkpoint due: save a pinned layered PSD before another visual mutation');
    }
    const sequence = Math.max(0, ...records.map(r => r.sequence ?? 0)) + 1;
    let baselinePreview;
    if (isVisual(request.tool) && Number.isSafeInteger(documentId) && documentId > 0) {
      const state = this.paintingState().documents?.[String(documentId)];
      const frame = state?.current_frame ?? state?.accepted_frame;
      const baselineRecord = frame?.operation_id ? this.read(frame.operation_id) : undefined;
      baselinePreview = baselineRecord?.preview
        ?? (frame?.path ? { sha256: frame.sha256, materialized_path: frame.path } : undefined);
    }
    const record = {
      ...request,
      hash,
      sequence,
      created_at: new Date().toISOString(),
      phase: 'started',
      visual: isVisual(request.tool),
      significance_mode: significanceMode,
      guard_ack_required: true,
      ...(baselinePreview ? { baseline_preview: baselinePreview } : {}),
      pid: process.pid,
    };
    this.write(record); // Intent must reach disk BEFORE connecting or dispatching.
    return { replay: false, record };
  }
  markDispatched(record) {
    record.dispatched = true;
    this.write(record);
    const documentId = record.args?.document_id;
    if (record.visual && Number.isSafeInteger(documentId) && documentId > 0) {
      this.setVisualBarrier(documentId, {
        planId: this.visualPlanId(record),
        operationId: record.id,
        operationSequence: record.sequence,
        requiresExternalPreview: true,
      });
    }
    return record;
  }
  complete(record, result) {
    const bodies = parseTexts(result);
    const failed = result.isError === true || bodies.some(b => b.ok === false);
    const notExecuted = failed && bodies.some(b => b.execution === 'not-executed');
    const beforePreview = beforePreviewOf(result);
    const updated = { ...record, phase: failed && !isRead(record.tool) && !notExecuted ? 'uncertain' : 'completed',
      ...(notExecuted ? { visual: false, execution: 'not-executed' } : {}),
      ...(beforePreview ? { before_preview: beforePreview } : {}),
      completed_at: new Date().toISOString(), result, failed, preview: bindPreviewDocument(previewOf(result), record.args?.document_id) };
    updated.operation_receipt = record.operation_receipt ?? {
      protocol: OPERATION_RECEIPT_PROTOCOL,
      operation_id: record.id,
      token: randomUUID(),
      issued_at: updated.completed_at,
      phase: updated.phase,
      execution: updated.execution ?? (notExecuted ? 'not-executed' : failed ? 'uncertain' : 'completed'),
    };
    if (!failed && record.tool === 'photoshop_save_document' && (record.args?.format ?? 'PSD') === 'PSD') {
      const file = record.args?.path;
      if (typeof file === 'string' && fs.existsSync(file) && fs.statSync(file).size > 0) updated.checkpoint = file;
      else { updated.phase = 'uncertain'; updated.failed = true; updated.checkpoint_error = 'PSD file was not verified on disk'; }
    }
    this.write(updated);
    const documentId = record.args?.document_id;
    if (!failed && isRollbackMutation(record) && Number.isSafeInteger(documentId) && documentId > 0) {
      this.updatePaintingState(documentId, current => ({
        ...current,
        pending_rollback: undefined,
        last_rollback: {
          operation_id: record.id,
          completed_at: updated.completed_at,
        },
      }));
    }
    if (notExecuted && Number.isSafeInteger(documentId) && documentId > 0) {
      const barrier = this.visualBarrier(documentId);
      if (this.barrierOwnedByRecord(barrier, record)) this.clearVisualBarrier(documentId);
    }
    if (updated.preview && record.tool === 'photoshop_get_preview' && Number.isSafeInteger(documentId) && documentId > 0) {
      const barrier = this.visualBarrier(documentId);
      if (barrier?.requiresExternalPreview) {
        this.setVisualBarrier(documentId, {
          ...barrier,
          sha256: updated.preview.sha256,
          requiresExternalPreview: false,
        });
      }
    }
    if (updated.preview) {
      const context = visualContext(record);
      this.updatePaintingState(documentId, current => ({
        ...current,
        current_frame: {
          operation_id: record.id,
          sha256: updated.preview.sha256,
          path: updated.preview.materialized_path,
          at: updated.completed_at,
          accepted: false,
        },
        ...(context.stage ? { current_stage: context.stage } : {}),
        ...(context.scale ? { active_scale: context.scale } : {}),
        visual_problems: context.problem_id ? {
          ...(current.visual_problems ?? {}),
          [context.problem_id]: {
            ...(current.visual_problems?.[context.problem_id] ?? {}),
            ...context,
            severity: context.severity ?? current.visual_problems?.[context.problem_id]?.severity ?? 'should-fix',
            status: 'open',
          },
        } : current.visual_problems,
        active_problem: context.problem_id ? context : current.active_problem,
        last_operation_id: record.id,
      }));
    }
    return updated;
  }
  attachBeforePreview(id, result) {
    const record = this.read(id);
    if (!record) throw new Error('Unknown operation');
    const preview = bindPreviewDocument(previewOf(result), record.args?.document_id);
    if (!preview) throw new Error('A materialized before-preview is required');
    record.before_preview = preview;
    this.write(record);
    return preview;
  }
  attachPreview(id, result) {
    const record = this.read(id);
    if (!record) throw new Error('Unknown operation');
    const preview = bindPreviewDocument(previewOf(result), record.args?.document_id);
    if (!preview) throw new Error('A materialized preview is required');
    record.preview = preview;
    record.preview_attached_at = new Date().toISOString();
    this.write(record);
    const documentId = record.args?.document_id;
    if (Number.isSafeInteger(documentId) && documentId > 0) {
      const barrier = this.visualBarrier(documentId);
      if (this.barrierOwnedByRecord(barrier, record)) {
        this.setVisualBarrier(documentId, {
          ...barrier,
          sha256: preview.sha256,
          requiresExternalPreview: false,
        });
      }
      const context = visualContext(record);
      this.updatePaintingState(documentId, current => ({
        ...current,
        current_frame: {
          operation_id: record.id,
          sha256: preview.sha256,
          path: preview.materialized_path,
          at: record.preview_attached_at,
          accepted: false,
        },
        active_problem: context.problem_id ? context : current.active_problem,
        last_operation_id: record.id,
      }));
    }
    return preview;
  }
  visualSignificance(id) {
    const record = this.read(id);
    if (!record?.visual || !record.preview) return undefined;
    return assessVisualSignificance({
      before: record.before_preview ?? record.baseline_preview,
      after: record.preview,
      mode: significanceModeOf(record),
    });
  }
  closePreviousCycle(input = {}, options = {}) {
    const id = textOrUndefined(input.previous_operation_id);
    if (!id) return { closed: false };
    const record = this.read(id);
    if (!record) throw new Error(`Unknown previous_operation_id: ${id}`);

    if (!record.report) {
      if (!input.previous_report || typeof input.previous_report !== 'object' || Array.isArray(input.previous_report)) {
        throw new Error(`previous_report is required to close ${id}`);
      }
      this.report({ id, ...input.previous_report });
    }

    const refreshedAfterReport = this.read(id);
    if (refreshedAfterReport?.operation_receipt && !refreshedAfterReport?.operation_ack) {
      if (!input.previous_operation_ack || typeof input.previous_operation_ack !== 'object' || Array.isArray(input.previous_operation_ack)) {
        throw new Error(`previous_operation_ack is required to close ${id}; echo the exact Guard receipt token from the prior controller result`);
      }
      this.ackOperation({ id, ...input.previous_operation_ack });
    }

    const afterGuardAck = this.read(id);
    if (input.previous_report_ack && options.hostAckVerified === true && !afterGuardAck?.report?.host_ack) {
      this.ackReport({ id, ...input.previous_report_ack }, { hostVerified: true });
    }

    const refreshed = this.read(id);
    if (refreshed.visual && !refreshed.verdict) {
      if (!input.previous_visual_verdict || typeof input.previous_visual_verdict !== 'object' || Array.isArray(input.previous_visual_verdict)) {
        throw new Error(`previous_visual_verdict is required to close visual operation ${id}`);
      }
      if (!refreshed.preview) throw new Error(`Visual operation ${id} has no attached preview to classify`);
      this.verdict({
        id,
        preview_id: id,
        sha256: refreshed.preview.sha256,
        ...input.previous_visual_verdict,
      });
    }

    const closed = this.read(id);
    return {
      closed: true,
      operation_id: id,
      operation_ack: closed?.operation_ack,
      report_delivery: closed?.report?.delivery,
      host_delivery_evidence: closed?.report?.host_ack ?? null,
      verdict_recorded: !!closed?.verdict,
    };
  }
  fail(record, error) {
    const updated = { ...record, phase: record.dispatched ? 'uncertain' : 'completed', visual: record.dispatched ? record.visual : false,
      execution: record.dispatched ? 'uncertain' : 'not-executed', error: String(error?.message ?? error), failed: true };
    updated.operation_receipt = record.operation_receipt ?? {
      protocol: OPERATION_RECEIPT_PROTOCOL,
      operation_id: record.id,
      token: randomUUID(),
      issued_at: new Date().toISOString(),
      phase: updated.phase,
      execution: updated.execution,
    };
    this.write(updated);
    return updated;
  }
  report(input) {
    const record = this.read(input.id);
    if (!record) throw new Error('Unknown operation');
    for (const key of ['did', 'why', 'result']) {
      if (typeof input[key] !== 'string' || input[key].trim().length < 4 || /^(tool called|called|done|ok)[.! ]*$/i.test(input[key].trim())) throw new Error(`Concrete report.${key} is required; a tool card is not a report`);
    }
    record.report = {
      ...input,
      recorded_at: new Date().toISOString(),
      delivery: 'recorded_host_verification_optional',
    };
    this.write(record);
    return { report: `Что сделал: ${input.did}\nЗачем: ${input.why}\nРезультат: ${input.result}`, delivery: record.report.delivery };
  }
  ackReport(input, options = {}) {
    const record = this.read(input.id);
    if (!record?.report) throw new Error('Report must be recorded before host acknowledgement');
    if (options.hostVerified !== true) throw new Error('Host report evidence must be verified by the host receipt boundary');
    if (input.source !== 'chat_on_steroids') throw new Error('Host acknowledgement source must be chat_on_steroids');
    if (typeof input.message_id !== 'string' || input.message_id.trim().length < 4) throw new Error('Host message_id is required');
    if (typeof input.delivered_at !== 'string' || !Number.isFinite(Date.parse(input.delivered_at))) throw new Error('Valid host delivered_at is required');
    record.report.host_ack = {
      source: input.source,
      message_id: input.message_id.trim(),
      delivered_at: new Date(input.delivered_at).toISOString(),
      ...(typeof input.turn_id === 'string' && input.turn_id.trim() ? { turn_id: input.turn_id.trim() } : {}),
      ...(typeof input.text_sha256 === 'string' && /^[0-9a-f]{64}$/i.test(input.text_sha256)
        ? { text_sha256: input.text_sha256.toLowerCase() }
        : {}),
      recorded_at: new Date().toISOString(),
    };
    record.report.delivery = 'host_verified';
    this.write(record);
    return { id: record.id, delivery: record.report.delivery, host_ack: record.report.host_ack };
  }
  ackOperation(input) {
    const record = this.read(input.id);
    if (!record) throw new Error('Unknown operation');
    const receipt = record.operation_receipt;
    if (!receipt) throw new Error('Operation has no Guard receipt to acknowledge');
    if (input.protocol !== undefined && input.protocol !== OPERATION_ACK_PROTOCOL) {
      throw new Error(`operation acknowledgement protocol must be ${OPERATION_ACK_PROTOCOL}`);
    }
    if (typeof input.token !== 'string' || input.token !== receipt.token) {
      throw new Error('Operation acknowledgement token does not match the exact Guard receipt');
    }
    record.operation_ack = {
      protocol: OPERATION_ACK_PROTOCOL,
      receipt_protocol: receipt.protocol,
      receipt_token: receipt.token,
      acknowledged_at: new Date().toISOString(),
    };
    this.write(record);
    return { id: record.id, operation_ack: record.operation_ack };
  }
  verdict(input) {
    const record = this.read(input.id);
    const previewRecord = this.read(input.preview_id);
    if (!record?.visual || !previewRecord?.preview || previewRecord.failed) throw new Error('A successful materialized preview and a visual operation are required');
    if (previewRecord.created_at < record.created_at || previewRecord.args?.document_id !== record.args?.document_id) throw new Error('Preview must follow the mutation and target the same pinned document');
    if (previewRecord.preview.document_id !== record.args?.document_id) throw new Error('Attached preview provenance does not match the visual operation pinned document');
    if (record.id !== previewRecord.id && record.sequence && previewRecord.sequence <= record.sequence) throw new Error('Preview must follow the mutation');
    const preview = previewRecord.preview;
    if (input.sha256 !== preview.sha256 || fingerprintFile(preview.materialized_path) !== input.sha256) throw new Error('Preview SHA mismatch');
    if (!['improvement', 'neutral', 'regression'].includes(input.verdict)) throw new Error('Visual verdict required');
    if (!['accept', 'correct', 'rollback'].includes(input.disposition)) throw new Error('Visual disposition accept|correct|rollback required');
    if (typeof input.observed_change !== 'string' || input.observed_change.trim().length < 10) throw new Error('Concrete observed_change required');
    if (!['yes', 'no', 'uncertain'].includes(input.target_resolved)) throw new Error('target_resolved must be yes|no|uncertain');
    if (!Array.isArray(input.regressions) || input.regressions.some(x => typeof x !== 'string' || !x.trim())) throw new Error('regressions must be an array of non-empty strings');
    if (typeof input.uncertainty !== 'string' || input.uncertainty.trim().length < 3) throw new Error('Concrete uncertainty required');
    if (!GLOBAL_READABILITY.has(input.global_readability)) throw new Error('global_readability must be improved|stable|degraded');
    if (!PRIMITIVE_FOOTPRINT.has(input.primitive_footprint)) throw new Error('primitive_footprint must be none|acceptable|suspect');
    if (!Array.isArray(input.trend_signals) || input.trend_signals.some(x => !normalizeTrendSignal(x))) {
      throw new Error('trend_signals must be an array of non-empty stable signal strings');
    }
    let plannerTaskAssessment;
    if (input.planner_task_assessment !== undefined) {
      const raw = input.planner_task_assessment;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('planner_task_assessment must be an object');
      const status = textOrUndefined(raw.status)?.toLowerCase();
      if (!['continue', 'completed', 'blocked'].includes(status)) throw new Error('planner_task_assessment.status must be continue|completed|blocked');
      if (raw.evidence_scope !== 'task') throw new Error('planner_task_assessment.evidence_scope must be task');
      const evidence = Array.isArray(raw.evidence)
        ? raw.evidence.map((value, index) => {
            const parsed = textOrUndefined(value);
            if (!parsed) throw new Error(`planner_task_assessment.evidence[${index}] must be non-empty`);
            return parsed;
          })
        : [];
      if ((status === 'completed' || status === 'blocked') && evidence.length === 0) {
        throw new Error(`planner_task_assessment.status=${status} requires task-level evidence`);
      }
      plannerTaskAssessment = { status, evidence_scope: 'task', evidence };
    }
    if (input.planner_interrupt_reason !== undefined) {
      const reason = textOrUndefined(input.planner_interrupt_reason)?.toLowerCase();
      if (!ART_DIRECTOR_INTERRUPT_REASONS.has(reason)) {
        throw new Error(`planner_interrupt_reason must be one of ${[...ART_DIRECTOR_INTERRUPT_REASONS].join(', ')}`);
      }
      if (input.planner_interrupt_detail !== undefined && (!textOrUndefined(input.planner_interrupt_detail) || input.planner_interrupt_detail.trim().length < 10)) {
        throw new Error('planner_interrupt_detail must be concrete when supplied');
      }
    }
    const isVisualMicroPlan = record.tool === 'photoshop_execute_visual_microplan';
    if (!isVisualMicroPlan && input.edge_observations !== undefined) {
      throw new Error('edge_observations are allowed only for photoshop_execute_visual_microplan operations with declared edge intents');
    }
    const edgeIntents = isVisualMicroPlan ? parseEdgeIntents(record.args?.edges) : [];
    if (isVisualMicroPlan && input.edge_observations !== undefined && edgeIntents.length === 0) {
      throw new Error('edge_observations require declared edge intents on the VisualMicroPlan');
    }
    const edgeObservations = edgeIntents.length
      ? validateEdgeObservations(edgeIntents, input.edge_observations)
      : [];
    const context = visualContext(record);
    const recognition = normalizeRecognitionVerdict(
      input.recognition,
      isRecognitionBlockInStage(context.stage)
    );
    if (input.verdict === 'regression' && input.disposition === 'accept') throw new Error('A regression cannot be accepted');
    const significance = assessVisualSignificance({
      before: record.before_preview ?? record.baseline_preview,
      after: preview,
      mode: significanceModeOf(record),
    });
    const executionChanged = significanceHasDetectedChange(significance);
    if (input.verdict === 'improvement' && input.disposition === 'accept' && !executionChanged) {
      throw new Error(`visual_execution_gate: improvement cannot be accepted because no comparable decoded pixel change was detected. execution_effect=${significance.execution_effect}. ${significance.reason}`);
    }
    if (input.target_resolved === 'yes' && !executionChanged) {
      throw new Error(`visual_execution_gate: target_resolved=yes requires evidence that the operation changed the rendered image; got execution_effect=${significance.execution_effect}`);
    }
    record.verdict = {
      ...input,
      ...(edgeObservations.length ? { edge_observations: edgeObservations.map(row => ({
        boundary_id: row.boundaryId,
        observed_behavior: row.observedBehavior,
        target_met: row.targetMet,
      })) } : {}),
      ...(recognition ? { recognition } : {}),
      trend_signals: [...new Set(input.trend_signals.map(normalizeTrendSignal))],
      significance,
      ...(plannerTaskAssessment ? { planner_task_assessment: plannerTaskAssessment } : {}),
      artistic_value: {
        accepted_improvement: input.verdict === 'improvement' && input.disposition === 'accept',
        execution_changed: executionChanged,
        note: 'Pixel delta is execution evidence only; artistic value comes from the visual verdict.',
      },
      at: new Date().toISOString(),
    };
    this.write(record);
    const documentId = record.args?.document_id;
    if (Number.isSafeInteger(documentId) && documentId > 0) {
      // This is the canonical release point for controller-driven workflows.
      // The operation journal keeps history; the shared per-document barrier is
      // the one durable gate consulted by both controller and VisualMicroPlan.
      const barrier = this.visualBarrier(documentId);
      if (this.barrierOwnedByRecord(barrier, record)) this.clearVisualBarrier(documentId);
    }
    const workflowMetrics = this.workflowMetrics(documentId);
    const recognitionMetrics = this.recognitionMetrics(documentId);
    const trendState = this.cumulativeTrendState(documentId);
    this.updatePaintingState(documentId, current => {
      const classifiedFrame = {
        operation_id: previewRecord.id,
        sha256: preview.sha256,
        path: preview.materialized_path,
        at: new Date().toISOString(),
        accepted: input.disposition === 'accept',
      };
      const problems = { ...(current.visual_problems ?? {}) };
      if (context.problem_id) {
        problems[context.problem_id] = {
          ...(problems[context.problem_id] ?? {}),
          ...context,
          severity: context.severity ?? problems[context.problem_id]?.severity ?? 'should-fix',
          status: input.target_resolved === 'yes' && input.verdict === 'improvement' && input.disposition === 'accept'
            ? 'resolved' : 'open',
        };
      }
      const nextMustFix = this.largestOpenMustFix(problems);
      const next = {
        ...current,
        ...(input.disposition === 'rollback' ? {
          pending_rollback: {
            operation_id: record.id,
            preview_sha256: preview.sha256,
            reason: input.observed_change,
            requested_at: record.verdict.at,
          },
        } : {}),
        current_frame: classifiedFrame,
        ...(input.disposition === 'accept' ? { accepted_frame: classifiedFrame } : {}),
        ...(context.stage ? { current_stage: context.stage } : {}),
        ...(context.scale ? { active_scale: context.scale } : {}),
        visual_problems: problems,
        active_problem: nextMustFix ?? (context.problem_id && problems[context.problem_id]?.status === 'open' ? problems[context.problem_id] : undefined),
        priority_review_required: !!nextMustFix && !!context.scale && SCALE_RANK[normalizeScale(context.scale)] > SCALE_RANK[normalizeScale(nextMustFix.scale)],
        last_critique: {
          operation_id: record.id,
          observed_change: input.observed_change,
          target_resolved: input.target_resolved,
          regressions: input.regressions,
          uncertainty: input.uncertainty,
          verdict: input.verdict,
          disposition: input.disposition,
          global_readability: input.global_readability,
          primitive_footprint: input.primitive_footprint,
          trend_signals: record.verdict.trend_signals,
          ...(recognition ? { recognition } : {}),
          significance,
        },
        cumulative_trend_guard: trendState,
        workflow_metrics: workflowMetrics,
        recognition_metrics: recognitionMetrics,
        last_operation_id: record.id,
      };
      const withPlanner = this.advanceArtDirectorAfterVerdict(next, context, input, record);
      return this.promoteCumulativeTrendProblem(documentId, withPlanner, trendState);
    });
    return { verdict: record.verdict, warning: 'Hash proves frame identity, not that a person/model actually viewed it.' };
  }
  reconcile(input) {
    const record = this.read(input.id);
    if (!record || record.phase === 'completed') throw new Error('Expected an interrupted or uncertain operation');
    if (typeof input.reason !== 'string' || input.reason.trim().length < 10) throw new Error('Explicit recovery outcome and evidence-based reason required');

    const closedDocumentRecovery = input.documents_id !== undefined || input.document_closed_confirmed !== undefined || input.outcome === 'abandoned';
    if (closedDocumentRecovery) {
      if (input.state_id !== undefined || input.preview_id !== undefined) throw new Error('Use either same-document state/preview evidence or closed-document evidence, not both');
      if (input.outcome !== 'abandoned') throw new Error('Closed-document recovery requires outcome=abandoned');
      if (input.document_closed_confirmed !== true) throw new Error('Closed-document recovery requires document_closed_confirmed=true from an explicit user confirmation');
      if (typeof input.documents_id !== 'string' || !input.documents_id) throw new Error('Closed-document recovery requires a fresh photoshop_list_documents evidence record');

      const targetDocumentId = record.args?.document_id;
      if (!Number.isSafeInteger(targetDocumentId) || targetDocumentId <= 0) throw new Error('Closed-document recovery requires the interrupted operation to have a pinned document_id');
      const documentsRecord = this.read(input.documents_id);
      if (!documentsRecord || documentsRecord.phase !== 'completed' || documentsRecord.failed || documentsRecord.created_at < record.created_at) {
        throw new Error('Fresh successful photoshop_list_documents evidence required');
      }
      if (record.sequence && documentsRecord.sequence <= record.sequence) throw new Error('Recovery evidence must follow the interrupted operation');
      if (documentsRecord.tool !== 'photoshop_list_documents') throw new Error('Closed-document recovery requires photoshop_list_documents evidence');
      const documentsBody = parseTexts(documentsRecord.result).find(body =>
        Array.isArray(body?.documents) || Array.isArray(body?.details?.documents)
      );
      if (!documentsBody) throw new Error('photoshop_list_documents evidence did not contain a documents array');
      const documents = Array.isArray(documentsBody.documents)
        ? documentsBody.documents
        : documentsBody.details.documents;
      const targetStillOpen = documents.some(document => {
        const id = document && typeof document === 'object' ? (document.id ?? document.document_id) : undefined;
        return Number(id) === targetDocumentId;
      });
      if (targetStillOpen) throw new Error(`Document ${targetDocumentId} is still open; use same-document state/preview reconciliation`);

      record.resolved = {
        ...input,
        evidence_mode: 'document_absent',
        target_document_id: targetDocumentId,
        at: new Date().toISOString(),
      };
      this.write(record);
      this.clearVisualBarrier(targetDocumentId);
      return {
        resolved: record.resolved,
        warning: 'Original operation remains non-replayable. Document absence closes the abandoned workflow but does not prove whether the interrupted action executed before the document was closed.',
      };
    }

    if (!['completed', 'not-executed', 'partial'].includes(input.outcome)) throw new Error('Explicit recovery outcome and evidence-based reason required');
    if (typeof input.state_id !== 'string' || typeof input.preview_id !== 'string') throw new Error('Fresh successful state and preview records required');
    const evidence = [this.read(input.state_id), this.read(input.preview_id)];
    if (evidence.some(r => !r || r.phase !== 'completed' || r.failed || r.created_at < record.created_at)) throw new Error('Fresh successful state and preview records required');
    if (record.sequence && evidence.some(r => r.sequence <= record.sequence)) throw new Error('Recovery evidence must follow the interrupted operation');
    if (evidence[0].tool !== 'photoshop_get_state' || !evidence[1].preview) throw new Error('Expected get_state and a materialized preview');
    if (record.args?.document_id && evidence.some(r => r.args?.document_id !== record.args.document_id)) throw new Error('Recovery evidence must target the same document');
    if (input.outcome === 'not-executed' && !this.hasDurableNotExecutedProof(record)) {
      throw new Error(
        'outcome=not-executed requires durable pre-dispatch evidence from the original operation; fresh state/preview alone cannot prove that no mutation executed'
      );
    }
    record.resolved = { ...input, at: new Date().toISOString() };
    if (input.outcome === 'not-executed') {
      record.visual = false;
      record.execution = 'not-executed';
      const documentId = record.args?.document_id;
      if (Number.isSafeInteger(documentId) && documentId > 0) {
        const barrier = this.visualBarrier(documentId);
        if (this.barrierOwnedByRecord(barrier, record)) this.clearVisualBarrier(documentId);
      }
    }
    this.write(record);
    return {
      resolved: record.resolved,
      warning: input.outcome === 'not-executed'
        ? 'Original operation remains non-replayable. Durable original-operation evidence proves no visual mutation executed; the matching owned barrier is released and no visual verdict is required.'
        : 'Original operation remains non-replayable. Inspect/classify before new work.',
    };
  }
  status() {
    const all = this.records();
    const state = this.paintingState();
    const documentIds = [...new Set([
      ...all.map(r => r.args?.document_id).filter(id => Number.isSafeInteger(id) && id > 0),
      ...Object.keys(state.documents ?? {}).map(Number).filter(id => Number.isSafeInteger(id) && id > 0),
    ])];
    const visualBarriers = Object.fromEntries(documentIds.map(id => [String(id), this.synchronizeVisualBarrier(id, all) ?? null]));
    const workflowMetrics = Object.fromEntries(documentIds.map(id => [String(id), this.workflowMetrics(id, all)]));
    const recognitionMetrics = Object.fromEntries(documentIds.map(id => [String(id), this.recognitionMetrics(id, all)]));
    const visualCadence = Object.fromEntries(documentIds.map(id => [String(id), this.visualCadenceState(id, all)]));
    const continuationWatch = Object.fromEntries(documentIds.map(id => [String(id), this.continuationWatchState(id, all)]));
    const continuation = this.statusCompact();
    return {
      route: ROUTE, mode: 'photoshop-mcp', directory: this.directory,
      lock: fs.existsSync(path.join(this.directory, 'controller.lock')) ? JSON.parse(fs.readFileSync(path.join(this.directory, 'controller.lock'), 'utf8')) : null,
      pending_reports: all.filter(r => !r.report).map(r => r.id),
      pending_operation_acks: all.filter(r => r.operation_receipt && !r.operation_ack).map(r => r.id),
      pending_report_delivery_acks: [],
      operation_ack_gate: 'guard_receipt_required',
      report_delivery_gate: 'host_render_receipt_optional',
      uncertain: all.filter(r => r.phase !== 'completed' && !r.resolved).map(r => r.id),
      pending_visual_verdicts: all.filter(r => r.visual && !r.verdict).map(r => r.id),
      visual_barriers: visualBarriers,
      last_checkpoint: all.filter(r => r.checkpoint).at(-1)?.checkpoint ?? null,
      progress_primary_metric: 'resolved_visual_problems',
      workflow_metrics: workflowMetrics,
      recognition_metrics: recognitionMetrics,
      visual_cadence: visualCadence,
      continuation_watch: continuationWatch,
      document_next_required_actions: Object.fromEntries(Object.entries(continuation.documents).map(([id, doc]) => [id, doc.next_required_action])),
      next_required_action: continuation.next_required_action,
      painting_state_path: this.paintingStateFile(),
      painting_state: this.paintingState(),
      recent: all.slice(-8).map(r => ({ id: r.id, tool: r.tool, phase: r.phase, failed: r.failed, execution: r.execution, error: r.error,
        result_excerpt: JSON.stringify(parseTexts(r.result)).slice(0, 1000),
        summary: r.summary, report: r.report, preview: r.preview, verdict: r.verdict, file: this.file(r.id) })),
    };
  }
  statusCompact() {
    const all = this.records();
    const state = this.paintingState();
    const documentIds = [...new Set([
      ...all.map(r => r.args?.document_id).filter(id => Number.isSafeInteger(id) && id > 0),
      ...Object.keys(state.documents ?? {}).map(Number).filter(id => Number.isSafeInteger(id) && id > 0),
    ])];
    const pendingReports = all.filter(r => !r.report).map(r => r.id);
    const pendingAcks = all.filter(r => r.operation_receipt && !r.operation_ack).map(r => r.id);
    const pendingOperationAckDetails = all
      .filter(r => r.operation_receipt && !r.operation_ack)
      .map(r => ({
        operation_id: r.id,
        protocol: OPERATION_ACK_PROTOCOL,
        receipt_protocol: r.operation_receipt.protocol,
        receipt_token: r.operation_receipt.token,
        issued_at: r.operation_receipt.issued_at,
      }));
    const uncertain = all.filter(r => r.phase !== 'completed' && !r.resolved).map(r => r.id);
    const pendingVerdicts = all.filter(r => r.visual && !r.verdict).map(r => r.id);
    const pendingVisualVerdictDetails = all
      .filter(r => r.visual && !r.verdict && r.preview)
      .map(r => ({
        operation_id: r.id,
        preview_id: r.id,
        sha256: r.preview.sha256,
        materialized_path: r.preview.materialized_path,
      }));
    const activeJobs = this.activeJobs();
    const documents = Object.fromEntries(documentIds.map(id => {
      const doc = state.documents?.[String(id)] ?? { document_id: id };
      const barrier = this.synchronizeVisualBarrier(id, all) ?? null;
      const metrics = this.workflowMetrics(id, all);
      const recognition = this.recognitionMetrics(id, all);
      const cadence = this.visualCadenceState(id, all);
      const continuationWatch = this.continuationWatchState(id, all);
      return [String(id), {
        document_id: id,
        current_frame: doc.current_frame ? {
          operation_id: doc.current_frame.operation_id,
          sha256: doc.current_frame.sha256,
          path: doc.current_frame.path,
          accepted: !!doc.current_frame.accepted,
        } : null,
        accepted_frame: doc.accepted_frame ? {
          operation_id: doc.accepted_frame.operation_id,
          sha256: doc.accepted_frame.sha256,
          path: doc.accepted_frame.path,
        } : null,
        active_problem: doc.active_problem?.problem_id ?? null,
        current_stage: doc.current_stage ?? null,
        active_scale: doc.active_scale ?? null,
        art_director: doc.art_director ? {
          directive_id: doc.art_director.directive_id,
          revision: doc.art_director.revision,
          status: doc.art_director.status,
          goal: doc.art_director.goal,
          priorities: doc.art_director.priorities ?? [],
          current_task_id: doc.art_director.current_task_id ?? null,
          review_after_microplans: doc.art_director.review_after_microplans,
          completed_microplans: doc.art_director.completed_microplans ?? 0,
          review_due: !!doc.art_director.review_due,
          review_reason: doc.art_director.review_reason ?? null,
          interrupt: doc.art_director.interrupt ?? null,
          value_check: doc.art_director.value_check ?? null,
          tasks: (doc.art_director.tasks ?? []).map(task => ({
            task_id: task.task_id,
            summary: task.summary,
            status: task.status,
            region: task.region ?? null,
            allowed_scales: task.allowed_scales ?? [],
            allowed_global_changes: task.allowed_global_changes ?? [],
          })),
        } : null,
        largest_open_must_fix: this.largestOpenMustFix(doc.visual_problems) ?? null,
        priority_review_required: !!doc.priority_review_required,
        last_critique: doc.last_critique ? {
          verdict: doc.last_critique.verdict,
          disposition: doc.last_critique.disposition,
          target_resolved: doc.last_critique.target_resolved,
          execution_effect: doc.last_critique.significance?.execution_effect,
        } : null,
        visual_barrier: barrier,
        workflow_stall: metrics.workflow_stall,
        decision_loop_stall: cadence.decision_loop_stall,
        silent_stall: continuationWatch.silent_stall,
        silent_stall_reason: continuationWatch.silent_stall_reason,
        seconds_since_last_advancement: continuationWatch.seconds_since_last_advancement,
        seconds_since_last_visual_operation: metrics.seconds_since_last_visual_operation,
        seconds_since_last_meaningful_visual_change: metrics.seconds_since_last_meaningful_visual_change,
        recognition_metrics: recognition,
        visual_cadence: cadence,
        continuation_watch: continuationWatch,
        resolved_visual_problems: metrics.resolved_visual_problems,
        next_required_action: this.documentNextRequiredAction(id, all),
      }];
    }));
    const documentAction = Object.values(documents).map(doc => doc.next_required_action).find(action => action !== 'ready');
    const silentStalls = Object.values(documents)
      .filter(doc => doc.silent_stall)
      .map(doc => ({
        document_id: doc.document_id,
        reason: doc.silent_stall_reason,
        seconds_since_last_advancement: doc.seconds_since_last_advancement,
        next_required_action: doc.next_required_action,
      }));
    return {
      route: ROUTE,
      mode: 'photoshop-mcp',
      lock: fs.existsSync(path.join(this.directory, 'controller.lock')) ? JSON.parse(fs.readFileSync(path.join(this.directory, 'controller.lock'), 'utf8')) : null,
      pending_reports: pendingReports,
      pending_operation_acks: pendingAcks,
      pending_operation_ack_details: pendingOperationAckDetails,
      pending_report_delivery_acks: [],
      operation_ack_gate: 'guard_receipt_required',
      report_delivery_gate: 'host_render_receipt_optional',
      uncertain,
      pending_visual_verdicts: pendingVerdicts,
      pending_visual_verdict_details: pendingVisualVerdictDetails,
      active_jobs: activeJobs,
      last_checkpoint: all.filter(r => r.checkpoint).at(-1)?.checkpoint ?? null,
      silent_stalls: silentStalls,
      documents,
      next_required_action: activeJobs.length ? activeJobs.at(-1).poll_command
        : pendingReports.length ? `emit/record report for ${pendingReports[0]}`
        : pendingAcks.length ? `acknowledge Guard operation receipt for ${pendingAcks[0]}`
          : uncertain.length ? `reconcile uncertain operation ${uncertain[0]}`
            : pendingVerdicts.length ? `inspect/classify visual operation ${pendingVerdicts[0]}`
              : documentAction ?? 'ready',
    };
  }
  activeJobs(documentId) {
    const root = jobsDirectory(this.directory);
    if (!fs.existsSync(root)) return [];
    const jobs = [];
    for (const name of fs.readdirSync(root)) {
      if (!name.startsWith('job-')) continue;
      try {
        const job = readJob(this.directory, name);
        if (!['starting', 'running', 'stalled', 'uncertain'].includes(job.state)) continue;
        const input = JSON.parse(fs.readFileSync(job.files.input, 'utf8'));
        const operation = input?.next_operation;
        if (Number.isSafeInteger(documentId) && documentId > 0 && operation?.args?.document_id !== documentId) continue;
        jobs.push({
          job_id: name,
          state: job.state,
          pid: job.pid ?? null,
          operation_id: operation?.id ?? null,
          document_id: operation?.args?.document_id ?? null,
          summary: operation?.summary ?? null,
          purpose: operation?.purpose ?? null,
          stall_reason: job.stall_reason ?? null,
          heartbeat_age_ms: job.heartbeat_age_ms ?? null,
          deadline_at: job.deadline_at ?? null,
          narrative: operationNarrative(
            operation,
            job.state === 'uncertain' || job.state === 'stalled'
              ? 'uncertain'
              : job.state === 'starting' ? 'starting' : 'running'
          ),
          poll_command: `node scripts/photoshop-session.mjs job-poll ${name}`,
        });
      } catch {
        // A corrupt/partial job must not make resume itself unavailable. The
        // operation journal remains the authoritative recovery record.
      }
    }
    return jobs.sort((a, b) => String(a.job_id).localeCompare(String(b.job_id)));
  }
  resume(documentId) {
    const compact = this.statusCompact();
    const ids = Object.keys(compact.documents).map(Number);
    const selectedId = Number.isSafeInteger(documentId) && documentId > 0
      ? documentId
      : ids.find(id => compact.documents[String(id)]?.current_frame) ?? ids[0];
    const document = selectedId ? compact.documents[String(selectedId)] : undefined;
    if (selectedId && !document) throw new Error(`Unknown document_id ${selectedId}`);
    const all = this.records();
    const latest = selectedId
      ? [...all].reverse().find(r => r.args?.document_id === selectedId)
      : all.at(-1);
    const activeJobs = this.activeJobs(selectedId);
    const activeJob = activeJobs.at(-1) ?? null;
    const pendingOperationAck = [...all].reverse().find(r =>
      r.operation_receipt && !r.operation_ack && (!selectedId || r.args?.document_id === selectedId)
    );
    const pendingVisualVerdict = [...all].reverse().find(r =>
      r.visual && !r.verdict && r.preview && (!selectedId || r.args?.document_id === selectedId)
    );
    const latestNarrativeState = activeJob
      ? activeJob.state
      : latest?.phase !== 'completed' ? 'uncertain'
        : 'completed';
    const nextRequiredAction = compact.next_required_action !== 'ready'
      ? compact.next_required_action
      : document?.next_required_action ?? 'ready';
    const baseResumeSummary = activeJob?.narrative ?? (latest ? operationNarrative(latest, latestNarrativeState) : {
        progress_id: 'photoshop-resume:idle',
        operation_id: null,
        state: 'idle',
        now: 'рабочая сессия восстановлена',
        why: 'продолжить с последнего подтверждённого состояния без повторного выполнения действий',
        photoshop: 'активной операции нет',
        next: nextRequiredAction,
      });
    const resumeSummary = {
      ...baseResumeSummary,
      next: nextRequiredAction,
      text: [
        `Сейчас: ${baseResumeSummary.now}`,
        `Почему: ${baseResumeSummary.why}`,
        `Photoshop: ${baseResumeSummary.photoshop}`,
        `Следом: ${nextRequiredAction}`,
      ].join('\n'),
    };
    return {
      route: ROUTE,
      mode: 'photoshop-mcp-resume',
      document_id: selectedId ?? null,
      document: document ?? null,
      last_checkpoint: compact.last_checkpoint,
      pending_reports: compact.pending_reports,
      pending_operation_acks: compact.pending_operation_acks,
      pending_operation_ack: pendingOperationAck ? {
        operation_id: pendingOperationAck.id,
        protocol: OPERATION_ACK_PROTOCOL,
        receipt_protocol: pendingOperationAck.operation_receipt.protocol,
        receipt_token: pendingOperationAck.operation_receipt.token,
        issued_at: pendingOperationAck.operation_receipt.issued_at,
      } : null,
      pending_report_delivery_acks: compact.pending_report_delivery_acks,
      uncertain: compact.uncertain,
      pending_visual_verdicts: compact.pending_visual_verdicts,
      pending_visual_verdict: pendingVisualVerdict ? {
        operation_id: pendingVisualVerdict.id,
        preview_id: pendingVisualVerdict.id,
        sha256: pendingVisualVerdict.preview.sha256,
        materialized_path: pendingVisualVerdict.preview.materialized_path,
      } : null,
      active_job: activeJob,
      continuation_watch: document?.continuation_watch ?? null,
      resume_summary: resumeSummary,
      last_operation: latest ? {
        id: latest.id,
        tool: latest.tool,
        phase: latest.phase,
        failed: !!latest.failed,
        summary: latest.summary,
        execution: latest.execution,
      } : null,
      next_required_action: nextRequiredAction,
      canonical_next_command: activeJob
        ? activeJob.poll_command
        : 'node scripts/photoshop-session.mjs cycle-auto -',
    };
  }
}
function fingerprintFile(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }\n