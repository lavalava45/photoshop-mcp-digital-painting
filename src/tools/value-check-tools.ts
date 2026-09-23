import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { ToolDefinition, ToolRegistry } from '../core/tool-registry.js';
import { analyzeLuminanceJpeg } from '../core/value-check.js';

function textBody(result: Awaited<ReturnType<ToolRegistry['execute']>>): Record<string, unknown> | undefined {
  const item = result.content.find(content => content.type === 'text');
  if (!item || !('text' in item)) return undefined;
  try { return JSON.parse(item.text) as Record<string, unknown>; } catch { return undefined; }
}

export function createValueCheckTools(registry: ToolRegistry): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_analyze_value_structure',
        description:
          'Capture a non-destructive Photoshop preview and derive grayscale/luminance evidence in Node. Returns a grayscale JPEG plus descriptive luminance summaries for Art Director review. It never declares artistic PASS automatically and does not modify the PSD.',
        inputSchema: {
          type: 'object',
          properties: {
            document_id: {
              type: 'number',
              minimum: 1,
              description: 'Required pinned Photoshop document id whose current preview is analyzed.',
            },
            max_dimension_px: { type: 'number', minimum: 128, maximum: 2048, default: 1000 },
            materialize_path: {
              type: 'string',
              description: 'Optional absolute path where the derived grayscale JPEG should be written for external visual inspection.',
            },
          },
          required: ['document_id'],
          additionalProperties: false,
        },
      },
      handler: async (args) => {
        const requestedPath = typeof args.materialize_path === 'string' && args.materialize_path.trim()
          ? args.materialize_path.trim()
          : undefined;
        if (requestedPath && !isAbsolute(requestedPath)) {
          return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'invalid_arguments', message: 'materialize_path must be absolute' }) }] };
        }
        const preview = registry.get('photoshop_get_preview');
        if (!preview) throw new Error('photoshop_get_preview is not registered');
        const result = await preview.handler({
          ...(args.document_id === undefined ? {} : { document_id: args.document_id }),
          max_dimension_px: typeof args.max_dimension_px === 'number' ? args.max_dimension_px : 1000,
          quality: 8,
          include_image: true,
        });
        const image = result.content.find(content => content.type === 'image');
        const meta = textBody(result);
        if (!image || !('data' in image)) {
          return { isError: true, content: [{ type: 'text', text: JSON.stringify({ ok: false, code: 'value_preview_unavailable', preview: meta ?? null }) }] };
        }
        const original = Buffer.from(image.data, 'base64');
        const evidence = analyzeLuminanceJpeg(original);
        const grayscaleSha = createHash('sha256').update(evidence.grayscale_jpeg).digest('hex');
        const materializedPath = requestedPath ? resolve(requestedPath) : undefined;
        if (materializedPath) {
          await mkdir(dirname(materializedPath), { recursive: true });
          await writeFile(materializedPath, evidence.grayscale_jpeg);
        }
        return {
          content: [
            { type: 'image', data: evidence.grayscale_jpeg.toString('base64'), mimeType: 'image/jpeg' },
            {
              type: 'text',
              text: JSON.stringify({
                ok: true,
                observed: true,
                source_preview_sha256: typeof meta?.sha256 === 'string' ? meta.sha256 : null,
                grayscale_sha256: grayscaleSha,
                ...(materializedPath ? { materialized_path: materializedPath } : {}),
                width: evidence.width,
                height: evidence.height,
                sampled_pixels: evidence.sampled_pixels,
                luminance_summary: {
                  p10: evidence.p10_luma,
                  p50: evidence.p50_luma,
                  p90: evidence.p90_luma,
                  dark_ratio: evidence.dark_ratio,
                  midtone_ratio: evidence.midtone_ratio,
                  light_ratio: evidence.light_ratio,
                  center_mean: evidence.center_mean_luma,
                  border_mean: evidence.border_mean_luma,
                  center_border_abs_delta: evidence.center_border_abs_delta,
                },
                interpretation_note:
                  'These are descriptive luminance summaries, not an artistic score. Art Director must inspect the grayscale image and classify value criteria explicitly.',
              }, null, 2),
            },
          ],
        };
      },
    },
  ];
}
