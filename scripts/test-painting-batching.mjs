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
  assert(definition.tool.inputSchema?.properties?.layer_id, 'paint strokes schema must expose layer_id pinning');
  const strokeSchema = definition.tool.inputSchema?.properties?.strokes?.items;
  assert(strokeSchema?.properties?.dynamics, 'paint stroke schema must expose dynamics');
  return definition.handler;
}

function dabHandler(connection) {
  const definition = createPaintingTools(connection).find((def) => def.tool.name === 'photoshop_paint_dabs');
  assert(definition, 'photoshop_paint_dabs definition missing');
  assert(definition.tool.inputSchema?.properties?.layer_id, 'paint dabs schema must expose layer_id pinning');
  return definition.handler;
}

function regionHandler(connection) {
  const definition = createPaintingTools(connection).find((def) => def.tool.name === 'photoshop_paint_regions');
  assert(definition, 'photoshop_paint_regions definition missing');
  assert(definition.tool.inputSchema?.properties?.clip_bounds, 'paint regions schema must expose clip_bounds');
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
  assert(connection.scripts[0].includes('72 / Number(doc.resolution || 72)'), 'stroke paths must convert canvas pixels to Photoshop path coordinates using document DPI');
  assert(connection.scripts[0].includes('__paint_canvasPx(src.x)'), 'stroke anchors must pass through the canvas-pixel coordinate conversion');
}

{
  const connection = recordingConnection();
  const handler = paintHandler(connection);
  const result = parseToolJson(await handler({ strokes: mixed, batch_mode: 'SINGLE_HISTORY', layer_id: 77 }));
  assert(result.ok === true, 'SINGLE_HISTORY batch should succeed');
  assert(result.details?.batch_count === 1, 'SINGLE_HISTORY must execute one batch');
  assert(result.details?.history_steps === 1, 'SINGLE_HISTORY must report one history step');
  assert(result.details?.auto_chunked === false, 'SINGLE_HISTORY must not report auto chunking');
  assert(connection.scripts.length === 1, 'SINGLE_HISTORY should issue one Photoshop script');
  assert(connection.scripts[0].includes('var __paint_requestedLayerId = 77;'), 'paint strokes must pin the requested stable layer id');
  assert(connection.scripts[0].includes('doc.activeLayer = __paint_targetLayer;'), 'paint strokes must activate the pinned target before painting');
  assert(connection.scripts[0].includes('doc.activeLayer = __paint_originalActive'), 'paint strokes must restore the previous active layer');
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
  const result = parseToolJson(await handler({
    strokes: [{
      tool: 'BRUSH',
      points: [{ x: 20, y: 140 }, { x: 220, y: 140 }],
      dynamics: {
        size: [30, 4],
        easing: 'LINEAR',
      },
    }],
  }));
  assert(result.ok === true, 'AUTO geometric dynamics should succeed');
  assert(result.details?.render_stroke_count > 12, 'long thin taper should use more than the minimum AUTO segments');
  assert(result.details?.render_stroke_count <= 40, 'AUTO dynamics must respect the 40-segment cap');
  assert(connection.scripts.length > 1, 'dense AUTO dynamics should remain safely chunked');

  const allScripts = connection.scripts.join('\n');
  const strokeMatches = [...allScripts.matchAll(/points:\[\{x:([0-9.\-]+),y:([0-9.\-]+)\},\{x:([0-9.\-]+),y:([0-9.\-]+)\}\]/g)];
  if (strokeMatches.length >= 4) {
    const lengths = strokeMatches.map((m) => Math.hypot(Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2])));
    assert(lengths[lengths.length - 1] < lengths[0], 'thin taper end should receive shorter render segments than thick start');
  }
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

