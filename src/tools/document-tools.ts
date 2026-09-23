import { randomUUID } from 'node:crypto';
import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { documentGuardScript } from '../core/document-target.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import {
  invokeUxpCreateDocument,
  invokeUxpOperation,
  invokeUxpSaveDocument,
  type UxpSaveFormat,
} from '../platform/uxp-bridge-client.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import {
  atomicFailure,
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

export function createDocumentTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_create_document',
        description:
          'Create a new empty Photoshop document with specified dimensions and color mode.\n\n' +
          'Use when: starting a design from scratch or no document is open.\n' +
          'Do NOT use when: opening an existing file — use photoshop_open_image.\n\n' +
          'Returns: created document id and name.\n' +
          'Preconditions: none. Side effects: creates a new document and makes it active.',
        inputSchema: {
          type: 'object',
          properties: {
            width: {
              type: 'number',
              description: 'Document width in pixels',
              minimum: 1,
            },
            height: {
              type: 'number',
              description: 'Document height in pixels',
              minimum: 1,
            },
            resolution: {
              type: 'number',
              description: 'Document resolution in DPI (default: 72)',
              default: 72,
            },
            colorMode: {
              type: 'string',
              description: 'Color mode (RGB, CMYK, Grayscale)',
              enum: ['RGB', 'CMYK', 'Grayscale'],
              default: 'RGB',
            },
          },
          required: ['width', 'height'],
        },
      },
      handler: async (args) => createDocument(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_get_document_info',
        description: 'Get information about the active Photoshop document',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => getDocumentInfo(backendRouter),
    },
    {
      tool: {
        name: 'photoshop_list_documents',
        description:
          'List every open Photoshop document with id, dimensions, and which tab is active (read-only).\n\n' +
          'Use when: multiple documents are open and you need document_id before switching tabs or closing a specific file.\n' +
          'Do NOT use when: you only need the active document — use photoshop_get_document_info or photoshop_get_state.\n\n' +
          'Returns: JSON { ok, summary, details: { count, documents[], active_document_id, context } }.\n' +
          'Preconditions: none (safe when zero documents open). Side effects: none.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => listDocuments(backendRouter),
    },
    {
      tool: {
        name: 'photoshop_set_active_document',
        description:
          'Switch the active document tab by document_id (preferred), zero-based index, or name.\n\n' +
          'Use when: working across multiple open files and mutations must target a specific document.\n' +
          'Do NOT use when: only one document is open — it is already active.\n' +
          'Do NOT use document_name when duplicate names exist — use document_id from photoshop_list_documents.\n\n' +
          'Returns: JSON { ok, summary, details: { activated: { id, name }, context } }.\n' +
          'Preconditions: target document must be open. Provide exactly one of document_id, index, or document_name. Side effects: changes active tab.',
        inputSchema: {
          type: 'object',
          properties: {
            document_id: {
              type: 'number',
              description: 'Unique internal document id from photoshop_list_documents (preferred)',
            },
            index: {
              type: 'number',
              description: 'Zero-based tab order index (leftmost tab is 0)',
              minimum: 0,
            },
            document_name: {
              type: 'string',
              description: 'Document name/title (ambiguous if multiple tabs share the same name)',
            },
          },
        },
      },
      handler: async (args) => setActiveDocument(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_save_document',
        description:
          'Save a non-interfering copy/checkpoint of the pinned or active document through the UXP bridge in PSD, JPEG, or PNG format.\n\n' +
          'Use when: user requests export/save with a specific path and format, or the painting controller requires a PSD checkpoint.\n' +
          'Do NOT use when: web-optimized resize+sharpen pipeline is needed — use photoshop_recipe_prepare_for_web.\n\n' +
          'Returns: saved path/format plus UXP pre/post persistence invariants.\n' +
          'Preconditions: Photoshop UXP companion loaded; path required. Side effects: writes a copy to disk. It must not switch the active document, working-file association, active layer/tool, or selection, and it never falls back to foreground-prone COM persistence.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Full path where to save the document',
            },
            format: {
              type: 'string',
              description: 'File format (PSD, JPEG, PNG)',
              enum: ['PSD', 'JPEG', 'PNG'],
              default: 'PSD',
            },
            quality: {
              type: 'number',
              description: 'Quality for JPEG (1-12, default: 8)',
              minimum: 1,
              maximum: 12,
              default: 8,
            },
          },
          required: ['path'],
        },
      },
      handler: async (args) => saveDocument(connection, args),
    },
    {
      tool: {
        name: 'photoshop_close_document',
        description: 'Close the active Photoshop document',
        inputSchema: {
          type: 'object',
          properties: {
            save: {
              type: 'boolean',
              description: 'Whether to save changes before closing',
              default: false,
            },
          },
        },
      },
      handler: async (args) => closeDocument(connection, backendRouter, args),
    },
  ];
}

