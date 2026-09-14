import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

export function createLayerOrderingTools(connection: PhotoshopConnection): ToolDefinition[] {
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
      handler: async (args) => moveLayerToPosition(connection, args),
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
      handler: async () => moveLayerToTop(connection),
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
      handler: async () => moveLayerToBottom(connection),
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
      handler: async () => moveLayerUp(connection),
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
      handler: async () => moveLayerDown(connection),
    },
  ];
}

async function moveLayerToPosition(
  connection: PhotoshopConnection,
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
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.moveLayerToPosition(targetLayerName, position, targetLayerId)
    );
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable move-layer result: ${String(raw)}`));
    }
    return atomicSuccess(`Layer moved ${position}`, parsed, 'photoshop_get_layers');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function moveLayerToTop(connection: PhotoshopConnection): Promise<ToolResult> {
  try {
    const raw = await runSnippet(connection, ExtendScriptSnippets.moveLayerToTop());
    const parsed = parseSnippetResult(raw);
    if (!parsed) return atomicFailureFromError(new Error(`Unparseable move-to-top result: ${String(raw)}`));
    return atomicSuccess('Layer moved to top', parsed, 'photoshop_get_layers');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function moveLayerToBottom(connection: PhotoshopConnection): Promise<ToolResult> {
  try {
    const raw = await runSnippet(connection, ExtendScriptSnippets.moveLayerToBottom());
    const parsed = parseSnippetResult(raw);
    if (!parsed) return atomicFailureFromError(new Error(`Unparseable move-to-bottom result: ${String(raw)}`));
    return atomicSuccess('Layer moved to bottom', parsed, 'photoshop_get_layers');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function moveLayerUp(connection: PhotoshopConnection): Promise<ToolResult> {
  try {
    const raw = await runSnippet(connection, ExtendScriptSnippets.moveLayerUp());
    const parsed = parseSnippetResult(raw);
    if (!parsed) return atomicFailureFromError(new Error(`Unparseable move-up result: ${String(raw)}`));
    return atomicSuccess('Layer moved up', parsed, 'photoshop_get_layers');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function moveLayerDown(connection: PhotoshopConnection): Promise<ToolResult> {
  try {
    const raw = await runSnippet(connection, ExtendScriptSnippets.moveLayerDown());
    const parsed = parseSnippetResult(raw);
    if (!parsed) return atomicFailureFromError(new Error(`Unparseable move-down result: ${String(raw)}`));
    return atomicSuccess('Layer moved down', parsed, 'photoshop_get_layers');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
