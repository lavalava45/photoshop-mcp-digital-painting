#!/usr/bin/env node
// One durable entry point for Core. No Plugins dependency and no foreground control.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SessionStore, ROUTE, parseTexts, atomicJson } from './lib/photoshop-session-store.mjs';
import { cycleEnvelope, executeLogicalOperation } from './lib/photoshop-cycle.mjs';
import { hostAckForReport } from './lib/host-report-receipt.mjs';
import { guardCapabilities } from './lib/guard-capabilities.mjs';
import { PersistentMcpClient } from './lib/mcp-daemon-client.mjs';
import {
  createJob,
  jobFiles,
  readJob,
  updateJob,
  waitForJobStart,
  writeJobCompleted,
  writeJobResult,
  writeJobStarted,
} from './lib/async-job.mjs';
import { hostProgressPayload, operationNarrative, progressPayload, shouldUseAsyncJob } from './lib/operation-narrative.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const defaultDirectory = path.join(root, '.photoshop-runtime', 'controller');
const runtimeOverride = process.env.PHOTOSHOP_CONTROLLER_RUNTIME_DIR?.trim();
if (runtimeOverride && !path.isAbsolute(runtimeOverride)) {
  throw new Error('PHOTOSHOP_CONTROLLER_RUNTIME_DIR must be an absolute path');
}
const directory = runtimeOverride ? path.resolve(runtimeOverride) : defaultDirectory;
const store = new SessionStore(directory, {
  visualBarrierDirectory: path.join(path.dirname(directory), 'preview-barriers'),
});
const [requestedCommand = 'status', inputFile] = process.argv.slice(2);
const asyncJobDirectory = process.env.PHOTOSHOP_ASYNC_JOB_DIR?.trim() || '';
let lastOutput;
const output = value => {
  lastOutput = value;
  if (asyncJobDirectory) writeJobResult(asyncJobDirectory, value);
  console.log(JSON.stringify(value, null, 2));
};

async function readInput(spec) {
  if (spec !== '-') return JSON.parse(fs.readFileSync(path.resolve(spec), 'utf8'));
  let text = '';
  for await (const chunk of process.stdin) text += chunk.toString();
  if (!text.trim()) throw new Error('Expected JSON on stdin');
  return JSON.parse(text);
}

async function withClient(fn) {
  const client = new PersistentMcpClient({ root, runtimeDirectory: directory });
  return await fn(client);
}

function asyncEnvelope(input, job, stateOverride) {
  const operation = input.next_operation;
  const state = stateOverride ?? job.state;
  const progressState = state === 'starting' ? 'starting'
    : state === 'running' ? (job.meta?.progress_state ?? 'running')
      : state === 'completed' ? 'completed'
        : state === 'failed' ? 'failed'
          : 'uncertain';
  const narrative = operationNarrative(operation, progressState);
  return {
    route: ROUTE,
    mode: 'photoshop-mcp-async',
    job_id: job.meta?.job_id,
    operation_id: operation?.id ?? null,
    state,
    pid: job.pid ?? null,
    started_at: job.started?.at ?? job.meta?.started_at ?? null,
    completed_at: job.completed?.at ?? null,
    narrative,
    progress: progressPayload(operation, progressState),
    host_progress: hostProgressPayload(operation, progressState),
    guard_capabilities: guardCapabilities(),
    ...(job.result ? { result: job.result } : {}),
    next: state === 'running' || state === 'starting'
      ? `Poll with: node scripts/photoshop-session.mjs job-poll ${job.meta?.job_id}`
      : state === 'completed'
        ? 'Inspect the completed cycle result and its preview/verdict obligations before another visual mutation.'
        : 'Read resume/status-compact and reconcile any dispatched uncertain operation; never replay it blindly.',
  };
}

