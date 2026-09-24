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
  'photoshop_guard_capabilities',
  'photoshop_guard_status',
  'photoshop_guard_resume',
  'photoshop_guard_cycle',
  'photoshop_guard_cycle_auto',
  'photoshop_guard_job_poll',
  'photoshop_guard_report',
  'photoshop_guard_ack_operation',
  'photoshop_guard_verdict',
  'photoshop_guard_reconcile',
  'photoshop_guard_set_priorities',
  'photoshop_guard_recover_lock',
]);

/** Non-ExtendScript tools that still mutate the currently active Photoshop document. */
const DOCUMENT_ID_PREACTIVATE_TOOLS = new Set(['photoshop_neural_filter']);

export const DOCUMENT_ID_PROPERTY = {
  type: 'number',
  minimum: 1,
  description:
    'Optional Photoshop document id from photoshop_get_state / photoshop_list_documents. ' +
    'When set, the tool verifies that this document is already active and fails closed if another tab is active. ' +
    'It never switches the active Photoshop document automatically.',
} as const;

export function runWithDocumentId<T>(documentId: number | undefined, fn: () => T): T {
  return targetDocumentId.run(documentId, fn);
}

export function getTargetDocumentId(): number | undefined {
  return targetDocumentId.getStore();
}

/**
 * Bind the current request's pinned document target to one internal Photoshop
 * dispatch. Internal callers may repeat the same id explicitly, but they may
 * never retarget a dispatch behind the public tool/Guard contract.
 */
export function bindPinnedDocumentId(
  params: Record<string, unknown>
): Record<string, unknown> {
  const pinnedDocumentId = getTargetDocumentId();
  if (pinnedDocumentId === undefined) return params;

  if (Object.prototype.hasOwnProperty.call(params, 'document_id')) {
    const dispatchDocumentId = params.document_id;
    if (
      typeof dispatchDocumentId !== 'number' ||
      !Number.isSafeInteger(dispatchDocumentId) ||
      dispatchDocumentId <= 0
    ) {
      throw new Error(
        `document_target_mismatch: internal dispatch document_id must be the pinned positive integer ${pinnedDocumentId}`
      );
    }
    if (dispatchDocumentId !== pinnedDocumentId) {
      throw new Error(
        `document_target_mismatch: internal dispatch document_id ${dispatchDocumentId} does not match pinned document_id ${pinnedDocumentId}`
      );
    }
    return params;
  }

  return { ...params, document_id: pinnedDocumentId };
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

async function verifyActiveDocument(connection: PhotoshopConnection, documentId: number): Promise<void> {
  const script = `
(function() {
  var __targetId = ${documentId};
  var __found = false;
  for (var i = 0; i < app.documents.length; i++) {
    if (app.documents[i].id === __targetId) {
      __found = true;
      break;
    }
  }
  if (!__found) {
    throw new Error('document_not_found: no open document with id ' + __targetId);
  }
  if (app.activeDocument.id !== __targetId) {
    throw new Error('document_not_active: pinned document ' + __targetId + ' is open but not active; active document was not changed');
  }
  return String(app.activeDocument.id);
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
      const explicitDocumentId = parseDocumentIdArg(args);
      const inheritedDocumentId = getTargetDocumentId();
      if (
        explicitDocumentId !== undefined
        && inheritedDocumentId !== undefined
        && explicitDocumentId !== inheritedDocumentId
      ) {
        throw new Error(
          `invalid_arguments: document_id ${explicitDocumentId} does not match inherited pinned document_id ${inheritedDocumentId}`
        );
      }
      documentId = explicitDocumentId ?? inheritedDocumentId;
    } catch (error) {
      return invalidDocumentIdResult(error instanceof Error ? error.message.replace(/^invalid_arguments:\s*/, '') : String(error));
    }

    if (documentId !== undefined && DOCUMENT_ID_PREACTIVATE_TOOLS.has(toolName)) {
      if (!connection) {
        return invalidDocumentIdResult(`document targeting is unavailable for ${toolName}`);
      }
      try {
        await verifyActiveDocument(connection, documentId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = /document_not_active/i.test(message) ? 'document_not_active' : 'document_not_found';
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  ok: false,
                  code,
                  message,
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
          __mcp_found = true;
          break;
        }
      }
      if (!__mcp_found) {
        throw new Error('document_not_found: no open document with id ' + __mcp_targetDocId);
      }
      if (app.activeDocument.id !== __mcp_targetDocId) {
        throw new Error('document_not_active: pinned document ' + __mcp_targetDocId + ' is open but not active; active document was not changed');
      }
    })();
  `;
}

/**
 * Apply the request-scoped document guard at the final legacy script boundary.
 * This is intentionally central: individual tool handlers may add an identical
 * guard for clarity, but correctness must not depend on every handler doing so.
 */
export function guardPinnedLegacyScript(script: string): string {
  const documentId = getTargetDocumentId();
  return documentId === undefined
    ? script
    : `${documentGuardScript(documentId)}\n${script}`;
}
