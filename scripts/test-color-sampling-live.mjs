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
const client = new Client({ name: 'color-sampling-live-test', version: '0.1.0' });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseResult(result) {
  for (const item of result.content ?? []) {
    if (item.type !== 'text') continue;
    try { return JSON.parse(item.text); } catch {}
  }
  return null;
}

async function call(name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result)}`);
  return { result, body: parseResult(result) };
}

async function activeId() {
  const { body } = await call('photoshop_list_documents');
  return body?.details?.active_document_id;
}

function closeTo(actual, expected, tolerance = 3) {
  return Math.abs(Number(actual) - expected) <= tolerance;
}

function assertColor(sampleBody, expected, label) {
  const rgb = sampleBody?.details?.rgb_8bit;
  assert(rgb, `${label}: missing rgb_8bit`);
  assert(closeTo(rgb.red, expected.red), `${label}: red ${rgb.red} != ${expected.red}`);
  assert(closeTo(rgb.green, expected.green), `${label}: green ${rgb.green} != ${expected.green}`);
  assert(closeTo(rgb.blue, expected.blue), `${label}: blue ${rgb.blue} != ${expected.blue}`);
}

let docA;
let docB;
try {
  await client.connect(transport);

  await call('photoshop_create_document', { width: 120, height: 100, resolution: 72, colorMode: 'RGB' });
  docA = await activeId();
  await call('photoshop_fill_layer', { document_id: docA, red: 200, green: 50, blue: 25 });

  await call('photoshop_create_document', { width: 120, height: 100, resolution: 72, colorMode: 'RGB' });
  docB = await activeId();
  await call('photoshop_fill_layer', { document_id: docB, red: 20, green: 80, blue: 220 });

  assert((await activeId()) === docB, 'Document B should be active before pinned sampling');

  const point = await call('photoshop_sample_color', {
    document_id: docA,
    x: 60,
    y: 50,
    radius: 0,
  });
  assert(point.body?.document_target?.id === docA, 'Point sample should report pinned document A');
  assert(point.body?.details?.mode === 'POINT', 'Point sample should report POINT mode');
  assertColor(point.body, { red: 200, green: 50, blue: 25 }, 'point sample');

  const average = await call('photoshop_sample_color', {
    document_id: docA,
    x: 60,
    y: 50,
    radius: 12,
  });
  assert(average.body?.document_target?.id === docA, 'Average sample should report pinned document A');
  assert(average.body?.details?.mode === 'AVERAGE', 'Average sample should report AVERAGE mode');
  assert(average.body?.details?.bounds?.width === 25, 'radius 12 should produce 25px sample width away from edges');
  assertColor(average.body, { red: 200, green: 50, blue: 25 }, 'average sample');

  const blue = await call('photoshop_sample_color', {
    document_id: docB,
    x: 30,
    y: 30,
  });
  assertColor(blue.body, { red: 20, green: 80, blue: 220 }, 'document B sample');

  const outOfBounds = await client.callTool({
    name: 'photoshop_sample_color',
    arguments: { document_id: docA, x: 999, y: 50 },
  });
  assert(outOfBounds.isError === true, 'Out-of-bounds sample should fail');

  console.log(JSON.stringify({ point: point.body?.details, average: average.body?.details }, null, 2));
  console.log('COLOR_SAMPLING_LIVE_TEST_OK');
} finally {
  try {
    if (docA) await client.callTool({ name: 'photoshop_close_document', arguments: { document_id: docA, save: false } });
  } catch {}
  try {
    if (docB) await client.callTool({ name: 'photoshop_close_document', arguments: { document_id: docB, save: false } });
  } catch {}
  await client.close().catch(() => undefined);
}

