import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function radiusValue(value: unknown): number {
  if (value === undefined) return 0;
  const radius = finiteNumber(value, 'radius');
  if (!Number.isInteger(radius) || radius < 0 || radius > 100) {
    throw new Error('radius must be an integer between 0 and 100');
  }
  return radius;
}

function sampleColorScript(x: number, y: number, radius: number): string {
  return `
var __mcpSourceDoc = app.activeDocument;
var __mcpTempDoc = null;
var __mcpSampler = null;
try {
  var __mcpW = __mcpSourceDoc.width.as('px');
  var __mcpH = __mcpSourceDoc.height.as('px');
  var __mcpX = ${x};
  var __mcpY = ${y};
  var __mcpRadius = ${radius};

  if (__mcpX < 0 || __mcpY < 0 || __mcpX >= __mcpW || __mcpY >= __mcpH) {
    throw new Error('sample_out_of_bounds: point (' + __mcpX + ', ' + __mcpY + ') is outside ' + __mcpW + 'x' + __mcpH);
  }

  // Always sample from a temporary merged duplicate. This avoids changing the
  // source document's Color Sampler markers and gives a stable composite sample.
  __mcpTempDoc = __mcpSourceDoc.duplicate('__MCP_COLOR_SAMPLE__' + (new Date().getTime()), true);
  app.activeDocument = __mcpTempDoc;

  var __mcpSampleX = __mcpX;
  var __mcpSampleY = __mcpY;
  var __mcpBounds = null;

  if (__mcpRadius > 0) {
    var __mcpLeft = Math.max(0, __mcpX - __mcpRadius);
    var __mcpTop = Math.max(0, __mcpY - __mcpRadius);
    var __mcpRight = Math.min(__mcpW, __mcpX + __mcpRadius + 1);
    var __mcpBottom = Math.min(__mcpH, __mcpY + __mcpRadius + 1);
    __mcpBounds = {
      left: __mcpLeft,
      top: __mcpTop,
      right: __mcpRight,
      bottom: __mcpBottom,
      width: __mcpRight - __mcpLeft,
      height: __mcpBottom - __mcpTop
    };

    __mcpTempDoc.crop([
      UnitValue(__mcpLeft, 'px'),
      UnitValue(__mcpTop, 'px'),
      UnitValue(__mcpRight, 'px'),
      UnitValue(__mcpBottom, 'px')
    ]);
    if (__mcpTempDoc.layers.length > 1) {
      __mcpTempDoc.flatten();
    }
    __mcpTempDoc.activeLayer.applyAverage();
    __mcpSampleX = Math.max(0, (__mcpTempDoc.width.as('px') - 1) / 2);
    __mcpSampleY = Math.max(0, (__mcpTempDoc.height.as('px') - 1) / 2);
  }

  __mcpSampler = __mcpTempDoc.colorSamplers.add([
    UnitValue(__mcpSampleX, 'px'),
    UnitValue(__mcpSampleY, 'px')
  ]);
  var __mcpRgb = __mcpSampler.color.rgb;
  var __mcpRed = Number(__mcpRgb.red);
  var __mcpGreen = Number(__mcpRgb.green);
  var __mcpBlue = Number(__mcpRgb.blue);
  var __mcpR8 = Math.max(0, Math.min(255, Math.round(__mcpRed)));
  var __mcpG8 = Math.max(0, Math.min(255, Math.round(__mcpGreen)));
  var __mcpB8 = Math.max(0, Math.min(255, Math.round(__mcpBlue)));
  function __mcpHex2(v) {
    var h = v.toString(16).toUpperCase();
    return h.length < 2 ? '0' + h : h;
  }

  return {
    ok: true,
    document: {
      id: __mcpSourceDoc.id,
      name: __mcpSourceDoc.name,
      width: __mcpW,
      height: __mcpH
    },
    point: { x: __mcpX, y: __mcpY },
    mode: __mcpRadius > 0 ? 'AVERAGE' : 'POINT',
    radius: __mcpRadius,
    bounds: __mcpBounds,
    rgb: { red: __mcpRed, green: __mcpGreen, blue: __mcpBlue },
    rgb_8bit: { red: __mcpR8, green: __mcpG8, blue: __mcpB8 },
    hex: '#' + __mcpHex2(__mcpR8) + __mcpHex2(__mcpG8) + __mcpHex2(__mcpB8)
  };
} finally {
  try { if (__mcpSampler) __mcpSampler.remove(); } catch (e) {}
  try { if (__mcpTempDoc) __mcpTempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {}
  try { app.activeDocument = __mcpSourceDoc; } catch (e) {}
}
`;
}

