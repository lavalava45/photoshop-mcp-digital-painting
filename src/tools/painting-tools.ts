import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

const PAINT_TOOLS = ['BRUSH', 'PENCIL', 'ERASER', 'SMUDGE'] as const;
type PaintTool = (typeof PAINT_TOOLS)[number];

interface PaintPoint {
  x: number;
  y: number;
  left?: [number, number];
  right?: [number, number];
  smooth?: boolean;
}

interface PaintStroke {
  points: PaintPoint[];
  tool: PaintTool;
  simulatePressure: boolean;
  closed: boolean;
  color?: { red: number; green: number; blue: number };
  size?: number;
  opacity?: number;
  flow?: number;
  dynamics?: StrokeDynamics;
}

type DynamicsEasing = 'LINEAR' | 'EASE_IN' | 'EASE_OUT' | 'EASE_IN_OUT';

interface StrokeDynamics {
  size?: [number, number];
  opacity?: [number, number];
  flow?: [number, number];
  steps: number;
  easing: DynamicsEasing;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function optionalNumber(
  value: unknown,
  name: string,
  min: number,
  max: number
): number | undefined {
  if (value === undefined) return undefined;
  const n = finiteNumber(value, name);
  if (n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return n;
}

function parsePair(value: unknown, name: string): [number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${name} must be [x, y]`);
  }
  return [finiteNumber(value[0], `${name}[0]`), finiteNumber(value[1], `${name}[1]`)];
}

function parseRange(
  value: unknown,
  name: string,
  min: number,
  max: number
): [number, number] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${name} must be [start, end]`);
  }
  const start = finiteNumber(value[0], `${name}[0]`);
  const end = finiteNumber(value[1], `${name}[1]`);
  if (start < min || start > max || end < min || end > max) {
    throw new Error(`${name} values must be between ${min} and ${max}`);
  }
  return [start, end];
}

function parseDynamics(value: unknown, strokeIndex: number): StrokeDynamics | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`strokes[${strokeIndex}].dynamics must be an object`);
  }
  const rec = value as Record<string, unknown>;
  const size = parseRange(rec.size, `strokes[${strokeIndex}].dynamics.size`, 1, 5000);
  const opacity = parseRange(rec.opacity, `strokes[${strokeIndex}].dynamics.opacity`, 0, 100);
  const flow = parseRange(rec.flow, `strokes[${strokeIndex}].dynamics.flow`, 0, 100);
  if (!size && !opacity && !flow) {
    throw new Error(`strokes[${strokeIndex}].dynamics requires size, opacity, or flow`);
  }
  const autoSteps = Math.min(
    64,
    Math.max(
      12,
      size ? Math.ceil(Math.abs(size[1] - size[0]) / 1.5) : 0,
      opacity ? Math.ceil(Math.abs(opacity[1] - opacity[0]) / 4) : 0,
      flow ? Math.ceil(Math.abs(flow[1] - flow[0]) / 4) : 0
    )
  );
  const stepsRaw = rec.steps === undefined
    ? autoSteps
    : finiteNumber(rec.steps, `strokes[${strokeIndex}].dynamics.steps`);
  if (!Number.isInteger(stepsRaw) || stepsRaw < 2 || stepsRaw > 64) {
    throw new Error(`strokes[${strokeIndex}].dynamics.steps must be an integer between 2 and 64`);
  }
  const easingRaw = typeof rec.easing === 'string' ? rec.easing.toUpperCase() : 'LINEAR';
  const allowed: DynamicsEasing[] = ['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'];
  if (!allowed.includes(easingRaw as DynamicsEasing)) {
    throw new Error(`strokes[${strokeIndex}].dynamics.easing must be one of ${allowed.join(', ')}`);
  }
  return {
    size,
    opacity,
    flow,
    steps: stepsRaw,
    easing: easingRaw as DynamicsEasing,
  };
}

function parsePoint(value: unknown, strokeIndex: number, pointIndex: number): PaintPoint {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`strokes[${strokeIndex}].points[${pointIndex}] must be an object`);
  }
  const rec = value as Record<string, unknown>;
  return {
    x: finiteNumber(rec.x, `strokes[${strokeIndex}].points[${pointIndex}].x`),
    y: finiteNumber(rec.y, `strokes[${strokeIndex}].points[${pointIndex}].y`),
    left: parsePair(rec.left, `strokes[${strokeIndex}].points[${pointIndex}].left`),
    right: parsePair(rec.right, `strokes[${strokeIndex}].points[${pointIndex}].right`),
    smooth: rec.smooth === true,
  };
}

