import { readFile, unlink, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, isAbsolute, resolve } from 'node:path';
import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { resolvePhotoshopCapabilities } from '../platform/capabilities.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { envelopeToToolResult, classifyError } from '../errors/envelope.js';
import { parseExtendScriptPayload } from '../utils/extendscript-result.js';

const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

async function runScript(connection: PhotoshopConnection, script: string): Promise<unknown> {
  const apiFactory = new PhotoshopAPIFactory(connection);
  const api = await apiFactory.createAPI();
  return api.executeScript(script);
}

export function createStateTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_get_state',
        description:
          'Return a cheap read-only snapshot of Photoshop session state (active document, layer, selection).\n\n' +
          'Use when: before any tool that needs an active document/layer, or after an error to recover context.\n' +
          'Do NOT use when: you only need a visual preview — use photoshop_get_preview instead.\n\n' +
          'Returns: JSON with hasDocument, document.id/name/dimensions/colorMode, activeLayer kind/name, hasSelection. Capture document.id and pass it as document_id on later mutating calls.\n' +
          'Preconditions: none (safe on empty session). Side effects: none.',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => getState(connection),
    },
    {
      tool: {
        name: 'photoshop_get_preview',
        description:
          'Export the active document as a base64 JPEG preview for visual verification.\n\n' +
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
          },
        },
      },
      handler: async (args) => getPreview(connection, args),
    },
    {
      tool: {
        name: 'photoshop_get_capabilities',
        description:
          'Return version-aware feature flags for the installed Photoshop (Select Subject v2, Generative Fill, etc.).\n\n' +
          'Use when: once per session before suggesting AI-powered features or gated recipes.\n' +
          'Do NOT use when: Photoshop version is already known from photoshop_get_version.\n\n' +
          'Returns: JSON { version, features: { select_subject_v2, generative_fill, ... } }.\n' +
          'Preconditions: none. Side effects: none.',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => getCapabilities(connection),
    },
  ];
}

async function getState(connection: PhotoshopConnection): Promise<ToolResult> {
  try {
    const raw = await runScript(connection, ExtendScriptSnippets.getState());
    const result = parseExtendScriptPayload(raw);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return envelopeToToolResult(
      classifyError(error instanceof Error ? error.message : String(error))
    );
  }
}

async function getPreview(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const maxDimension = (args.max_dimension_px as number) || 1024;
  const quality = (args.quality as number) || 8;
  const includeImage = args.include_image !== false;
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

  try {
    const result = (await runScript(
      connection,
      ExtendScriptSnippets.exportPreview(maxDimension, quality)
    )) as { path: string; width: number; height: number; mimeType: string };

    tempPath = result.path;
    const buffer = await readFile(tempPath);

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

    const content: ToolResult['content'] = [];
    if (includeImage) {
      content.push({
        type: 'image',
        data: buffer.toString('base64'),
        mimeType: result.mimeType || 'image/jpeg',
      });
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
          ...(materializedPath ? { materialized_path: materializedPath } : {}),
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
