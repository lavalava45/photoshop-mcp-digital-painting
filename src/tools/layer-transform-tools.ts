import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { invokeUxpOperation } from '../platform/uxp-bridge-client.js';

export function createLayerTransformTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_fit_layer_to_document',
        description:
          'Scale the active layer to fit the document canvas while maintaining aspect ratio',
        inputSchema: {
          type: 'object',
          properties: {
            fillDocument: {
              type: 'boolean',
              description:
                'If true, fills entire canvas (may crop). If false, fits within canvas (may have margins). Default: false',
              default: false,
            },
          },
        },
      },
      handler: async (args) => fitLayerToDocument(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_scale_layer',
        description: 'Scale the active layer by a percentage',
        inputSchema: {
          type: 'object',
          properties: {
            scalePercent: {
              type: 'number',
              description: 'Scale percentage (e.g., 50 for 50%, 200 for 200%)',
              minimum: 1,
            },
            centerAnchor: {
              type: 'boolean',
              description: 'Scale from center (true) or top-left (false). Default: true',
              default: true,
            },
          },
          required: ['scalePercent'],
        },
      },
      handler: async (args) => scaleLayer(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_move_layer',
        description: 'Move the active layer by specified offset',
        inputSchema: {
          type: 'object',
          properties: {
            deltaX: {
              type: 'number',
              description: 'Horizontal offset in pixels (can be negative)',
            },
            deltaY: {
              type: 'number',
              description: 'Vertical offset in pixels (can be negative)',
            },
          },
          required: ['deltaX', 'deltaY'],
        },
      },
      handler: async (args) => moveLayer(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_rotate_layer',
        description: 'Rotate the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            degrees: {
              type: 'number',
              description: 'Rotation angle in degrees (positive = clockwise, negative = counter-clockwise)',
            },
          },
          required: ['degrees'],
        },
      },
      handler: async (args) => rotateLayer(connection, backendRouter, args),
    },
  ];
}

async function fitLayerToDocument(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const fillDocument = (args.fillDocument as boolean) || false;

  try {
    const backend = await backendRouter.backendFor('layer.fit');
    let result: unknown;
    if (backend.kind === 'uxp') {
      const uxpResult = await invokeUxpOperation(
        'fit_layer_to_document',
        {
          ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
          fillDocument,
        },
        'uxp_fit_layer_to_document_failed'
      );
      if (!uxpResult.ok || !uxpResult.data) {
        throw new Error(uxpResult.error ?? 'uxp_fit_layer_to_document_failed');
      }
      result = uxpResult.data;
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      const script = ExtendScriptSnippets.fitLayerToDocument(fillDocument);
      result = await api.executeScript(script);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer ${fillDocument ? 'filled' : 'fitted'} to document\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error fitting layer to document: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function scaleLayer(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const scalePercent = args.scalePercent as number;
  const centerAnchor = args.centerAnchor !== undefined ? (args.centerAnchor as boolean) : true;

  try {
    const backend = await backendRouter.backendFor('layer.scale');
    let result: unknown;
    if (backend.kind === 'uxp') {
      const uxpResult = await invokeUxpOperation(
        'scale_layer',
        {
          ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
          scalePercent,
          centerAnchor,
        },
        'uxp_scale_layer_failed'
      );
      if (!uxpResult.ok || !uxpResult.data) {
        throw new Error(uxpResult.error ?? 'uxp_scale_layer_failed');
      }
      result = uxpResult.data;
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      const script = ExtendScriptSnippets.scaleLayer(scalePercent, centerAnchor);
      result = await api.executeScript(script);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer scaled to ${scalePercent}%\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error scaling layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function moveLayer(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const deltaX = args.deltaX as number;
  const deltaY = args.deltaY as number;

  try {
    const backend = await backendRouter.backendFor('layer.move_pixels');
    let result: unknown;
    if (backend.kind === 'uxp') {
      const uxpResult = await invokeUxpOperation(
        'move_layer_pixels',
        {
          ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
          deltaX,
          deltaY,
        },
        'uxp_move_layer_pixels_failed'
      );
      if (!uxpResult.ok || !uxpResult.data) {
        throw new Error(uxpResult.error ?? 'uxp_move_layer_pixels_failed');
      }
      result = uxpResult.data;
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      const script = ExtendScriptSnippets.moveLayer(deltaX, deltaY);
      result = await api.executeScript(script);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer moved by (${deltaX}, ${deltaY})px\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error moving layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function rotateLayer(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const degrees = args.degrees as number;

  try {
    const backend = await backendRouter.backendFor('layer.rotate');
    let result: unknown;
    if (backend.kind === 'uxp') {
      const uxpResult = await invokeUxpOperation(
        'rotate_layer',
        {
          ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
          degrees,
        },
        'uxp_rotate_layer_failed'
      );
      if (!uxpResult.ok || !uxpResult.data) {
        throw new Error(uxpResult.error ?? 'uxp_rotate_layer_failed');
      }
      result = uxpResult.data;
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      const script = ExtendScriptSnippets.rotateLayer(degrees);
      result = await api.executeScript(script);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer rotated ${degrees} degrees\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error rotating layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

function documentIdFromArgs(args: Record<string, unknown>): number | undefined {
  return typeof args.document_id === 'number' &&
    Number.isSafeInteger(args.document_id) &&
    args.document_id > 0
    ? args.document_id
    : undefined;
}
