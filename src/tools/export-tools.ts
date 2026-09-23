import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { invokeUxpOperation } from '../platform/uxp-bridge-client.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

const EXPORT_FORMATS = ['PNG', 'JPEG', 'WEBP', 'AVIF'] as const;
type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function createExportTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_export_as',
        description:
          'Export a copy of the active document as PNG, JPEG, WebP or AVIF without changing the open document. WebP/AVIF require Photoshop 23.2+/recent builds and return a clear error when unsupported.\n\n' +
          'Users often say: export for web, save as webp, quick export png.\n\n' +
          'Use when: web-ready delivery formats are needed (WebP/AVIF/modern pipelines).\n' +
          'Do NOT use when: saving the working document itself — use photoshop_save_document.\n\n' +
          'Returns: JSON { ok, summary, details: { path, format, method } }.\n' +
          'Preconditions: active document. Side effects: writes one file to path.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute output file path (extension should match format)' },
            format: { type: 'string', enum: EXPORT_FORMATS, description: 'Export format', default: 'PNG' },
            quality: { type: 'number', description: 'Quality 0-100 (JPEG/WebP/AVIF)', minimum: 0, maximum: 100, default: 80 },
          },
          required: ['path'],
        },
      },
      handler: async (args) => exportAs(connection, backendRouter, args),
    },
  ];
}

async function exportAs(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const filePath = typeof args.path === 'string' ? args.path.trim() : '';
  if (!filePath) {
    return atomicFailureFromError(new Error('path parameter is required'));
  }
  const format: ExportFormat = EXPORT_FORMATS.includes(args.format as ExportFormat)
    ? (args.format as ExportFormat)
    : 'PNG';
  const quality =
    typeof args.quality === 'number' && Number.isFinite(args.quality)
      ? Math.max(0, Math.min(100, Math.round(args.quality)))
      : 80;

  try {
    const backend = await backendRouter.backendFor('document.export');
    let parsed: Record<string, unknown>;
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' &&
        Number.isSafeInteger(args.document_id) &&
        args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpOperation(
        'export_as',
        {
          ...(documentId !== undefined ? { document_id: documentId } : {}),
          path: filePath,
          format,
          quality,
        },
        'uxp_export_as_failed',
        60_000
      );
      if (!result.ok || !result.data) {
        return atomicFailureFromError(new Error(result.error ?? 'uxp_export_as_failed'));
      }
      parsed = result.data;
    } else {
      const raw = await runSnippet(
        connection,
        ExtendScriptSnippets.exportAs(filePath, format, quality)
      );
      const legacy = parseSnippetResult(raw);
      if (!legacy) {
        return atomicFailureFromError(new Error(`Unparseable export result: ${String(raw)}`));
      }
      parsed = legacy;
    }
    if (parsed.ok === false) {
      return atomicFailureFromError(new Error(String(parsed.message || 'Export failed')), {
        code: 'version_unsupported',
        suggested_next_tool: 'photoshop_save_document',
      });
    }
    return atomicSuccess(`Exported ${format} to ${filePath}`, {
      path: filePath,
      format,
      method: parsed.method,
    });
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
