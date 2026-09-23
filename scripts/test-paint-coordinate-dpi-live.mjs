// HISTORICAL LEGACY DAEMON LIVE UTILITY — not a maintained acceptance command.
// Do not use for canonical compact-v2 acceptance.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PersistentMcpClient } from './lib/mcp-daemon-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const runtimeDirectory = path.join(root, '.photoshop-runtime', 'controller');
const client = new PersistentMcpClient({ root, runtimeDirectory });

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

async function measureAtDpi(resolution) {
  await call('photoshop_create_document', {
    width: 480,
    height: 320,
    resolution,
    colorMode: 'RGB',
  });
  const documentId = await activeId();
  assert(Number.isInteger(documentId), `No document id at ${resolution} dpi`);
  try {
    await call('photoshop_create_layer', { document_id: documentId, name: `DPI_${resolution}` });
    await call('photoshop_set_brush', {
      document_id: documentId,
      size: 12,
      hardness: 100,
      opacity: 100,
      flow: 100,
      smoothing_enabled: false,
      use_pressure_size: false,
      use_pressure_opacity: false,
    });
    await call('photoshop_paint_strokes', {
      document_id: documentId,
      strokes: [{
        tool: 'BRUSH',
        simulate_pressure: false,
        size: 12,
        opacity: 100,
        flow: 100,
        points: [
          { x: 100, y: 140 },
          { x: 220, y: 140 },
        ],
      }],
      batch_mode: 'SINGLE_HISTORY',
    });
    const { body: state } = await call('photoshop_get_state', { document_id: documentId });
    const bounds = state?.activeLayer?.bounds;
    assert(bounds && Number.isFinite(bounds.left) && Number.isFinite(bounds.right), `No active-layer bounds at ${resolution} dpi`);
    return { resolution, bounds };
  } finally {
    await call('photoshop_close_document', { document_id: documentId, save: false }).catch(() => undefined);
  }
}

try {
  await client.ensureDaemon();
  const results = [];
  for (const dpi of [72, 144, 300]) results.push(await measureAtDpi(dpi));
  console.log(JSON.stringify(results, null, 2));
  const reference = results[0].bounds;
  for (const item of results.slice(1)) {
    for (const key of ['left', 'top', 'right', 'bottom']) {
      const delta = Math.abs(item.bounds[key] - reference[key]);
      assert(delta <= 2, `DPI coordinate drift at ${item.resolution} dpi for ${key}: ${item.bounds[key]} vs ${reference[key]}`);
    }
  }
  console.log('PAINT_COORDINATE_DPI_LIVE_TEST_OK');
} finally {
  await client.close().catch(() => undefined);
}