async function createDocument(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const width = args.width as number;
  const height = args.height as number;
  const resolution = (args.resolution as number) || 72;
  const colorMode = (args.colorMode as string) || 'RGB';

  const guardOperationId =
    typeof args._guard_operation_id === 'string' && args._guard_operation_id.trim().length > 0
      ? args._guard_operation_id.trim()
      : null;
  const commandId = guardOperationId ?? `direct-create-document-${randomUUID()}`;

  try {
    const backend = await backendRouter.backendFor('document.create');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpCreateDocument(
        {
          width,
          height,
          resolution,
          colorMode: (['RGB', 'CMYK', 'Grayscale'].includes(colorMode) ? colorMode : 'RGB') as
            | 'RGB'
            | 'CMYK'
            | 'Grayscale',
        },
        commandId
      );
      if (!result.ok) {
        const durableNotExecuted =
          result.pre_dispatch_rejected || result.receipt?.state === 'not-claimed';
        const body = {
          ok: false,
          code:
            result.error?.includes('revision') || result.error?.includes('plugin_not_connected')
              ? 'uxp_bridge_unavailable'
              : 'unknown',
          message: `UXP create_document failed: ${result.error ?? 'unknown error'}`,
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
        `Document created via UXP: ${width}x${height}px at ${resolution}dpi (${colorMode})`,
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
    const colorModeMap: Record<string, string> = {
      RGB: 'NewDocumentMode.RGB',
      CMYK: 'NewDocumentMode.CMYK',
      Grayscale: 'NewDocumentMode.GRAYSCALE',
    };
    await api.executeScript(
      ExtendScriptSnippets.newDocument(
        width,
        height,
        resolution,
        colorModeMap[colorMode] || 'NewDocumentMode.RGB'
      )
    );
    return {
      content: [{
        type: 'text' as const,
        text: `Document created: ${width}x${height}px at ${resolution}dpi (${colorMode})`,
      }],
    };
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function listDocuments(backendRouter: PhotoshopBackendRouter): Promise<ToolResult> {
  try {
    const parsed = await backendRouter.listDocuments();

    if (parsed.ok === false) {
      return atomicFailure({
        ok: false,
        code: 'extendscript_runtime_error',
        message: String(parsed.message || 'Failed to list documents'),
        suggested_next_tool: 'photoshop_get_state',
      });
    }

    const count = typeof parsed.count === 'number' ? parsed.count : 0;
    const details: Record<string, unknown> = {
      count,
      documents: parsed.documents ?? [],
      active_document_id: parsed.active_document_id ?? null,
    };
    if (parsed.context !== undefined) {
      details.context = parsed.context;
    }

    return atomicSuccess(
      count === 0 ? 'No documents open' : `${count} open document${count === 1 ? '' : 's'}`,
      details,
      count === 0 ? 'photoshop_create_document' : 'photoshop_get_document_info'
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

function countSetActiveIdentifiers(args: Record<string, unknown>): number {
  let count = 0;
  if (args.document_id !== undefined && args.document_id !== null) count++;
  if (args.index !== undefined && args.index !== null) count++;
  if (typeof args.document_name === 'string' && args.document_name.length > 0) count++;
  return count;
}

async function setActiveDocument(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const identifierCount = countSetActiveIdentifiers(args);
  if (identifierCount !== 1) {
    return atomicFailure({
      ok: false,
      code: 'invalid_arguments',
      message:
        'Exactly one of document_id, index, or document_name is required to set the active document',
      suggested_next_tool: 'photoshop_list_documents',
    });
  }

  const params: { documentId?: number; documentName?: string; index?: number } = {};
  if (args.document_id !== undefined && args.document_id !== null) {
    params.documentId = args.document_id as number;
  } else if (args.index !== undefined && args.index !== null) {
    params.index = args.index as number;
  } else {
    params.documentName = args.document_name as string;
  }

  try {
    const backend = await backendRouter.backendFor('document.activate');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'set_active_document',
        {
          ...(params.documentId !== undefined ? { document_id: params.documentId } : {}),
          ...(params.index !== undefined ? { index: params.index } : {}),
          ...(params.documentName !== undefined ? { document_name: params.documentName } : {}),
        },
        'uxp_set_active_document_failed'
      );
      if (!result.ok || !result.data) {
        throw new Error(result.error ?? 'uxp_set_active_document_failed');
      }

      if (result.data.ok === false) {
        const code =
          result.data.code === 'document_not_found' || result.data.code === 'ambiguous_name'
            ? result.data.code
            : 'unknown';
        return atomicFailure({
          ok: false,
          code,
          message: String(result.data.message || 'Failed to set active document'),
          suggested_next_tool: 'photoshop_list_documents',
          ...(Array.isArray(result.data.matching_document_ids)
            ? { suggested_args: { matching_document_ids: result.data.matching_document_ids } }
            : {}),
        });
      }

      const activated = result.data.activated as { id?: number; name?: string } | undefined;
      const details: Record<string, unknown> = {};
      if (activated) details.activated = activated;
      if (result.data.context !== undefined) details.context = result.data.context;
      return atomicSuccess(
        activated?.name
          ? `Active document set to \"${activated.name}\"`
          : 'Active document switched',
        details,
        'photoshop_get_document_info'
      );
    }

    const raw = await runSnippet(connection, ExtendScriptSnippets.setActiveDocument(params));
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Snippet returned unparseable payload: ${String(raw)}`));
    }

    if (parsed.ok === false) {
      const code =
        parsed.code === 'document_not_found' || parsed.code === 'ambiguous_name'
          ? parsed.code
          : 'extendscript_runtime_error';
      return atomicFailure({
        ok: false,
        code,
        message: String(parsed.message || 'Failed to set active document'),
        suggested_next_tool: 'photoshop_list_documents',
        ...(parsed.matching_document_ids
          ? { suggested_args: { matching_document_ids: parsed.matching_document_ids } }
          : {}),
      });
    }

    const activated = parsed.activated as { id?: number; name?: string } | undefined;
    const details: Record<string, unknown> = {};
    if (activated) {
      details.activated = activated;
    }
    if (parsed.context !== undefined) {
      details.context = parsed.context;
    }

    return atomicSuccess(
      activated?.name
        ? `Active document set to "${activated.name}"`
        : 'Active document switched',
      details,
      'photoshop_get_document_info'
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function getDocumentInfo(backendRouter: PhotoshopBackendRouter): Promise<ToolResult> {
  try {
    const result = await backendRouter.readDocumentInfo();

    return {
      content: [
        {
          type: 'text' as const,
          text: `Document info:\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error getting document info: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function saveDocument(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const path = args.path as string;
  const format = ((args.format as string) || 'PSD').toUpperCase() as UxpSaveFormat;
  const quality = (args.quality as number) || 8;

  try {
    void connection;
    if (typeof path !== 'string' || path.trim().length === 0) {
      return atomicFailure({
        ok: false,
        code: 'invalid_arguments',
        message: 'path is required for photoshop_save_document',
      });
    }

    const result = await invokeUxpSaveDocument({
      path,
      format,
      quality,
      ...(typeof args.document_id === 'number' ? { document_id: args.document_id } : {}),
    });
    if (!result.ok) {
      const unavailable = result.error === 'uxp_bridge_unavailable';
      return atomicFailure({
        ok: false,
        code: unavailable ? 'uxp_bridge_unavailable' : 'unknown',
        message:
          unavailable
            ? 'Non-interfering persistence requires the Photoshop MCP UXP Bridge; COM/ExtendScript fallback is intentionally disabled for save/checkpoint.'
            : `UXP save failed: ${result.error ?? 'unknown error'}`,
        suggested_next_tool: unavailable ? 'photoshop_get_capabilities' : 'photoshop_get_state',
      });
    }

    if (result.data?.invariants_ok === false) {
      return atomicFailure({
        ok: false,
        code: 'unknown',
        message: `UXP save completed but persistence invariants changed: ${JSON.stringify(result.data.invariants ?? {})}`,
        suggested_next_tool: 'photoshop_get_state',
      });
    }

    return atomicSuccess(
      `Document copy saved as ${format} via UXP to: ${path}`,
      {
        persistence: {
          transport: 'uxp',
          as_copy: true,
          path,
          format,
          invariants_ok: result.data?.invariants_ok ?? null,
          invariants: result.data?.invariants ?? null,
          before: result.data?.before ?? null,
          after: result.data?.after ?? null,
        },
      },
      'photoshop_get_state'
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function closeDocument(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const save = (args.save as boolean) || false;
  const hasDocumentId = Object.prototype.hasOwnProperty.call(args, 'document_id');
  const documentId =
    hasDocumentId &&
    typeof args.document_id === 'number' &&
    Number.isSafeInteger(args.document_id) &&
    args.document_id > 0
      ? args.document_id
      : undefined;

  if (hasDocumentId && documentId === undefined) {
    return atomicFailure({
      ok: false,
      code: 'invalid_arguments',
      message: 'document_id must be a positive integer',
      suggested_next_tool: 'photoshop_list_documents',
    });
  }

  try {
    const backend = await backendRouter.backendFor('document.close');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'close_document',
        {
          save,
          ...(documentId !== undefined ? { document_id: documentId } : {}),
        },
        'uxp_close_document_failed'
      );
      if (!result.ok || !result.data) {
        throw new Error(result.error ?? 'uxp_close_document_failed');
      }
      if (result.data.ok === false) {
        const code = result.data.code === 'document_not_found' ? 'document_not_found' : 'unknown';
        return atomicFailure({
          ok: false,
          code,
          message: String(result.data.message || 'Failed to close document'),
          suggested_next_tool:
            code === 'document_not_found' ? 'photoshop_list_documents' : 'photoshop_get_state',
        });
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: save ? 'Document closed and saved' : 'Document closed without saving',
          },
        ],
      };
    }

    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const closeScript = ExtendScriptSnippets.closeDocument(save);
    const script =
      documentId !== undefined
        ? `${documentGuardScript(documentId)}\n${closeScript}`
        : closeScript;
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: save ? 'Document closed and saved' : 'Document closed without saving',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error closing document: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
