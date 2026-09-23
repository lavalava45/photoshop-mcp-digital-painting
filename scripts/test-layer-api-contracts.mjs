import { ExtendScriptSnippets } from '../dist/api/extendscript.js';
import { createLayerTools } from '../dist/tools/layer-tools.js';
import { createLayerPropertiesTools } from '../dist/tools/layer-properties-tools.js';
import { createLayerOrderingTools } from '../dist/tools/layer-ordering-tools.js';
import { ExtendScriptPhotoshopBackend, PhotoshopBackendRouter } from '../dist/platform/photoshop-backend.js';

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

function legacyOnlyRouter(connection) {
  return new PhotoshopBackendRouter(connection, [new ExtendScriptPhotoshopBackend(connection)]);
}

function toolText(result) {
  return result?.content?.find((item) => item.type === 'text')?.text ?? '';
}

const layerListScript = ExtendScriptSnippets.getLayerNames();
assert(layerListScript.includes('function __mcp_findLayerById'), 'Layer list must include shared recursive id lookup helper');
assert(layerListScript.includes('path: __mcp_layerPath(layer)'), 'Layer list must expose stable layer paths');
assert(layerListScript.includes('entry.id = layer.id'), 'Layer list must expose layer ids when Photoshop provides them');
assert(layerListScript.includes('collectLayers(layer, depth + 1)'), 'Layer listing must recurse into groups');

const selectScript = ExtendScriptSnippets.selectLayerByName('Nested Target');
assert(selectScript.includes('__mcp_findLayerByName(doc, targetName)'), 'Layer selection must use recursive shared lookup');

const fillPinnedScript = ExtendScriptSnippets.fillLayer(10, 20, 30, 4242);
assert(fillPinnedScript.includes('requestedLayerId = 4242'), 'Fill-layer script must carry explicit stable target layer id');
assert(fillPinnedScript.includes('__mcp_findLayerById(doc, requestedLayerId)'), 'Fill-layer pinning must resolve the target recursively by id');
assert(fillPinnedScript.includes('doc.activeLayer = originalActive'), 'Fill-layer pinning must restore the previously active layer');

const createAboveScript = ExtendScriptSnippets.newLayer('Placed Layer', { aboveLayerId: 4242 });
assert(createAboveScript.includes('requestedAboveId = 4242'), 'Create-layer script must carry explicit above-layer id');
assert(createAboveScript.includes('__mcp_findLayerById(doc, requestedAboveId)'), 'Create-layer placement must resolve stable layer ids recursively');
assert(createAboveScript.includes('ElementPlacement.PLACEBEFORE'), 'Create-layer ABOVE placement must be explicit');
assert(createAboveScript.includes('actualIndex'), 'Create-layer result must report verified stack position');

const deletePinnedScript = ExtendScriptSnippets.deleteLayer(4242);
assert(deletePinnedScript.includes('requestedLayerId = 4242'), 'Delete-layer script must carry exact stable target id');
assert(deletePinnedScript.includes('__mcp_findLayerById(doc, requestedLayerId)'), 'Delete-layer must resolve exact stable target id');
assert(deletePinnedScript.includes('activeLayerRestored'), 'Delete-layer must report active-layer restoration behavior');

const mergePinnedScript = ExtendScriptSnippets.mergeLayerDown(77, 55);
assert(mergePinnedScript.includes('sourceId = 77'), 'Merge-layer-down must carry exact source id');
assert(mergePinnedScript.includes('targetId = 55'), 'Merge-layer-down must carry exact target id');
assert(mergePinnedScript.includes('targetIndex !== sourceIndex + 1'), 'Merge-layer-down must require immediately-below sibling');
assert(mergePinnedScript.includes('source.merge()'), 'Merge-layer-down must merge only the validated source into the validated sibling');

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

