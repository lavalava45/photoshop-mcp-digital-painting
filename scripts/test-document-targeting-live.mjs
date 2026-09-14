import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, 'dist', 'index.js')],
  cwd: root,
  env: { ...process.env, ANALYTICS_DISABLED: '1' },
  stderr: 'inherit',
});
const client = new Client({ name: 'document-targeting-live-test', version: '0.1.0' });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseResult(result) {
  for (const item of result.content ?? []) {
    if (item.type !== 'text') continue;
    try {
      return JSON.parse(item.text);
    } catch {
      // continue
    }
  }
  return null;
}

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`${name} failed: ${JSON.stringify(result)}`);
  }
  return { result, body: parseResult(result) };
}

async function activeId() {
  const { body } = await call('photoshop_list_documents');
  return body?.details?.active_document_id;
}

async function layerNames(documentId) {
  const { body } = await call('photoshop_get_layers', { document_id: documentId });
  return (body?.details?.layers ?? []).map((layer) => layer.name);
}

async function guideCount(documentId) {
  const { body } = await call('photoshop_list_guides', { document_id: documentId });
  return body?.details?.guide_count ?? 0;
}

let docA;
let docB;
try {
  await client.connect(transport);

  await call('photoshop_create_document', { width: 320, height: 240, resolution: 72, colorMode: 'RGB' });
  docA = await activeId();
  assert(Number.isInteger(docA), 'Failed to capture temporary document A id');

  await call('photoshop_create_document', { width: 360, height: 260, resolution: 72, colorMode: 'RGB' });
  docB = await activeId();
  assert(Number.isInteger(docB) && docB !== docA, 'Failed to capture distinct temporary document B id');
  assert((await activeId()) === docB, 'Document B should be active before pinned mutation');

  const created = await call('photoshop_create_layer', {
    document_id: docA,
    name: 'PINNED_TO_A',
  });
  assert(created.body?.document_target?.id === docA, 'Mutation result should report pinned document A');
  assert((await layerNames(docA)).includes('PINNED_TO_A'), 'Pinned layer should exist in document A');
  assert(!(await layerNames(docB)).includes('PINNED_TO_A'), 'Pinned layer must not leak into document B');

  await call('photoshop_set_active_document', { document_id: docB });
  const beforeA = await guideCount(docA);
  const beforeB = await guideCount(docB);
  const guides = await call('photoshop_add_guides', {
    document_id: docA,
    guides: [{ orientation: 'VERTICAL', position: 123 }],
  });
  assert(guides.body?.document_target?.id === docA, 'Guide mutation should report pinned document A');
  assert((await guideCount(docA)) === beforeA + 1, 'Guide should be added to document A');
  assert((await guideCount(docB)) === beforeB, 'Document B guide count should remain unchanged');

  await call('photoshop_set_active_document', { document_id: docB });
  const closedA = await call('photoshop_close_document', { document_id: docA, save: false });
  assert(closedA.body?.document_target?.id === docA, 'Close result should report pinned document A');
  const afterClose = await call('photoshop_list_documents');
  const ids = (afterClose.body?.details?.documents ?? []).map((doc) => doc.id);
  assert(!ids.includes(docA), 'Pinned close should close document A');
  assert(ids.includes(docB), 'Pinned close must leave document B open');
  docA = undefined;

  console.log(JSON.stringify({ document_a: 'closed', document_b: docB }, null, 2));
  console.log('DOCUMENT_TARGETING_LIVE_TEST_OK');
} finally {
  try {
    if (docA) await client.callTool({ name: 'photoshop_close_document', arguments: { document_id: docA, save: false } });
  } catch {}
  try {
    if (docB) await client.callTool({ name: 'photoshop_close_document', arguments: { document_id: docB, save: false } });
  } catch {}
  await client.close().catch(() => undefined);
}
