#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'dist', 'cos-plugin.js')],
  cwd: root,
  env: { ...process.env, LOG_LEVEL: '3' },
  stderr: 'pipe',
});
const client = new Client({ name: 'embedded-guard-mcp-acceptance', version: '1.0.0' });

function textBody(result) {
  const item = result.content?.find?.((entry) => entry.type === 'text' && typeof entry.text === 'string');
  assert.ok(item?.text, 'tool result must contain text JSON');
  return JSON.parse(item.text);
}

try {
  await client.connect(transport);

  const { tools } = await client.listTools();
  const guardTools = tools.filter((tool) => tool.name.startsWith('photoshop_guard_'));
  const exposureBytes = tools.reduce((total, tool) => total + Buffer.byteLength(JSON.stringify(tool)), 0);

  assert.equal(tools.length, 145, 'runtime catalog must expose the complete 145-tool surface');
  assert.equal(guardTools.length, 15, 'runtime catalog must expose all 15 embedded Guard tools');
  assert.ok(exposureBytes <= 250_000, `CoS schema budget exceeded: ${exposureBytes} > 250000`);

  const capabilities = textBody(await client.callTool({
    name: 'photoshop_guard_capabilities',
    arguments: {},
  }));
  assert.equal(capabilities.embedded, true);
  assert.equal(capabilities.mode, 'required');
  assert.equal(capabilities.raw_mutation_bypass_blocked, true);

  // Use an impossible document id on purpose. In required mode the public gate
  // must reject the raw mutation before any Photoshop/document validation runs.
  const blockedResult = await client.callTool({
    name: 'photoshop_fill_layer',
    arguments: { red: 1, green: 2, blue: 3, document_id: 2_147_483_647 },
  });
  const blocked = textBody(blockedResult);
  assert.equal(blockedResult.isError, true);
  assert.equal(blocked.code, 'guard_required');

  console.log(JSON.stringify({
    ok: true,
    tools: tools.length,
    guard_tools: guardTools.length,
    exposure_bytes: exposureBytes,
    cos_budget_bytes: 250_000,
    remaining_bytes: 250_000 - exposureBytes,
    raw_mutation_gate: blocked.code,
  }, null, 2));
  console.log('EMBEDDED_GUARD_MCP_ACCEPTANCE_OK; no Photoshop mutation executed');
} finally {
  await client.close().catch(() => undefined);
}
