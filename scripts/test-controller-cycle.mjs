// HISTORICAL LEGACY CONTROLLER FIXTURE — not part of maintained acceptance.
// Compact cycle/closure/preview coverage is maintained in native embedded Guard tests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { SessionStore, atomicJson } from './lib/photoshop-session-store.mjs';
import { cycleEnvelope, executeLogicalOperation } from './lib/photoshop-cycle.mjs';
import { hostAckForReport, visibleReportText, visibleTextSha256 } from './lib/host-report-receipt.mjs';

function writeJpeg(file, value, changedValue = value, changedFraction = 0, width = 64, height = 64) {
  const data = Buffer.alloc(width * height * 4);
  const changedPixels = Math.floor(width * height * changedFraction);
  for (let i = 0; i < width * height; i++) {
    const v = i < changedPixels ? changedValue : value;
    const offset = i * 4;
    data[offset] = v;
    data[offset + 1] = v;
    data[offset + 2] = v;
    data[offset + 3] = 255;
  }
  const bytes = jpeg.encode({ data, width, height }, 100).data;
  writeFileSync(file, bytes);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    materialized_path: file,
    width,
    height,
    mime_type: 'image/jpeg',
  };
}

function previewResult(metadata) {
  return { content: [{ type: 'text', text: JSON.stringify(metadata) }] };
}

function request(id, extras = {}) {
  return {
    id,
    tool: 'photoshop_set_layer_opacity',
    args: { document_id: 42, opacity: 50 },
    summary: 'Reduce the test layer opacity',
    purpose: 'Make the test form visibly less dominant',
    problem_id: 'test-form',
    ...extras,
  };
}

function critic(overrides = {}) {
  return {
    verdict: 'improvement',
    disposition: 'accept',
    observed_change: 'The edited test form is visibly less dominant than in the before frame',
    target_resolved: 'yes',
    regressions: [],
    uncertainty: 'none observed',
    global_readability: 'improved',
    primitive_footprint: 'none',
    trend_signals: [],
    ...overrides,
  };
}