const orderingSchemaConnection = queuedConnection([]);
const orderingDefinitions = createLayerOrderingTools(
  orderingSchemaConnection,
  legacyOnlyRouter(orderingSchemaConnection)
);
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
  '({created:true,layerName:"Regression Layer",layerId:77,path:"Group/Regression Layer",requestedPlacement:"ABOVE",actualIndex:1,aboveLayerId:11,belowLayerId:22,relativeToId:22,relativeToPath:"Group/Target",context:{hasDocument:true}})',
  '({layerCount:1,layers:[{name:"Regression Layer",id:77,path:"Group/Regression Layer",depth:1}],context:{hasDocument:true}})',
]);
const layerDefinitions = createLayerTools(layerConnection, legacyOnlyRouter(layerConnection));
const createDefinition = layerDefinitions.find((def) => def.tool.name === 'photoshop_create_layer');
const deleteDefinition = layerDefinitions.find((def) => def.tool.name === 'photoshop_delete_layer');
const mergeDefinition = layerDefinitions.find((def) => def.tool.name === 'photoshop_merge_layer_down');
const fillDefinition = layerDefinitions.find((def) => def.tool.name === 'photoshop_fill_layer');
const listDefinition = layerDefinitions.find((def) => def.tool.name === 'photoshop_get_layers');
assert(createDefinition && deleteDefinition && mergeDefinition && fillDefinition && listDefinition, 'Layer tool definitions missing');
assert(createDefinition.tool.inputSchema?.properties?.above_layer_id, 'Create-layer schema must expose above_layer_id');
assert(createDefinition.tool.inputSchema?.properties?.below_layer_id, 'Create-layer schema must expose below_layer_id');
assert(deleteDefinition.tool.inputSchema?.properties?.layer_id, 'Delete-layer schema must expose stable layer_id discard target');
assert(mergeDefinition.tool.inputSchema?.properties?.layer_id, 'Merge-layer-down schema must expose stable source layer_id');
assert(mergeDefinition.tool.inputSchema?.properties?.target_layer_id, 'Merge-layer-down schema must expose stable merge target');
assert(fillDefinition.tool.inputSchema?.properties?.layer_id, 'Fill-layer schema must expose stable layer_id pinning');

const created = parseToolJson(await createDefinition.handler({ name: 'Regression Layer', above_layer_id: 22 }));
assert(created.details?.layerId === 77, 'Create-layer envelope must preserve returned layerId');
assert(created.details?.layerName === 'Regression Layer', 'Create-layer envelope must preserve returned layerName');
assert(created.details?.actualIndex === 1, 'Create-layer envelope must preserve actual stack index');
assert(created.details?.relativeToId === 22, 'Create-layer envelope must preserve relative target id');
assert(created.details?.aboveLayerId === 11 && created.details?.belowLayerId === 22, 'Create-layer envelope must preserve adjacent layer ids');

const invalidCreate = await createDefinition.handler({ name: 'Bad Placement', above_layer_id: 11, below_layer_id: 22 });
const invalidCreateText = invalidCreate.content?.find((item) => item.type === 'text')?.text;
const invalidCreateParsed = JSON.parse(invalidCreateText);
assert(invalidCreate.isError === true, 'Create-layer must reject competing placement anchors');
assert(invalidCreateParsed.code === 'invalid_arguments', 'Create-layer placement conflict must use invalid_arguments code');

const listed = parseToolJson(await listDefinition.handler({}));
assert(listed.details?.layers?.[0]?.id === 77, 'Get-layers envelope must preserve layer ids');
assert(listed.details?.layers?.[0]?.path === 'Group/Regression Layer', 'Get-layers envelope must preserve layer path');

const discardConnection = queuedConnection([
  '({deleted:true,layerName:"Temporary Hypothesis",layerId:77,path:"Temporary Hypothesis",requestedLayerId:77,originalActiveLayerId:11,activeLayerRestored:true,context:{hasDocument:true}})',
]);
const discardTool = createLayerTools(discardConnection, legacyOnlyRouter(discardConnection)).find((def) => def.tool.name === 'photoshop_delete_layer');
assert(discardTool, 'photoshop_delete_layer missing for discard contract');
const discarded = parseToolJson(await discardTool.handler({ layer_id: 77 }));
assert(discarded.details?.layerId === 77, 'Discard must report the exact deleted logical layer id');
assert(discarded.details?.activeLayerRestored === true, 'Discard must preserve an unrelated previously active layer when possible');

