import { ExtendScriptSnippets } from '../dist/api/extendscript.js';
import { createLayerTools } from '../dist/tools/layer-tools.js';
import { createLayerOrderingTools } from '../dist/tools/layer-ordering-tools.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseToolJson(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  assert(text, 'Tool result has no text content');
  const parsed = JSON.parse(text);
  assert(parsed.ok === true, `Expected structured success envelope, got: ${text}`);
  return parsed;
}

function queuedConnection(rawResults) {
  const queue = [...rawResults];
  return {
    getPhotoshopInfo() {
      return { version: '2026', path: 'offline-test', isRunning: true };
    },
    async executeScript(script) {
      assert(typeof script === 'string' && script.length > 0, 'Expected wrapped ExtendScript');
      if (queue.length === 0) throw new Error('Offline fake connection ran out of canned results');
      return queue.shift();
    },
  };
}

const layerListScript = ExtendScriptSnippets.getLayerNames();
assert(layerListScript.includes('function __mcp_findLayerById'), 'Layer list must include shared recursive id lookup helper');
assert(layerListScript.includes('path: __mcp_layerPath(layer)'), 'Layer list must expose stable layer paths');
assert(layerListScript.includes('entry.id = layer.id'), 'Layer list must expose layer ids when Photoshop provides them');
assert(layerListScript.includes('collectLayers(layer, depth + 1)'), 'Layer listing must recurse into groups');

const selectScript = ExtendScriptSnippets.selectLayerByName('Nested Target');
assert(selectScript.includes('__mcp_findLayerByName(doc, targetName)'), 'Layer selection must use recursive shared lookup');

const moveByIdScript = ExtendScriptSnippets.moveLayerToPosition(undefined, 'ABOVE', 4242);
assert(moveByIdScript.includes('__mcp_findLayerById(doc, requestedTargetId)'), 'Layer move must support id lookup');
assert(moveByIdScript.includes('__mcp_findLayerByName(doc, requestedTargetName)'), 'Layer move must retain recursive name lookup');
assert(!moveByIdScript.includes('for (var i = 0; i < doc.layers.length; i++) {\n      if (doc.layers[i].name'), 'Layer move must not use the old top-level-only lookup');

for (const [label, script] of [
  ['top', ExtendScriptSnippets.moveLayerToTop()],
  ['bottom', ExtendScriptSnippets.moveLayerToBottom()],
  ['up', ExtendScriptSnippets.moveLayerUp()],
  ['down', ExtendScriptSnippets.moveLayerDown()],
]) {
  assert(script.includes('layer.parent.layers'), `Move-${label} must operate within the active layer parent stack`);
}

const orderingDefinitions = createLayerOrderingTools(queuedConnection([]));
const moveDefinition = orderingDefinitions.find((def) => def.tool.name === 'photoshop_move_layer_to_position');
assert(moveDefinition, 'photoshop_move_layer_to_position definition missing');
assert(moveDefinition.tool.inputSchema?.properties?.targetLayerId, 'Move schema must expose targetLayerId');
assert(
  Array.isArray(moveDefinition.tool.inputSchema?.required) &&
    moveDefinition.tool.inputSchema.required.length === 1 &&
    moveDefinition.tool.inputSchema.required[0] === 'position',
  'Move schema should require only position; target is conditional for ABOVE/BELOW'
);

const layerConnection = queuedConnection([
  '({created:true,layerName:"Regression Layer",layerId:77,context:{hasDocument:true}})',
  '({layerCount:1,layers:[{name:"Regression Layer",id:77,path:"Group/Regression Layer",depth:1}],context:{hasDocument:true}})',
]);
const layerDefinitions = createLayerTools(layerConnection);
const createDefinition = layerDefinitions.find((def) => def.tool.name === 'photoshop_create_layer');
const listDefinition = layerDefinitions.find((def) => def.tool.name === 'photoshop_get_layers');
assert(createDefinition && listDefinition, 'Layer tool definitions missing');

const created = parseToolJson(await createDefinition.handler({ name: 'Regression Layer' }));
assert(created.details?.layerId === 77, 'Create-layer envelope must preserve returned layerId');
assert(created.details?.layerName === 'Regression Layer', 'Create-layer envelope must preserve returned layerName');

const listed = parseToolJson(await listDefinition.handler({}));
assert(listed.details?.layers?.[0]?.id === 77, 'Get-layers envelope must preserve layer ids');
assert(listed.details?.layers?.[0]?.path === 'Group/Regression Layer', 'Get-layers envelope must preserve layer path');

const moveConnection = queuedConnection([
  '({moved:true,layerName:"Mover",layerId:12,position:"ABOVE",relativeTo:"Target",relativeToId:77,relativeToPath:"Group/Target",context:{hasDocument:true}})',
]);
const moveTools = createLayerOrderingTools(moveConnection);
const moveHandler = moveTools.find((def) => def.tool.name === 'photoshop_move_layer_to_position')?.handler;
assert(moveHandler, 'Move handler missing');
const moved = parseToolJson(await moveHandler({ position: 'ABOVE', targetLayerId: 77 }));
assert(moved.details?.relativeToId === 77, 'Move envelope must preserve relative target id');

const invalid = await moveHandler({ position: 'BELOW' });
const invalidText = invalid.content?.find((item) => item.type === 'text')?.text;
const invalidParsed = JSON.parse(invalidText);
assert(invalid.isError === true, 'Missing relative target must be an MCP error');
assert(invalidParsed.code === 'invalid_arguments', 'Missing relative target must use invalid_arguments code');

console.log('LAYER_API_CONTRACT_TEST_OK');