const dir = mkdtempSync(path.join(tmpdir(), 'ps-cycle-test-'));
try {
  const barrierDir = path.join(dir, 'barriers');
  const store = new SessionStore(dir, { visualBarrierDirectory: barrierDir });
  const before = writeJpeg(path.join(dir, 'before.jpg'), 80);
  const after = writeJpeg(path.join(dir, 'after.jpg'), 150);
  atomicJson(store.paintingStateFile(), {
    version: 1,
    revision: 1,
    documents: {
      '42': {
        document_id: 42,
        current_frame: {
          operation_id: 'baseline',
          sha256: before.sha256,
          path: before.materialized_path,
          accepted: true,
        },
      },
    },
  });

  const calls = [];
  const invoke = async (name, args) => {
    calls.push({ name, args });
    if (name === 'photoshop_get_preview') return previewResult(after);
    return { content: [{ type: 'text', text: '{"ok":true,"text":"opacity changed"}' }] };
  };
  const materializeArguments = (_tool, args) => structuredClone(args ?? {});
  const first = await executeLogicalOperation({
    store,
    input: request('cycle-one'),
    invoke,
    materializeArguments,
  });
  assert.equal(first.record.phase, 'completed');
  assert.equal(first.record.preview.sha256, after.sha256);
  assert.deepEqual(calls.map(x => x.name), ['photoshop_set_layer_opacity', 'photoshop_get_preview']);
  assert.equal(store.visualBarrier(42)?.sha256, after.sha256);
  const envelope = cycleEnvelope(store, first.record);
  assert.equal(envelope.next_state, 'awaiting_visual_review');
  assert.equal(envelope.significance.execution_effect, 'meaningful');
  assert.equal(envelope.required_user_report.must_be_visible_before_next_host_call, true);
  assert.equal(envelope.operation_receipt.protocol, 'photoshop.guard.operation_receipt.v1');
  assert.equal(envelope.required_operation_ack.receipt_token, envelope.operation_receipt.token);
  assert.equal(envelope.execution.operation_id, 'cycle-one');
  assert.equal(envelope.confirmed_targets.document_id, 42);
  const continuationEnvelope = cycleEnvelope(store, {
    ...first.record,
    result: {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          continuation_layers: [
            {
              step_id: 'body',
              layer_id: 77,
              layer_name: 'Body',
              hypothesis_id: 'body-volume',
              hypothesis: 'Body volume should be independently reversible',
              rollback_value: 'high',
              temporary: false,
              decision: 'create-new',
            },
            { step_id: 'features', layer_id: 88, layer_name: 'Features' },
          ],
          mutation_result: {
            details: { painted_regions: [{ layer_id: 77 }, { layer_id: 88 }] },
          },
        }),
      }],
    },
  });
  assert.deepEqual(continuationEnvelope.confirmed_targets.layer_ids, [77, 88],
    'compact cycle envelope must preserve stable continuation layer ids from a VisualMicroPlan');
  assert.deepEqual(continuationEnvelope.confirmed_targets.logical_layers, [{
    layer_id: 77,
    layer_name: 'Body',
    hypothesis_id: 'body-volume',
    hypothesis: 'Body volume should be independently reversible',
    rollback_value: 'high',
    temporary: false,
    decision: 'create-new',
  }], 'compact cycle envelope must preserve logical-layer rollback semantics');
  assert.match(envelope.next_required_action, /cycle-auto/);
  assert.equal(typeof envelope.journal_record_path, 'string');
  assert.equal(envelope.narrative, undefined, 'healthy cycle must not repeat narrative in the final envelope');
  assert.equal(envelope.progress, undefined, 'healthy cycle must not repeat transient progress in the final envelope');
  assert.equal(envelope.host_progress, undefined, 'healthy cycle must not repeat host progress in the final envelope');
  assert.equal(envelope.guard_capabilities, undefined, 'healthy cycle must not repeat static guard capabilities');
  assert.equal(envelope.diagnostics, undefined, 'healthy cycle must keep forensic detail in the journal');

  const uncertainStore = new SessionStore(path.join(dir, 'uncertain-controller'), {
    visualBarrierDirectory: path.join(dir, 'uncertain-barriers'),
  });
  const uncertainRecord = uncertainStore.begin(request('uncertain-envelope')).record;
  uncertainStore.markDispatched(uncertainRecord);
  const failedRecord = uncertainStore.fail(uncertainRecord, new Error('simulated dispatch uncertainty'));
  const failedEnvelope = cycleEnvelope(uncertainStore, failedRecord);
  assert.equal(failedEnvelope.next_state, 'awaiting_reconcile');
  assert.match(failedEnvelope.next_required_action, /Reconcile uncertain operation uncertain-envelope/);
  assert.doesNotMatch(failedEnvelope.next_required_action, /next_operation|cycle-auto/);

  const closed = store.closePreviousCycle({
    previous_operation_id: 'cycle-one',
    previous_operation_ack: { token: envelope.operation_receipt.token },
    previous_report: {
      did: 'Reduced the test layer opacity and captured its preview',
      why: 'Make the test form visibly less dominant',
      result: 'The before and after previews differ clearly and are ready for classification',
    },
    previous_visual_verdict: critic(),
  });
  assert.equal(closed.closed, true);
  assert.equal(closed.operation_ack.protocol, 'photoshop.guard.operation_ack.v1');
  assert.equal(closed.verdict_recorded, true);
  assert.equal(store.visualBarrier(42), undefined);
  assert.equal(store.read('cycle-one').report.delivery, 'recorded_host_verification_optional');

  const initialDir = path.join(dir, 'initial-baseline');
  const initialStore = new SessionStore(initialDir, {
    visualBarrierDirectory: path.join(initialDir, 'barriers'),
  });
  const initialBefore = writeJpeg(path.join(dir, 'initial-before.jpg'), 30);
  const initialAfter = writeJpeg(path.join(dir, 'initial-after.jpg'), 180);
  let initialPreviewCount = 0;
  const initialCalls = [];
  const initialStages = [];
  const initialInvoke = async (name, args) => {
    initialCalls.push({ name, args });
    if (name !== 'photoshop_get_preview') {
      return { content: [{ type: 'text', text: '{"ok":true,"text":"initial visual mutation"}' }] };
    }
    initialPreviewCount++;
    return previewResult(initialPreviewCount === 1 ? initialBefore : initialAfter);
  };
  const initial = await executeLogicalOperation({
    store: initialStore,
    input: request('cycle-initial'),
    invoke: initialInvoke,
    materializeArguments,
    onProgress: async stage => { initialStages.push(stage); },
  });
  assert.deepEqual(initialCalls.map(x => x.name), [
    'photoshop_get_preview',
    'photoshop_set_layer_opacity',
    'photoshop_get_preview',
  ]);
  assert.equal(initialStore.read('cycle-initial').before_preview.sha256, initialBefore.sha256);
  assert.equal(initialStore.read('cycle-initial').preview.sha256, initialAfter.sha256);
  assert.equal(initialStore.visualSignificance('cycle-initial').execution_effect, 'meaningful');
  assert.deepEqual(initialStages, ['before_preview', 'mutation', 'after_preview']);

  const focusRegion = { left: 10, top: 10, right: 74, bottom: 74 };
  const wholeBefore = writeJpeg(path.join(dir, 'subtle-whole-before.jpg'), 100);
  const wholeAfter = writeJpeg(path.join(dir, 'subtle-whole-after.jpg'), 100);
  const focusBefore = writeJpeg(path.join(dir, 'subtle-focus-before.jpg'), 100);
  const focusAfter = writeJpeg(path.join(dir, 'subtle-focus-after.jpg'), 101);
  atomicJson(store.paintingStateFile(), {
    version: 1,
    revision: 2,
    documents: {
      '42': {
        document_id: 42,
        current_frame: {
          operation_id: 'baseline-two',
          sha256: wholeBefore.sha256,
          path: wholeBefore.materialized_path,
          accepted: true,
        },
      },
    },
  });

  let previewCount = 0;
  const subtleCalls = [];
  const subtleStages = [];
  const subtleTimeouts = [];
  const subtleInvoke = async (name, args, timeout) => {
    subtleCalls.push({ name, args });
    subtleTimeouts.push(timeout);
    await new Promise(resolve => setTimeout(resolve, 8));
    if (name !== 'photoshop_get_preview') return { content: [{ type: 'text', text: '{"ok":true}' }] };
    previewCount++;
    const meta = previewCount === 1
      ? { ...wholeBefore, focus: { ...focusBefore, region: focusRegion } }
      : { ...wholeAfter, focus: { ...focusAfter, region: focusRegion } };
    return previewResult(meta);
  };
  const subtle = await executeLogicalOperation({
    store,
    input: request('cycle-subtle', {
      significance_mode: 'subtle_local',
      preview_args: { focus_region: focusRegion, focus_max_dimension_px: 1000 },
    }),
    invoke: subtleInvoke,
    materializeArguments,
    onProgress: async stage => { subtleStages.push(stage); },
  });
  assert.deepEqual(subtleCalls.map(x => x.name), [
    'photoshop_get_preview',
    'photoshop_set_layer_opacity',
    'photoshop_get_preview',
  ]);
  assert.equal(subtleTimeouts.length, 3);
  assert.ok(subtleTimeouts[1] < subtleTimeouts[0], 'mutation must receive less of the shared deadline than before-preview');
  assert.ok(subtleTimeouts[2] < subtleTimeouts[1], 'after-preview must receive less of the shared deadline than mutation');
  assert.equal(store.read('cycle-subtle').before_preview.focus.sha256, focusBefore.sha256);
  assert.equal(store.read('cycle-subtle').preview.focus.sha256, focusAfter.sha256);
  assert.equal(store.visualSignificance('cycle-subtle').execution_effect, 'meaningful');
  assert.equal(store.visualSignificance('cycle-subtle').focus_matched, true);
  assert.deepEqual(subtleStages, ['before_preview', 'mutation', 'after_preview']);

  const visibleReport = {
    did: 'Reduced the test layer opacity and captured its preview',
    why: 'Make the test form visibly less dominant',
    result: 'The before and after previews differ clearly and are ready for classification',
  };
  const verifiedAck = hostAckForReport(visibleReport, {
    COS_ASSISTANT_RECEIPT_VERSION: '1',
    COS_ASSISTANT_MESSAGE_ID: 'assistant-message-123',
    COS_ASSISTANT_MESSAGE_SHA256: visibleTextSha256(visibleReportText(visibleReport)),
    COS_ASSISTANT_TURN_ID: 'turn-123',
    COS_ASSISTANT_DELIVERED_AT: '2026-09-16T12:00:00.000Z',
  });
  assert.equal(verifiedAck.message_id, 'assistant-message-123');
  assert.equal(verifiedAck.turn_id, 'turn-123');
  assert.equal(hostAckForReport({ ...visibleReport, result: 'Different text' }, {
    COS_ASSISTANT_RECEIPT_VERSION: '1',
    COS_ASSISTANT_MESSAGE_ID: 'assistant-message-123',
    COS_ASSISTANT_MESSAGE_SHA256: visibleTextSha256(visibleReportText(visibleReport)),
    COS_ASSISTANT_DELIVERED_AT: '2026-09-16T12:00:00.000Z',
  }), undefined);

  const strictDir = path.join(dir, 'guard-owned-delivery');
  const strictStore = new SessionStore(strictDir, {
    visualBarrierDirectory: path.join(strictDir, 'barriers'),
  });
  const strictRecord = strictStore.begin({
    id: 'strict-read-one',
    tool: 'photoshop_get_state',
    args: { document_id: 42 },
    summary: 'Read strict test state',
    purpose: 'Verify the Guard-owned acknowledgement gate before continuation',
  }).record;
  strictStore.complete(strictRecord, { content: [{ type: 'text', text: '{"ok":true}' }] });
  assert.throws(() => strictStore.closePreviousCycle({
    previous_operation_id: 'strict-read-one',
    previous_report: visibleReport,
  }), /previous_operation_ack is required/);

  const strictReceipt = strictStore.read('strict-read-one').operation_receipt;
  assert.throws(() => strictStore.closePreviousCycle({
    previous_operation_id: 'strict-read-one',
    previous_operation_ack: { token: 'wrong-token' },
  }), /does not match/);

  const exactStrictAck = hostAckForReport(visibleReport, {
    COS_ASSISTANT_RECEIPT_VERSION: '1',
    COS_ASSISTANT_MESSAGE_ID: 'assistant-message-strict',
    COS_ASSISTANT_MESSAGE_SHA256: visibleTextSha256(visibleReportText(visibleReport)),
    COS_ASSISTANT_TURN_ID: 'turn-strict',
    COS_ASSISTANT_DELIVERED_AT: '2026-09-16T12:00:01.000Z',
  });
  assert.ok(exactStrictAck);
  assert.throws(() => strictStore.ackReport({
    id: 'strict-read-one',
    ...exactStrictAck,
  }), /verified by the host receipt boundary/);

  const strictClosed = strictStore.closePreviousCycle({
    previous_operation_id: 'strict-read-one',
    previous_operation_ack: { token: strictReceipt.token },
    previous_report_ack: exactStrictAck,
  }, { hostAckVerified: true });
  assert.equal(strictClosed.report_delivery, 'host_verified');
  assert.equal(strictClosed.operation_ack.protocol, 'photoshop.guard.operation_ack.v1');
  assert.equal(strictStore.read('strict-read-one').report.host_ack.message_id, 'assistant-message-strict');
  const nextStrict = strictStore.begin({
    id: 'strict-read-two',
    tool: 'photoshop_get_state',
    args: { document_id: 42 },
    summary: 'Read state after strict host verification',
    purpose: 'Prove the next operation is admitted after the exact Guard receipt acknowledgement',
  });
  assert.equal(nextStrict.replay, false);

  const diagnosticStore = new SessionStore(path.join(dir, 'diagnostic-cycle'), {
    visualBarrierDirectory: path.join(dir, 'diagnostic-cycle', 'barriers'),
  });
  const diagnosticRecord = diagnosticStore.begin(request('cycle-diagnostic')).record;
  diagnosticStore.markDispatched(diagnosticRecord);
  const diagnosticFailed = diagnosticStore.fail(diagnosticRecord, new Error('forced diagnostic failure'));
  const diagnosticEnvelope = cycleEnvelope(diagnosticStore, diagnosticFailed);
  assert.match(diagnosticEnvelope.blocking_issue, /forced diagnostic failure/);
  assert.equal(diagnosticEnvelope.diagnostics.progress.protocol, 'operation.progress.v1');
  assert.equal(diagnosticEnvelope.diagnostics.host_progress.protocol, 'cos.host_progress.v1');
  assert.equal(diagnosticEnvelope.diagnostics.guard_capabilities.operation_ack.required, true);
  assert.match(diagnosticEnvelope.diagnostics.error, /forced diagnostic failure/);

  console.log('CONTROLLER_CYCLE_TEST_OK 2 logical cycles + shrinking timeout budget + Guard receipt ack + optional host receipt evidence; no Photoshop or browser used');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