function parseStroke(value: unknown, index: number): PaintStroke {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`strokes[${index}] must be an object`);
  }
  const rec = value as Record<string, unknown>;
  if (!Array.isArray(rec.points) || rec.points.length < 1) {
    throw new Error(`strokes[${index}].points must contain at least 1 point`);
  }
  if (rec.points.length > 1000) throw new Error(`strokes[${index}] has too many points (max 1000)`);
  const rawTool = typeof rec.tool === 'string' ? rec.tool.toUpperCase() : 'BRUSH';
  if (!PAINT_TOOLS.includes(rawTool as PaintTool)) {
    throw new Error(`strokes[${index}].tool must be one of ${PAINT_TOOLS.join(', ')}`);
  }
  let color: { red: number; green: number; blue: number } | undefined;
  if (rec.color !== undefined) {
    if (!rec.color || typeof rec.color !== 'object' || Array.isArray(rec.color)) {
      throw new Error(`strokes[${index}].color must be an object`);
    }
    const c = rec.color as Record<string, unknown>;
    color = {
      red: finiteNumber(c.red, `strokes[${index}].color.red`),
      green: finiteNumber(c.green, `strokes[${index}].color.green`),
      blue: finiteNumber(c.blue, `strokes[${index}].color.blue`),
    };
    for (const [channel, n] of Object.entries(color)) {
      if (n < 0 || n > 255) throw new Error(`strokes[${index}].color.${channel} must be between 0 and 255`);
    }
  }
  return {
    points: rec.points.map((point, pointIndex) => parsePoint(point, index, pointIndex)),
    tool: rawTool as PaintTool,
    simulatePressure: rec.simulate_pressure === true,
    closed: rec.closed === true,
    color,
    size: optionalNumber(rec.size, `strokes[${index}].size`, 1, 5000),
    opacity: optionalNumber(rec.opacity, `strokes[${index}].opacity`, 0, 100),
    flow: optionalNumber(rec.flow, `strokes[${index}].flow`, 0, 100),
    dynamics: parseDynamics(rec.dynamics, index),
  };
}

