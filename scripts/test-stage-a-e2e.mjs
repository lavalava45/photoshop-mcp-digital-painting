// HISTORICAL LEGACY CONTROLLER FIXTURE — not part of maintained acceptance.
// Native interruption/barrier/recovery coverage is maintained by embedded Guard Vitest suites.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { SessionStore, atomicJson } from './lib/photoshop-session-store.mjs';
import { executeLogicalOperation } from './lib/photoshop-cycle.mjs';

const roots = [];
function fresh(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'ps-stage-a-e2e-'));
  roots.push(dir);
  return new SessionStore(dir, { visualBarrierDirectory: path.join(dir, 'barriers'), ...options });
}

function writeJpeg(file, value, width = 64, height = 64) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
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

function visualRequest(id, tool = 'photoshop_set_layer_opacity', extras = {}) {
  return {
    id,
    tool,
    args: { document_id: 42, ...(extras.args ?? {}) },
    summary: extras.summary ?? 'Refine the test form',
    purpose: extras.purpose ?? 'Resolve the active visual problem',
    problem_id: extras.problem_id ?? 'test-form',
    ...(extras.replan ? { replan: extras.replan } : {}),
  };
}

function reportPayload(result = 'The materialized preview is ready for visual classification') {
  return {
    did: 'Completed the visual operation and captured its preview',
    why: 'Resolve the active visual problem with a reviewable result',
    result,
  };
}

function ackOperation(store, id) {
  const receipt = store.read(id)?.operation_receipt;
  assert.ok(receipt?.token, `missing Guard receipt for ${id}`);
  return store.ackOperation({ id, token: receipt.token });
}

function neutralVerdict(overrides = {}) {
  return {
    observed_change: 'The target region changed visibly but the visual problem is not fully resolved yet',
    target_resolved: 'no',
    regressions: [],
    uncertainty: 'Further refinement is still required',
    verdict: 'neutral',
    disposition: 'correct',
    global_readability: 'stable',
    primitive_footprint: 'none',
    trend_signals: [],
    ...overrides,
  };
}

function completeMicroplan(store, id, planId, preview) {
  const request = visualRequest(id, 'photoshop_execute_visual_microplan', {
    args: { plan_id: planId },
  });
  const record = store.begin(request).record;
  store.markDispatched(record);
  const completed = store.complete(record, {
    content: [{ type: 'text', text: JSON.stringify({ ok: true, plan_id: planId, document_id: 42, preview }) }],
  });
  // The real VisualMicroPlan server writes this exact shared barrier state after its
  // mandatory final preview. This fixture invokes SessionStore directly, so mirror that
  // server-side write explicitly rather than weakening the production contract.
  store.setVisualBarrier(42, { planId, sha256: preview.sha256, requiresExternalPreview: false });
  return completed;
}

let passed = 0;
function ok(name) {
  passed++;
  console.log(`PASS ${name}`);
}

