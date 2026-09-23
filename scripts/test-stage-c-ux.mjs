// HISTORICAL LEGACY CONTROLLER/CLI FIXTURE — not part of maintained acceptance.
// Native durable-job start/poll/resume and bounded async recovery are covered by embedded Guard.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionStore, atomicJson } from './lib/photoshop-session-store.mjs';
import {
  createJob,
  readJob,
  writeJobCompleted,
  writeJobStarted,
} from './lib/async-job.mjs';
import { operationNarrative, shouldUseAsyncJob } from './lib/operation-narrative.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), 'ps-stage-c-'));
const runtime = path.join(temp, 'controller');

function parseCli(result) {
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, null);
  const text = result.stdout.trim();
  assert.ok(text, `CLI produced no JSON; stderr=${result.stderr}`);
  return JSON.parse(text);
}

function run(args, env = {}) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'photoshop-session.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, PHOTOSHOP_CONTROLLER_RUNTIME_DIR: runtime, ...env },
    windowsHide: true,
  });
}

try {
  const operation = {
    id: 'face-form-001',
    tool: 'photoshop_execute_visual_microplan',
    summary: 'корректирую форму лица',
    purpose: 'глаза читаются как символы',
    problem_id: 'face-symbolic-eyes',
    timeout_ms: 60_000,
    args: {
      document_id: 42,
      steps: [
        { id: 'before', tool: 'photoshop_get_preview', args: { focus_region: { left: 10, top: 10, right: 100, bottom: 100 } } },
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: Array.from({ length: 40 }, (_, i) => ({ x: i, y: i })) } },
        { id: 'after', tool: 'photoshop_get_preview', args: { focus_region: { left: 10, top: 10, right: 100, bottom: 100 } } },
      ],
    },
  };
  const narrative = operationNarrative(operation, 'running');
  const slowMicroplanHistory = Array.from({ length: 3 }, (_, i) => ({
    tool: 'photoshop_execute_visual_microplan',
    phase: 'completed',
    created_at: `2026-09-16T12:00:0${i}.000Z`,
    completed_at: `2026-09-16T12:00:1${i}.000Z`,
  }));
  assert.equal(shouldUseAsyncJob(operation), true);
  const smallDabs = structuredClone(operation);
  smallDabs.id = 'small-dabs';
  smallDabs.args.steps[1].args.dabs = Array.from({ length: 24 }, (_, i) => ({ x: i, y: i }));
  assert.equal(shouldUseAsyncJob(smallDabs, slowMicroplanHistory), false, 'slow history must not force a small dab plan async');
  const smallStrokes = structuredClone(operation);
  smallStrokes.id = 'small-strokes';
  smallStrokes.args.steps[1] = {
    id: 'paint', tool: 'photoshop_paint_strokes',
    args: { strokes: Array.from({ length: 4 }, (_, i) => ({ points: [[i, i], [i + 1, i + 1]] })) },
  };
  assert.equal(shouldUseAsyncJob(smallStrokes, slowMicroplanHistory), false, 'slow history must not force a small stroke plan async');
  const smallRegions = structuredClone(operation);
  smallRegions.id = 'small-regions';
  smallRegions.args.steps[1] = {
    id: 'paint', tool: 'photoshop_paint_regions',
    args: { regions: Array.from({ length: 8 }, (_, i) => ({ id: `r${i}` })) },
  };
  assert.equal(shouldUseAsyncJob(smallRegions, slowMicroplanHistory), false, 'slow history must not force a small region block-in async');
  assert.equal(shouldUseAsyncJob(operation, slowMicroplanHistory), true, 'genuinely large current plan remains async with slow history');
  assert.equal(shouldUseAsyncJob(operation, []), true, 'genuinely large current plan remains async without history');
  assert.equal(shouldUseAsyncJob({ ...operation, timeout_ms: 10_000 }, slowMicroplanHistory), false, 'timeout <=10s remains synchronous');
  assert.equal(shouldUseAsyncJob({ ...operation, tool: 'photoshop_custom_slow_read' }, [
    { tool: 'photoshop_custom_slow_read', phase: 'completed', created_at: '2026-09-16T12:00:00.000Z', completed_at: '2026-09-16T12:00:08.000Z' },
  ]), true);
  assert.equal(narrative.now, 'корректирую форму лица');
  assert.equal(narrative.why, 'глаза читаются как символы');
  assert.equal(narrative.photoshop, 'mutation выполняется');
  assert.match(narrative.next, /локальный before\/after preview/);

  // Durable running-job state and resume summary without a Photoshop process.
  mkdirSync(runtime, { recursive: true });
  const store = new SessionStore(runtime, { visualBarrierDirectory: path.join(temp, 'preview-barriers') });
  const baseline = store.begin({
    id: 'baseline-read', tool: 'photoshop_get_state', args: { document_id: 42 },
    summary: 'читаю состояние документа', purpose: 'зафиксировать исходный контекст перед продолжением',
  }).record;
  store.complete(baseline, { content: [{ type: 'text', text: '{"ok":true}' }] });
  store.report({
    id: 'baseline-read',
    did: 'прочитал исходное состояние документа',
    why: 'зафиксировать контекст перед проверкой resume',
    result: 'состояние сохранено как безопасная read-only исходная точка',
  });
  store.ackOperation({ id: 'baseline-read', token: store.read('baseline-read').operation_receipt.token });
  const jobInput = { next_operation: operation };
  const created = createJob(runtime, jobInput, operationNarrative(operation, 'starting'));
  writeJobStarted(created.dir);
  const running = readJob(runtime, created.jobId);
  assert.equal(running.state, 'running');
  const compactWhileRunning = store.statusCompact();
  assert.equal(compactWhileRunning.active_jobs[0].job_id, created.jobId);
  assert.equal(compactWhileRunning.next_required_action, `node scripts/photoshop-session.mjs job-poll ${created.jobId}`);
  const resume = store.resume(42);
  assert.equal(resume.active_job.job_id, created.jobId);
  assert.equal(resume.resume_summary.now, operation.summary);
  assert.equal(resume.resume_summary.next, `node scripts/photoshop-session.mjs job-poll ${created.jobId}`);
  assert.equal(resume.canonical_next_command, `node scripts/photoshop-session.mjs job-poll ${created.jobId}`);
  writeJobCompleted(created.dir, 0);

  // Detached CLI lifecycle in an isolated runtime. Empty tool catalog forces a
  // deterministic pre-Photoshop failure, proving start/poll persistence without
  // touching the real application or its controller journal.
  const isolatedRuntime = path.join(temp, 'isolated-controller');
  mkdirSync(isolatedRuntime, { recursive: true });
  atomicJson(path.join(isolatedRuntime, 'tools.json'), { tools: [] });
  const inputFile = path.join(temp, 'cycle.json');
  const detachedInput = {
    next_operation: {
      id: 'detached-long-001',
      tool: 'photoshop_fake_long',
      args: { document_id: 42 },
      summary: 'корректирую тестовую форму',
      purpose: 'проверить async UX без Photoshop',
      problem_id: 'detached-test',
      timeout_ms: 60_000,
    },
  };
  writeFileSync(inputFile, JSON.stringify(detachedInput));
  detachedInput.next_operation.tool = 'photoshop_execute_visual_microplan';
  writeFileSync(inputFile, JSON.stringify(detachedInput));
  const startedCli = spawnSync(process.execPath, [path.join(root, 'scripts', 'photoshop-session.mjs'), 'cycle-auto', inputFile], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: { ...process.env, PHOTOSHOP_CONTROLLER_RUNTIME_DIR: isolatedRuntime },
    windowsHide: true,
  });
  const startedEnvelope = parseCli(startedCli);
  assert.match(startedEnvelope.job_id, /^job-/);
  assert.equal(startedEnvelope.progress.protocol, 'operation.progress.v1');
  assert.equal(startedEnvelope.host_progress.protocol, 'cos.host_progress.v1');
  assert.equal(startedEnvelope.guard_capabilities.operation_ack.required, true);
  assert.match(startedEnvelope.host_progress.text, /Сейчас: корректирую тестовую форму/);
  assert.doesNotMatch(startedEnvelope.host_progress.text, /Called Photoshop tool/i);

  let finalEnvelope = startedEnvelope;
  for (let i = 0; i < 50 && !['completed', 'failed', 'uncertain'].includes(finalEnvelope.state); i++) {
    await new Promise(resolve => setTimeout(resolve, 25));
    finalEnvelope = parseCli(spawnSync(process.execPath, [path.join(root, 'scripts', 'photoshop-session.mjs'), 'job-poll', startedEnvelope.job_id], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, PHOTOSHOP_CONTROLLER_RUNTIME_DIR: isolatedRuntime },
      windowsHide: true,
    }));
  }
  assert.equal(finalEnvelope.state, 'failed');
  assert.equal(finalEnvelope.progress.state, 'failed');
  assert.equal(finalEnvelope.host_progress.state, 'failed');
  assert.ok(finalEnvelope.result);

  console.log('STAGE_C_UX_TEST_OK narrative + durable resume job + detached start/poll; no Photoshop used');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