function ease(t: number, mode: DynamicsEasing): number {
  if (mode === 'EASE_IN') return t * t;
  if (mode === 'EASE_OUT') return 1 - (1 - t) * (1 - t);
  if (mode === 'EASE_IN_OUT') return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  return t;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function cubicPoint(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number
): [number, number] {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  const uuu = uu * u;
  const ttt = tt * t;
  return [
    uuu * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + ttt * p3[0],
    uuu * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + ttt * p3[1],
  ];
}

function sampleStrokePath(stroke: PaintStroke, targetSamples: number): [number, number][] {
  if (stroke.points.length === 1) return [[stroke.points[0].x, stroke.points[0].y]];

  const dense: [number, number][] = [];
  const segmentSamples = Math.max(8, Math.ceil(targetSamples / Math.max(1, stroke.points.length - 1)) * 4);
  for (let i = 0; i < stroke.points.length - 1; i++) {
    const a = stroke.points[i];
    const b = stroke.points[i + 1];
    const p0: [number, number] = [a.x, a.y];
    const p1: [number, number] = a.right ?? p0;
    const p3: [number, number] = [b.x, b.y];
    const p2: [number, number] = b.left ?? p3;
    for (let j = 0; j <= segmentSamples; j++) {
      if (i > 0 && j === 0) continue;
      dense.push(cubicPoint(p0, p1, p2, p3, j / segmentSamples));
    }
  }

  const cumulative = [0];
  for (let i = 1; i < dense.length; i++) {
    const dx = dense[i][0] - dense[i - 1][0];
    const dy = dense[i][1] - dense[i - 1][1];
    cumulative.push(cumulative[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = cumulative[cumulative.length - 1];
  if (total <= 1e-9) return Array.from({ length: targetSamples + 1 }, () => dense[0]);

  const out: [number, number][] = [];
  let cursor = 1;
  for (let s = 0; s <= targetSamples; s++) {
    const target = (total * s) / targetSamples;
    while (cursor < cumulative.length - 1 && cumulative[cursor] < target) cursor++;
    const lo = Math.max(0, cursor - 1);
    const hi = cursor;
    const span = cumulative[hi] - cumulative[lo];
    const localT = span <= 1e-9 ? 0 : (target - cumulative[lo]) / span;
    out.push([
      lerp(dense[lo][0], dense[hi][0], localT),
      lerp(dense[lo][1], dense[hi][1], localT),
    ]);
  }
  return out;
}

function expandDynamicStroke(stroke: PaintStroke): PaintStroke[] {
  if (!stroke.dynamics) return [{ ...stroke, dynamics: undefined }];
  if (stroke.closed) throw new Error('dynamics is not supported for closed strokes');
  if (stroke.points.length < 2) throw new Error('dynamics requires at least 2 stroke points');

  const { dynamics } = stroke;
  const sampled = sampleStrokePath(stroke, dynamics.steps);
  const segments: PaintStroke[] = [];
  for (let i = 0; i < dynamics.steps; i++) {
    const midpoint = (i + 0.5) / dynamics.steps;
    const t = ease(midpoint, dynamics.easing);
    segments.push({
      points: [
        { x: sampled[i][0], y: sampled[i][1] },
        { x: sampled[i + 1][0], y: sampled[i + 1][1] },
      ],
      tool: stroke.tool,
      simulatePressure: false,
      closed: false,
      color: stroke.color,
      size: dynamics.size ? lerp(dynamics.size[0], dynamics.size[1], t) : stroke.size,
      opacity: dynamics.opacity ? lerp(dynamics.opacity[0], dynamics.opacity[1], t) : stroke.opacity,
      flow: dynamics.flow ? lerp(dynamics.flow[0], dynamics.flow[1], t) : stroke.flow,
    });
  }
  return segments;
}

function paintRuntime(): string {
  return `
function __paint_cTID(s) { return app.charIDToTypeID(s); }
function __paint_sTID(s) { return app.stringIDToTypeID(s); }
function __paint_selectBrushTool() {
  var d = new ActionDescriptor();
  var r = new ActionReference();
  r.putClass(__paint_sTID('paintbrushTool'));
  d.putReference(__paint_cTID('null'), r);
  executeAction(__paint_cTID('slct'), d, DialogModes.NO);
}
function __paint_readBrush() {
  __paint_selectBrushTool();
  var ref = new ActionReference();
  ref.putEnumerated(__paint_cTID('capp'), __paint_cTID('Ordn'), __paint_cTID('Trgt'));
  var appDesc = executeActionGet(ref);
  var opts = appDesc.getObjectValue(__paint_sTID('currentToolOptions'));
  var brush = opts.getObjectValue(__paint_sTID('brush'));
  function optUnit(obj, key, fallback) {
    try { return obj.getUnitDoubleValue(__paint_sTID(key)); } catch (e) {}
    try { return obj.getDouble(__paint_sTID(key)); } catch (e2) {}
    try { return obj.getInteger(__paint_sTID(key)); } catch (e3) {}
    return fallback;
  }
  function optBool(obj, key, fallback) {
    try { return obj.getBoolean(__paint_sTID(key)); } catch (e) { return fallback; }
  }
  function optDouble(obj, key, fallback) {
    try { return obj.getDouble(__paint_sTID(key)); } catch (e) {}
    try { return obj.getInteger(__paint_sTID(key)); } catch (e2) {}
    return fallback;
  }
  return {
    size: optUnit(brush, 'diameter', 1),
    hardness: optUnit(brush, 'hardness', 100),
    angle: optUnit(brush, 'angle', 0),
    roundness: optUnit(brush, 'roundness', 100),
    spacing: optUnit(brush, 'spacing', 25),
    opacity: optUnit(opts, 'opacity', 100),
    flow: optUnit(opts, 'flow', 100),
    flip_x: optBool(brush, 'flipX', false),
    flip_y: optBool(brush, 'flipY', false),
    use_pressure_size: optBool(opts, 'usePressureOverridesSize', false),
    use_pressure_opacity: optBool(opts, 'usePressureOverridesOpacity', false),
    airbrush: optBool(opts, 'repeat', false),
    smoothing_enabled: optBool(opts, 'smoothing', false),
    smoothing: optDouble(opts, 'smooth', 10)
  };
}
function __paint_createBrushCache() {
  __paint_selectBrushTool();
  var ref = new ActionReference();
  ref.putEnumerated(__paint_cTID('capp'), __paint_cTID('Ordn'), __paint_cTID('Trgt'));
  var appDesc = executeActionGet(ref);
  var opts = appDesc.getObjectValue(__paint_sTID('currentToolOptions'));
  var brush = opts.getObjectValue(__paint_sTID('brush'));
  function optUnit(obj, key, fallback) {
    try { return obj.getUnitDoubleValue(__paint_sTID(key)); } catch (e) {}
    try { return obj.getDouble(__paint_sTID(key)); } catch (e2) {}
    try { return obj.getInteger(__paint_sTID(key)); } catch (e3) {}
    return fallback;
  }
  return {
    opts: opts,
    brush: brush,
    state: {
      size: optUnit(brush, 'diameter', 1),
      opacity: optUnit(opts, 'opacity', 100),
      flow: optUnit(opts, 'flow', 100)
    }
  };
}
function __paint_applyBrushCache(cache) {
  cache.brush.putDouble(__paint_sTID('diameter'), cache.state.size);
  cache.opts.putObject(__paint_sTID('brush'), __paint_sTID('brush'), cache.brush);
  cache.opts.putInteger(__paint_sTID('opacity'), Math.round(cache.state.opacity));
  cache.opts.putInteger(__paint_sTID('flow'), Math.round(cache.state.flow));
  var toolDesc = new ActionDescriptor();
  var toolRef = new ActionReference();
  toolRef.putClass(__paint_sTID('paintbrushTool'));
  toolDesc.putReference(__paint_sTID('null'), toolRef);
  toolDesc.putObject(__paint_sTID('to'), __paint_sTID('null'), cache.opts);
  executeAction(__paint_sTID('set'), toolDesc, DialogModes.NO);
}
function __paint_setBrush(v) {
  __paint_selectBrushTool();
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putEnumerated(__paint_cTID('Brsh'), __paint_cTID('Ordn'), __paint_cTID('Trgt'));
  desc.putReference(__paint_cTID('null'), ref);
  var b = new ActionDescriptor();
  b.putDouble(__paint_sTID('diameter'), v.size);
  b.putDouble(__paint_sTID('hardness'), v.hardness);
  b.putDouble(__paint_sTID('angle'), v.angle);
  b.putDouble(__paint_sTID('roundness'), v.roundness);
  b.putUnitDouble(__paint_sTID('spacing'), __paint_cTID('#Prc'), v.spacing);
  b.putBoolean(__paint_sTID('flipX'), v.flip_x);
  b.putBoolean(__paint_sTID('flipY'), v.flip_y);
  desc.putObject(__paint_sTID('to'), __paint_cTID('Brsh'), b);
  executeAction(__paint_cTID('setd'), desc, DialogModes.NO);

  var currentRef = new ActionReference();
  currentRef.putEnumerated(__paint_cTID('capp'), __paint_cTID('Ordn'), __paint_cTID('Trgt'));
  var currentApp = executeActionGet(currentRef);
  var toolOptions = currentApp.getObjectValue(__paint_sTID('currentToolOptions'));
  toolOptions.putInteger(__paint_sTID('opacity'), Math.round(v.opacity));
  toolOptions.putInteger(__paint_sTID('flow'), Math.round(v.flow));
  toolOptions.putBoolean(__paint_sTID('usePressureOverridesOpacity'), v.use_pressure_opacity);
  toolOptions.putBoolean(__paint_sTID('usePressureOverridesSize'), v.use_pressure_size);
  toolOptions.putBoolean(__paint_sTID('repeat'), v.airbrush);
  toolOptions.putBoolean(__paint_sTID('smoothing'), v.smoothing_enabled);
  toolOptions.putInteger(__paint_sTID('smooth'), Math.round(v.smoothing));
  toolOptions.putDouble(__paint_sTID('smoothingValue'), v.smoothing);

  var toolDesc = new ActionDescriptor();
  var toolRef = new ActionReference();
  toolRef.putClass(__paint_sTID('paintbrushTool'));
  toolDesc.putReference(__paint_sTID('null'), toolRef);
  toolDesc.putObject(__paint_sTID('to'), __paint_sTID('null'), toolOptions);
  executeAction(__paint_sTID('set'), toolDesc, DialogModes.NO);
}
`;
}

function getBrushScript(): string {
  return `${paintRuntime()} return { ok: true, settings: __paint_readBrush() };`;
}

function setBrushScript(values: Record<string, number | boolean | undefined>): string {
  const overrides = JSON.stringify(values);
  return `${paintRuntime()}
var current = __paint_readBrush();
var overrides = ${overrides};
for (var key in overrides) {
  if (overrides.hasOwnProperty(key) && overrides[key] !== undefined) current[key] = overrides[key];
}
__paint_setBrush(current);
return { ok: true, settings: __paint_readBrush() };`;
}

function brushPresetsScript(query: string | undefined, limit: number): string {
  const q = JSON.stringify((query ?? '').toLowerCase());
  return `
function __paint_sTID(s) { return app.stringIDToTypeID(s); }
var ref = new ActionReference();
ref.putProperty(__paint_sTID('property'), __paint_sTID('presetManager'));
ref.putEnumerated(__paint_sTID('application'), __paint_sTID('ordinal'), __paint_sTID('targetEnum'));
var desc = executeActionGet(ref);
var managers = desc.getList(__paint_sTID('presetManager'));
var names = [];
for (var i = 0; i < managers.count; i++) {
  var className = '';
  try { className = typeIDToStringID(managers.getObjectType(i)); } catch (eClass) {}
  if (className !== 'brush') continue;
  var brushManager = managers.getObjectValue(i);
  var brushNames = brushManager.getList(__paint_sTID('name'));
  for (var j = 0; j < brushNames.count; j++) names.push(brushNames.getString(j));
  break;
}
var q = ${q};
var filtered = [];
for (var n = 0; n < names.length; n++) {
  if (!q || String(names[n]).toLowerCase().indexOf(q) >= 0) filtered.push(names[n]);
}
var visible = filtered.slice(0, ${limit});
return { ok: true, total: names.length, matched: filtered.length, truncated: filtered.length > visible.length, presets: visible };
`;
}

function selectBrushPresetScript(name: string): string {
  const preset = JSON.stringify(name);
  return `${paintRuntime()}
var presetName = ${preset};
var desc = new ActionDescriptor();
var ref = new ActionReference();
ref.putName(__paint_cTID('Brsh'), presetName);
desc.putReference(__paint_cTID('null'), ref);
executeAction(__paint_cTID('slct'), desc, DialogModes.NO);
return { ok: true, preset: presetName, settings: __paint_readBrush() };
`;
}
function foregroundColorScript(red: number, green: number, blue: number): string {
  return `
var color = new SolidColor();
color.rgb.red = ${red};
color.rgb.green = ${green};
color.rgb.blue = ${blue};
app.foregroundColor = color;
return { ok: true, red: ${red}, green: ${green}, blue: ${blue} };
`;
}

function paintStrokesScript(strokes: PaintStroke[]): string {
  const payload = JSON.stringify(strokes);
  return `
${paintRuntime()}
if (app.documents.length === 0) throw new Error('No active document');
var doc = app.activeDocument;
var strokes = ${payload};
function __paint_setForeground(c) {
  var color = new SolidColor();
  color.rgb.red = c.red;
  color.rgb.green = c.green;
  color.rgb.blue = c.blue;
  app.foregroundColor = color;
}
function __paint_sameColor(a, b) {
  return a && b && a.red === b.red && a.green === b.green && a.blue === b.blue;
}
function __paint_differs(a, b) {
  return Math.abs(Number(a) - Number(b)) > 0.0001;
}
function __paint_applyStrokes() {
  var brushCache = __paint_createBrushCache();
  var brushState = brushCache.state;
  var fg = app.foregroundColor.rgb;
  var cachedColor = { red: Number(fg.red), green: Number(fg.green), blue: Number(fg.blue) };
  for (var s = 0; s < strokes.length; s++) {
    var stroke = strokes[s];
    var brushChanged = false;
    if (stroke.size !== undefined || stroke.opacity !== undefined || stroke.flow !== undefined) {
      if (stroke.size !== undefined && __paint_differs(brushState.size, stroke.size)) {
        brushState.size = stroke.size;
        brushChanged = true;
      }
      if (stroke.opacity !== undefined && __paint_differs(brushState.opacity, stroke.opacity)) {
        brushState.opacity = stroke.opacity;
        brushChanged = true;
      }
      if (stroke.flow !== undefined && __paint_differs(brushState.flow, stroke.flow)) {
        brushState.flow = stroke.flow;
        brushChanged = true;
      }
      if (brushChanged) __paint_applyBrushCache(brushCache);
    }
    var desiredColor = stroke.color ? stroke.color : cachedColor;
    if (desiredColor && (brushChanged || !__paint_sameColor(cachedColor, desiredColor))) {
      __paint_setForeground(desiredColor);
    }
    if (stroke.color) {
      cachedColor = { red: stroke.color.red, green: stroke.color.green, blue: stroke.color.blue };
    }
    var pts = [];
    for (var i = 0; i < stroke.points.length; i++) {
      var src = stroke.points[i];
      var p = new PathPointInfo();
      p.kind = src.smooth ? PointKind.SMOOTHPOINT : PointKind.CORNERPOINT;
      p.anchor = [src.x, src.y];
      p.leftDirection = src.left ? src.left : [src.x, src.y];
      p.rightDirection = src.right ? src.right : [src.x, src.y];
      pts.push(p);
    }
    if (pts.length === 1) {
      var src0 = stroke.points[0];
      var p2 = new PathPointInfo();
      p2.kind = PointKind.CORNERPOINT;
      p2.anchor = [src0.x, src0.y];
      p2.leftDirection = [src0.x, src0.y];
      p2.rightDirection = [src0.x, src0.y];
      pts.push(p2);
    }
    var sub = new SubPathInfo();
    sub.closed = stroke.closed;
    sub.operation = ShapeOperation.SHAPEADD;
    sub.entireSubPath = pts;
    var path = doc.pathItems.add('__MCP_PAINT_' + s, [sub]);
    try {
      path.strokePath(ToolType[stroke.tool], stroke.simulatePressure);
    } finally {
      try { path.remove(); } catch (eRemove) {}
    }
  }
}
doc.suspendHistory('MCP Digital Painting', '__paint_applyStrokes()');
return { ok: true, stroke_count: strokes.length, layer_name: doc.activeLayer.name };
`;
}

function paintStrokeCost(stroke: PaintStroke): number {
  let cost = 1;
  if (stroke.color) cost += 0.5;
  if (stroke.size !== undefined || stroke.opacity !== undefined || stroke.flow !== undefined) cost += 4;
  if (stroke.points.length > 8) cost += Math.min(4, stroke.points.length / 16);
  return cost;
}

function chunkPaintStrokes(strokes: PaintStroke[], maxCost = 24): PaintStroke[][] {
  const batches: PaintStroke[][] = [];
  let current: PaintStroke[] = [];
  let cost = 0;
  for (const stroke of strokes) {
    const nextCost = paintStrokeCost(stroke);
    if (current.length > 0 && cost + nextCost > maxCost) {
      batches.push(current);
      current = [];
      cost = 0;
    }
    current.push(stroke);
    cost += nextCost;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

export function createPaintingTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_list_brush_presets',
        description:
          'List installed Photoshop brush presets. Supports optional case-insensitive filtering and a result limit.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Optional case-insensitive substring filter' },
            limit: {
              type: 'number',
              minimum: 1,
              maximum: 1000,
              default: 200,
              description: 'Maximum number of preset names to return',
            },
          },
        },
      },
      handler: async (args) => listBrushPresets(connection, args),
    },
    {
      tool: {
        name: 'photoshop_select_brush_preset',
        description:
          'Select an installed Photoshop brush preset by exact name. Returns the selected preset and current brush settings.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Exact Photoshop brush preset name' },
          },
          required: ['name'],
        },
      },
      handler: async (args) => selectBrushPreset(connection, args),
    },
    {
      tool: {
        name: 'photoshop_get_brush_settings',
        description:
          'Read active Photoshop paint-brush settings used for digital painting, including geometry, opacity/flow, pressure overrides, airbrush and smoothing.',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => getBrushSettings(connection),
    },
    {
      tool: {
        name: 'photoshop_set_brush',
        description:
          'Configure the active Photoshop Brush Tool for digital painting. Unspecified fields preserve their current values.',
        inputSchema: {
          type: 'object',
          properties: {
            size: {
              type: 'number',
              minimum: 1,
              maximum: 5000,
              description: 'Brush diameter in pixels',
            },
            hardness: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: 'Brush hardness percent',
            },
            opacity: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: 'Brush opacity percent',
            },
            flow: { type: 'number', minimum: 0, maximum: 100, description: 'Brush flow percent' },
            spacing: {
              type: 'number',
              minimum: 1,
              maximum: 1000,
              description: 'Brush spacing percent',
            },
            angle: {
              type: 'number',
              minimum: -180,
              maximum: 180,
              description: 'Brush tip angle in degrees',
            },
            roundness: {
              type: 'number',
              minimum: 1,
              maximum: 100,
              description: 'Brush tip roundness percent',
            },
            flip_x: { type: 'boolean', description: 'Flip brush tip horizontally' },
            flip_y: { type: 'boolean', description: 'Flip brush tip vertically' },
            use_pressure_size: {
              type: 'boolean',
              description: 'Enable Photoshop pressure override for brush size',
            },
            use_pressure_opacity: {
              type: 'boolean',
              description: 'Enable Photoshop pressure override for brush opacity',
            },
            airbrush: {
              type: 'boolean',
              description: 'Enable Photoshop airbrush/repeat behavior',
            },
            smoothing_enabled: {
              type: 'boolean',
              description: 'Enable Photoshop brush smoothing',
            },
            smoothing: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              description: 'Photoshop brush smoothing amount',
            },
          },
        },
      },
      handler: async (args) => setBrush(connection, args),
    },
    {
      tool: {
        name: 'photoshop_set_foreground_color',
        description: 'Set Photoshop foreground color for subsequent paint strokes.',
        inputSchema: {
          type: 'object',
          properties: {
            red: { type: 'number', minimum: 0, maximum: 255 },
            green: { type: 'number', minimum: 0, maximum: 255 },
            blue: { type: 'number', minimum: 0, maximum: 255 },
          },
          required: ['red', 'green', 'blue'],
        },
      },
      handler: async (args) => setForegroundColor(connection, args),
    },
    {
      tool: {
        name: 'photoshop_paint_strokes',
        description:
          'Paint one or many raster strokes on the active layer using Photoshop path stroking. Supports Brush, Pencil, Eraser and Smudge, optional Bezier handles, closed paths, simulated pressure, one-point dabs, per-stroke color/size/opacity/flow overrides, and interpolated dynamics. AUTO batching proactively splits expensive mixed batches into short Photoshop scripts to avoid ExtendScript timeouts; small batches remain one history step.',
        inputSchema: {
          type: 'object',
          properties: {
            strokes: {
              type: 'array',
              minItems: 1,
              maxItems: 250,
              items: {
                type: 'object',
                properties: {
                  tool: { type: 'string', enum: PAINT_TOOLS, default: 'BRUSH' },
                  simulate_pressure: { type: 'boolean', default: false },
                  closed: { type: 'boolean', default: false },
                  color: {
                    type: 'object',
                    properties: {
                      red: { type: 'number', minimum: 0, maximum: 255 },
                      green: { type: 'number', minimum: 0, maximum: 255 },
                      blue: { type: 'number', minimum: 0, maximum: 255 },
                    },
                    required: ['red', 'green', 'blue'],
                  },
                  size: { type: 'number', minimum: 1, maximum: 5000 },
                  opacity: { type: 'number', minimum: 0, maximum: 100 },
                  flow: { type: 'number', minimum: 0, maximum: 100 },
                  dynamics: {
                    type: 'object',
                    description:
                      'Optional interpolated profile along an open stroke. Ranges are [start, end]. The path is sampled into short segments and rendered with changing brush settings.',
                    properties: {
                      size: {
                        type: 'array',
                        minItems: 2,
                        maxItems: 2,
                        items: { type: 'number', minimum: 1, maximum: 5000 },
                      },
                      opacity: {
                        type: 'array',
                        minItems: 2,
                        maxItems: 2,
                        items: { type: 'number', minimum: 0, maximum: 100 },
                      },
                      flow: {
                        type: 'array',
                        minItems: 2,
                        maxItems: 2,
                        items: { type: 'number', minimum: 0, maximum: 100 },
                      },
                      steps: {
                        type: 'number',
                        minimum: 2,
                        maximum: 64,
                        description:
                          'Optional rendered segment count. When omitted, an automatic 12–64 step count is chosen from the size/opacity/flow change magnitude.',
                      },
                      easing: {
                        type: 'string',
                        enum: ['LINEAR', 'EASE_IN', 'EASE_OUT', 'EASE_IN_OUT'],
                        default: 'LINEAR',
                      },
                    },
                  },
                  points: {
                    type: 'array',
                    minItems: 1,
                    maxItems: 1000,
                    items: {
                      type: 'object',
                      properties: {
                        x: { type: 'number' },
                        y: { type: 'number' },
                        left: {
                          type: 'array',
                          minItems: 2,
                          maxItems: 2,
                          items: { type: 'number' },
                        },
                        right: {
                          type: 'array',
                          minItems: 2,
                          maxItems: 2,
                          items: { type: 'number' },
                        },
                        smooth: { type: 'boolean', default: false },
                      },
                      required: ['x', 'y'],
                    },
                  },
                },
                required: ['points'],
              },
            },
            batch_mode: {
              type: 'string',
              enum: ['AUTO', 'SINGLE_HISTORY'],
              default: 'AUTO',
              description:
                'AUTO proactively chunks expensive batches for reliability. SINGLE_HISTORY preserves the legacy one-history-step behavior but can time out on large heterogeneous batches.',
            },
          },
          required: ['strokes'],
        },
      },
      handler: async (args) => paintStrokes(connection, args),
    },
  ];
}

