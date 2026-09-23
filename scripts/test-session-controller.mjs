// HISTORICAL LEGACY CONTROLLER FIXTURE — not part of maintained acceptance.
// Equivalent required recovery/state coverage lives on the compact native embedded Guard path.
// Keep only as read-only archaeology until the legacy provider files themselves are deleted.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { SessionStore, atomicJson } from './lib/photoshop-session-store.mjs';
import { createJob, writeJobCompleted, writeJobStarted } from './lib/async-job.mjs';

const dirs = [];
function fresh() { const dir = mkdtempSync(path.join(tmpdir(), 'ps-session-test-')); dirs.push(dir); return new SessionStore(dir); }
function request(id, tool = 'photoshop_paint_dabs', args = { document_id: 42 }) {
  return { id, tool, args, summary: 'Refine the sky value', purpose: 'Separate sky and tower', problem_id: 'sky-separation' };
}
function critic(overrides = {}) {
  return {
    verdict: 'neutral', disposition: 'correct',
    observed_change: 'The edited sky region changed visibly but the target separation is not yet sufficient',
    target_resolved: 'no', regressions: [], uncertainty: 'No new defect observed',
    global_readability: 'stable', primitive_footprint: 'none', trend_signals: [],
    ...overrides,
  };
}
const ok = { content: [{ type: 'text', text: '{"ok":true}' }] };
function report(s, id) {
  s.report({ id, did: 'Completed the stated operation', why: 'Verify the planned change', result: 'Execution recorded; visual review pending' });
  const receipt = s.read(id)?.operation_receipt;
  if (receipt) s.ackOperation({ id, token: receipt.token });
}
function writeJpeg(file, value, changedValue = value, changedFraction = 0, width = 64, height = 64) {
  const data = Buffer.alloc(width * height * 4);
  const changedPixels = Math.floor(width * height * changedFraction);
  for (let i = 0; i < width * height; i++) {
    const v = i < changedPixels ? changedValue : value;
    const offset = i * 4;
    data[offset] = v; data[offset + 1] = v; data[offset + 2] = v; data[offset + 3] = 255;
  }
  const bytes = jpeg.encode({ data, width, height }, 100).data;
  writeFileSync(file, bytes);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), materialized_path: file, width, height, mime_type: 'image/jpeg' };
}
function previewResult(metadata) {
  return { content: [{ type: 'text', text: JSON.stringify(metadata) }] };
}
function seedClassifiedVisual(s, id, { ageMs = 10_000, targetResolved = 'no', effect = 'meaningful', sequence = 1 } = {}) {
  const at = new Date(Date.now() - ageMs).toISOString();
  atomicJson(s.file(id), {
    ...request(id),
    phase: 'completed',
    sequence,
    created_at: at,
    completed_at: at,
    visual: true,
    report: {},
    verdict: {
      ...critic({ target_resolved: targetResolved }),
      significance: { execution_effect: effect },
      at,
    },
  });
  s.updatePaintingState(42, current => ({
    ...current,
    current_stage: 'medium-form',
    active_problem: targetResolved === 'yes' ? undefined : { problem_id: 'sky-separation', scale: 'medium', severity: 'should-fix' },
    visual_problems: {
      ...(current.visual_problems ?? {}),
      'sky-separation': { problem_id: 'sky-separation', scale: 'medium', severity: 'should-fix', status: targetResolved === 'yes' ? 'resolved' : 'open' },
    },
  }));
}
let count = 0;
function test(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
try {
  test('intent survives restart; no uncertain replay or unreported follow-up', () => {
    const s = fresh(); s.begin(request('one'));
    const next = new SessionStore(s.directory);
    assert.deepEqual(next.status().uncertain, ['one']);
    assert.throws(() => next.begin(request('one')), /uncertain/);
    assert.throws(() => next.begin(request('two')), /Report required/);
    report(next, 'one');
    assert.throws(() => next.begin(request('two')), /Uncertain operation/);
    next.begin(request('read', 'photoshop_get_state'));
  });
  test('completed id returns cached result without executing; changed payload rejected', () => {
    const s = fresh(); const r = s.begin(request('one')).record; s.complete(r, ok);
    assert.equal(s.begin(request('one')).replay, true);
    assert.throws(() => s.begin({ ...request('one'), purpose: 'Different task' }), /different request/);
  });
  test('Tool called is not a report and a missing verdict blocks new work', () => {
    const s = fresh(); s.complete(s.begin(request('one')).record, ok);
    assert.throws(() => s.report({ id: 'one', did: 'Tool called', why: 'Check the result', result: 'Done' }), /Concrete report/);
    report(s, 'one');
    assert.throws(() => s.begin(request('two')), /Visual barrier.*preview and verdict/);
  });
  test('concurrent controller rejected, live lock cannot be removed', () => {
    const s = fresh(); const release = s.lock();
    assert.throws(() => s.lock(), /Another controller/);
    assert.throws(() => s.recoverLock(), /still running/);
    release(); s.lock()();
  });
  test('preview must be same document, fresh and byte-for-byte the classified frame', () => {
    const s = fresh(); s.complete(s.begin(request('one')).record, ok); report(s, 'one');
    const file = path.join(s.directory, 'preview.jpg'); writeFileSync(file, 'frame');
    const sha = createHash('sha256').update('frame').digest('hex');
    const preview = { content: [{ type: 'text', text: JSON.stringify({ sha256: sha, materialized_path: file }) }] };
    s.complete(s.begin(request('preview', 'photoshop_get_preview')).record, preview); report(s, 'preview');
    assert.throws(() => s.verdict({ id: 'one', preview_id: 'preview', sha256: 'bad', ...critic() }), /SHA mismatch/);
    s.verdict({ id: 'one', preview_id: 'preview', sha256: sha, ...critic() });
    assert.equal(s.begin(request('two')).replay, false);
    assert.equal(s.paintingState().documents['42'].last_critique.target_resolved, 'no');
  });
  test('connection failure before dispatch is not mislabeled as an executed mutation', () => {
    const s = fresh(); const r = s.begin(request('one')).record;
    const failure = s.fail(r, new Error('handshake failed'));
    assert.equal(failure.phase, 'completed'); assert.equal(failure.visual, false);
    assert.equal(failure.execution, 'not-executed');
  });
  test('dispatched error remains uncertain and cannot auto-retry', () => {
    const s = fresh(); const r = s.begin(request('one')).record; r.dispatched = true;
    s.fail(r, new Error('timeout')); report(s, 'one');
    assert.throws(() => s.begin(request('two')), /Uncertain operation/);
  });
  test('wrong-document PSD cannot release checkpoint deadline', () => {
    const s = fresh();
    atomicJson(s.file('old'), { ...request('old'), phase: 'completed', created_at: new Date(Date.now() - 360000).toISOString(), visual: true, verdict: { verdict: 'improvement' }, report: {} });
    atomicJson(s.file('save-other'), { ...request('save-other', 'photoshop_save_document', { document_id: 99 }), phase: 'completed', created_at: new Date().toISOString(), checkpoint: 'other.psd', report: {} });
    assert.throws(() => s.begin(request('new')), /Checkpoint due/);
  });
  test('PSD persistence preserves the pinned document and hard preview barrier', () => {
    const s = fresh();
    const visual = s.begin(request('visual-before-save')).record;
    s.markDispatched(visual);
    s.complete(visual, ok);
    report(s, 'visual-before-save');

    const barrierBefore = structuredClone(s.visualBarrier(42));
    const paintingBefore = structuredClone(s.paintingState().documents?.['42'] ?? null);
    assert.equal(barrierBefore?.planId, 'visual-before-save');
    assert.equal(barrierBefore?.requiresExternalPreview, true);

    const checkpoint = path.join(s.directory, 'checkpoint.psd');
    writeFileSync(checkpoint, 'verified layered checkpoint');
    const saveRequest = request('save-with-barrier', 'photoshop_save_document', {
      document_id: 42,
      path: checkpoint,
      format: 'PSD',
    });
    const save = s.begin(saveRequest).record;
    assert.equal(save.args.document_id, 42);
    s.complete(save, ok);

    assert.equal(s.read('save-with-barrier')?.checkpoint, checkpoint);
    assert.equal(s.read('save-with-barrier')?.args?.document_id, 42);
    assert.deepEqual(s.visualBarrier(42), barrierBefore);
    assert.deepEqual(s.paintingState().documents?.['42'] ?? null, paintingBefore);
    assert.equal(s.status().pending_visual_verdicts.includes('visual-before-save'), true);
  });
  test('three non-improving passes demand a replan', () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) atomicJson(s.file(`n${i}`), { ...request(`n${i}`), problem_id: 'sky-separation', phase: 'completed', created_at: new Date(Date.now() - 1000 + i).toISOString(), visual: true, verdict: { verdict: 'neutral' }, report: {} });
    assert.throws(() => s.begin({ ...request('next'), problem_id: 'sky-separation' }), /concrete replan/);
    assert.equal(s.begin({ ...request('next'), problem_id: 'sky-separation', replan: 'Change the value structure instead of adding more texture' }).replay, false);
  });
  test('non-improving attempts are scoped to one explicit visual problem', () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) atomicJson(s.file(`n${i}`), { ...request(`n${i}`), problem_id: 'rock-silhouette', phase: 'completed', created_at: new Date(Date.now() - 1000 + i).toISOString(), visual: true, verdict: { verdict: 'neutral' }, report: {} });
    assert.equal(s.begin({ ...request('sky-next'), problem_id: 'sky-separation' }).replay, false);
  });
  test('stage priority gate blocks detail while a larger must-fix remains open', () => {
    const s = fresh();
    s.setPriorityState({ document_id: 42, current_stage: 'global block-in', problems: [
      { problem_id: 'landscape-masses', scale: 'global', severity: 'must-fix', region: 'background' },
      { problem_id: 'eye-naturalization', scale: 'small', severity: 'should-fix', region: 'eyes' },
    ] });
    assert.throws(() => s.begin({ ...request('detail-blocked'), problem_id: 'eye-naturalization', scale: 'small', severity: 'should-fix' }), /stage_priority_gate/);
    assert.equal(s.begin({ ...request('global-ok'), problem_id: 'landscape-masses', scale: 'global', severity: 'must-fix' }).replay, false);
  });
  test('explicit diagnostic override may cross the scale gate but ordinary replan may not', () => {
    const s = fresh();
    s.setPriorityState({ document_id: 42, current_stage: 'global block-in', problems: [
      { problem_id: 'figure-silhouette', scale: 'global', severity: 'must-fix' },
    ] });
    assert.throws(() => s.begin({ ...request('small-no'), scale: 'small', replan: 'Try a different small brush around the eye' }), /stage_priority_gate/);
    assert.equal(s.begin({ ...request('small-probe'), scale: 'small', replan: 'Diagnostic override: test one focal edge solely to evaluate the global silhouette' }).replay, false);
  });
  test('cumulative trend guard promotes repeated degradation to a global must-fix', () => {
    const s = fresh();
    s.setPriorityState({ document_id: 42, current_stage: 'medium-form', problems: [
      { problem_id: 'face-form', scale: 'medium', severity: 'should-fix' },
    ] });
    for (let i = 0; i < 2; i++) {
      const before = writeJpeg(path.join(s.directory, `trend-before-${i}.jpg`), 90 + i);
      const after = writeJpeg(path.join(s.directory, `trend-after-${i}.jpg`), 130 + i);
      const id = `trend-${i}`;
      const record = s.begin({ ...request(id), problem_id: `local-${i}`, scale: 'medium', severity: 'should-fix' }).record;
      record.baseline_preview = before;
      s.complete(record, ok); report(s, id);
      const previewId = `trend-preview-${i}`;
      s.complete(s.begin(request(previewId, 'photoshop_get_preview')).record, previewResult(after)); report(s, previewId);
      s.verdict({ id, preview_id: previewId, sha256: after.sha256, ...critic({
        global_readability: 'degraded',
        primitive_footprint: 'suspect',
        trend_signals: ['edge-softening', 'soft-round-footprint'],
      }) });
    }
    const doc = s.paintingState().documents['42'];
    assert.equal(doc.cumulative_trend_guard.triggered, true);
    assert.equal(doc.active_scale, 'global');
    assert.match(doc.active_problem.problem_id, /^cumulative-trend-/);
    assert.equal(doc.active_problem.severity, 'must-fix');
    assert.throws(() => s.begin({ ...request('small-after-trend'), problem_id: 'eye-detail', scale: 'small' }), /stage_priority_gate/);
  });
  test('request cannot pre-supply a report, verdict or completed state', () => {
    const s = fresh();
    for (const key of ['report', 'verdict', 'phase', 'resolved']) assert.throws(() => s.begin({ ...request('bad'), [key]: {} }), /Unsupported request field/);
  });
  test('reconciliation requires successful same-document evidence and never enables replay', () => {
    const s = fresh(); const beforeFile = path.join(s.directory, 'before.jpg'); const before = writeJpeg(beforeFile, 80);
    const r = s.begin(request('one')).record; r.baseline_preview = before; r.dispatched = true; s.fail(r, new Error('timeout')); report(s, 'one');
    s.complete(s.begin(request('state', 'photoshop_get_state')).record, ok); report(s, 'state');
    const file = path.join(s.directory, 'recover.jpg'); const after = writeJpeg(file, 80, 140, 0.5); const sha = after.sha256;
    const preview = previewResult(after);
    s.complete(s.begin(request('preview', 'photoshop_get_preview')).record, preview); report(s, 'preview');
    s.reconcile({ id: 'one', state_id: 'state', preview_id: 'preview', outcome: 'partial', reason: 'Only part of the planned sky plane was changed' });
    assert.throws(() => s.begin(request('one')), /uncertain/);
    s.verdict({ id: 'one', preview_id: 'preview', sha256: sha, ...critic({
      verdict: 'improvement', disposition: 'accept', target_resolved: 'yes',
      observed_change: 'The left sky plane is now visibly lighter than the adjacent tower silhouette',
      uncertainty: 'none observed',
    }) });
    assert.equal(s.begin(request('repair-remaining')).replay, false);
  });
  test('reconciliation can abandon an uncertain operation after confirmed document closure', () => {
    const s = fresh();
    const r = s.begin(request('one')).record; r.dispatched = true; s.fail(r, new Error('timeout')); report(s, 'one');

    const openDocs = s.begin(request('docs-open', 'photoshop_list_documents', {})).record;
    s.complete(openDocs, { content: [{ type: 'text', text: JSON.stringify({ ok: true, details: { count: 1, documents: [{ id: 42 }], active_document_id: 42 } }) }] });
    report(s, 'docs-open');
    assert.throws(() => s.reconcile({
      id: 'one', documents_id: 'docs-open', document_closed_confirmed: true, outcome: 'abandoned',
      reason: 'The user explicitly closed the interrupted disposable document',
    }), /still open/);

    const closedDocs = s.begin(request('docs-closed', 'photoshop_list_documents', {})).record;
    s.complete(closedDocs, { content: [{ type: 'text', text: JSON.stringify({ ok: true, details: { count: 0, documents: [], active_document_id: null } }) }] });
    report(s, 'docs-closed');
    assert.throws(() => s.reconcile({
      id: 'one', documents_id: 'docs-closed', outcome: 'abandoned',
      reason: 'The interrupted disposable document is absent from the fresh document list',
    }), /document_closed_confirmed=true/);

    const resolved = s.reconcile({
      id: 'one', documents_id: 'docs-closed', document_closed_confirmed: true, outcome: 'abandoned',
      reason: 'The user explicitly closed document 42 and a fresh document list proves it is no longer open',
    });
    assert.equal(resolved.resolved.evidence_mode, 'document_absent');
    assert.equal(resolved.resolved.target_document_id, 42);
    assert.deepEqual(s.status().uncertain, []);
    assert.equal(s.begin(request('after-abandon')).replay, false);
  });
  test('explicit execution_busy is not an uncertain or visual operation', () => {
    const s = fresh();
    const result = s.complete(s.begin(request('one')).record, { isError: true, content: [{ type: 'text', text: '{"ok":false,"code":"execution_busy","execution":"not-executed"}' }] });
    assert.equal(result.phase, 'completed'); assert.equal(result.visual, false);
  });
  test('not-executed reconciliation clears matching barrier and visual verdict obligation', () => {
    const s = fresh();
    const r = s.begin(request('one', 'photoshop_execute_visual_microplan', { document_id: 42, plan_id: 'plan-one' })).record;
    s.markDispatched(r);
    s.complete(r, { isError: true, content: [{ type: 'text', text: JSON.stringify({
      ok: false,
      code: 'invalid_visual_microplan',
      message: 'simulated legacy parser rejection before mutation dispatch',
    }) }] });
    report(s, 'one');
    assert.equal(s.visualBarrier(42)?.planId, 'plan-one');
    assert.equal(s.visualBarrier(42)?.operationId, 'one');

    s.complete(s.begin(request('state', 'photoshop_get_state', { document_id: 42 })).record, ok); report(s, 'state');
    const file = path.join(s.directory, 'unchanged-reconcile.jpg');
    const frame = writeJpeg(file, 100);
    s.complete(s.begin(request('preview', 'photoshop_get_preview', { document_id: 42 })).record, previewResult(frame)); report(s, 'preview');

    s.reconcile({
      id: 'one',
      state_id: 'state',
      preview_id: 'preview',
      outcome: 'not-executed',
      reason: 'The original invalid_visual_microplan result proves parsing failed before mutation dispatch',
    });
    assert.equal(s.read('one').visual, false);
    assert.equal(s.read('one').execution, 'not-executed');
    assert.equal(s.visualBarrier(42), undefined);
    assert.equal(s.status().pending_visual_verdicts.includes('one'), false);
  });
  test('matching recovery evidence alone cannot prove not-executed after a dispatched timeout', () => {
    const s = fresh();
    const r = s.begin(request('one')).record;
    s.markDispatched(r);
    s.fail(r, new Error('timeout'));
    report(s, 'one');
    s.complete(s.begin(request('state', 'photoshop_get_state')).record, ok); report(s, 'state');
    const frame = writeJpeg(path.join(s.directory, 'same-looking.jpg'), 100);
    s.complete(s.begin(request('preview', 'photoshop_get_preview')).record, previewResult(frame)); report(s, 'preview');
    assert.throws(() => s.reconcile({
      id: 'one',
      state_id: 'state',
      preview_id: 'preview',
      outcome: 'not-executed',
      reason: 'The post-state and preview look unchanged but original execution evidence is absent',
    }), /durable pre-dispatch evidence/);
    assert.equal(s.visualBarrier(42)?.operationId, 'one');
  });
  test('tiny but real decoded change may be accepted artistically without forcing a larger intervention', () => {
    const s = fresh();
    const before = writeJpeg(path.join(s.directory, 'weak-before.jpg'), 100);
    const after = writeJpeg(path.join(s.directory, 'weak-after.jpg'), 100, 101, 0.001);
    const record = s.begin({ ...request('weak'), significance_mode: 'normal' }).record;
    record.baseline_preview = before;
    s.complete(record, ok); report(s, 'weak');
    s.complete(s.begin(request('weak-preview', 'photoshop_get_preview')).record, previewResult(after)); report(s, 'weak-preview');
    const accepted = s.verdict({
      id: 'weak', preview_id: 'weak-preview', sha256: after.sha256,
      ...critic({ verdict: 'improvement', disposition: 'accept', target_resolved: 'yes' }),
    });
    assert.equal(accepted.verdict.significance.execution_effect, 'insufficient');
    assert.equal(accepted.verdict.artistic_value.accepted_improvement, true);
    assert.equal(accepted.verdict.artistic_value.execution_changed, true);
    assert.doesNotMatch(s.statusCompact().documents['42'].next_required_action, /concrete replan for sky-separation/);
    assert.equal(s.status().workflow_metrics['42'].resolved_visual_problems, 1);
  });
  test('different preview geometry is unknown rather than a manufactured delta', () => {
    const s = fresh();
    const before = writeJpeg(path.join(s.directory, 'geometry-before.jpg'), 100, 100, 0, 64, 64);
    const after = writeJpeg(path.join(s.directory, 'geometry-after.jpg'), 150, 150, 0, 80, 80);
    const record = s.begin(request('geometry')).record;
    record.baseline_preview = before;
    s.complete(record, ok); report(s, 'geometry');
    s.complete(s.begin(request('geometry-preview', 'photoshop_get_preview')).record, previewResult(after)); report(s, 'geometry-preview');
    assert.throws(() => s.verdict({
      id: 'geometry', preview_id: 'geometry-preview', sha256: after.sha256,
      ...critic({ verdict: 'improvement', disposition: 'accept', target_resolved: 'yes' }),
    }), /visual_execution_gate/);
  });
  test('subtle_local accepts a tiny but inspectable matching-focus correction', () => {
    const s = fresh();
    const wholeBefore = writeJpeg(path.join(s.directory, 'subtle-whole-before.jpg'), 100);
    const wholeAfter = writeJpeg(path.join(s.directory, 'subtle-whole-after.jpg'), 100);
    const focusBefore = writeJpeg(path.join(s.directory, 'subtle-focus-before.jpg'), 100);
    const focusAfter = writeJpeg(path.join(s.directory, 'subtle-focus-after.jpg'), 101);
    const region = { left: 10, top: 10, right: 74, bottom: 74 };
    const record = s.begin({ ...request('subtle'), significance_mode: 'subtle_local' }).record;
    record.baseline_preview = { ...wholeBefore, focus: { ...focusBefore, region } };
    s.complete(record, ok); report(s, 'subtle');
    const after = { ...wholeAfter, focus: { ...focusAfter, region } };
    s.complete(s.begin(request('subtle-preview', 'photoshop_get_preview')).record, previewResult(after)); report(s, 'subtle-preview');
    const verdict = s.verdict({
      id: 'subtle', preview_id: 'subtle-preview', sha256: wholeAfter.sha256,
      ...critic({ verdict: 'improvement', disposition: 'accept', target_resolved: 'yes', observed_change: 'The local eyelid edge is subtly but visibly cleaner in the matching focus crop' }),
    });
    assert.equal(verdict.verdict.significance.execution_effect, 'meaningful');
    const metrics = s.status().workflow_metrics['42'];
    assert.equal(metrics.resolved_visual_problems, 1);
    assert.deepEqual(metrics.resolved_problem_ids, ['sky-separation']);
  });
  test('recognition block-in requires explicit recognition verdict and records TTFR milestones', () => {
    const s = fresh();
    const before = writeJpeg(path.join(s.directory, 'recognition-before.jpg'), 20);
    const subjectFrame = writeJpeg(path.join(s.directory, 'recognition-subject.jpg'), 150);
    const styledFrame = writeJpeg(path.join(s.directory, 'recognition-style.jpg'), 210);

    const first = s.begin({
      ...request('recognition-one'),
      stage: 'RECOGNITION_BLOCK_IN',
      scale: 'global',
    }).record;
    first.baseline_preview = before;
    s.complete(first, ok); report(s, 'recognition-one');
    s.complete(
      s.begin(request('recognition-preview-one', 'photoshop_get_preview')).record,
      previewResult(subjectFrame)
    );
    report(s, 'recognition-preview-one');
    assert.throws(() => s.verdict({
      id: 'recognition-one', preview_id: 'recognition-preview-one', sha256: subjectFrame.sha256,
      ...critic({ verdict: 'improvement', disposition: 'accept' }),
    }), /recognition verdict is required/);
    s.verdict({
      id: 'recognition-one', preview_id: 'recognition-preview-one', sha256: subjectFrame.sha256,
      ...critic({ verdict: 'improvement', disposition: 'accept' }),
      recognition: {
        subject: 'yes', style: 'no', evaluator: 'producer',
        visible_features: ['outer silhouette', 'light face mass', 'feature wedge'],
        lost_features: [],
      },
    });
    let recognition = s.recognitionMetrics(42);
    assert.equal(recognition.tracking_started, true);
    assert.ok(recognition.first_detected_visual_change_at);
    assert.ok(recognition.first_subject_recognizable_at);
    assert.equal(recognition.first_subject_and_style_recognizable_at, null);

    const second = s.begin({
      ...request('recognition-two'),
      problem_id: 'recognition-style',
      stage: 'RECOGNITION_BLOCK_IN',
      scale: 'global',
    }).record;
    s.complete(second, ok); report(s, 'recognition-two');
    s.complete(
      s.begin(request('recognition-preview-two', 'photoshop_get_preview')).record,
      previewResult(styledFrame)
    );
    report(s, 'recognition-preview-two');
    s.verdict({
      id: 'recognition-two', preview_id: 'recognition-preview-two', sha256: styledFrame.sha256,
      ...critic({ verdict: 'improvement', disposition: 'accept' }),
      recognition: {
        subject: 'yes', style: 'yes', evaluator: 'producer',
        visible_features: ['outer silhouette', 'feature wedge', 'retro control panel'],
        lost_features: ['light face mass'],
      },
    });
    recognition = s.recognitionMetrics(42);
    assert.ok(recognition.first_subject_and_style_recognizable_at);
    assert.equal(recognition.recognition_feature_destruction_passes, 1);
    assert.equal(recognition.recognition_features_lost_count, 1);
    assert.deepEqual(recognition.recognition_features_lost, ['light face mass']);
    assert.ok(recognition.recorded_operation_ms >= 0);
    assert.ok(recognition.between_operation_gap_ms >= 0);
    assert.deepEqual(s.statusCompact().documents['42'].recognition_metrics, recognition);
  });
  test('workflow stall counts protocol actions instead of mistaking them for visual progress', () => {
    const s = fresh();
    const before = writeJpeg(path.join(s.directory, 'stall-before.jpg'), 90);
    const after = writeJpeg(path.join(s.directory, 'stall-after.jpg'), 150);
    const record = s.begin(request('meaningful')).record; record.baseline_preview = before;
    s.complete(record, ok); report(s, 'meaningful');
    s.complete(s.begin(request('meaningful-preview', 'photoshop_get_preview')).record, previewResult(after)); report(s, 'meaningful-preview');
    s.verdict({ id: 'meaningful', preview_id: 'meaningful-preview', sha256: after.sha256,
      ...critic({ verdict: 'improvement', disposition: 'accept', target_resolved: 'yes' }) });
    for (let i = 0; i < 8; i++) {
      const id = `housekeeping-${i}`;
      s.complete(s.begin(request(id, 'photoshop_get_state')).record, ok); report(s, id);
    }
    const metrics = s.status().workflow_metrics['42'];
    assert.equal(metrics.workflow_stall, true);
    assert.equal(metrics.external_actions_since_last_meaningful_visual_change >= 8, true);
    assert.throws(() => s.begin(request('after-stall')), /workflow_stall/);
    assert.equal(s.begin({ ...request('after-stall'), replan: 'Stop housekeeping and make one larger value correction with a measurable target' }).replay, false);
  });
  test('decision-loop stall is wall-clock based, prescriptive and advisory', () => {
    const recent = fresh();
    seedClassifiedVisual(recent, 'recent-pass', { ageMs: 10_000 });
    assert.equal(recent.statusCompact().documents['42'].decision_loop_stall, false);
    assert.equal(recent.statusCompact().documents['42'].next_required_action, 'dispatch next meaningful visual pass');

    const stalled = fresh();
    seedClassifiedVisual(stalled, 'old-pass', { ageMs: 120_000 });
    const compact = stalled.statusCompact();
    assert.equal(compact.documents['42'].decision_loop_stall, true);
    assert.equal(compact.documents['42'].visual_cadence.seconds_since_last_visual_verdict >= 90, true);
    assert.match(compact.documents['42'].next_required_action, /decision-loop stall: dispatch next meaningful visual pass/);
    assert.match(stalled.status().next_required_action, /decision-loop stall: dispatch next meaningful visual pass/);
    assert.equal(stalled.begin(request('after-cadence-stall')).replay, false, 'cadence stall must not block the visual pass itself');
  });
  test('decision-loop stall yields to active job, pending verdict, uncertainty and checkpoint barriers', () => {
    const jobStore = fresh();
    seedClassifiedVisual(jobStore, 'job-old-pass', { ageMs: 120_000 });
    const created = createJob(jobStore.directory, { next_operation: request('job-next') }, { text: 'test job' });
    writeJobStarted(created.dir);
    let cadence = jobStore.visualCadenceState(42);
    assert.equal(cadence.decision_loop_stall, false);
    assert.equal(cadence.blockers.active_job, created.jobId);
    assert.match(jobStore.statusCompact().documents['42'].next_required_action, /job-poll/);
    writeJobCompleted(created.dir, 0);

    const verdictStore = fresh();
    seedClassifiedVisual(verdictStore, 'verdict-old-pass', { ageMs: 120_000 });
    atomicJson(verdictStore.file('pending-visual'), {
      ...request('pending-visual'), phase: 'completed', sequence: 2, created_at: new Date().toISOString(), completed_at: new Date().toISOString(), visual: true, report: {},
      preview: { sha256: 'pending-preview-sha', materialized_path: path.join(verdictStore.directory, 'pending-preview.jpg') },
    });
    cadence = verdictStore.visualCadenceState(42);
    assert.equal(cadence.decision_loop_stall, false);
    assert.equal(cadence.blockers.pending_visual_barrier, 'pending-visual');
    assert.match(verdictStore.statusCompact().documents['42'].next_required_action, /inspect\/classify preview/);

    const uncertainStore = fresh();
    seedClassifiedVisual(uncertainStore, 'uncertain-old-pass', { ageMs: 120_000 });
    atomicJson(uncertainStore.file('uncertain-op'), {
      ...request('uncertain-op', 'photoshop_get_state'), phase: 'uncertain', sequence: 2, created_at: new Date().toISOString(), report: {}, visual: false,
    });
    cadence = uncertainStore.visualCadenceState(42);
    assert.equal(cadence.decision_loop_stall, false);
    assert.equal(cadence.blockers.uncertain_operation, 'uncertain-op');
    assert.match(uncertainStore.statusCompact().documents['42'].next_required_action, /reconcile uncertain operation/);

    const checkpointStore = fresh();
    seedClassifiedVisual(checkpointStore, 'checkpoint-old-pass', { ageMs: 360_000 });
    cadence = checkpointStore.visualCadenceState(42);
    assert.equal(cadence.decision_loop_stall, false);
    assert.equal(cadence.blockers.checkpoint_due, true);
    assert.equal(checkpointStore.statusCompact().documents['42'].next_required_action, 'save required checkpoint, then dispatch next meaningful visual pass');
  });
  test('silent stall detects an abandoned pending report even when decision-loop stall is suppressed', () => {
    const s = fresh();
    seedClassifiedVisual(s, 'shadow-pass', { ageMs: 180_000 });
    const at = new Date(Date.now() - 120_000).toISOString();
    atomicJson(s.file('shadow-select'), {
      ...request('shadow-select', 'photoshop_select_layer_by_name', { document_id: 42, name: 'Cast Shadow' }),
      phase: 'completed', sequence: 2, created_at: at, completed_at: at, visual: false,
      operation_receipt: {
        protocol: 'photoshop.guard.operation_receipt.v1', operation_id: 'shadow-select', token: 'shadow-select-token',
        issued_at: at, phase: 'completed', execution: 'completed',
      },
    });
    const cadence = s.visualCadenceState(42);
    const watch = s.continuationWatchState(42);
    assert.equal(cadence.decision_loop_stall, false, 'pending report remains a decision-loop blocker');
    assert.equal(cadence.blockers.pending_report, 'shadow-select');
    assert.equal(watch.silent_stall, true);
    assert.equal(watch.silent_stall_reason, 'awaiting_report');
    assert.equal(watch.phase, 'awaiting_report');
    assert.equal(watch.seconds_since_last_advancement >= 90, true);
    assert.match(watch.next_required_action, /emit\/record report for shadow-select/);
    const compact = s.statusCompact();
    assert.equal(compact.documents['42'].silent_stall, true);
    assert.equal(compact.silent_stalls.length, 1);
    assert.equal(compact.silent_stalls[0].document_id, 42);
  });
  test('silent stall also detects the first unclassified visual pass', () => {
    const s = fresh();
    const at = new Date(Date.now() - 120_000).toISOString();
    atomicJson(s.file('first-visual'), {
      ...request('first-visual'), phase: 'completed', sequence: 1,
      created_at: at, completed_at: at, visual: true,
      operation_receipt: {
        protocol: 'photoshop.guard.operation_receipt.v1', operation_id: 'first-visual', token: 'first-visual-token',
        issued_at: at, phase: 'completed', execution: 'completed',
      },
    });
    const watch = s.continuationWatchState(42);
    assert.equal(watch.active_visual_workflow, true);
    assert.equal(watch.silent_stall, true);
    assert.equal(watch.silent_stall_reason, 'awaiting_report');
  });
  test('read-only diagnostic churn does not reset silent-stall advancement time', () => {
    const s = fresh();
    seedClassifiedVisual(s, 'old-art-pass', { ageMs: 180_000 });
    const stalledAt = new Date(Date.now() - 120_000).toISOString();
    atomicJson(s.file('prep-step'), {
      ...request('prep-step', 'photoshop_select_layer_by_name', { document_id: 42, name: 'Cast Shadow' }),
      phase: 'completed', sequence: 2, created_at: stalledAt, completed_at: stalledAt, visual: false,
      operation_receipt: {
        protocol: 'photoshop.guard.operation_receipt.v1', operation_id: 'prep-step', token: 'prep-token',
        issued_at: stalledAt, phase: 'completed', execution: 'completed',
      },
    });
    const recent = new Date(Date.now() - 5_000).toISOString();
    atomicJson(s.file('diagnostic-state'), {
      ...request('diagnostic-state', 'photoshop_get_state'), phase: 'completed', sequence: 3,
      created_at: recent, completed_at: recent, visual: false,
      report: { did: 'Read state', why: 'Diagnostic read', result: 'State captured', recorded_at: recent },
      operation_receipt: {
        protocol: 'photoshop.guard.operation_receipt.v1', operation_id: 'diagnostic-state', token: 'diagnostic-token',
        issued_at: recent, phase: 'completed', execution: 'completed',
      },
      operation_ack: {
        protocol: 'photoshop.guard.operation_ack.v1', receipt_protocol: 'photoshop.guard.operation_receipt.v1',
        receipt_token: 'diagnostic-token', acknowledged_at: recent,
      },
    });
    const watch = s.continuationWatchState(42);
    assert.equal(watch.silent_stall, true);
    assert.equal(watch.seconds_since_last_advancement >= 90, true, 'read-only churn must not refresh advancement time');
    assert.equal(watch.silent_stall_reason, 'awaiting_report');
  });
  test('active durable job suppresses silent stall until the job finishes', () => {
    const s = fresh();
    seedClassifiedVisual(s, 'job-watch-pass', { ageMs: 120_000 });
    const created = createJob(s.directory, { next_operation: request('job-watch-next') }, { text: 'test job' });
    writeJobStarted(created.dir);
    const watch = s.continuationWatchState(42);
    assert.equal(watch.phase, 'active_job');
    assert.equal(watch.silent_stall, false);
    writeJobCompleted(created.dir, 0);
  });
  test('non-visual and completed visual workflows do not create false cadence stalls', () => {
    const nonVisual = fresh();
    atomicJson(nonVisual.file('old-state'), {
      ...request('old-state', 'photoshop_get_state'), phase: 'completed', sequence: 1,
      created_at: new Date(Date.now() - 120_000).toISOString(), completed_at: new Date(Date.now() - 120_000).toISOString(), report: {}, visual: false,
    });
    assert.equal(nonVisual.visualCadenceState(42).decision_loop_stall, false);

    const resolved = fresh();
    seedClassifiedVisual(resolved, 'resolved-pass', { ageMs: 120_000, targetResolved: 'yes' });
    resolved.updatePaintingState(42, current => ({ ...current, current_stage: undefined }));
    assert.equal(resolved.visualCadenceState(42).active_visual_workflow, false);
    assert.equal(resolved.statusCompact().documents['42'].decision_loop_stall, false);
    assert.equal(resolved.statusCompact().documents['42'].silent_stall, false);
  });
  test('resume summary uses prescriptive checkpoint and cadence continuation wording', () => {
    const stalled = fresh();
    seedClassifiedVisual(stalled, 'resume-old-pass', { ageMs: 120_000 });
    const stalledResume = stalled.resume(42);
    assert.match(stalledResume.next_required_action, /decision-loop stall/);
    assert.match(stalledResume.resume_summary.text, /Следом: decision-loop stall: dispatch next meaningful visual pass/);

    const checkpoint = fresh();
    seedClassifiedVisual(checkpoint, 'resume-checkpoint-pass', { ageMs: 360_000 });
    const checkpointResume = checkpoint.resume(42);
    assert.equal(checkpointResume.next_required_action, 'save required checkpoint, then dispatch next meaningful visual pass');
    assert.match(checkpointResume.resume_summary.text, /save required checkpoint, then dispatch next meaningful visual pass/);
  });
  test('Guard operation receipt blocks continuation until the exact token is acknowledged', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ps-session-guard-ack-')); dirs.push(dir);
    const s = new SessionStore(dir);
    s.complete(s.begin(request('read-one', 'photoshop_get_state')).record, ok);
    s.report({ id: 'read-one', did: 'Read the Photoshop state', why: 'Verify the Guard acknowledgement gate', result: 'A controller result and receipt were recorded' });
    const receipt = s.read('read-one').operation_receipt;
    assert.equal(receipt.protocol, 'photoshop.guard.operation_receipt.v1');
    assert.throws(() => s.begin(request('read-two', 'photoshop_get_state')), /Guard operation acknowledgement/);
    assert.throws(() => s.ackOperation({ id: 'read-one', token: 'wrong-token' }), /does not match/);
    s.ackOperation({ id: 'read-one', token: receipt.token });
    assert.equal(s.begin(request('read-two', 'photoshop_get_state')).replay, false);
  });
  test('one shared durable visual barrier spans standalone mutation, preview and verdict', () => {
    const s = fresh();
    const mutation = s.begin(request('standalone')).record;
    s.markDispatched(mutation);
    assert.equal(s.visualBarrier(42)?.planId, 'standalone');
    assert.equal(s.visualBarrier(42)?.requiresExternalPreview, true);
    s.complete(mutation, ok); report(s, 'standalone');
    const after = writeJpeg(path.join(s.directory, 'standalone-after.jpg'), 140);
    const preview = s.begin(request('standalone-preview', 'photoshop_get_preview')).record;
    s.complete(preview, previewResult(after)); report(s, 'standalone-preview');
    assert.equal(s.visualBarrier(42)?.sha256, after.sha256);
    assert.equal(s.visualBarrier(42)?.requiresExternalPreview, false);
    s.verdict({ id: 'standalone', preview_id: 'standalone-preview', sha256: after.sha256, ...critic() });
    assert.equal(s.visualBarrier(42), undefined);
  });
  test('classified journal self-heals a stale legacy server barrier before the next visual operation', () => {
    const s = fresh();
    atomicJson(s.file('classified'), {
      ...request('classified', 'photoshop_execute_visual_microplan', { document_id: 42, plan_id: 'old-plan' }),
      phase: 'completed', created_at: new Date(Date.now() - 1000).toISOString(), visual: true,
      verdict: { verdict: 'neutral', disposition: 'correct', target_resolved: 'no' }, report: {},
    });
    s.setVisualBarrier(42, { planId: 'old-plan', sha256: 'stale-sha', requiresExternalPreview: false });
    assert.equal(s.visualBarrier(42)?.planId, 'old-plan');
    const next = s.begin({ ...request('next'), replan: 'Use a different value structure after the classified prior attempt' });
    assert.equal(next.replay, false);
    assert.equal(s.visualBarrier(42), undefined);
  });
  test('compact status and resume expose only canonical continuation state', () => {
    const s = fresh();
    const record = s.begin(request('compact-read', 'photoshop_get_state')).record;
    s.complete(record, ok); report(s, 'compact-read');
    const compact = s.statusCompact();
    assert.equal(compact.next_required_action, 'ready');
    assert.equal(compact.documents['42'].document_id, 42);
    assert.equal(Object.prototype.hasOwnProperty.call(compact, 'recent'), false);
    const resume = s.resume(42);
    assert.equal(resume.document_id, 42);
    assert.equal(resume.canonical_next_command, 'node scripts/photoshop-session.mjs cycle-auto -');
    assert.equal(resume.last_operation.id, 'compact-read');
    assert.equal(resume.resume_summary.operation_id, 'compact-read');
    assert.equal(resume.resume_summary.now, record.summary);
    assert.match(resume.resume_summary.text, /^Сейчас: /);
    assert.match(resume.resume_summary.text, /\nПочему: /);
    assert.match(resume.resume_summary.text, /\nPhotoshop: /);
    assert.match(resume.resume_summary.text, /\nСледом: /);
    assert.equal(JSON.stringify(compact).length < 5000, true);
    assert.equal(JSON.stringify(resume).length < 5000, true);
  });
  console.log(`SESSION_CONTROLLER_TEST_OK ${count} checks; no Photoshop or browser used`);
} finally { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); }
