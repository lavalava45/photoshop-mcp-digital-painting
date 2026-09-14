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