const mergeConnection = queuedConnection([
  '({merged:true,sourceLayerId:77,sourceLayerName:"Cheek volume",targetLayerId:55,targetLayerName:"Face base",mergedLayerId:55,mergedLayerName:"Face base",originalActiveLayerId:11,context:{hasDocument:true}})',
]);
const mergeTool = createLayerTools(mergeConnection).find((def) => def.tool.name === 'photoshop_merge_layer_down');
assert(mergeTool, 'photoshop_merge_layer_down missing');
const mergedLogical = parseToolJson(await mergeTool.handler({ layer_id: 77, target_layer_id: 55 }));
assert(mergedLogical.details?.sourceLayerId === 77 && mergedLogical.details?.targetLayerId === 55,
  'Merge must preserve exact logical source/target ids');

const invalidMerge = await mergeTool.handler({ layer_id: 77, target_layer_id: 77 });
const invalidMergeText = invalidMerge.content?.find((item) => item.type === 'text')?.text;
const invalidMergeParsed = JSON.parse(invalidMergeText);
assert(invalidMerge.isError === true, 'Merge must reject identical source/target ids');
assert(invalidMergeParsed.code === 'invalid_arguments', 'Invalid merge boundary must use invalid_arguments');

const moveConnection = queuedConnection([
  '({moved:true,layerName:"Mover",layerId:12,position:"ABOVE",relativeTo:"Target",relativeToId:77,relativeToPath:"Group/Target",context:{hasDocument:true}})',
]);
const moveTools = createLayerOrderingTools(moveConnection, legacyOnlyRouter(moveConnection));
const moveHandler = moveTools.find((def) => def.tool.name === 'photoshop_move_layer_to_position')?.handler;
assert(moveHandler, 'Move handler missing');
const moved = parseToolJson(await moveHandler({ position: 'ABOVE', targetLayerId: 77 }));
assert(moved.details?.relativeToId === 77, 'Move envelope must preserve relative target id');

const invalid = await moveHandler({ position: 'BELOW' });
const invalidText = invalid.content?.find((item) => item.type === 'text')?.text;
const invalidParsed = JSON.parse(invalidText);
assert(invalid.isError === true, 'Missing relative target must be an MCP error');
assert(invalidParsed.code === 'invalid_arguments', 'Missing relative target must use invalid_arguments code');

const propertiesConnection = queuedConnection([
  '({updated:true,property:"opacity",value:42,layerName:"Base"})',
  '({updated:true,property:"blendMode",value:"BlendMode.MULTIPLY",layerName:"Base"})',
  '({visible:false,name:"Base"})',
  '({locked:true,name:"Base"})',
  { oldName: 'Base', newName: 'Renamed' },
  { originalName: 'Renamed', newName: 'Copy', activated: true, newLayerId: 88 },
]);
const propertyTools = createLayerPropertiesTools(
  propertiesConnection,
  legacyOnlyRouter(propertiesConnection)
);
const propertyTool = (name) => {
  const definition = propertyTools.find((def) => def.tool.name === name);
  assert(definition, `${name} definition missing`);
  return definition;
};
assert(
  toolText(await propertyTool('photoshop_set_layer_opacity').handler({ opacity: 42 })) === 'Layer opacity set to 42%',
  'Opacity public success text must remain unchanged'
);
assert(
  toolText(await propertyTool('photoshop_set_layer_blend_mode').handler({ blendMode: 'MULTIPLY' })) === 'Layer blend mode set to MULTIPLY',
  'Blend-mode public success text must remain unchanged'
);
assert(
  toolText(await propertyTool('photoshop_set_layer_visibility').handler({ visible: false })) === 'Layer hidden',
  'Visibility public success text must remain unchanged'
);
assert(
  toolText(await propertyTool('photoshop_set_layer_locked').handler({ locked: true })) === 'Layer locked',
  'Lock public success text must remain unchanged'
);
assert(
  toolText(await propertyTool('photoshop_rename_layer').handler({ name: 'Renamed' })) ===
    'Layer renamed to: Renamed\nResult: {"oldName":"Base","newName":"Renamed"}',
  'Rename public success text/result must remain unchanged'
);
assert(
  toolText(await propertyTool('photoshop_duplicate_layer').handler({ newName: 'Copy' })) ===
    'Layer duplicated\nResult: {"originalName":"Renamed","newName":"Copy","activated":true,"newLayerId":88}',
  'Duplicate public success text/result must remain unchanged'
);

console.log('LAYER_API_CONTRACT_TEST_OK');
