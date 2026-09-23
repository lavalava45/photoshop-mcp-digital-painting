import type { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import type { PhotoshopConnection } from '../platform/connection.js';
import { getPhotoshopCapabilities } from '../platform/capabilities.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { invokeUxpOperation } from '../platform/uxp-bridge-client.js';
import {
  atomicFailure,
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
} from './atomic-shared.js';

const SKY_ACTION_TIMEOUT_MS = 120_000;

function jsStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function skyReplacementScript(skyImagePath: string): string {
  const escaped = jsStringLiteral(skyImagePath);
  return `
    function sTID(s) { return stringIDToTypeID(s); }
    function __mcp_trySkyAction(actionIds, skyFile) {
      var lastError = '';
      for (var i = 0; i < actionIds.length; i++) {
        var actionId = actionIds[i];
        try {
          var desc = new ActionDescriptor();
          if (skyFile && skyFile.exists) {
            try { desc.putPath(sTID('skyImage'), skyFile); } catch (eP) {}
            try { desc.putPath(sTID('null'), skyFile); } catch (eN) {}
          }
          executeAction(sTID(actionId), desc, DialogModes.NO);
          return { ok: true, action_id: actionId };
        } catch (e) {
          lastError = actionId + ': ' + (e.message || String(e));
        }
      }
      return { ok: false, error: lastError || 'No native sky replacement action succeeded' };
    }

    if (app.documents.length === 0) {
      return { ok: false, code: 'no_active_document', message: 'No active document' };
    }
    app.displayDialogs = DialogModes.NO;
    var skyFile = new File(${escaped});
    var result = __mcp_trySkyAction(
      ['skyReplacement', 'replaceSky', 'replaceSkyBackground'],
      skyFile
    );
    if (!result.ok) {
      return { ok: false, code: 'unknown', message: String(result.error || '') };
    }
    return {
      ok: true,
      summary: 'Native Sky Replacement invoked via ' + result.action_id,
      details: { action_id: result.action_id, sky_image_path: ${escaped} },
      next_suggested_tool: 'photoshop_get_preview'
    };
  `;
}

export function createSkyReplacementTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_sky_replacement',
        description:
          'Replace the sky using Photoshop native Sky Replacement when available.\\n\\n' +
          'Use when: a sky image path is provided and native Sky Replacement is supported.\\n' +
          'Fallback: photoshop_recipe_sky_blend for a manual composite.\\n\\n' +
          'Returns: JSON { ok, summary, details }.\\n' +
          'Preconditions: active document; optional sky_image_path for custom sky.',
        inputSchema: {
          type: 'object',
          properties: {
            sky_image_path: {
              type: 'string',
              description: 'Optional absolute path to a sky image file',
            },
          },
        },
      },
      handler: async (args) => skyReplacement(connection, backendRouter, args),
    },
  ];
}

async function skyReplacement(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const version = await connection.getVersion();
  const caps = getPhotoshopCapabilities(version);
  if (!caps.features.sky_replacement_native) {
    return atomicFailure({
      ok: false,
      code: 'version_unsupported',
      message: `Photoshop ${version} does not expose native Sky Replacement`,
      suggested_next_tool: 'photoshop_recipe_sky_blend',
    });
  }

  const skyPath = typeof args.sky_image_path === 'string' ? args.sky_image_path.trim() : '';
  try {
    const backend = await backendRouter.backendFor('sky.replace');
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' && Number.isSafeInteger(args.document_id) && args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpOperation(
        'sky_replacement',
        {
          ...(skyPath ? { sky_image_path: skyPath } : {}),
          ...(documentId !== undefined ? { document_id: documentId } : {}),
        },
        'uxp_sky_replacement_failed',
        SKY_ACTION_TIMEOUT_MS
      );
      if (!result.ok || !result.data) throw new Error(result.error ?? 'uxp_sky_replacement_failed');
      if (result.data.ok === false) {
        return atomicFailure({
          ok: false,
          code: result.data.code === 'no_active_document' ? 'no_active_document' : 'unknown',
          message:
            typeof result.data.message === 'string'
              ? result.data.message
              : 'Native Sky Replacement failed',
          suggested_next_tool: 'photoshop_recipe_sky_blend',
        });
      }
      return atomicSuccess(
        typeof result.data.summary === 'string'
          ? result.data.summary
          : 'Native Sky Replacement completed',
        result.data.details && typeof result.data.details === 'object' && !Array.isArray(result.data.details)
          ? (result.data.details as Record<string, unknown>)
          : undefined,
        'photoshop_get_preview'
      );
    }
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();
    const raw = await api.executeScript(skyReplacementScript(skyPath), SKY_ACTION_TIMEOUT_MS);
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailure({
        ok: false,
        code: 'unknown',
        message: `Unparseable native Sky Replacement result: ${String(raw)}`,
      });
    }
    if (parsed.ok === false) {
      return atomicFailure({
        ok: false,
        code: parsed.code === 'no_active_document' ? 'no_active_document' : 'unknown',
        message:
          typeof parsed.message === 'string'
            ? parsed.message
            : 'Native Sky Replacement failed',
        suggested_next_tool: 'photoshop_recipe_sky_blend',
      });
    }
    return atomicSuccess(
      typeof parsed.summary === 'string'
        ? parsed.summary
        : 'Native Sky Replacement completed',
      parsed.details && typeof parsed.details === 'object' && !Array.isArray(parsed.details)
        ? (parsed.details as Record<string, unknown>)
        : undefined,
      'photoshop_get_preview'
    );
  } catch (error) {
    return atomicFailureFromError(error, {
      suggested_next_tool: 'photoshop_recipe_sky_blend',
    });
  }
}
