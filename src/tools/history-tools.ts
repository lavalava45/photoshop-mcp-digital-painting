import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { invokeUxpOperation, invokeUxpUndo } from '../platform/uxp-bridge-client.js';
import { atomicFailureFromError } from './atomic-shared.js';

export function createHistoryTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_undo',
        description: 'Undo the last operation(s) - equivalent to Ctrl/Cmd+Z',
        inputSchema: {
          type: 'object',
          properties: {
            steps: {
              type: 'number',
              description: 'Number of steps to undo (default: 1)',
              minimum: 1,
              default: 1,
            },
          },
        },
      },
      handler: async (args) => undo(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_redo',
        description: 'Redo the previously undone operation(s) - equivalent to Ctrl/Cmd+Shift+Z',
        inputSchema: {
          type: 'object',
          properties: {
            steps: {
              type: 'number',
              description: 'Number of steps to redo (default: 1)',
              minimum: 1,
              default: 1,
            },
          },
        },
      },
      handler: async (args) => redo(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_get_history',
        description: 'Get the history states of the active document',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => getHistory(backendRouter),
    },
  ];
}

async function undo(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const steps = (args.steps as number) || 1;

  try {
    const backend = await backendRouter.backendFor('history.undo');
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' &&
        Number.isSafeInteger(args.document_id) &&
        args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpUndo({
        ...(documentId !== undefined ? { document_id: documentId } : {}),
        steps,
      });
      if (!result.ok || !result.data) throw new Error(result.error ?? 'uxp_undo_failed');
      return {
        content: [{
          type: 'text' as const,
          text: `Undo successful (${steps} step${steps > 1 ? 's' : ''})\nResult: ${JSON.stringify(result.data)}`,
        }],
      };
    }

    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();
    const script = ExtendScriptSnippets.undo(steps);
    const result = await api.executeScript(script);
    return {
      content: [{
        type: 'text' as const,
        text: `Undo successful (${steps} step${steps > 1 ? 's' : ''})\nResult: ${JSON.stringify(result)}`,
      }],
    };
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function redo(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const steps = (args.steps as number) || 1;

  try {
    const backend = await backendRouter.backendFor(
      'history.redo' as Parameters<PhotoshopBackendRouter['backendFor']>[0]
    );
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' && Number.isSafeInteger(args.document_id) && args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpOperation(
        'redo',
        {
          steps,
          ...(documentId !== undefined ? { document_id: documentId } : {}),
        },
        'uxp_redo_failed'
      );
      if (!result.ok || !result.data) throw new Error(result.error ?? 'uxp_redo_failed');
      return {
        content: [{
          type: 'text' as const,
          text: `Redo successful (${steps} step${steps > 1 ? 's' : ''})\nResult: ${JSON.stringify(result.data)}`,
        }],
      };
    }

    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.redo(steps);
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Redo successful (${steps} step${steps > 1 ? 's' : ''})\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error redoing: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function getHistory(backendRouter: PhotoshopBackendRouter): Promise<ToolResult> {
  try {
    const result = await backendRouter.readHistory();

    return {
      content: [
        {
          type: 'text' as const,
          text: `History States:\n${JSON.stringify(result, null, 2)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error getting history: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
