import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import {
  invokeUxpDuplicateLayer,
  invokeUxpOperation,
  invokeUxpRenameLayer,
  invokeUxpSetLayerBlendMode,
  invokeUxpSetLayerLocked,
  invokeUxpSetLayerOpacity,
  invokeUxpSetLayerVisibility,
} from '../platform/uxp-bridge-client.js';
import { LAYER_BLEND_MODE_ENUM, resolveLayerBlendMode } from './blend-mode.js';

export function createLayerPropertiesTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_rasterize_layer',
        description: 'Rasterize the active layer (convert text/smart object to normal layer)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async (args) => rasterizeLayer(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_set_layer_opacity',
        description: 'Set the opacity of the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            opacity: {
              type: 'number',
              description: 'Opacity value (0-100)',
              minimum: 0,
              maximum: 100,
            },
          },
          required: ['opacity'],
        },
      },
      handler: async (args) => setLayerOpacity(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_set_layer_blend_mode',
        description:
          'Set the blend mode of the active layer.\n\n' +
          '`COLOR` is the Photoshop UI name (Colorize); it is mapped to ExtendScript `BlendMode.COLORBLEND`.',
        inputSchema: {
          type: 'object',
          properties: {
            blendMode: {
              type: 'string',
              description:
                'Blend mode (Photoshop UI name). COLOR maps to BlendMode.COLORBLEND. ' +
                'DARKERCOLOR / LIGHTERCOLOR use Action Manager if the DOM enum is missing.',
              enum: [...LAYER_BLEND_MODE_ENUM],
            },
          },
          required: ['blendMode'],
        },
      },
      handler: async (args) => setLayerBlendMode(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_set_layer_visibility',
        description: 'Show or hide the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            visible: {
              type: 'boolean',
              description: 'Whether the layer should be visible',
            },
          },
          required: ['visible'],
        },
      },
      handler: async (args) => setLayerVisibility(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_set_layer_locked',
        description: 'Lock or unlock the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            locked: {
              type: 'boolean',
              description: 'Whether the layer should be locked',
            },
          },
          required: ['locked'],
        },
      },
      handler: async (args) => setLayerLocked(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_rename_layer',
        description: 'Rename the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'New name for the layer',
            },
          },
          required: ['name'],
        },
      },
      handler: async (args) => renameLayer(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_duplicate_layer',
        description:
          'Duplicate the active layer. The duplicate becomes the active layer; ' +
          'returns its name and, when available, its layer id.',
        inputSchema: {
          type: 'object',
          properties: {
            newName: {
              type: 'string',
              description: 'Name for the duplicated layer (optional)',
            },
          },
        },
      },
      handler: async (args) => duplicateLayer(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_merge_visible_layers',
        description: 'Merge all visible layers into one',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async (args) => mergeVisibleLayers(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_flatten_image',
        description: 'Flatten all layers into a single background layer',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async (args) => flattenImage(connection, backendRouter, args),
    },
  ];
}

