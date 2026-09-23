import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import {
  invokeUxpCreateLayer,
  invokeUxpDeleteLayer,
  invokeUxpFillLayer,
  invokeUxpOperation,
  invokeUxpSelectLayerByName,
} from '../platform/uxp-bridge-client.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

export function createLayerTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_create_layer',
        description:
          'Create a new empty layer with explicit stack placement. By default it is placed above the layer that was active when the call started.\n\n' +
          'Use when: user needs a blank layer for painting, fills, or stacking content.\n' +
          'Do NOT use when: adding text — use photoshop_create_text_layer.\n\n' +
          'Use above_layer_id or below_layer_id when exact ordering matters; provide at most one.\n\n' +
          'Returns: created layer id/name/path, requested placement, actual stack index and adjacent layer ids.\n' +
          'Preconditions: active document. Side effects: adds layer to history.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name for the new layer (optional)',
            },
            above_layer_id: {
              type: 'number',
              description: 'Place the new layer immediately above this stable layer id',
            },
            below_layer_id: {
              type: 'number',
              description: 'Place the new layer immediately below this stable layer id',
            },
          },
        },
      },
      handler: async (args) => createLayer(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_delete_layer',
        description:
          'Delete one exact layer. When layer_id is supplied, the tool targets that stable layer id and restores the previously active unrelated layer when possible. Use this for safe logical-layer discard.',
        inputSchema: {
          type: 'object',
          properties: {
            layer_id: {
              type: 'number',
              minimum: 1,
              description: 'Optional stable layer id to discard. If omitted, deletes the active layer for backward compatibility.',
            },
          },
        },
      },
      handler: async (args) => deleteLayer(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_merge_layer_down',
        description:
          'Merge one exact logical layer into one exact immediately-below sibling. Fails closed if the ids are not adjacent siblings, so unrelated layers cannot be collapsed accidentally.',
        inputSchema: {
          type: 'object',
          properties: {
            layer_id: { type: 'number', minimum: 1, description: 'Stable source layer id.' },
            target_layer_id: { type: 'number', minimum: 1, description: 'Stable immediately-below sibling layer id.' },
          },
          required: ['layer_id', 'target_layer_id'],
        },
      },
      handler: async (args) => mergeLayerDown(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_create_text_layer',
        description:
          'Create a text layer with content, position, font size, and optional font.\n\n' +
          'Use when: adding labels, titles, or typography to the design.\n' +
          'Do NOT use when: editing existing text — use photoshop_update_text_content.\n\n' +
          'Returns: layer name, text, position, fontSize, font (when fontName set), context.\n' +
          'Use photoshop_list_fonts to discover font names; photoshop_set_text_font to change font later.\n' +
          'Preconditions: active document. Side effects: adds text layer.',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'Text content',
            },
            x: {
              type: 'number',
              description: 'X position in pixels (default: 100)',
              default: 100,
            },
            y: {
              type: 'number',
              description: 'Y position in pixels (default: 100)',
              default: 100,
            },
            fontSize: {
              type: 'number',
              description: 'Font size in points (default: 24)',
              default: 24,
            },
            fontName: {
              type: 'string',
              description:
                'Optional font display or PostScript name (resolved via app.fonts; see photoshop_list_fonts)',
            },
          },
          required: ['text'],
        },
      },
      handler: async (args) => createTextLayer(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_fill_layer',
        description: 'Fill the active layer with a color',
        inputSchema: {
          type: 'object',
          properties: {
            red: {
              type: 'number',
              description: 'Red component (0-255)',
              minimum: 0,
              maximum: 255,
            },
            green: {
              type: 'number',
              description: 'Green component (0-255)',
              minimum: 0,
              maximum: 255,
            },
            blue: {
              type: 'number',
              description: 'Blue component (0-255)',
              minimum: 0,
              maximum: 255,
            },
            layer_id: {
              type: 'number',
              minimum: 1,
              description:
                'Optional stable target layer id. When supplied, the fill is pinned to that layer and the previously active layer is restored afterward.',
            },
          },
          required: ['red', 'green', 'blue'],
        },
      },
      handler: async (args) => fillLayer(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_get_layers',
        description:
          'List all layers in the active document with kind, visibility, and opacity.\n\n' +
          'Use when: choosing a layer to edit, debugging structure, or after organize_layers.\n' +
          'Do NOT use when: only session summary is needed — use photoshop_get_state (lighter).\n\n' +
          'Returns: layerCount, layers array, context.\n' +
          'Preconditions: active document. Side effects: none.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => getLayers(backendRouter),
    },
    {
      tool: {
        name: 'photoshop_select_layer_by_name',
        description:
          'Select the active layer by exact name, including layers inside groups.\n\n' +
          'Use when: a transform or property tool must target a named layer (photoshop_scale_layer, etc.).\n' +
          'Do NOT use when: the layer is already active — check photoshop_get_state first.\n\n' +
          'Returns: selected, layerName, kind, bounds (best-effort), context.\n' +
          'First depth-first name match wins when duplicate names exist in different groups.\n' +
          'Preconditions: active document. Side effects: changes active layer.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Exact layer name (case-sensitive)',
            },
          },
          required: ['name'],
        },
      },
      handler: async (args) => selectLayerByName(connection, backendRouter, args),
    },
  ];
}

