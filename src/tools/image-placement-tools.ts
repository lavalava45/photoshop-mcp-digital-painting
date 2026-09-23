import { randomUUID } from 'node:crypto';
import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { documentGuardScript } from '../core/document-target.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { invokeUxpOpenImage, invokeUxpOperation } from '../platform/uxp-bridge-client.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { atomicFailureFromError, atomicSuccess } from './atomic-shared.js';

function documentIdParams(args: Record<string, unknown>): Record<string, unknown> {
  return typeof args.document_id === 'number' &&
    Number.isSafeInteger(args.document_id) &&
    args.document_id > 0
    ? { document_id: args.document_id }
    : {};
}

export function createImagePlacementTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_place_image',
        description:
          'Place an external image file as a new layer in the active document.\n\n' +
          'x/y are absolute canvas coordinates for the placed layer\'s top-left bound in pixels ' +
          '(0,0 = document top-left). They are NOT an offset from Photoshop\'s default centered Place.\n\n' +
          'Use when: compositing assets into an open document at a known position.\n' +
          'Do NOT use when: opening a file as a new document — use photoshop_open_image.\n\n' +
          'Returns: placed layer name, bounds, and position.semantics = absolute_top_left.\n' +
          'Preconditions: active document; file must exist. Side effects: adds a new layer.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Full path to the image file (JPEG, PNG, PSD, etc.)',
            },
            x: {
              type: 'number',
              description: 'Absolute canvas X of the placed layer top-left, in pixels (default: 0)',
              default: 0,
            },
            y: {
              type: 'number',
              description: 'Absolute canvas Y of the placed layer top-left, in pixels (default: 0)',
              default: 0,
            },
          },
          required: ['filePath'],
        },
      },
      handler: async (args) => placeImage(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_open_image',
        description:
          'Open an image file as a new Photoshop document.\n\n' +
          'Use when: user provides a file path to edit or no document is open yet.\n' +
          'Do NOT use when: adding to an existing composite — use photoshop_place_image.\n\n' +
          'Returns: document id, name, width, height.\n' +
          'Preconditions: file must exist on disk. Side effects: opens document as active.',
        inputSchema: {
          type: 'object',
          properties: {
            filePath: {
              type: 'string',
              description: 'Full path to the image file',
            },
          },
          required: ['filePath'],
        },
      },
      handler: async (args) => openImage(connection, backendRouter, args),
    },
  ];
}

async function placeImage(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const filePath = args.filePath as string;
  const x = typeof args.x === 'number' && Number.isFinite(args.x) ? args.x : 0;
  const y = typeof args.y === 'number' && Number.isFinite(args.y) ? args.y : 0;

  try {
    const backend = await backendRouter.backendFor('document.place');
    let result: unknown;
    if (backend.kind === 'uxp') {
      const uxpResult = await invokeUxpOperation(
        'place_image',
        { filePath, x, y, ...documentIdParams(args) },
        'uxp_place_image_failed'
      );
      if (!uxpResult.ok) throw new Error(uxpResult.error ?? 'uxp_place_image_failed');
      result = uxpResult.data;
    } else {
      const api = await new PhotoshopAPIFactory(connection).createAPI();
      const script = ExtendScriptSnippets.placeImage(filePath, x, y);
      const documentId = documentIdParams(args).document_id;
      result = await api.executeScript(
        typeof documentId === 'number'
          ? `${documentGuardScript(documentId)}\n${script}`
          : script
      );
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Image placed successfully: ${filePath}\nPosition (absolute top-left): (${x}, ${y})\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error placing image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function openImage(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const filePath = args.filePath as string;
  const guardOperationId =
    typeof args._guard_operation_id === 'string' && args._guard_operation_id.trim().length > 0
      ? args._guard_operation_id.trim()
      : null;
  const commandId = guardOperationId ?? `direct-open-image-${randomUUID()}`;

  try {
    const backend = await backendRouter.backendFor('document.open');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOpenImage({ filePath }, commandId);
      if (!result.ok) {
        const durableNotExecuted =
          result.pre_dispatch_rejected || result.receipt?.state === 'not-claimed';
        const body = {
          ok: false,
          code:
            result.error?.includes('revision') || result.error?.includes('plugin_not_connected')
              ? 'uxp_bridge_unavailable'
              : result.error?.includes('not exist') || result.error?.includes('file')
                ? 'file_not_found'
                : 'unknown',
          message: `UXP open_image failed: ${result.error ?? 'unknown error'}`,
          command_id: commandId,
          uxp_command_receipt: result.receipt,
          ...(durableNotExecuted
            ? {
                execution: 'not-executed',
                next_required_action:
                  'The UXP command was not claimed by Photoshop. A retry may use the same stable command identity.',
              }
            : {}),
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(body, null, 2) }],
          isError: true,
        };
      }

      return atomicSuccess(
        `Image opened as a new document via UXP: ${filePath}`,
        {
          transport: 'uxp',
          command_id: commandId,
          uxp_command_receipt: result.receipt,
          ...(result.data ?? {}),
        },
        'photoshop_get_document_info'
      );
    }

    const api = await new PhotoshopAPIFactory(connection).createAPI();
    const result = await api.executeScript(ExtendScriptSnippets.openImage(filePath));
    return {
      content: [{
        type: 'text' as const,
        text: `Image opened as new document: ${filePath}\nResult: ${JSON.stringify(result)}`,
      }],
    };
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
