import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { invokeUxpOperation } from '../platform/uxp-bridge-client.js';

export function createActionTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_play_action',
        description: 'Play a recorded action from the Actions palette',
        inputSchema: {
          type: 'object',
          properties: {
            actionName: {
              type: 'string',
              description: 'Name of the action to play',
            },
            actionSetName: {
              type: 'string',
              description: 'Name of the action set containing the action',
            },
          },
          required: ['actionName', 'actionSetName'],
        },
      },
      handler: async (args) => playAction(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_execute_script',
        description:
          'Retired raw ExtendScript (JSX) escape hatch retained only for non-canonical legacy/debug compatibility.\n\n' +
          'Do NOT use from the required Guard / compact-v2 production lane: Guard execution policy rejects this tool before Photoshop dispatch.\n' +
          'Use maintained semantic photoshop_* tools instead.\n\n' +
          'Returns: script return value serialized as text/JSON.\n' +
          'IMPORTANT: Your code runs inside a wrapping IIFE. Use an explicit `return` to pass data back — ' +
          'a bare trailing expression returns undefined. Example: `return { ok: true };` ' +
          'Objects are serialized with toSource() and parsed automatically on macOS and Windows.\n' +
          'Preconditions: valid ExtendScript; active document if script expects one. Side effects: depends on code.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'ExtendScript code to execute',
            },
          },
          required: ['code'],
        },
      },
      handler: async (args) => executeCustomScript(connection, args),
    },
  ];
}

async function playAction(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const actionName = args.actionName as string;
  const actionSetName = args.actionSetName as string;

  try {
    const backend = await backendRouter.backendFor(
      'action.play' as Parameters<PhotoshopBackendRouter['backendFor']>[0]
    );
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' && Number.isSafeInteger(args.document_id) && args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpOperation(
        'play_action',
        {
          actionName,
          actionSetName,
          ...(documentId !== undefined ? { document_id: documentId } : {}),
        },
        'uxp_play_action_failed'
      );
      if (!result.ok) throw new Error(result.error ?? 'uxp_play_action_failed');
      return {
        content: [{
          type: 'text' as const,
          text: `Action played: "${actionName}" from set "${actionSetName}"`,
        }],
      };
    }

    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.playAction(actionName, actionSetName);
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Action played: "${actionName}" from set "${actionSetName}"`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error playing action: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function executeCustomScript(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const code = args.code as string;

  try {
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.executeCustomScript(code);
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Custom script executed\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error executing custom script: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