async function setLayerOpacity(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const opacity = args.opacity as number;

  try {
    const backend = await backendRouter.backendFor('layer.opacity.write');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpSetLayerOpacity({
        ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
        opacity,
      });
      if (!result.ok) throw new Error(result.error ?? 'uxp_set_layer_opacity_failed');
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      await api.executeScript(ExtendScriptSnippets.setLayerOpacity(opacity));
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer opacity set to ${opacity}%`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting layer opacity: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setLayerBlendMode(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const requested = typeof args.blendMode === 'string' ? args.blendMode : '';
  const extendScriptToken = resolveLayerBlendMode(requested);
  if (!extendScriptToken) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting blend mode: unknown blendMode "${requested}"`,
        },
      ],
      isError: true,
    };
  }

  try {
    const backend = await backendRouter.backendFor('layer.blend_mode.write');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpSetLayerBlendMode({
        ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
        blendMode: requested,
      });
      if (!result.ok) throw new Error(result.error ?? 'uxp_set_layer_blend_mode_failed');
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      await api.executeScript(ExtendScriptSnippets.setLayerBlendMode(extendScriptToken));
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer blend mode set to ${requested}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting blend mode: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setLayerVisibility(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const visible = args.visible as boolean;

  try {
    const backend = await backendRouter.backendFor('layer.visibility.write');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpSetLayerVisibility({
        ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
        visible,
      });
      if (!result.ok) throw new Error(result.error ?? 'uxp_set_layer_visibility_failed');
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      await api.executeScript(ExtendScriptSnippets.setLayerVisibility(visible));
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer ${visible ? 'shown' : 'hidden'}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting layer visibility: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setLayerLocked(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const locked = args.locked as boolean;

  try {
    const backend = await backendRouter.backendFor('layer.locked.write');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpSetLayerLocked({
        ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
        locked,
      });
      if (!result.ok) throw new Error(result.error ?? 'uxp_set_layer_locked_failed');
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      await api.executeScript(ExtendScriptSnippets.setLayerLocked(locked));
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer ${locked ? 'locked' : 'unlocked'}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error locking/unlocking layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function renameLayer(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = args.name as string;

  try {
    const backend = await backendRouter.backendFor('layer.rename');
    let result: unknown;
    if (backend.kind === 'uxp') {
      const uxpResult = await invokeUxpRenameLayer({
        ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
        name,
      });
      if (!uxpResult.ok || !uxpResult.data) throw new Error(uxpResult.error ?? 'uxp_rename_layer_failed');
      result = uxpResult.data;
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      result = await api.executeScript(ExtendScriptSnippets.renameLayer(name));
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer renamed to: ${name}\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error renaming layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function duplicateLayer(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const newName = args.newName as string | undefined;

  try {
    const backend = await backendRouter.backendFor('layer.duplicate');
    let result: unknown;
    if (backend.kind === 'uxp') {
      const uxpResult = await invokeUxpDuplicateLayer({
        ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
        ...(newName !== undefined ? { newName } : {}),
      });
      if (!uxpResult.ok || !uxpResult.data) throw new Error(uxpResult.error ?? 'uxp_duplicate_layer_failed');
      result = uxpResult.data;
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      result = await api.executeScript(ExtendScriptSnippets.duplicateLayer(newName));
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer duplicated\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error duplicating layer: ${error instanceof Error ? error.message : String(error)}`,
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

async function mergeVisibleLayers(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const backend = await backendRouter.backendFor('layer.merge_visible');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'merge_visible_layers',
        documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {},
        'uxp_merge_visible_layers_failed'
      );
      if (!result.ok) throw new Error(result.error ?? 'uxp_merge_visible_layers_failed');
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      const script = ExtendScriptSnippets.mergeVisibleLayers();
      await api.executeScript(script);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: 'All visible layers merged',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error merging visible layers: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function flattenImage(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const backend = await backendRouter.backendFor('layer.flatten');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'flatten_image',
        documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {},
        'uxp_flatten_image_failed'
      );
      if (!result.ok) throw new Error(result.error ?? 'uxp_flatten_image_failed');
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      const script = ExtendScriptSnippets.flattenImage();
      await api.executeScript(script);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: 'Image flattened (all layers merged to background)',
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error flattening image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function rasterizeLayer(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  try {
    const backend = await backendRouter.backendFor('layer.rasterize');
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' && Number.isSafeInteger(args.document_id) && args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpOperation(
        'rasterize_layer',
        documentId !== undefined ? { document_id: documentId } : {},
        'uxp_rasterize_layer_failed'
      );
      if (!result.ok || !result.data) throw new Error(result.error ?? 'uxp_rasterize_layer_failed');
      return {
        content: [{
          type: 'text' as const,
          text: `Layer rasterized\nResult: ${JSON.stringify(result.data)}`,
        }],
      };
    }
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.rasterizeLayer();
    const result = await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Layer rasterized\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error rasterizing layer: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
