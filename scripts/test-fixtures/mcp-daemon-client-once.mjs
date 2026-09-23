// HISTORICAL LEGACY DAEMON FIXTURE HELPER — not part of maintained acceptance.
import { PersistentMcpClient } from '../lib/mcp-daemon-client.mjs';

const [root, runtimeDirectory, mode = 'list', value = ''] = process.argv.slice(2);
if (!root || !runtimeDirectory) throw new Error('root and runtimeDirectory are required');

const client = new PersistentMcpClient({ root, runtimeDirectory, startTimeoutMs: 5_000 });
const started = performance.now();
let payload;
if (mode === 'list') payload = await client.listTools({}, { timeout: 5_000 });
else if (mode === 'echo') payload = await client.callTool({ name: 'fixture_echo', arguments: { value } }, undefined, { timeout: 5_000 });
else if (mode === 'disconnect') {
  try {
    await client.callTool({ name: 'fixture_disconnect', arguments: {} }, undefined, { timeout: 3_000 });
    payload = { unexpectedly_succeeded: true };
  } catch (error) {
    payload = { rejected: true, message: error instanceof Error ? error.message : String(error) };
  }
} else throw new Error(`Unknown mode ${mode}`);

console.log(JSON.stringify({ elapsed_ms: performance.now() - started, server_info: client.serverInfo, payload }));
