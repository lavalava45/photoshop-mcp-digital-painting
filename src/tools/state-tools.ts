import { readFile, unlink, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, parse as parsePath, resolve } from 'node:path';
import jpeg from 'jpeg-js';
import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { resolvePhotoshopCapabilities } from '../platform/capabilities.js';
import { PhotoshopConnection } from '../platform/connection.js';
import {
  PhotoshopBackendRouter,
  type PhotoshopPreviewImage,
} from '../platform/photoshop-backend.js';
import { envelopeToToolResult, classifyError } from '../errors/envelope.js';

const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

export function createStateTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_get_state',
        description:
          'Return a cheap read-only snapshot of Photoshop session state (active document, layer, selection).\n\n' +
          'Use when: before the first document/layer-dependent action, when active state may have changed, or after an error to recover context. A verified document/layer latch does not require repeating this read before every atomic action.\n' +
          'Do NOT use when: you only need a visual preview — use photoshop_get_preview instead.\n\n' +
          'Returns: JSON with hasDocument, document.id/name/dimensions/colorMode, activeLayer kind/name, hasSelection. Capture document.id and pass it as document_id on later mutating calls.\n' +
          'Preconditions: none (safe on empty session). Side effects: none.',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => getState(backendRouter),
    },
    {
      tool: {
        name: 'photoshop_get_preview',
        description:
          'Export the active/pinned document as a base64 JPEG preview for visual verification. The server injects optional document_id targeting for this tool; use it when multiple documents may be open.\n\n' +
          'Use when: after visual edits to confirm result before reporting success to the user.\n' +
          'Do NOT use when: you only need numeric state — use photoshop_get_state (much cheaper).\n\n' +
          'Returns: MCP image content block (JPEG) plus metadata text by default. Terminal-only clients may set materialize_path and include_image=false to persist the same JPEG and receive only lightweight metadata.\n' +
          'Preconditions: active document required. Side effects: creates and deletes an internal temp file; materialize_path additionally writes/overwrites the requested preview file. The Photoshop document is not modified.',
        inputSchema: {
          type: 'object',
          properties: {
            max_dimension_px: {
              type: 'number',
              description: 'Maximum long edge in pixels (default 1024)',
              default: 1024,
            },
            quality: {
              type: 'number',
              description: 'JPEG quality 1–12 (default 8)',
              minimum: 1,
              maximum: 12,
              default: 8,
            },
            materialize_path: {
              type: 'string',
              description:
                'Optional absolute filesystem path where the same preview JPEG should be persisted. Useful for terminal-only MCP clients that cannot display MCP image content blocks. Parent directories are created automatically and an existing file is overwritten.',
            },
            include_image: {
              type: 'boolean',
              description:
                'Whether to include the base64 MCP image content block. Default true. Set false together with materialize_path for terminal-only clients to avoid sending the image payload over stdio.',
              default: true,
            },
            focus_region: {
              type: 'object',
              description:
                'Optional local crop returned together with the whole-document preview. Coordinates are source-document pixels.',
              properties: {
                left: { type: 'number' },
                top: { type: 'number' },
                right: { type: 'number' },
                bottom: { type: 'number' },
              },
              required: ['left', 'top', 'right', 'bottom'],
              additionalProperties: false,
            },
            focus_max_dimension_px: {
              type: 'number',
              description: 'Maximum long edge for focus_region (default 1200)',
              default: 1200,
            },
          },
        },
      },
      handler: async (args) => getPreview(backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_get_capabilities',
        description:
          'Return version-aware feature flags for the installed Photoshop (Select Subject v2, native Sky Replacement, UXP bridge, etc.).\n\n' +
          'Use when: once per session before suggesting version-gated Photoshop features or recipes.\n' +
          'Do NOT use when: Photoshop version is already known from photoshop_get_version.\n\n' +
          'Returns: JSON { version, features: { select_subject_v2, sky_replacement_native, neural_filters, ... } }.\n' +
          'Preconditions: none. Side effects: none.',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => getCapabilities(connection),
    },
  ];
}

async function getState(backendRouter: PhotoshopBackendRouter): Promise<ToolResult> {
  try {
    const result = await backendRouter.readState();
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return envelopeToToolResult(
      classifyError(error instanceof Error ? error.message : String(error))
    );
  }
}

function previewJpegQuality(quality: number): number {
  const clamped = Math.max(1, Math.min(12, Math.round(quality)));
  return Math.max(1, Math.min(100, Math.round((clamped / 12) * 100)));
}