{
  const connection = recordingConnection();
  const handler = dabHandler(connection);
  const result = parseToolJson(await handler({
    layer_id: 88,
    dabs: [
      { x: 10, y: 10, color: { red: 255, green: 0, blue: 0 }, opacity: 50 },
      { x: 20, y: 20, color: { red: 0, green: 0, blue: 255 }, opacity: 50 },
      { x: 30, y: 30, color: { red: 255, green: 0, blue: 0 }, opacity: 50 },
    ],
  }));
  assert(result.ok === true, 'ordered dab regression should succeed');
  assert(connection.scripts.length === 1, 'three cheap dabs should fit one Photoshop script');
  const script = connection.scripts[0];
  const firstRed = script.indexOf('"points":[{"x":10,"y":10}]');
  const blue = script.indexOf('"points":[{"x":20,"y":20}]');
  const secondRed = script.indexOf('"points":[{"x":30,"y":30}]');
  assert(firstRed >= 0 && blue > firstRed && secondRed > blue,
    'dab batching must preserve red #1 -> blue #2 -> red #3 order');
  assert(result.details?.group_count === 3,
    `non-adjacent identical styles must remain separate ordered runs, got ${result.details?.group_count}`);
  assert(result.details?.style_run_count === 3, 'ordered style-run count should be explicit');
  assert(result.details?.unique_style_count === 2, 'red/blue/red should report two unique styles');
  assert(result.details?.planned_batch_count === 1, 'three cheap ordered dabs should plan one internal batch');
  assert(result.details?.center_bounds?.left === 10 && result.details?.center_bounds?.right === 30,
    'dab execution metadata should expose affected center bounds');
  assert(Array.isArray(result.details?.batch_durations_ms), 'dab execution metadata should expose per-batch timings');
  assert(script.includes('72 / Number(doc.resolution || 72)'), 'dab paths must convert canvas pixels to Photoshop path coordinates using document DPI');
  assert(script.includes('__paint_canvasPx(src.x)'), 'dab anchors must pass through the canvas-pixel coordinate conversion');
  assert(result.details?.coordinate_space === 'canvas_pixels', 'painting tool contract must report canvas_pixels coordinate space');
  assert(script.includes('var __paint_requestedLayerId = 88;'), 'paint dabs must pin the requested stable layer id');
  assert(script.includes('doc.activeLayer = __paint_originalActive'), 'paint dabs must restore the previous active layer');
}

{
  const connection = recordingConnection();
  const handler = dabHandler(connection);
  const dabs = Array.from({ length: 25 }, (_, i) => ({
    x: i,
    y: i,
    color: { red: 12, green: 34, blue: 56 },
  }));
  const result = parseToolJson(await handler({ dabs }));
  assert(result.ok === true, 'large same-style dab run should succeed');
  assert(result.details?.group_count === 1, 'adjacent compatible dabs should remain one semantic style run');
  assert(result.details?.batch_count === 3, `25 dabs at 12/script should use 3 ordered batches, got ${result.details?.batch_count}`);
  assert(result.details?.planned_batch_count === 3, 'planned and executed batch count should match on success');
  assert(result.details?.points_per_script_limit === 12, 'planner should expose the current safety chunk limit');
}

{
  const connection = recordingConnection();
  const handler = regionHandler(connection);
  const result = parseToolJson(await handler({
    clip_bounds: { left: 10, top: 10, right: 300, bottom: 260 },
    regions: [
      {
        id: 'body-mass',
        layer_id: 77,
        color: { red: 30, green: 40, blue: 50 },
        contours: [
          {
            operation: 'ADD',
            points: [
              { x: 60, y: 50, right: [90, 40], smooth: true },
              { x: 220, y: 60, left: [190, 40], smooth: true },
              { x: 200, y: 220 },
              { x: 70, y: 210 },
            ],
          },
          {
            operation: 'SUBTRACT',
            points: [
              { x: 110, y: 100 },
              { x: 160, y: 100 },
              { x: 160, y: 150 },
              { x: 110, y: 150 },
            ],
          },
        ],
      },
    ],
  }));
  assert(result.ok === true, 'paint regions should succeed against recording connection');
  assert(result.details?.region_count === 1, 'paint regions should report semantic region count');
  assert(result.details?.history_steps === 1, 'paint regions should remain one semantic history step');
  assert(result.details?.coordinate_space === 'canvas_pixels', 'paint regions coordinate contract must be canvas_pixels');
  assert(connection.scripts.length === 1, 'paint regions should execute as one Photoshop script');
  const script = connection.scripts[0];
  assert(script.includes('path.fillPath('), 'paint regions must fill closed paths instead of emulating masses with many brush strokes');
  assert(script.includes('ShapeOperation.SHAPESUBTRACT'), 'paint regions must support subtractive contours/holes');
  assert(script.includes('__paint_findLayerById'), 'paint regions must support stable target layer ids');
  assert(script.includes('lies outside clip_bounds'), 'paint regions must enforce clip_bounds');
  assert(script.indexOf('__paint_preflightRegions') < script.indexOf("doc.suspendHistory('MCP Paint Regions'"),
    'paint regions must validate all geometry/targets before the history mutation starts');
  assert(script.includes('var __paint_regionTargets = __paint_preflightRegions'),
    'paint regions must resolve every target layer before painting the first region');
  assert(script.includes('72 / Number(doc.resolution || 72)'), 'paint regions must share the DPI-invariant canvas-pixel contract');
}

console.log('PAINTING_BATCHING_TEST_OK');