try {
  // 1 + 2. Host interruption after a completed visual action, then a fresh process resumes it.
  {
    const s = fresh();
    const before = writeJpeg(path.join(s.directory, 'before.jpg'), 80);
    const after = writeJpeg(path.join(s.directory, 'after.jpg'), 145);
    atomicJson(s.paintingStateFile(), {
      version: 1,
      revision: 1,
      documents: { '42': { document_id: 42, current_frame: { operation_id: 'baseline', sha256: before.sha256, path: before.materialized_path, accepted: true } } },
    });
    const record = s.begin(visualRequest('interrupted')).record;
    storeBaseline(record, before);
    s.markDispatched(record);
    s.complete(record, { content: [{ type: 'text', text: '{"ok":true}' }] });
    s.attachPreview('interrupted', previewResult(after));

    // Simulate TURN FAILED / new host process: no in-memory state is reused.
    const resumed = new SessionStore(s.directory, {
      visualBarrierDirectory: s.visualBarrierDirectory,
    });
    const resume = resumed.resume(42);
    assert.deepEqual(resume.pending_reports, ['interrupted']);
    assert.deepEqual(resume.pending_visual_verdicts, ['interrupted']);
    assert.equal(resume.document.visual_barrier.planId, 'interrupted');
    assert.throws(() => resumed.begin(visualRequest('must-not-run')), /Report required|Visual barrier/);

    resumed.closePreviousCycle({
      previous_operation_id: 'interrupted',
      previous_report: reportPayload(),
      previous_operation_ack: { token: resumed.read('interrupted').operation_receipt.token },
      previous_visual_verdict: neutralVerdict(),
    });
    const healed = resumed.resume(42);
    assert.deepEqual(healed.pending_reports, []);
    assert.deepEqual(healed.pending_visual_verdicts, []);
    assert.equal(healed.document.visual_barrier, null);
    assert.equal(healed.next_required_action, 'dispatch next meaningful visual pass');
    ok('host interruption is durable and resume closes exactly the pending cycle');
  }

  // 3. A stale legacy server barrier cannot resurrect an already-classified operation.
  {
    const s = fresh();
    atomicJson(s.file('old-classified'), {
      ...visualRequest('old-classified', 'photoshop_execute_visual_microplan', { args: { plan_id: 'old-plan' } }),
      phase: 'completed',
      created_at: new Date(Date.now() - 10_000).toISOString(),
      sequence: 1,
      visual: true,
      report: { did: 'done', why: 'classified', result: 'already reviewed' },
      verdict: { ...neutralVerdict(), at: new Date(Date.now() - 9_000).toISOString() },
    });
    s.setVisualBarrier(42, { planId: 'old-plan', sha256: 'legacy-stale-sha', requiresExternalPreview: false });
    assert.equal(s.visualBarrier(42)?.planId, 'old-plan');
    const compact = s.statusCompact();
    assert.equal(compact.documents['42'].visual_barrier, null);
    assert.equal(s.visualBarrier(42), undefined);
    assert.equal(s.begin(visualRequest('after-old', 'photoshop_set_layer_opacity', {
      replan: 'Use a fresh standalone correction after the already classified legacy pass',
    })).replay, false);
    ok('legacy stale preview barrier self-heals from classified journal evidence');
  }

  // 4. A standalone edit between two microplans owns the shared barrier and leaves no stale microplan SHA.
  {
    const s = fresh();
    const frameA = writeJpeg(path.join(s.directory, 'frame-a.jpg'), 90);
    const frameB = writeJpeg(path.join(s.directory, 'frame-b.jpg'), 130);
    const frameC = writeJpeg(path.join(s.directory, 'frame-c.jpg'), 150);

    const a = completeMicroplan(s, 'micro-a', 'plan-a', frameA);
    assert.equal(a.preview.sha256, frameA.sha256);
    s.report({ id: 'micro-a', ...reportPayload('Microplan A preview inspected') });
    ackOperation(s, 'micro-a');
    s.verdict({ id: 'micro-a', preview_id: 'micro-a', sha256: frameA.sha256, ...neutralVerdict() });
    assert.equal(s.visualBarrier(42), undefined);

    const calls = [];
    const standalone = await executeLogicalOperation({
      store: s,
      input: visualRequest('standalone-b'),
      materializeArguments: (_tool, args) => structuredClone(args ?? {}),
      invoke: async (name) => {
        calls.push(name);
        return name === 'photoshop_get_preview'
          ? previewResult(frameB)
          : { content: [{ type: 'text', text: '{"ok":true}' }] };
      },
    });
    assert.deepEqual(calls, ['photoshop_set_layer_opacity', 'photoshop_get_preview']);
    assert.equal(standalone.record.preview.sha256, frameB.sha256);
    s.report({ id: 'standalone-b', ...reportPayload('Standalone edit B preview inspected') });
    ackOperation(s, 'standalone-b');
    s.verdict({ id: 'standalone-b', preview_id: 'standalone-b', sha256: frameB.sha256, ...neutralVerdict() });
    assert.equal(s.visualBarrier(42), undefined);

    const c = completeMicroplan(s, 'micro-c', 'plan-c', frameC);
    assert.equal(c.preview.sha256, frameC.sha256);
    assert.equal(s.visualBarrier(42)?.planId, 'plan-c');
    assert.equal(s.visualBarrier(42)?.sha256, frameC.sha256);
    ok('standalone edit between microplans replaces barrier ownership without resurrecting plan-a');
  }

  console.log(`STAGE_A_E2E_OK ${passed}/3 scenarios; interruption, Guard receipt resume, legacy barrier and standalone-between-microplans covered`);
} finally {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true });
}

function storeBaseline(record, preview) {
  record.baseline_preview = preview;
}