interface SamplePoint {
  id?: string;
  x: number;
  y: number;
}

function parseSamplePoints(value: unknown): SamplePoint[] {
  if (!Array.isArray(value) || value.length < 1) {
    throw new Error('points must be a non-empty array');
  }
  if (value.length > 1024) throw new Error('points may contain at most 1024 entries');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`points[${index}] must be an object`);
    }
    const rec = item as Record<string, unknown>;
    return {
      id: rec.id === undefined ? undefined : String(rec.id),
      x: finiteNumber(rec.x, `points[${index}].x`),
      y: finiteNumber(rec.y, `points[${index}].y`),
    };
  });
}

function sampleColorsScript(points: SamplePoint[]): string {
  const payload = JSON.stringify(points);
  return `
var __mcpSourceDoc = app.activeDocument;
var __mcpTempDoc = null;
var __mcpSampler = null;
try {
  var __mcpW = __mcpSourceDoc.width.as('px');
  var __mcpH = __mcpSourceDoc.height.as('px');
  var __mcpPoints = ${payload};
  __mcpTempDoc = __mcpSourceDoc.duplicate('__MCP_COLOR_SAMPLES__' + (new Date().getTime()), true);
  app.activeDocument = __mcpTempDoc;

  function __mcpHex2(v) {
    var h = v.toString(16).toUpperCase();
    return h.length < 2 ? '0' + h : h;
  }

  var __mcpSamples = [];
  for (var i = 0; i < __mcpPoints.length; i++) {
    var p = __mcpPoints[i];
    if (p.x < 0 || p.y < 0 || p.x >= __mcpW || p.y >= __mcpH) {
      throw new Error('sample_out_of_bounds: point (' + p.x + ', ' + p.y + ') is outside ' + __mcpW + 'x' + __mcpH);
    }
    __mcpSampler = __mcpTempDoc.colorSamplers.add([
      UnitValue(p.x, 'px'),
      UnitValue(p.y, 'px')
    ]);
    var rgb = __mcpSampler.color.rgb;
    var red = Number(rgb.red);
    var green = Number(rgb.green);
    var blue = Number(rgb.blue);
    var r8 = Math.max(0, Math.min(255, Math.round(red)));
    var g8 = Math.max(0, Math.min(255, Math.round(green)));
    var b8 = Math.max(0, Math.min(255, Math.round(blue)));
    __mcpSamples.push({
      id: p.id === undefined ? null : p.id,
      point: { x: p.x, y: p.y },
      rgb: { red: red, green: green, blue: blue },
      rgb_8bit: { red: r8, green: g8, blue: b8 },
      hex: '#' + __mcpHex2(r8) + __mcpHex2(g8) + __mcpHex2(b8)
    });
    try { __mcpSampler.remove(); } catch (eRemove) {}
    __mcpSampler = null;
  }

  return {
    ok: true,
    document: {
      id: __mcpSourceDoc.id,
      name: __mcpSourceDoc.name,
      width: __mcpW,
      height: __mcpH
    },
    mode: 'POINT_BATCH',
    count: __mcpSamples.length,
    samples: __mcpSamples
  };
} finally {
  try { if (__mcpSampler) __mcpSampler.remove(); } catch (e) {}
  try { if (__mcpTempDoc) __mcpTempDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {}
  try { app.activeDocument = __mcpSourceDoc; } catch (e) {}
}
`;
}

