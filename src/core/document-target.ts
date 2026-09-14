import { AsyncLocalStorage } from 'node:async_hooks';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { PhotoshopConnection } from '../platform/connection.js';
import type { ToolHandler } from './tool-registry.js';

const targetDocumentId = new AsyncLocalStorage<number | undefined>();

/** Tools that already manage documents themselves, or never target a document. */
export const DOCUMENT_ID_SCHEMA_EXCLUDES = new Set([
  'photoshop_ping',
  'photoshop_get_version',
  'photoshop_get_capabilities',
  'photoshop_list_documents',
  'photoshop_set_active_document',
  'photoshop_create_document',
  'photoshop_open_image',
  'photoshop_list_brush_presets',
  'photoshop_select_brush_preset',
  'photoshop_get_brush_settings',
  'photoshop_set_brush',
  'photoshop_set_foreground_color',
  'photoshop_list_fonts',
  'photoshop_transform_landmarks',
  'photoshop_compare_landmarks',
]);

/** Non-ExtendScript tools that still mutate the currently active Photoshop document. */
const DOCUMENT_ID_PREACTIVATE_TOOLS = new Set(['photoshop_neural_filter']);

export const DOCUMENT_ID_PROPERTY = {
  type: 'number',
  minimum: 1,
  description:
    'Optional Photoshop document id from photoshop_get_state / photoshop_list_documents. ' +
    'When set, the tool activates that document before running so a UI tab switch cannot retarget the edit.',
} as const;

export function runWithDocumentId<T>(documentId: number | undefined, fn: () => T): T {
  return targetDocumentId.run(documentId, fn);
}

export function getTargetDocumentId(): number | undefined {
  return targetDocumentId.getStore();
}

export function parseDocumentIdArg(args: Record<string, unknown> | undefined): number | undefined {
  if (!args || !Object.prototype.hasOwnProperty.call(args, 'document_id')) return undefined;
  const raw = args.document_id;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw) || raw <= 0) {
    throw new Error('invalid_arguments: document_id must be a positive integer');
  }
  return raw;
}

function invalidDocumentIdResult(message: string): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            ok: false,
            code: 'invalid_arguments',
            message,
            suggested_next_tool: 'photoshop_list_documents',
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

function annotateDocumentTarget(result: CallToolResult, documentId: number): CallToolResult {
  const target = { id: documentId, pinned: true };
  let annotated = false;
  const content = result.content.map((item) => {
    if (annotated || item.type !== 'text') return item;
    try {
      const parsed = JSON.parse(item.text) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return item;
      annotated = true;
      return {
        ...item,
        text: JSON.stringify({ ...parsed, document_target: target }, null, 2),
      };
    } catch {
      return item;
    }
  });

  if (!annotated) {
    content.push({
      type: 'text',
      text: JSON.stringify({ document_target: target }, null, 2),
    });
  }

  return { ...result, content };
}

async function preactivateDocument(connection: PhotoshopConnection, documentId: number): Promise<void> {
  const script = `
(function() {
  var __targetId = ${documentId};
  for (var i = 0; i < app.documents.length; i++) {
    if (app.documents[i].id === __targetId) {
      app.activeDocument = app.documents[i];
      return String(app.activeDocument.id);
    }
  }
  throw new Error('document_not_found: no open document with id ' + __targetId);
})();
  `.trim();
  await connection.executeScript(script);
}

export function wrapDocumentIdHandler(
  toolName: string,
  handler: ToolHandler,
  connection?: PhotoshopConnection
): ToolHandler {
  if (DOCUMENT_ID_SCHEMA_EXCLUDES.has(toolName)) return handler;
  return async (args) => {
    let documentId: number | undefined;
    try {
      documentId = parseDocumentIdArg(args);
    } catch (error) {
      return invalidDocumentIdResult(error instanceof Error ? error.message.replace(/^invalid_arguments:\s*/, '') : String(error));
    }

    if (documentId !== undefined && DOCUMENT_ID_PREACTIVATE_TOOLS.has(toolName)) {
      if (!connection) {
        return invalidDocumentIdResult(`document targeting is unavailable for ${toolName}`);
      }
      try {
        await preactivateDocument(connection, documentId);
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: false,
                  code: 'document_not_found',
                  message: error instanceof Error ? error.message : String(error),
                  suggested_next_tool: 'photoshop_list_documents',
                  document_target: { id: documentId, pinned: true },
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }

    const result = await runWithDocumentId(documentId, () => handler(args));
    return documentId === undefined ? result : annotateDocumentTarget(result, documentId);
  };
}

type ObjectSchema = {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

/** Inject optional `document_id` on tools that operate against the active document. */
export function withOptionalDocumentId(tool: Tool): Tool {
  if (DOCUMENT_ID_SCHEMA_EXCLUDES.has(tool.name)) return tool;
  const schema = tool.inputSchema as ObjectSchema | undefined;
  if (!schema || schema.type !== 'object') return tool;
  const properties = schema.properties ?? {};
  if (properties.document_id) return tool;
  return {
    ...tool,
    inputSchema: {
      ...schema,
      type: 'object',
      properties: {
        ...properties,
        document_id: { ...DOCUMENT_ID_PROPERTY },
      },
    },
  };
}

/** ExtendScript prepended inside the execute wrapper when a target id is set. */
export function documentGuardScript(documentId: number): string {
  const id = Math.trunc(documentId);
  return `
    (function() {
      var __mcp_targetDocId = ${id};
      var __mcp_found = false;
      for (var __mcp_di = 0; __mcp_di < app.documents.length; __mcp_di++) {
        if (app.documents[__mcp_di].id === __mcp_targetDocId) {
          app.activeDocument = app.documents[__mcp_di];
          __mcp_found = true;
          break;
        }
      }
      if (!__mcp_found) {
        throw new Error('document_not_found: no open document with id ' + __mcp_targetDocId);
      }
    })();
  `;
}