async function listBrushPresets(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const query = typeof args.query === 'string' ? args.query : undefined;
    const limitRaw = optionalNumber(args.limit, 'limit', 1, 1000);
    const limit = limitRaw === undefined ? 200 : Math.round(limitRaw);
    const raw = await runSnippet(connection, brushPresetsScript(query, limit));
    const parsed = parseSnippetResult(raw);
    if (!parsed) throw new Error(`Unparseable brush preset list: ${String(raw)}`);
    return atomicSuccess('Brush presets listed', {
      total: parsed.total,
      matched: parsed.matched,
      truncated: parsed.truncated,
      presets: parsed.presets,
    });
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function selectBrushPreset(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    if (typeof args.name !== 'string' || args.name.trim().length === 0) {
      throw new Error('name is required');
    }
    const name = args.name.trim();
    const raw = await runSnippet(connection, selectBrushPresetScript(name));
    const parsed = parseSnippetResult(raw);
    if (!parsed) throw new Error(`Unparseable brush preset selection: ${String(raw)}`);
    return atomicSuccess(`Brush preset selected: ${name}`, {
      preset: parsed.preset,
      settings: parsed.settings,
    });
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function getBrushSettings(connection: PhotoshopConnection): Promise<ToolResult> {
  try {
    const raw = await runSnippet(connection, getBrushScript());
    const parsed = parseSnippetResult(raw);
    if (!parsed) throw new Error(`Unparseable brush settings: ${String(raw)}`);
    return atomicSuccess('Brush settings read', { settings: parsed.settings });
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function setBrush(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const values: Record<string, number | boolean | undefined> = {
      size: optionalNumber(args.size, 'size', 1, 5000),
      hardness: optionalNumber(args.hardness, 'hardness', 0, 100),
      opacity: optionalNumber(args.opacity, 'opacity', 0, 100),
      flow: optionalNumber(args.flow, 'flow', 0, 100),
      spacing: optionalNumber(args.spacing, 'spacing', 1, 1000),
      angle: optionalNumber(args.angle, 'angle', -180, 180),
      roundness: optionalNumber(args.roundness, 'roundness', 1, 100),
      flip_x: typeof args.flip_x === 'boolean' ? args.flip_x : undefined,
      flip_y: typeof args.flip_y === 'boolean' ? args.flip_y : undefined,
      use_pressure_size:
        typeof args.use_pressure_size === 'boolean' ? args.use_pressure_size : undefined,
      use_pressure_opacity:
        typeof args.use_pressure_opacity === 'boolean' ? args.use_pressure_opacity : undefined,
      airbrush: typeof args.airbrush === 'boolean' ? args.airbrush : undefined,
      smoothing_enabled:
        typeof args.smoothing_enabled === 'boolean' ? args.smoothing_enabled : undefined,
      smoothing: optionalNumber(args.smoothing, 'smoothing', 0, 100),
    };
    const raw = await runSnippet(connection, setBrushScript(values));
    const parsed = parseSnippetResult(raw);
    if (!parsed) throw new Error(`Unparseable set-brush result: ${String(raw)}`);
    return atomicSuccess('Brush settings updated', { settings: parsed.settings });
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function setForegroundColor(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const red = optionalNumber(args.red, 'red', 0, 255);
    const green = optionalNumber(args.green, 'green', 0, 255);
    const blue = optionalNumber(args.blue, 'blue', 0, 255);
    if (red === undefined || green === undefined || blue === undefined)
      throw new Error('red, green and blue are required');
    const raw = await runSnippet(connection, foregroundColorScript(red, green, blue));
    const parsed = parseSnippetResult(raw);
    if (!parsed) throw new Error(`Unparseable color result: ${String(raw)}`);
    return atomicSuccess('Foreground color updated', { red, green, blue });
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function paintStrokes(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    if (!Array.isArray(args.strokes) || args.strokes.length === 0)
      throw new Error('strokes must be a non-empty array');
    if (args.strokes.length > 250)
      throw new Error('strokes may contain at most 250 strokes per call');
    const inputStrokes = args.strokes.map((stroke, index) => parseStroke(stroke, index));
    const renderStrokes = inputStrokes.flatMap((stroke) => expandDynamicStroke(stroke));
    if (renderStrokes.length > 1000) {
      throw new Error(`Dynamics expansion produced ${renderStrokes.length} render strokes; maximum is 1000 per call`);
    }

    const rawMode = typeof args.batch_mode === 'string' ? args.batch_mode.toUpperCase() : 'AUTO';
    if (rawMode !== 'AUTO' && rawMode !== 'SINGLE_HISTORY') {
      throw new Error('batch_mode must be AUTO or SINGLE_HISTORY');
    }
    const batches = rawMode === 'SINGLE_HISTORY' ? [renderStrokes] : chunkPaintStrokes(renderStrokes);
    let layerName: unknown;
    let completed = 0;
    for (let i = 0; i < batches.length; i++) {
      try {
        const raw = await runSnippet(connection, paintStrokesScript(batches[i]));
        const parsed = parseSnippetResult(raw);
        if (!parsed) throw new Error(`Unparseable paint result: ${String(raw)}`);
        layerName = parsed.layer_name;
        completed += batches[i].length;
      } catch (error) {
        throw new Error(
          `Painting batch ${i + 1}/${batches.length} failed after ${completed}/${renderStrokes.length} render strokes completed. ` +
            `Earlier AUTO batches remain applied as separate history steps. ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    return atomicSuccess(`Painted ${inputStrokes.length} stroke${inputStrokes.length === 1 ? '' : 's'}`, {
      stroke_count: inputStrokes.length,
      render_stroke_count: renderStrokes.length,
      dynamic_stroke_count: inputStrokes.filter((stroke) => stroke.dynamics !== undefined).length,
      batch_mode: rawMode,
      batch_count: batches.length,
      history_steps: batches.length,
      auto_chunked: rawMode === 'AUTO' && batches.length > 1,
      layer_name: layerName,
    });
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
