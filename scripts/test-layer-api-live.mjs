import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: {
    ...process.env,
    ...(process.env.PHOTOSHOP_PATH ? { PHOTOSHOP_PATH: process.env.PHOTOSHOP_PATH } : {}),
  },
});

const client = new Client({ name: 'layer-api-live-smoke', version: '1.0.0' });
let tempDocumentId;

function textOf(result) {
  return result?.content?.find((item) => item.type === 'text')?.text ?? '';
}

function parseStructured(result, label) {
  const text = textOf(result);
  if (!text) throw new Error(`${label}: missing text result`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label}: expected structured JSON, got: ${text}`);
  }
  if (result.isError || parsed.ok === false) {
    throw new Error(`${label}: ${text}`);
  }
  return parsed;
}

function parseCustomScriptResult(result, label) {
  const text = textOf(result);
  if (result.isError) throw new Error(`${label}: ${text}`);
  const marker = 'Result: ';
  const index = text.indexOf(marker);
  if (index < 0) return text;
  const raw = text.slice(index + marker.length).trim();
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function detail(parsed, key) {
  return parsed?.details?.[key];
}

async function call(name, args = {}) {
  return client.callTool({ name, arguments: args });
}

async function layers() {
  const result = await call('photoshop_get_layers', { document_id: tempDocumentId });
  const parsed = parseStructured(result, 'photoshop_get_layers');
  const list = detail(parsed, 'layers');
  if (!Array.isArray(list)) throw new Error('photoshop_get_layers: details.layers missing');
  return list;
}

function layerByName(list, name) {
  const found = list.find((layer) => layer.name === name);
  if (!found) throw new Error(`Layer not found in get_layers result: ${name}`);
  return found;
}

function nestedOrder(list) {
  return list
    .filter((layer) => typeof layer.path === 'string' && layer.path.startsWith('MCP_LIVE_GROUP/'))
    .filter((layer) => layer.depth === 1)
    .map((layer) => layer.name);
}

async function selectByName(name) {
  const result = await call('photoshop_select_layer_by_name', {
    document_id: tempDocumentId,
    name,
  });
  return parseStructured(result, `select ${name}`);
}

try {
  await client.connect(transport);

  const createDoc = await call('photoshop_create_document', {
    width: 320,
    height: 240,
    resolution: 72,
    colorMode: 'RGB',
  });
  if (createDoc.isError) throw new Error(`create document failed: ${textOf(createDoc)}`);

  const docsResult = await call('photoshop_list_documents', {});
  const docs = parseStructured(docsResult, 'photoshop_list_documents');
  tempDocumentId = detail(docs, 'active_document_id');
  if (typeof tempDocumentId !== 'number') throw new Error('Temporary document id not found');

  const setup = await call('photoshop_execute_script', {
    document_id: tempDocumentId,
    code: `
      var doc = app.activeDocument;
      var group = doc.layerSets.add();
      group.name = 'MCP_LIVE_GROUP';
      var a = group.artLayers.add(); a.name = 'Nested A';
      var b = group.artLayers.add(); b.name = 'Nested B';
      var c = group.artLayers.add(); c.name = 'Nested C';
      var topA = doc.artLayers.add(); topA.name = 'Top A';
      var topB = doc.artLayers.add(); topB.name = 'Top B';
      doc.activeLayer = b;
      return { ok: true };
    `,
  });
  parseCustomScriptResult(setup, 'setup');

  let list = await layers();
  const nestedA = layerByName(list, 'Nested A');
  const nestedB = layerByName(list, 'Nested B');
  const nestedC = layerByName(list, 'Nested C');
  for (const layer of [nestedA, nestedB, nestedC]) {
    if (typeof layer.id !== 'number') throw new Error(`${layer.name}: numeric id missing`);
    if (layer.depth !== 1) throw new Error(`${layer.name}: expected depth=1, got ${layer.depth}`);
    if (layer.path !== `MCP_LIVE_GROUP/${layer.name}`) {
      throw new Error(`${layer.name}: unexpected path ${layer.path}`);
    }
  }

  const createLayer = await call('photoshop_create_layer', {
    document_id: tempDocumentId,
    name: 'Structured Create',
  });
  const created = parseStructured(createLayer, 'photoshop_create_layer');
  if (typeof detail(created, 'layerId') !== 'number') {
    throw new Error('photoshop_create_layer: details.layerId missing');
  }

  await selectByName('Nested B');
  const moveBottom = await call('photoshop_move_layer_to_bottom', { document_id: tempDocumentId });
  parseStructured(moveBottom, 'move nested B to bottom');
  list = await layers();
  let order = nestedOrder(list);
  if (order.at(-1) !== 'Nested B') {
    throw new Error(`move-to-bottom escaped/failed within group: ${order.join(' > ')}`);
  }

  const moveTop = await call('photoshop_move_layer_to_top', { document_id: tempDocumentId });
  parseStructured(moveTop, 'move nested B to top');
  list = await layers();
  order = nestedOrder(list);
  if (order[0] !== 'Nested B') {
    throw new Error(`move-to-top escaped/failed within group: ${order.join(' > ')}`);
  }

  const targetA = layerByName(list, 'Nested A');
  const moveById = await call('photoshop_move_layer_to_position', {
    document_id: tempDocumentId,
    position: 'BELOW',
    targetLayerId: targetA.id,
  });
  const movedById = parseStructured(moveById, 'move nested B below A by id');
  if (detail(movedById, 'relativeToId') !== targetA.id) {
    throw new Error('move_layer_to_position did not report the requested targetLayerId');
  }
  list = await layers();
  order = nestedOrder(list);
  const indexA = order.indexOf('Nested A');
  const indexB = order.indexOf('Nested B');
  if (indexA < 0 || indexB !== indexA + 1) {
    throw new Error(`id-based BELOW failed: ${order.join(' > ')}`);
  }

  const moveUp = await call('photoshop_move_layer_up', { document_id: tempDocumentId });
  parseStructured(moveUp, 'move nested B up');
  list = await layers();
  order = nestedOrder(list);
  if (order.indexOf('Nested B') >= order.indexOf('Nested A')) {
    throw new Error(`move-up failed inside group: ${order.join(' > ')}`);
  }

  const moveDown = await call('photoshop_move_layer_down', { document_id: tempDocumentId });
  parseStructured(moveDown, 'move nested B down');
  list = await layers();
  order = nestedOrder(list);
  if (order.indexOf('Nested B') <= order.indexOf('Nested A')) {
    throw new Error(`move-down failed inside group: ${order.join(' > ')}`);
  }

  console.log('LAYER_API_LIVE_TEST_OK');
} finally {
  if (typeof tempDocumentId === 'number') {
    try {
      await call('photoshop_set_active_document', { document_id: tempDocumentId });
      await call('photoshop_close_document', { document_id: tempDocumentId, save: false });
    } catch (error) {
      console.error(`WARNING: failed to close temporary document ${tempDocumentId}: ${error}`);
    }
  }
  await client.close().catch(() => {});
}
