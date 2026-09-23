// HISTORICAL LEGACY DAEMON LIVE UTILITY — not a maintained acceptance command.
// Do not use for canonical compact-v2 acceptance.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PersistentMcpClient } from './lib/mcp-daemon-client.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const runtimeDirectory = path.join(root, '.photoshop-runtime', 'controller');
const client = new PersistentMcpClient({ root, runtimeDirectory });
let documentId;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function bodyOf(result, label, allowError = false) {
  const texts = result?.content?.filter((item) => item.type === 'text').map((item) => item.text) ?? [];
  for (const text of texts) {
    try {
      const body = JSON.parse(text);
      if (!allowError && (result.isError || body.ok === false)) throw new Error(`${label}: ${text}`);
      return body;
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  if (!allowError && result?.isError) throw new Error(`${label}: ${texts.join(' | ')}`);
  return { ok: true, text: texts.join(' | ') };
}

async function call(name, args = {}) {
  return client.callTool({ name, arguments: args });
}

async function assertProtectedStillActive() {
  const state = bodyOf(await call('photoshop_get_state', { document_id: documentId }), 'read restored state');
  assert(state.activeLayer?.name === 'Protected Feature',
    `active layer was not restored after pinned mutation: ${state.activeLayer?.name}`);
}

try {
  await client.ensureDaemon();
  bodyOf(await call('photoshop_create_document', {
    width: 320,
    height: 240,
    resolution: 72,
    colorMode: 'RGB',
  }), 'create document');
  const docs = bodyOf(await call('photoshop_list_documents'), 'list documents');
  documentId = docs.details?.active_document_id;
  assert(Number.isInteger(documentId), 'temporary document id missing');

  const protectedCreated = bodyOf(await call('photoshop_create_layer', {
    document_id: documentId,
    name: 'Protected Feature',
  }), 'create protected layer');
  const protectedLayerId = protectedCreated.details?.layerId;
  assert(Number.isInteger(protectedLayerId), 'protected layer id missing');

  const workCreated = bodyOf(await call('photoshop_create_layer', {
    document_id: documentId,
    name: 'Work Layer',
  }), 'create work layer');
  const workLayerId = workCreated.details?.layerId;
  assert(Number.isInteger(workLayerId), 'work layer id missing');

  bodyOf(await call('photoshop_select_layer_by_name', {
    document_id: documentId,
    name: 'Protected Feature',
  }), 'select protected layer');

  const painted = bodyOf(await call('photoshop_paint_dabs', {
    document_id: documentId,
    layer_id: workLayerId,
    dabs: [
      { x: 80, y: 80, size: 24, color: { red: 20, green: 40, blue: 60 } },
      { x: 120, y: 120, size: 24, color: { red: 20, green: 40, blue: 60 } },
    ],
  }), 'paint pinned work layer');
  assert(painted.details?.layer_id === workLayerId,
    `paint_dabs reported layer_id=${painted.details?.layer_id}, expected ${workLayerId}`);
  await assertProtectedStillActive();

  const stroked = bodyOf(await call('photoshop_paint_strokes', {
    document_id: documentId,
    layer_id: workLayerId,
    batch_mode: 'SINGLE_HISTORY',
    strokes: [{
      tool: 'BRUSH',
      size: 12,
      points: [{ x: 30, y: 180 }, { x: 180, y: 180 }],
    }],
  }), 'paint pinned work layer stroke');
  assert(stroked.details?.layer_id === workLayerId,
    `paint_strokes reported layer_id=${stroked.details?.layer_id}, expected ${workLayerId}`);
  await assertProtectedStillActive();

  const filled = bodyOf(await call('photoshop_fill_layer', {
    document_id: documentId,
    layer_id: workLayerId,
    red: 220,
    green: 225,
    blue: 230,
  }), 'fill pinned work layer');
  assert(filled.details?.layerId === workLayerId,
    `fill_layer reported layerId=${filled.details?.layerId}, expected ${workLayerId}`);
  await assertProtectedStillActive();

  const regions = bodyOf(await call('photoshop_paint_regions', {
    document_id: documentId,
    regions: [{
      id: 'safe-region',
      layer_id: workLayerId,
      color: { red: 30, green: 50, blue: 70 },
      contours: [{
        points: [{ x: 200, y: 30 }, { x: 280, y: 30 }, { x: 280, y: 90 }, { x: 200, y: 90 }],
      }],
    }],
  }), 'paint pinned work layer region');
  assert(regions.details?.painted_regions?.[0]?.layer_id === workLayerId,
    `paint_regions reported layer_id=${regions.details?.painted_regions?.[0]?.layer_id}, expected ${workLayerId}`);
  await assertProtectedStillActive();

  const blocked = bodyOf(await call('photoshop_execute_visual_microplan', {
    plan_id: 'protected-layer-live-block',
    summary: 'Prove protected target is rejected before dispatch',
    stage: 'MEDIUM_FORM',
    scale: 'medium',
    region: 'protected feature',
    action_class: 'REFINE',
    expected_visual_result: 'No mutation should start because the declared target is protected.',
    protected_layer_ids: [protectedLayerId],
    document_id: documentId,
    steps: [
      {
        id: 'paint',
        tool: 'photoshop_paint_dabs',
        args: { layer_id: protectedLayerId, dabs: [{ x: 40, y: 40, size: 20 }] },
      },
      {
        id: 'preview',
        tool: 'photoshop_get_preview',
        args: { max_dimension_px: 400 },
      },
    ],
  }), 'protected VisualMicroPlan rejection', true);
  assert(blocked.ok === false && blocked.code === 'protected_layer_violation',
    `expected protected_layer_violation, got ${JSON.stringify(blocked)}`);
  assert(blocked.visual_mutation_started === false, 'protected-layer rejection must occur before visual mutation dispatch');
  await assertProtectedStillActive();

  console.log(JSON.stringify({ document_id: documentId, protected_layer_id: protectedLayerId, work_layer_id: workLayerId }, null, 2));
  console.log('PROTECTED_LAYER_LIVE_TEST_OK');
} finally {
  if (Number.isInteger(documentId)) {
    await call('photoshop_close_document', { document_id: documentId, save: false }).catch(() => undefined);
  }
  await client.close().catch(() => undefined);
}
