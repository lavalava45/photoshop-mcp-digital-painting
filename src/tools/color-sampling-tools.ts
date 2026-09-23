import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { atomicFailureFromError, atomicSuccess } from './atomic-shared.js';

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

export function createColorSamplingTools(connection: PhotoshopConnection): ToolDefinition[] {
  const backendRouter = new PhotoshopBackendRouter(connection);
  return [
    {
      tool: {
        name: 'photoshop_sample_color',
        description:
          'Sample the visible composite color at a document-space pixel coordinate. ' +
          'With radius=0, returns a point sample. With radius>0, returns the Photoshop Average-equivalent color of the clipped square neighborhood without changing the source document. ' +
          'The public operation is UXP-first; the retained ExtendScript fallback may use a temporary merged duplicate and Color Sampler internally. ' +
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
      handler: async (args) => sampleColor(backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_sample_colors',
        description:
          'Sample many visible-composite point colors from one pinned Photoshop document in a single operation. ' +
          'Large requests are automatically split into bounded batches; up to 1024 total point samples are returned without changing the source document. ' +
          'The public operation is UXP-first; the retained ExtendScript fallback may use a temporary merged duplicate and Color Sampler internally. ' +
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
      handler: async (args) => sampleColors(backendRouter, args),
    },
  ];
}

async function sampleColor(
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const x = finiteNumber(args.x, 'x');
    const y = finiteNumber(args.y, 'y');
    const radius = radiusValue(args.radius);
    const documentId =
      typeof args.document_id === 'number' &&
      Number.isInteger(args.document_id) &&
      args.document_id > 0
        ? args.document_id
        : undefined;
    const parsed = await backendRouter.sampleColor(x, y, radius, documentId);
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
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const points = parseSamplePoints(args.points);
    const chunkSize = 48;
    const samples: unknown[] = [];
    let document: unknown;
    let batchCount = 0;
    const documentId =
      typeof args.document_id === 'number' &&
      Number.isInteger(args.document_id) &&
      args.document_id > 0
        ? args.document_id
        : undefined;
    for (let offset = 0; offset < points.length; offset += chunkSize) {
      const chunk = points.slice(offset, offset + chunkSize);
      const parsed = await backendRouter.sampleColors(chunk, documentId);
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