async function previewImageBuffer(
  image: PhotoshopPreviewImage,
  transport: 'uxp' | 'extendscript',
  quality: number
): Promise<Buffer> {
  let buffer: Buffer;
  if (typeof image.base64 === 'string' && image.base64.length > 0) {
    buffer = Buffer.from(image.base64, 'base64');
  } else if (typeof image.path === 'string' && image.path.length > 0) {
    buffer = await readFile(image.path);
  } else {
    throw new Error('Preview backend returned neither base64 nor path data');
  }

  if (transport !== 'uxp') return buffer;
  const decoded = jpeg.decode(buffer, { useTArray: true });
  if (!decoded?.data || !decoded.width || !decoded.height) {
    throw new Error('Unable to decode UXP preview JPEG');
  }
  return Buffer.from(
    jpeg.encode(
      { data: decoded.data, width: decoded.width, height: decoded.height },
      previewJpegQuality(quality)
    ).data
  );
}

async function getPreview(
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const maxDimension = (args.max_dimension_px as number) || 1024;
  const quality = (args.quality as number) || 8;
  const includeImage = args.include_image !== false;
  const focusMaxDimension = (args.focus_max_dimension_px as number) || 1200;
  const focusRegion = args.focus_region;
  const requestedMaterializePath =
    typeof args.materialize_path === 'string' && args.materialize_path.trim()
      ? args.materialize_path.trim()
      : undefined;

  if (requestedMaterializePath && !isAbsolute(requestedMaterializePath)) {
    return envelopeToToolResult({
      ok: false,
      code: 'invalid_arguments',
      message: 'materialize_path must be an absolute filesystem path',
    });
  }

  if (!includeImage && !requestedMaterializePath) {
    return envelopeToToolResult({
      ok: false,
      code: 'invalid_arguments',
      message: 'include_image=false requires materialize_path so the preview remains accessible',
    });
  }

  let tempPath: string | undefined;
  let focusTempPath: string | undefined;

  try {
    let parsedFocus:
      | { left: number; top: number; right: number; bottom: number }
      | undefined;
    if (focusRegion !== undefined) {
      if (!focusRegion || typeof focusRegion !== 'object' || Array.isArray(focusRegion)) {
        throw new Error('focus_region must be an object');
      }
      const region = focusRegion as Record<string, unknown>;
      const left = Number(region.left);
      const top = Number(region.top);
      const right = Number(region.right);
      const bottom = Number(region.bottom);
      if (![left, top, right, bottom].every(Number.isFinite)) {
        throw new Error('focus_region left/top/right/bottom must be finite numbers');
      }
      if (right <= left || bottom <= top) throw new Error('focus_region must have positive width and height');
      if (!Number.isFinite(focusMaxDimension) || focusMaxDimension < 64 || focusMaxDimension > 4096) {
        throw new Error('focus_max_dimension_px must be between 64 and 4096');
      }
      parsedFocus = { left, top, right, bottom };
    }

    const documentId =
      typeof args.document_id === 'number' &&
      Number.isInteger(args.document_id) &&
      args.document_id > 0
        ? args.document_id
        : undefined;
    const capture = await backendRouter.capturePreview({
      ...(documentId !== undefined ? { documentId } : {}),
      maxDimension,
      quality,
      ...(parsedFocus ? { focusRegion: parsedFocus, focusMaxDimension } : {}),
    });
    const result = capture.whole;
    const focusResult = capture.focus;

    tempPath = result.path;
    const buffer = await previewImageBuffer(result, capture.transport, quality);

    if (buffer.byteLength > PREVIEW_MAX_BYTES) {
      return envelopeToToolResult(
        classifyError(
          `Preview exceeds ${PREVIEW_MAX_BYTES} byte limit (${buffer.byteLength} bytes). Lower max_dimension_px or quality.`
        )
      );
    }

    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const materializedPath = requestedMaterializePath
      ? resolve(requestedMaterializePath)
      : undefined;

    if (materializedPath) {
      await mkdir(dirname(materializedPath), { recursive: true });
      await writeFile(materializedPath, buffer);
    }

    let focus:
      | {
          width: number;
          height: number;
          bytes: number;
          mimeType: string;
          sha256: string;
          region: { left: number; top: number; right: number; bottom: number };
          canvasWidth?: number;
          canvasHeight?: number;
          materializedPath?: string;
          buffer: Buffer;
        }
      | undefined;

    if (focusResult) {
      focusTempPath = focusResult.path;
      const focusBuffer = await previewImageBuffer(focusResult, capture.transport, quality);
      if (focusBuffer.byteLength > PREVIEW_MAX_BYTES) {
        throw new Error('Focus preview exceeds byte limit; lower focus_max_dimension_px or quality');
      }
      const focusSha256 = createHash('sha256').update(focusBuffer).digest('hex');
      let focusMaterializedPath: string | undefined;
      if (materializedPath) {
        const parsed = parsePath(materializedPath);
        focusMaterializedPath = join(parsed.dir, `${parsed.name}-focus${parsed.ext || '.jpg'}`);
        await writeFile(focusMaterializedPath, focusBuffer);
      }
      focus = {
        width: focusResult.width,
        height: focusResult.height,
        bytes: focusBuffer.byteLength,
        mimeType: focusResult.mimeType || 'image/jpeg',
        sha256: focusSha256,
        region: focusResult.region ?? parsedFocus!,
        ...(Number.isFinite(focusResult.canvasWidth) ? { canvasWidth: focusResult.canvasWidth } : {}),
        ...(Number.isFinite(focusResult.canvasHeight) ? { canvasHeight: focusResult.canvasHeight } : {}),
        ...(focusMaterializedPath ? { materializedPath: focusMaterializedPath } : {}),
        buffer: focusBuffer,
      };
    }

    const content: ToolResult['content'] = [];
    if (includeImage) {
      content.push({
        type: 'image',
        data: buffer.toString('base64'),
        mimeType: result.mimeType || 'image/jpeg',
      });
      if (focus) {
        content.push({
          type: 'image',
          data: focus.buffer.toString('base64'),
          mimeType: focus.mimeType,
        });
      }
    }

    content.push({
      type: 'text',
      text: JSON.stringify(
        {
          ok: true,
          width: result.width,
          height: result.height,
          bytes: buffer.byteLength,
          mime_type: result.mimeType || 'image/jpeg',
          sha256,
          include_image: includeImage,
          ...(Number.isFinite(result.canvasWidth) ? { canvas_width: result.canvasWidth } : {}),
          ...(Number.isFinite(result.canvasHeight) ? { canvas_height: result.canvasHeight } : {}),
          ...(Number.isFinite(result.canvasWidth) && result.canvasWidth! > 0 ? { scale_x: result.width / result.canvasWidth! } : {}),
          ...(Number.isFinite(result.canvasHeight) && result.canvasHeight! > 0 ? { scale_y: result.height / result.canvasHeight! } : {}),
          ...(materializedPath ? { materialized_path: materializedPath } : {}),
          ...(focus
            ? {
                focus: {
                  width: focus.width,
                  height: focus.height,
                  bytes: focus.bytes,
                  mime_type: focus.mimeType,
                  sha256: focus.sha256,
                  region: focus.region,
                  ...(Number.isFinite(focus.canvasWidth) ? { canvas_width: focus.canvasWidth } : {}),
                  ...(Number.isFinite(focus.canvasHeight) ? { canvas_height: focus.canvasHeight } : {}),
                  ...((focus.region.right - focus.region.left) > 0
                    ? { scale_x: focus.width / (focus.region.right - focus.region.left) }
                    : {}),
                  ...((focus.region.bottom - focus.region.top) > 0
                    ? { scale_y: focus.height / (focus.region.bottom - focus.region.top) }
                    : {}),
                  ...(focus.materializedPath ? { materialized_path: focus.materializedPath } : {}),
                },
              }
            : {}),
        },
        null,
        2
      ),
    });

    return {
      content,
    };
  } catch (error) {
    return envelopeToToolResult(
      classifyError(error instanceof Error ? error.message : String(error))
    );
  } finally {
    if (tempPath) {
      await unlink(tempPath).catch(() => undefined);
    }
    if (focusTempPath) {
      await unlink(focusTempPath).catch(() => undefined);
    }
  }
}

async function getCapabilities(connection: PhotoshopConnection): Promise<ToolResult> {
  try {
    const version = await connection.getVersion();
    const capabilities = await resolvePhotoshopCapabilities(version);
    return {
      content: [{ type: 'text', text: JSON.stringify(capabilities, null, 2) }],
    };
  } catch (error) {
    return envelopeToToolResult(
      classifyError(error instanceof Error ? error.message : String(error))
    );
  }
}
