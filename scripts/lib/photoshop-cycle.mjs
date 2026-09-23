import { isVisual, parseTexts } from './photoshop-session-store.mjs';
import { hostProgressPayload, operationNarrative, progressPayload } from './operation-narrative.mjs';
import { guardCapabilities } from './guard-capabilities.mjs';

function compactResult(result, limit = 1800) {
  return JSON.stringify(parseTexts(result)).slice(0, limit);
}

function resultSummary(result, limit = 700) {
  const bodies = parseTexts(result);
  const summaries = bodies
    .map(body => typeof body?.summary === 'string' ? body.summary.trim() : '')
    .filter(Boolean);
  if (summaries.length) return summaries.join(' | ').slice(0, limit);
  return JSON.stringify(bodies).slice(0, limit);
}

function confirmedTargets(record) {
  const layerIds = new Set();
  const logicalLayers = [];
  let documentId = Number.isSafeInteger(record?.args?.document_id) ? record.args.document_id : undefined;
  for (const body of parseTexts(record?.result)) {
    if (!documentId && Number.isSafeInteger(body?.document_target?.id)) {
      documentId = body.document_target.id;
    }
    const details = body?.details;
    for (const candidate of [details?.layerId, details?.layer_id, body?.layerId, body?.layer_id]) {
      if (Number.isSafeInteger(candidate) && candidate > 0) layerIds.add(candidate);
    }
    if (Array.isArray(details?.painted_regions)) {
      for (const region of details.painted_regions) {
        if (Number.isSafeInteger(region?.layer_id) && region.layer_id > 0) layerIds.add(region.layer_id);
      }
    }
    if (Array.isArray(body?.continuation_layers)) {
      for (const layer of body.continuation_layers) {
        if (Number.isSafeInteger(layer?.layer_id) && layer.layer_id > 0) {
          layerIds.add(layer.layer_id);
          if (typeof layer?.hypothesis_id === 'string' && layer.hypothesis_id) {
            logicalLayers.push({
              layer_id: layer.layer_id,
              ...(typeof layer.layer_name === 'string' && layer.layer_name ? { layer_name: layer.layer_name } : {}),
              hypothesis_id: layer.hypothesis_id,
              ...(typeof layer.hypothesis === 'string' && layer.hypothesis ? { hypothesis: layer.hypothesis } : {}),
              ...(typeof layer.rollback_value === 'string' ? { rollback_value: layer.rollback_value } : {}),
              ...(typeof layer.temporary === 'boolean' ? { temporary: layer.temporary } : {}),
              ...(typeof layer.decision === 'string' ? { decision: layer.decision } : {}),
            });
          }
        }
      }
    }
    if (Array.isArray(body?.mutation_result?.details?.painted_regions)) {
      for (const region of body.mutation_result.details.painted_regions) {
        if (Number.isSafeInteger(region?.layer_id) && region.layer_id > 0) layerIds.add(region.layer_id);
      }
    }
  }
  return {
    ...(documentId ? { document_id: documentId } : {}),
    ...(layerIds.size ? { layer_ids: [...layerIds] } : {}),
    ...(logicalLayers.length ? { logical_layers: logicalLayers } : {}),
  };
}

function compactClosedPrevious(value) {
  if (!value?.closed) return value?.closed === false ? { closed: false } : undefined;
  return {
    closed: true,
    operation_id: value.operation_id,
    operation_acknowledged: !!value.operation_ack,
    report_delivery: value.report_delivery,
    verdict_recorded: !!value.verdict_recorded,
  };
}

function nextState(record) {
  if (record.phase !== 'completed') return 'awaiting_reconcile';
  if (record.visual && !record.preview) return 'awaiting_preview_recovery';
  if (record.visual && record.preview && !record.verdict) return 'awaiting_visual_review';
  return 'awaiting_report_and_operation_ack';
}

function microplanHasExplicitBeforePreview(input) {
  if (input?.tool !== 'photoshop_execute_visual_microplan') return false;
  const steps = input?.args?.steps;
  if (!Array.isArray(steps) || steps.length < 3) return false;
  const mutationIndex = steps.findIndex(step => /photoshop_(?:paint_strokes|paint_dabs|paint_regions|fill_layer|undo)$/.test(step?.tool ?? ''));
  if (mutationIndex <= 0) return false;
  return steps.slice(0, mutationIndex).some(step => step?.tool === 'photoshop_get_preview');
}