async function startAsyncCycle(input) {
  if (!input?.next_operation || typeof input.next_operation !== 'object' || Array.isArray(input.next_operation)) {
    throw new Error('async cycle requires next_operation');
  }
  const narrative = operationNarrative(input.next_operation, 'starting');
  const created = createJob(directory, input, narrative);
  const files = jobFiles(created.dir);
  const stdoutFd = fs.openSync(files.stdout, 'a');
  const stderrFd = fs.openSync(files.stderr, 'a');
  let child;
  try {
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'cycle', files.input], {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', stdoutFd, stderrFd],
      env: {
        ...process.env,
        PHOTOSHOP_ASYNC_JOB_DIR: created.dir,
        PHOTOSHOP_ASYNC_OPERATION_ID: String(input.next_operation.id ?? ''),
      },
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  if (!child?.pid) throw new Error('Failed to start async Photoshop controller job');
  child.unref();
  updateJob(created.dir, { state: 'starting', pid: child.pid });
  const started = await waitForJobStart(directory, created.jobId, 2_500);
  return asyncEnvelope(input, started);
}

function pollAsyncJob(jobId) {
  const job = readJob(directory, jobId);
  const input = JSON.parse(fs.readFileSync(job.files.input, 'utf8'));
  return asyncEnvelope(input, job);
}

function materializeArguments(tool, args, id) {
  const result = structuredClone(args ?? {});
  if (tool === 'photoshop_get_preview') {
    result.materialize_path ??= path.join(directory, 'previews', `${id}.jpg`);
    result.include_image = false;
    result.max_dimension_px ??= 1000;
  }
  if (tool === 'photoshop_execute_visual_microplan') {
    result.steps = result.steps?.map(step => step.tool === 'photoshop_get_preview'
      ? { ...step, args: materializeArguments(step.tool, step.args, `${id}-${step.id}`) } : step);
  }
  return result;
}

function receipt(record, replay = false) {
  return {
    route: ROUTE, mode: 'photoshop-mcp', operation_id: record.id, phase: record.phase,
    replayed_from_disk: replay, failed: !!record.failed, record_path: store.file(record.id),
    summary: record.summary, purpose: record.purpose, preview: record.preview,
    operation_receipt: record.operation_receipt ?? null,
    guard_capabilities: guardCapabilities(),
    result: JSON.stringify(parseTexts(record.result)).slice(0, 6000), error: record.error,
    next: 'Emit a distinct assistant report (Что сделал / Зачем / Результат), then record it with report. Tool called is not a report. View the preview before verdict. Do not switch to image_gen or Plugins.',
  };
}

async function main() {
  let command = requestedCommand;
  let preloadedInput;

  if (command === 'job-poll') {
    if (!inputFile) throw new Error('job-poll requires a job_id');
    output(pollAsyncJob(inputFile));
    return;
  }
  if (command === 'cycle-start' || command === 'cycle-auto') {
    if (!inputFile) throw new Error(`${command} requires an absolute JSON request file path, or - for stdin`);
    preloadedInput = await readInput(inputFile);
    const asyncRecommended = shouldUseAsyncJob(preloadedInput?.next_operation, store.records());
    if (command === 'cycle-start' || asyncRecommended) {
      output(await startAsyncCycle(preloadedInput));
      return;
    }
    command = 'cycle';
  }

  if (command === 'status') { output({ ...store.status(), guard_capabilities: guardCapabilities() }); return; }
  if (command === 'status-compact') { output({ ...store.statusCompact(), guard_capabilities: guardCapabilities() }); return; }
  if (command === 'priorities') {
    if (!inputFile) throw new Error('priorities requires an absolute JSON request file path, or - for stdin');
    const input = await readInput(inputFile);
    output({ route: ROUTE, mode: 'photoshop-mcp-priorities', document: store.setPriorityState(input), next: 'Use status-compact/resume; stage_priority_gate now enforces the largest unresolved must-fix scale.' });
    return;
  }
  if (command === 'art-director') {
    if (!inputFile) throw new Error('art-director requires an absolute JSON request file path, or - for stdin');
    const input = await readInput(inputFile);
    output({
      route: ROUTE,
      mode: 'photoshop-mcp-art-director',
      document: store.setArtDirectorState(input),
      next: 'Use status-compact/resume; Painter work must remain bound to the active directive/task until review or interrupt.',
    });
    return;
  }
  if (command === 'resume') {
    const documentId = inputFile === undefined ? undefined : Number(inputFile);
    if (inputFile !== undefined && (!Number.isSafeInteger(documentId) || documentId <= 0)) throw new Error('resume accepts an optional positive document_id');
    const resumed = store.resume(documentId);
    output({
      ...resumed,
      progress: {
        protocol: 'operation.progress.v1',
        progress_id: `photoshop-resume:${resumed.document_id ?? 'session'}`,
        operation_id: resumed.resume_summary?.operation_id ?? null,
        state: resumed.resume_summary?.state ?? 'idle',
        text: resumed.resume_summary?.text ?? 'Photoshop session resumed',
      },
      host_progress: {
        protocol: 'cos.host_progress.v1',
        progress_id: `photoshop-resume:${resumed.document_id ?? 'session'}`,
        operation_id: resumed.resume_summary?.operation_id ?? null,
        state: resumed.resume_summary?.state ?? 'idle',
        text: resumed.resume_summary?.text ?? 'Photoshop session resumed',
      },
      guard_capabilities: guardCapabilities(),
    });
    return;
  }
  if (command === 'daemon-status') {
    const client = new PersistentMcpClient({ root, runtimeDirectory: directory });
    output(await client.status());
    return;
  }
  if (command === 'daemon-stop') {
    const client = new PersistentMcpClient({ root, runtimeDirectory: directory });
    output(await client.shutdown());
    return;
  }
  if (command === 'recover-lock') {
    output({ controller: store.recoverLock(), server: store.recoverLock(path.join(root, '.photoshop-runtime', 'execution.lock')) }); return;
  }
  const release = store.lock();
  if (asyncJobDirectory) {
    writeJobStarted(asyncJobDirectory, {
      command,
      operation_id: process.env.PHOTOSHOP_ASYNC_OPERATION_ID || null,
      progress_state: 'starting',
    });
  }
  try {
    if (command === 'bootstrap') {
      const discovery = await withClient(async client => {
        const result = await client.listTools({}, { timeout: 20_000 });
        atomicJson(path.join(directory, 'tools.json'), result);
        return { tool_count: result.tools.length, catalog_path: path.join(directory, 'tools.json'), server_instructions_received: !!client.getInstructions() };
      });
      output({ ...store.status(), guard_capabilities: guardCapabilities(), direct_stdio_available: true, photoshop_reachability: 'not tested; next call photoshop_get_state', ...discovery,
        guide: path.join(root, 'docs', 'reliable-core-workflow.md'),
        next: 'Report bootstrap result. Then use cycle-auto with JSON on stdin (cycle-auto -). Long work returns job_id for job-poll; the persistent daemon keeps MCP warm. Use status-compact/resume for continuation. No Plugins lookup is needed.' });
      return;
    }
    if (!inputFile) throw new Error('Pass an absolute JSON request file path, or - for stdin');
    const input = preloadedInput ?? await readInput(inputFile);
    if (command === 'ack-report') {
      const record = store.read(input.id);
      const verified = record?.report ? hostAckForReport(record.report) : undefined;
      const ack = verified ?? input;
      output(store.ackReport({ id: input.id, ...ack }, { hostVerified: !!verified }));
      return;
    }
    if (command === 'ack-operation') {
      output(store.ackOperation(input));
      return;
    }
    if (['report', 'verdict', 'reconcile'].includes(command)) { output(store[command](input)); return; }
    if (command === 'cycle') {
      const cycleInput = structuredClone(input);
      const verifiedAck = cycleInput.previous_report ? hostAckForReport(cycleInput.previous_report) : undefined;
      // Host-render evidence is optional and can only come from the host boundary.
      // Never trust a model-authored previous_report_ack supplied in cycle JSON.
      delete cycleInput.previous_report_ack;
      if (verifiedAck) cycleInput.previous_report_ack = verifiedAck;
      const closedPrevious = store.closePreviousCycle(cycleInput, { hostAckVerified: !!verifiedAck });
      if (!cycleInput.next_operation || typeof cycleInput.next_operation !== 'object' || Array.isArray(cycleInput.next_operation)) {
        throw new Error('cycle requires next_operation');
      }
      const nextOperation = cycleInput.next_operation;
      const run = await withClient(async client => {
        const catalog = JSON.parse(fs.readFileSync(path.join(directory, 'tools.json'), 'utf8'));
        const invoke = async (name, args, timeout) => {
          const tool = catalog.tools.find(t => t.name === name);
          if (!tool) throw new Error(`Tool ${name} missing from this fork catalog; run bootstrap to refresh discovery`);
          if (tool.inputSchema.properties?.document_id && name !== 'photoshop_get_state' &&
              (!Number.isSafeInteger(args?.document_id) || args.document_id <= 0)) {
            throw new Error('Pass a positive pinned document_id; get it from photoshop_list_documents first');
          }
          return await client.callTool({ name, arguments: args }, undefined, { timeout });
        };
        const onProgress = asyncJobDirectory
          ? async stage => {
              updateJob(asyncJobDirectory, {
                state: 'running',
                progress_state: stage,
                narrative: operationNarrative(nextOperation, stage),
              });
            }
          : undefined;
        return await executeLogicalOperation({ store, input: nextOperation, invoke, materializeArguments, onProgress });
      });
      output(cycleEnvelope(store, run.record, { replay: run.replay, closed_previous: closedPrevious }));
      if (run.record.failed) process.exitCode = 1;
      return;
    }
    if (command !== 'call') throw new Error('Use bootstrap | daemon-status | daemon-stop | status-compact | resume [document_id] | status | priorities file.json|- | art-director file.json|- | cycle-auto file.json|- | cycle-start file.json|- | job-poll job_id | cycle file.json|- | call file.json|- | report file.json|- | ack-operation file.json|- | ack-report file.json|- | verdict file.json|- | reconcile file.json|- | recover-lock');
    const { record, replay } = store.begin(input);
    if (replay) { output(receipt(record, true)); if (record.failed) process.exitCode = 1; return; }
    // Each call gets an on-disk intent and result. Losing the chat cannot erase them.
    try {
      const result = await withClient(async client => {
        const catalog = JSON.parse(fs.readFileSync(path.join(directory, 'tools.json'), 'utf8'));
        const tool = catalog.tools.find(t => t.name === input.tool);
        if (!tool) throw new Error('Tool missing from this fork catalog; run bootstrap to refresh discovery');
        if (tool.inputSchema.properties?.document_id && input.tool !== 'photoshop_get_state' &&
            (!Number.isSafeInteger(input.args?.document_id) || input.args.document_id <= 0)) throw new Error('Pass a positive pinned document_id; get it from photoshop_list_documents first');
        const args = materializeArguments(input.tool, input.args, input.id);
        const timeout = Number(input.timeout_ms ?? 60_000);
        if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 180_000) throw new Error('timeout_ms must be 1000..180000; split longer work');
        store.markDispatched(record);
        return await client.callTool({ name: input.tool, arguments: args }, undefined, { timeout });
      });
      // Images should be materialized, never dumped as base64 into terminal/chat history.
      for (let i = 0; i < result.content.length; i++) {
        const item = result.content[i];
        if (item.type === 'image') {
          const imagePath = path.join(directory, 'previews', `${input.id}-${i}.${item.mimeType === 'image/png' ? 'png' : 'jpg'}`);
          fs.mkdirSync(path.dirname(imagePath), { recursive: true });
          fs.writeFileSync(imagePath, Buffer.from(item.data, 'base64'));
          result.content[i] = { type: 'text', text: JSON.stringify({ image_path: imagePath, mimeType: item.mimeType }) };
        }
      }
      const completed = store.complete(record, result);
      output(receipt(completed));
      if (completed.failed) process.exitCode = 1;
    } catch (error) {
      output(receipt(store.fail(record, error)));
      process.exitCode = 1;
    }
  } finally { release(); }
}

try {
  await main();
} catch (error) {
  output({ ok: false, route: ROUTE, message: error.message, next: 'Read status-compact/resume. Do not retry a mutation blindly or substitute another image tool.' });
  process.exitCode = 1;
} finally {
  if (asyncJobDirectory) {
    writeJobCompleted(asyncJobDirectory, process.exitCode ?? 0, {
      has_result: lastOutput !== undefined,
    });
  }
}