export function createColorSamplingTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_sample_color',
        description:
          'Sample the visible composite color at a document-space pixel coordinate. ' +
          'With radius=0, returns a point sample. With radius>0, returns the Photoshop Average color of the clipped square neighborhood using a temporary merged duplicate, without changing the source document or its Color Sampler markers. ' +
          'Useful for painting from references, skin/hair/lip palette pickup, and local color checks.',
        inputSchema: {
          type: 'object',
          properties: {
            x: {
              type: 'number',
              description: 'Document-space X coordinate in pixels',
            },
            y: {
              type: 'number',
              description: 'Document-space Y coordinate in pixels',
            },
            radius: {
              type: 'number',
              minimum: 0,
              maximum: 100,
              default: 0,
              description:
                'Integer pixel radius. 0 samples one point; >0 averages a square neighborhood clipped to document bounds.',
            },
          },
          required: ['x', 'y'],
        },
      },
      handler: async (args) => sampleColor(connection, args),
    },
    {
      tool: {
        name: 'photoshop_sample_colors',
        description:
          'Sample many visible-composite point colors from one pinned Photoshop document in a single operation. ' +
          'Large requests are automatically split into short Photoshop batches to avoid ExtendScript timeouts; each batch uses a merged temporary duplicate, and up to 1024 total point samples are returned without changing the source or leaving Color Sampler markers. ' +
          'Use for reference-driven painting value maps, palette studies, and dense visual checkpoints where repeated photoshop_sample_color calls would be inefficient.',
        inputSchema: {
          type: 'object',
          properties: {
            points: {
              type: 'array',
              minItems: 1,
              maxItems: 1024,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Optional caller label preserved in the result' },
                  x: { type: 'number', description: 'Document-space X coordinate in pixels' },
                  y: { type: 'number', description: 'Document-space Y coordinate in pixels' },
                },
                required: ['x', 'y'],
              },
            },
          },
          required: ['points'],
        },
      },
      handler: async (args) => sampleColors(connection, args),
    },
  ];
}

async function sampleColor(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const x = finiteNumber(args.x, 'x');
    const y = finiteNumber(args.y, 'y');
    const radius = radiusValue(args.radius);
    const raw = await runSnippet(connection, sampleColorScript(x, y, radius));
    const parsed = parseSnippetResult(raw);
    if (!parsed) throw new Error(`Unparseable color sample result: ${String(raw)}`);
    return atomicSuccess(
      radius > 0 ? `Average color sampled around (${x}, ${y})` : `Color sampled at (${x}, ${y})`,
      parsed,
      'photoshop_set_foreground_color'
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function sampleColors(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const points = parseSamplePoints(args.points);
    const chunkSize = 48;
    const samples: unknown[] = [];
    let document: unknown;
    let batchCount = 0;
    for (let offset = 0; offset < points.length; offset += chunkSize) {
      const chunk = points.slice(offset, offset + chunkSize);
      const raw = await runSnippet(connection, sampleColorsScript(chunk));
      const parsed = parseSnippetResult(raw);
      if (!parsed) throw new Error(`Unparseable color samples result: ${String(raw)}`);
      if (document === undefined) document = parsed.document;
      if (Array.isArray(parsed.samples)) samples.push(...parsed.samples);
      batchCount++;
    }
    return atomicSuccess(
      `Sampled ${points.length} colors in ${batchCount} batch${batchCount === 1 ? '' : 'es'}`,
      {
        document,
        mode: 'POINT_BATCH',
        count: samples.length,
        batch_count: batchCount,
        batch_size: chunkSize,
        samples,
      },
      'photoshop_set_foreground_color'
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
