// HISTORICAL LEGACY CONTROLLER/DAEMON FIXTURE — not part of maintained acceptance.
// Required exact-once/restart semantics are maintained on the embedded Guard durable-job path.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicJson } from './lib/photoshop-session-store.mjs';
import { readJob } from './lib/async-job.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(path.join(tmpdir(), 'ps-stage-d-'));
const runtime = path.join(temp, 'controller');
const fixtureServer = path.join(root, 'scripts', 'test-fixtures', 'mcp-fixture-server.mjs');
const fixtureLog = path.join(temp, 'fixture.ndjson');
const sessionCli = path.join(root, 'scripts', 'photoshop-session.mjs');

function env(extra = {}) {
  const base = { ...process.env };
  for (const key of [
    'COS_ASSISTANT_RECEIPT_VERSION', 'COS_ASSISTANT_MESSAGE_ID', 'COS_ASSISTANT_MESSAGE_SHA256',
    'COS_ASSISTANT_TURN_ID', 'COS_ASSISTANT_DELIVERED_AT',
  ]) delete base[key];
  return {
    ...base,
    PHOTOSHOP_CONTROLLER_RUNTIME_DIR: runtime,
    PHOTOSHOP_MCP_SERVER_ENTRY: fixtureServer,
    PHOTOSHOP_MCP_FIXTURE_LOG: fixtureLog,
    ...extra,
  };
}

function cli(args, options = {}) {
  const result = spawnSync(process.execPath, [sessionCli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: options.timeout ?? 10_000,
    windowsHide: true,
    env: env(options.env),
  });
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, null);
  const text = result.stdout.trim();
  assert.ok(text, `CLI returned no JSON; stderr=${result.stderr}`);
  return { status: result.status, body: JSON.parse(text), stderr: result.stderr };
}

function rows() {
  try { return readFileSync(fixtureLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  catch { return []; }
}

try {
  mkdirSync(runtime, { recursive: true });
  atomicJson(path.join(runtime, 'tools.json'), {
    tools: [{
      name: 'photoshop_save_document',
      inputSchema: {
        type: 'object',
        properties: {
          document_id: { type: 'integer' }, path: { type: 'string' }, format: { type: 'string' }, delay_ms: { type: 'integer' },
        },
      },
    }],
  });

  const inputFile = path.join(temp, 'cycle.json');
  writeFileSync(inputFile, JSON.stringify({
    next_operation: {
      id: 'interrupted-save-001',
      tool: 'photoshop_save_document',
      args: { document_id: 42, path: path.join(temp, 'fixture.png'), format: 'PNG', delay_ms: 700 },
      summary: 'сохраняю тестовый результат',
      purpose: 'проверить durable job через потерю host-наблюдения',
      timeout_ms: 10_000,
    },
  }), 'utf8');

  const started = cli(['cycle-start', inputFile]);
  assert.equal(started.status, 0);
  assert.match(started.body.job_id, /^job-/);
  assert.match(started.body.state, /starting|running/);
  const jobId = started.body.job_id;

  // Simulate the host/chat disappearing: no poll, no receipt and no follow-up tool call
  // while the detached controller and persistent MCP child continue on their own.
  const deadline = Date.now() + 5_000;
  let durable = readJob(runtime, jobId);
  while (!['completed', 'failed', 'uncertain'].includes(durable.state) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50));
    durable = readJob(runtime, jobId);
  }
  assert.equal(durable.state, 'completed', `detached job did not finish within acceptance budget; state=${durable.state}`);

  // A completely new controller process, with no COS binding/receipt environment, recovers
  // local durable state instead of starting replacement work.
  const resumed = cli(['resume', '42']);
  assert.equal(resumed.status, 0);
  assert.equal(resumed.body.last_operation.id, 'interrupted-save-001');
  assert.deepEqual(resumed.body.pending_reports, ['interrupted-save-001']);
  assert.match(resumed.body.next_required_action, /report|ready|job-poll/);

  const firstPoll = cli(['job-poll', jobId]);
  assert.equal(firstPoll.status, 0);
  assert.equal(firstPoll.body.state, 'completed');
  assert.equal(firstPoll.body.result.execution.operation_id, 'interrupted-save-001');

  const callsAfterFirstPoll = rows().filter(row => row.event === 'call_tool' && row.name === 'photoshop_save_document');
  assert.equal(callsAfterFirstPoll.length, 1, 'interrupted job must execute exactly once');

  const secondPoll = cli(['job-poll', jobId]);
  assert.equal(secondPoll.body.state, 'completed');
  const callsAfterSecondPoll = rows().filter(row => row.event === 'call_tool' && row.name === 'photoshop_save_document');
  assert.equal(callsAfterSecondPoll.length, 1, 'repeated polls must never replay the operation');

  console.log(`STAGE_D_ACCEPTANCE_OK job=${jobId}; detached operation survived host absence and was observed twice with one MCP call`);
} finally {
  try { cli(['daemon-stop'], { timeout: 3_000 }); } catch {}
  rmSync(temp, { recursive: true, force: true });
}