export function cycleEnvelope(store, record, { replay = false, closed_previous } = {}) {
  const narrativeState = record.phase === 'completed' ? 'completed' : 'uncertain';
  const healthyCompletion = record.phase === 'completed' && !record.failed && !record.error;
  const state = nextState(record);
  const nextRequiredAction = state === 'awaiting_reconcile'
    ? `Reconcile uncertain operation ${record.id} from fresh same-document state/preview evidence before any retry or new mutation.`
    : state === 'awaiting_preview_recovery'
      ? `Obtain and attach a recovery preview for operation ${record.id}, then inspect/classify it before any new visual mutation.`
      : state === 'awaiting_visual_review'
        ? 'Inspect the materialized preview, emit one visible assistant update, then call cycle-auto with previous_operation_id + previous_operation_ack + previous_report + previous_visual_verdict + next_operation.'
        : 'Emit one visible assistant update, then call cycle-auto with previous_operation_id + previous_operation_ack + previous_report + next_operation.';
  const envelope = {
    mode: 'photoshop-mcp-cycle',
    ...(replay ? { replayed_from_disk: true } : {}),
    ...(closed_previous !== undefined ? { closed_previous: compactClosedPrevious(closed_previous) } : {}),
    execution: {
      operation_id: record.id,
      tool: record.tool,
      phase: record.phase,
      failed: !!record.failed,
      execution: record.execution,
    },
    confirmed_targets: confirmedTargets(record),
    preview: record.preview,
    significance: store.visualSignificance(record.id),
    operation_receipt: record.operation_receipt ?? null,
    required_user_report: {
      operation_id: record.id,
      format: 'Что сделал: ...\nЗачем: ...\nРезультат: ...',
      did_hint: record.summary,
      why_hint: record.purpose,
      result_hint: resultSummary(record.result),
      must_be_visible_before_next_host_call: true,
    },
    required_operation_ack: record.operation_receipt ? {
      protocol: 'photoshop.guard.operation_ack.v1',
      operation_id: record.id,
      receipt_token: record.operation_receipt.token,
    } : null,
    next_state: state,
    next_required_action: nextRequiredAction,
    journal_record_path: store.file(record.id),
  };
  if (!healthyCompletion) {
    envelope.blocking_issue = record.error ?? (record.failed ? 'operation failed or requires reconciliation' : 'operation outcome is uncertain');
    envelope.diagnostics = {
      route: 'Chat_On_Steroids_Core -> direct stdio -> this fork/dist/index.js -> Photoshop',
      summary: record.summary,
      purpose: record.purpose,
      error: record.error,
      result: compactResult(record.result),
      narrative: operationNarrative(record, narrativeState),
      progress: progressPayload(record, narrativeState),
      host_progress: hostProgressPayload(record, narrativeState),
      guard_capabilities: guardCapabilities(),
    };
  }
  return envelope;
}

export async function executeLogicalOperation({
  store,
  input,
  invoke,
  materializeArguments,
  onProgress,
}) {
  const { record, replay } = store.begin(input);
  if (replay) return { record, replay: true };
  let activeRecord = record;

  try {
    const timeout = Number(input.timeout_ms ?? 60_000);
    if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 180_000) {
      throw new Error('timeout_ms must be 1000..180000; split longer work');
    }
    const deadlineAt = Date.now() + timeout;
    const remainingTimeout = () => {
      const remaining = Math.floor(deadlineAt - Date.now() - 500);
      if (remaining < 1000) {
        throw new Error('Logical cycle deadline exhausted before the next MCP dispatch; operation not sent.');
      }
      return remaining;
    };

    const visualOperation = isVisual(input.tool);
    const standaloneVisual = visualOperation && input.tool !== 'photoshop_execute_visual_microplan';
    const documentId = input.args?.document_id;

    const needsInitialBaseline = visualOperation && !activeRecord.before_preview && !activeRecord.baseline_preview;
    const needsFreshSubtleBaseline = standaloneVisual && input.significance_mode === 'subtle_local';
    const controllerShouldCaptureBefore =
      !microplanHasExplicitBeforePreview(input) && (needsInitialBaseline || needsFreshSubtleBaseline);

    if (controllerShouldCaptureBefore) {
      await onProgress?.('before_preview');
      const beforeArgs = materializeArguments(
        'photoshop_get_preview',
        { ...(input.preview_args ?? {}), document_id: documentId },
        `${input.id}-before`
      );
      const beforeResult = await invoke('photoshop_get_preview', beforeArgs, remainingTimeout());
      store.attachBeforePreview(record.id, beforeResult);
      activeRecord = store.read(record.id);
    }

    store.markDispatched(activeRecord);
    await onProgress?.('mutation');
    const result = await invoke(input.tool, materializeArguments(input.tool, input.args, input.id), remainingTimeout());
    let completed = store.complete(activeRecord, result);
    activeRecord = completed;

    if (completed.visual && !completed.preview && completed.execution !== 'not-executed') {
      await onProgress?.('after_preview');
      const afterArgs = materializeArguments(
        'photoshop_get_preview',
        { ...(input.preview_args ?? {}), document_id: documentId },
        `${input.id}-after`
      );
      const afterResult = await invoke('photoshop_get_preview', afterArgs, remainingTimeout());
      store.attachPreview(completed.id, afterResult);
      completed = store.read(completed.id);
    }

    return { record: completed, replay: false };
  } catch (error) {
    return { record: store.fail(activeRecord, error), replay: false };
  }
}