async function createLayer(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = args.name as string | undefined;
  const aboveLayerId =
    typeof args.above_layer_id === 'number' && Number.isSafeInteger(args.above_layer_id) && args.above_layer_id > 0
      ? args.above_layer_id
      : undefined;
  const belowLayerId =
    typeof args.below_layer_id === 'number' && Number.isSafeInteger(args.below_layer_id) && args.below_layer_id > 0
      ? args.below_layer_id
      : undefined;

  if (args.above_layer_id !== undefined && aboveLayerId === undefined) {
    return atomicFailureFromError(new Error('above_layer_id must be a positive integer'), {
      code: 'invalid_arguments',
    });
  }
  if (args.below_layer_id !== undefined && belowLayerId === undefined) {
    return atomicFailureFromError(new Error('below_layer_id must be a positive integer'), {
      code: 'invalid_arguments',
    });
  }
  if (aboveLayerId !== undefined && belowLayerId !== undefined) {
    return atomicFailureFromError(new Error('Provide only one of above_layer_id or below_layer_id'), {
      code: 'invalid_arguments',
    });
  }

  try {
    const backend = await backendRouter.backendFor('layer.create');
    let parsed: Record<string, unknown>;
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' &&
        Number.isSafeInteger(args.document_id) &&
        args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpCreateLayer({
        ...(documentId !== undefined ? { document_id: documentId } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(aboveLayerId !== undefined ? { above_layer_id: aboveLayerId } : {}),
        ...(belowLayerId !== undefined ? { below_layer_id: belowLayerId } : {}),
      });
      if (!result.ok || !result.data) {
        return atomicFailureFromError(new Error(result.error ?? 'uxp_create_layer_failed'));
      }
      parsed = result.data;
    } else {
      const raw = await runSnippet(
        connection,
        ExtendScriptSnippets.newLayer(name, { aboveLayerId, belowLayerId })
      );
      const legacy = parseSnippetResult(raw);
      if (!legacy) {
        return atomicFailureFromError(new Error(`Unparseable create-layer result: ${String(raw)}`));
      }
      parsed = legacy;
    }
    return atomicSuccess(`Layer created: ${String(parsed.layerName ?? name ?? 'unnamed')}`, parsed);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function deleteLayer(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const layerId =
    args.layer_id === undefined
      ? undefined
      : typeof args.layer_id === 'number' && Number.isSafeInteger(args.layer_id) && args.layer_id > 0
        ? args.layer_id
        : null;
  if (layerId === null) {
    return atomicFailureFromError(new Error('layer_id must be a positive integer'), { code: 'invalid_arguments' });
  }
  try {
    const backend = await backendRouter.backendFor('layer.delete');
    let parsed: Record<string, unknown>;
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' &&
        Number.isSafeInteger(args.document_id) &&
        args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpDeleteLayer({
        ...(documentId !== undefined ? { document_id: documentId } : {}),
        ...(layerId !== undefined ? { layer_id: layerId } : {}),
      });
      if (!result.ok || !result.data) {
        return atomicFailureFromError(new Error(result.error ?? 'uxp_delete_layer_failed'));
      }
      parsed = result.data;
    } else {
      const raw = await runSnippet(connection, ExtendScriptSnippets.deleteLayer(layerId));
      const legacy = parseSnippetResult(raw);
      if (!legacy) {
        return atomicFailureFromError(new Error(`Unparseable delete-layer result: ${String(raw)}`));
      }
      parsed = legacy;
    }
    return atomicSuccess('Layer deleted', parsed);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function mergeLayerDown(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const layerId = args.layer_id;
  const targetLayerId = args.target_layer_id;
  if (typeof layerId !== 'number' || !Number.isSafeInteger(layerId) || layerId <= 0) {
    return atomicFailureFromError(new Error('layer_id must be a positive integer'), { code: 'invalid_arguments' });
  }
  if (typeof targetLayerId !== 'number' || !Number.isSafeInteger(targetLayerId) || targetLayerId <= 0) {
    return atomicFailureFromError(new Error('target_layer_id must be a positive integer'), { code: 'invalid_arguments' });
  }
  if (layerId === targetLayerId) {
    return atomicFailureFromError(new Error('layer_id and target_layer_id must differ'), { code: 'invalid_arguments' });
  }
  try {
    const backend = await backendRouter.backendFor('layer.merge_down');
    let parsed: Record<string, unknown>;
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' &&
        Number.isSafeInteger(args.document_id) &&
        args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpOperation(
        'merge_layer_down',
        {
          ...(documentId !== undefined ? { document_id: documentId } : {}),
          layer_id: layerId,
          target_layer_id: targetLayerId,
        },
        'uxp_merge_layer_down_failed'
      );
      if (!result.ok || !result.data) {
        return atomicFailureFromError(new Error(result.error ?? 'uxp_merge_layer_down_failed'));
      }
      parsed = result.data;
    } else {
      const raw = await runSnippet(connection, ExtendScriptSnippets.mergeLayerDown(layerId, targetLayerId));
      const legacy = parseSnippetResult(raw);
      if (!legacy) {
        return atomicFailureFromError(new Error(`Unparseable merge-layer-down result: ${String(raw)}`));
      }
      parsed = legacy;
    }
    return atomicSuccess('Logical layer merged down', parsed);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function createTextLayer(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const text = args.text as string;
  const x = (args.x as number) || 100;
  const y = (args.y as number) || 100;
  const fontSize = (args.fontSize as number) || 24;
  const fontName = args.fontName as string | undefined;

  try {
    const backend = await backendRouter.backendFor('layer.text.create');
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' && Number.isSafeInteger(args.document_id) && args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpOperation(
        'create_text_layer',
        {
          text,
          x,
          y,
          fontSize,
          ...(fontName ? { fontName } : {}),
          ...(documentId !== undefined ? { document_id: documentId } : {}),
        },
        'uxp_create_text_layer_failed'
      );
      if (!result.ok || !result.data) {
        return atomicFailureFromError(new Error(result.error ?? 'uxp_create_text_layer_failed'));
      }
      return atomicSuccess(`Text layer created: ${String(result.data.layerName ?? 'text layer')}`, result.data);
    }
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.createTextLayer(text, x, y, fontSize, fontName)
    );
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable create-text-layer result: ${String(raw)}`));
    }
    return atomicSuccess(`Text layer created: ${String(parsed.layerName ?? 'text layer')}`, parsed);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function fillLayer(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const red = args.red as number;
  const green = args.green as number;
  const blue = args.blue as number;
  const layerId =
    typeof args.layer_id === 'number' && Number.isSafeInteger(args.layer_id) && args.layer_id > 0
      ? args.layer_id
      : undefined;

  if (args.layer_id !== undefined && layerId === undefined) {
    return atomicFailureFromError(new Error('layer_id must be a positive integer'), {
      code: 'invalid_arguments',
    });
  }

  try {
    const backend = await backendRouter.backendFor('layer.fill');
    let parsed: Record<string, unknown>;
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' &&
        Number.isSafeInteger(args.document_id) &&
        args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpFillLayer({
        ...(documentId !== undefined ? { document_id: documentId } : {}),
        ...(layerId !== undefined ? { layer_id: layerId } : {}),
        red,
        green,
        blue,
      });
      if (!result.ok || !result.data) {
        return atomicFailureFromError(new Error(result.error ?? 'uxp_fill_layer_failed'));
      }
      parsed = result.data;
    } else {
      const raw = await runSnippet(connection, ExtendScriptSnippets.fillLayer(red, green, blue, layerId));
      const legacy = parseSnippetResult(raw);
      if (!legacy) {
        return atomicFailureFromError(new Error(`Unparseable fill-layer result: ${String(raw)}`));
      }
      parsed = legacy;
    }
    return atomicSuccess(`Layer filled with RGB(${red}, ${green}, ${blue})`, parsed);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function getLayers(backendRouter: PhotoshopBackendRouter): Promise<ToolResult> {
  try {
    const parsed = await backendRouter.listLayers();
    const count = typeof parsed.layerCount === 'number' ? parsed.layerCount : undefined;
    return atomicSuccess(
      count === undefined ? 'Listed layers' : `Listed ${count} layers`,
      parsed,
      'photoshop_select_layer_by_name'
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function selectLayerByName(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = args.name as string;

  try {
    const backend = await backendRouter.backendFor('layer.select_by_name');
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' &&
        Number.isSafeInteger(args.document_id) &&
        args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpSelectLayerByName({
        ...(documentId !== undefined ? { document_id: documentId } : {}),
        name,
      });
      if (!result.ok || !result.data) {
        return atomicFailureFromError(new Error(result.error ?? 'uxp_select_layer_by_name_failed'));
      }
      return atomicSuccess(
        `Layer selected: ${String(result.data.layerName ?? name)}`,
        result.data,
        'photoshop_get_state'
      );
    }
    const raw = await runSnippet(connection, ExtendScriptSnippets.selectLayerByName(name));
    const parsed = parseSnippetResult(raw);
    if (!parsed) return atomicFailureFromError(new Error(`Unparseable select-layer result: ${String(raw)}`));
    if (parsed.ok === false) return atomicFailureFromError(new Error(String(parsed.message || 'Layer not found')));
    return atomicSuccess(
      `Layer selected: ${String(parsed.layerName ?? parsed.layer_name ?? name)}`,
      parsed,
      'photoshop_get_state'
    );
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
