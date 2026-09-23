import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { invokeUxpMoveLayer } from '../platform/uxp-bridge-client.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

export function createLayerOrderingTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_move_layer_to_position',
        description:
          'Move the active layer ABOVE/BELOW another layer, or to TOP/BOTTOM of its current parent stack.\n\n' +
          'For ABOVE/BELOW, targetLayerId from photoshop_get_layers is preferred because names can be duplicated. targetLayerName remains supported for compatibility and searches recursively through groups. TOP/BOTTOM do not require a target.',
        inputSchema: {
          type: 'object',
          properties: {
            targetLayerName: {
              type: 'string',
              description: 'Exact target layer name for ABOVE/BELOW; recursive first match',
            },
            targetLayerId: {
              type: 'number',
              description: 'Stable target layer id from photoshop_get_layers (preferred for ABOVE/BELOW)',
            },
            position: {
              type: 'string',
              description: 'Position relative to target layer',
              enum: ['ABOVE', 'BELOW', 'TOP', 'BOTTOM'],
            },
          },
          required: ['position'],
        },
      },
      handler: async (args) => moveLayerToPosition(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_move_layer_to_top',
        description: 'Move the active layer to the top of its current parent stack (document or group)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async (args) => moveLayerToTop(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_move_layer_to_bottom',
        description: 'Move the active layer to the bottom of its current parent stack (document or group)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async (args) => moveLayerToBottom(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_move_layer_up',
        description: 'Move the active layer up one position within its current parent stack',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async (args) => moveLayerUp(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_move_layer_down',
        description: 'Move the active layer down one position within its current parent stack',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async (args) => moveLayerDown(connection, backendRouter, args),
    },
  ];
}

async function moveLayerToPosition(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const targetLayerName =
    typeof args.targetLayerName === 'string' && args.targetLayerName.trim()
      ? args.targetLayerName.trim()
      : undefined;
  const targetLayerId =
    typeof args.targetLayerId === 'number' && Number.isFinite(args.targetLayerId)
      ? Math.trunc(args.targetLayerId)
      : undefined;
  const position = args.position as string;

  if ((position === 'ABOVE' || position === 'BELOW') && targetLayerId === undefined && !targetLayerName) {
    return atomicFailureFromError(new Error('Invalid arguments: ABOVE/BELOW requires targetLayerId or targetLayerName'), {
      code: 'invalid_arguments',
    });
  }

  try {
    const backend = await backendRouter.backendFor('layer.order.write');
    let parsed: Record<string, unknown>;
    if (backend.kind === 'uxp') {
      const result = await invokeUxpMoveLayer({
        ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
        position: position as 'ABOVE' | 'BELOW' | 'TOP' | 'BOTTOM',
        ...(targetLayerId !== undefined ? { targetLayerId } : {}),
        ...(targetLayerName !== undefined ? { targetLayerName } : {}),
      });
      if (!result.ok || !result.data) return atomicFailureFromError(new Error(result.error ?? 'uxp_move_layer_failed'));
      parsed = normalizePositionResult(result.data, position);
    } else {
      const raw = await runSnippet(
        connection,
        ExtendScriptSnippets.moveLayerToPosition(targetLayerName, position, targetLayerId)
      );
      const legacy = parseSnippetResult(raw);
      if (!legacy) {
        return atomicFailureFromError(new Error(`Unparseable move-layer result: ${String(raw)}`));
      }
      parsed = legacy;
    }
    return atomicSuccess(`Layer moved ${position}`, parsed, 'photoshop_get_layers');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function moveLayerToTop(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const parsed = await moveSimple(
      connection, backendRouter, args, 'TOP', ExtendScriptSnippets.moveLayerToTop(), 'move-to-top'
    );
    return atomicSuccess('Layer moved to top', parsed, 'photoshop_get_layers');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function moveLayerToBottom(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const parsed = await moveSimple(
      connection, backendRouter, args, 'BOTTOM', ExtendScriptSnippets.moveLayerToBottom(), 'move-to-bottom'
    );
    return atomicSuccess('Layer moved to bottom', parsed, 'photoshop_get_layers');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function moveLayerUp(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const parsed = await moveSimple(
      connection, backendRouter, args, 'UP', ExtendScriptSnippets.moveLayerUp(), 'move-up'
    );
    return atomicSuccess('Layer moved up', parsed, 'photoshop_get_layers');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function moveLayerDown(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const parsed = await moveSimple(
      connection, backendRouter, args, 'DOWN', ExtendScriptSnippets.moveLayerDown(), 'move-down'
    );
    return atomicSuccess('Layer moved down', parsed, 'photoshop_get_layers');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function moveSimple(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>,
  position: 'TOP' | 'BOTTOM' | 'UP' | 'DOWN',
  legacySnippet: string,
  legacyParseLabel: string
): Promise<Record<string, unknown>> {
  const backend = await backendRouter.backendFor('layer.order.write');
  if (backend.kind === 'uxp') {
    const result = await invokeUxpMoveLayer({
      ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
      position,
    });
    if (!result.ok || !result.data) throw new Error(result.error ?? 'uxp_move_layer_failed');
    return result.data;
  }
  const raw = await runSnippet(connection, legacySnippet);
  const parsed = parseSnippetResult(raw);
  if (!parsed) throw new Error(`Unparseable ${legacyParseLabel} result: ${String(raw)}`);
  return parsed;
}

function documentIdFromArgs(args: Record<string, unknown>): number | undefined {
  return typeof args.document_id === 'number' &&
    Number.isSafeInteger(args.document_id) &&
    args.document_id > 0
    ? args.document_id
    : undefined;
}

function normalizePositionResult(
  data: Record<string, unknown>,
  position: string
): Record<string, unknown> {
  if (position !== 'TOP' && position !== 'BOTTOM') return data;
  return {
    moved: data.moved,
    layerName: data.layerName,
    layerId: data.layerId,
    position,
    context: data.context,
  };
}
