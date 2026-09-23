// HISTORICAL LEGACY DAEMON TRANSPORT FIXTURE — not part of maintained acceptance.
// Daemon PID reuse/startup latency are retired-provider properties, not compact-native invariants.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PersistentMcpClient } from './lib/mcp-daemon-client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeDirectory = mkdtempSync(path.join(tmpdir(), 'ps-mcp-daemon-test-'));
const client = new PersistentMcpClient({ root, runtimeDirectory, startTimeoutMs: 5_000 });
const fixtureServer = path.join(root, 'scripts', 'test-fixtures', 'mcp-fixture-server.mjs');
const fixtureClient = path.join(root, 'scripts', 'test-fixtures', 'mcp-daemon-client-once.mjs');
const fixtureLog = path.join(runtimeDirectory, 'fixture.ndjson');

process.env.PHOTOSHOP_MCP_SERVER_ENTRY = fixtureServer;
process.env.PHOTOSHOP_MCP_FIXTURE_LOG = fixtureLog;

function runExternal(mode, value = '') {
  const result = spawnSync(process.execPath, [fixtureClient, root, runtimeDirectory, mode, value], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
    env: {
      ...process.env,
      PHOTOSHOP_MCP_SERVER_ENTRY: fixtureServer,
      PHOTOSHOP_MCP_FIXTURE_LOG: fixtureLog,
    },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, `fixture client failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim());
}

function logRows() {
  try { return readFileSync(fixtureLog, 'utf8').trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  catch { return []; }
}

try {
  const first = await client.status();
  const second = await client.status();
  assert.equal(first.server_info.pid, second.server_info.pid, 'two controller processes must reuse one daemon pid');
  assert.equal(first.server_info.mcp_ready, false, 'daemon ping must not cold-start Photoshop MCP');
  assert.equal(second.server_info.mcp_ready, false);

  // Real stdio MCP child lifecycle across independent controller processes.
  const cold = runExternal('list');
  const warm = runExternal('echo', 'second-controller');
  const rows = logRows();
  const starts = rows.filter(row => row.event === 'start');
  const echo = JSON.parse(warm.payload.content[0].text);
  assert.equal(starts.length, 1, 'warm controller must reuse the same MCP child instead of starting another');
  assert.equal(echo.pid, starts[0].pid, 'tool call must reach the original persistent MCP child');
  assert.ok(cold.elapsed_ms < 7_000, `cold daemon+MCP startup exceeded 7000ms: ${cold.elapsed_ms.toFixed(1)}ms`);
  assert.ok(warm.elapsed_ms < 1_000, `warm daemon+MCP call exceeded 1000ms: ${warm.elapsed_ms.toFixed(1)}ms`);

  // A lost mutation-capable response is never replayed by the client/daemon.
  const disconnected = runExternal('disconnect');
  assert.equal(disconnected.payload.rejected, true);
  const afterDisconnect = logRows().filter(row => row.event === 'call_tool' && row.name === 'fixture_disconnect');
  assert.equal(afterDisconnect.length, 1, 'ambiguous call_tool must be attempted exactly once');

  // Next safe discovery establishes a fresh MCP child after the broken transport.
  const recovered = runExternal('list');
  const recoveredStarts = logRows().filter(row => row.event === 'start');
  assert.equal(recoveredStarts.length, 2, 'safe discovery after transport loss should create one fresh MCP child');
  assert.notEqual(recoveredStarts[0].pid, recoveredStarts[1].pid);
  assert.ok(recovered.elapsed_ms < 7_000, `recovery cold-start exceeded 7000ms: ${recovered.elapsed_ms.toFixed(1)}ms`);

  const stopped = await client.shutdown();
  assert.equal(stopped.shutting_down, true);
  console.log(`MCP_DAEMON_TEST_OK daemon=${first.server_info.pid}; mcp_child=${starts[0].pid}; cold=${cold.elapsed_ms.toFixed(1)}ms warm=${warm.elapsed_ms.toFixed(1)}ms; no replay after disconnect`);
} finally {
  delete process.env.PHOTOSHOP_MCP_SERVER_ENTRY;
  delete process.env.PHOTOSHOP_MCP_FIXTURE_LOG;
  rmSync(runtimeDirectory, { recursive: true, force: true });
}
