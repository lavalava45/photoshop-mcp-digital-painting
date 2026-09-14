import { createPaintingTools } from '../dist/tools/painting-tools.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseToolJson(result) {
  const text = result?.content?.find((item) => item.type === 'text')?.text;
  assert(text, 'Tool result has no text content');
  return JSON.parse(text);
}

function recordingConnection() {
  const scripts = [];
  return {
    scripts,
    getPhotoshopInfo() {
      return { version: '2026', path: 'offline-test', isRunning: true };
    },
    async executeScript(script) {
      scripts.push(script);
      return '({ok:true,stroke_count:1,layer_name:"Batch Regression"})';
    },
  };
}

function paintHandler(connection) {
  const definition = createPaintingTools(connection).find((def) => def.tool.name === 'photoshop_paint_strokes');
  assert(definition, 'photoshop_paint_strokes definition missing');
  assert(definition.tool.inputSchema?.properties?.batch_mode, 'paint schema must expose batch_mode');
  const strokeSchema = definition.tool.inputSchema?.properties?.strokes?.items;
  assert(strokeSchema?.properties?.dynamics, 'paint stroke schema must expose dynamics');
  return definition.handler;
}

const mixed = Array.from({ length: 12 }, (_, i) => ({
  points: [{ x: 20, y: 20 + i * 5 }, { x: 180, y: 20 + i * 5 }],
  tool: 'BRUSH',
  size: 10 + i,
  opacity: 60 + i,
}));

{
  const connection = recordingConnection();
  const handler = paintHandler(connection);
  const result = parseToolJson(await handler({ strokes: mixed, batch_mode: 'AUTO' }));
  assert(result.ok === true, 'AUTO batch should succeed');
  assert(result.details?.stroke_count === 12, 'input stroke count should remain 12');
  assert(result.details?.render_stroke_count === 12, 'render stroke count should remain 12 without dynamics');
  assert(result.details?.batch_count === 3, `expected 3 AUTO batches, got ${result.details?.batch_count}`);
  assert(result.details?.history_steps === 3, 'AUTO chunk history step count should match batches');
  assert(result.details?.auto_chunked === true, 'AUTO mixed batch should report auto_chunked=true');
  assert(connection.scripts.length === 3, `expected 3 Photoshop script calls, got ${connection.scripts.length}`);
  assert(connection.scripts[0].includes('var brushCache = __paint_createBrushCache();'), 'paint script should cache Photoshop tool descriptors once per batch');
  assert(connection.scripts[0].includes('if (brushChanged) __paint_applyBrushCache(brushCache);'), 'paint script should avoid redundant descriptor reads and brush writes');
}

{
  const connection = recordingConnection();
  const handler = paintHandler(connection);
  const result = parseToolJson(await handler({ strokes: mixed, batch_mode: 'SINGLE_HISTORY' }));
  assert(result.ok === true, 'SINGLE_HISTORY batch should succeed');
  assert(result.details?.batch_count === 1, 'SINGLE_HISTORY must execute one batch');
  assert(result.details?.history_steps === 1, 'SINGLE_HISTORY must report one history step');
  assert(result.details?.auto_chunked === false, 'SINGLE_HISTORY must not report auto chunking');
  assert(connection.scripts.length === 1, 'SINGLE_HISTORY should issue one Photoshop script');
}

{
  const connection = recordingConnection();
  const handler = paintHandler(connection);
  const result = parseToolJson(await handler({
    strokes: [{
      tool: 'BRUSH',
      points: [
        { x: 20, y: 100, right: [80, 20], smooth: true },
        { x: 220, y: 100, left: [160, 180], smooth: true },
      ],
      dynamics: {
        size: [30, 4],
        opacity: [90, 20],
        flow: [70, 30],
        steps: 8,
        easing: 'EASE_OUT',
      },
    }],
  }));
  assert(result.ok === true, 'dynamic stroke should succeed');
  assert(result.details?.stroke_count === 1, 'dynamic input count should remain one semantic stroke');
  assert(result.details?.render_stroke_count === 8, '8-step dynamics should expand to 8 render strokes');
  assert(result.details?.dynamic_stroke_count === 1, 'dynamic stroke count should be one');
  assert(result.details?.batch_count === 2, `expected dynamic stroke to use 2 safe batches, got ${result.details?.batch_count}`);
}

{
  const connection = recordingConnection();
  const handler = paintHandler(connection);
  const result = await handler({
    strokes: [{
      points: [{ x: 20, y: 20 }, { x: 100, y: 20 }],
      closed: true,
      dynamics: { size: [20, 5] },
    }],
  });
  const parsed = parseToolJson(result);
  assert(result.isError === true, 'closed dynamic stroke must be rejected');
  assert(parsed.message?.includes('closed strokes'), 'closed dynamics error should explain the limitation');
  assert(connection.scripts.length === 0, 'invalid dynamics must fail before Photoshop execution');
}

console.log('PAINTING_BATCHING_TEST_OK');
