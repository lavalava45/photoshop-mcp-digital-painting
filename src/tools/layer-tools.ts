import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

export function createLayerTools(connection: PhotoshopConnection): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_create_layer',
        description:
          'Create a new empty layer above the active layer.\n\n' +
          'Use when: user needs a blank layer for painting, fills, or stacking content.\n' +
          'Do NOT use when: adding text — use photoshop_create_text_layer.\n\n' +
          'Returns: created layer name and context.\n' +
          'Preconditions: active document. Side effects: adds layer to history.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Name for the new layer (optional)',
            },
          },
        },
      },
      handler: async (args) => createLayer(connection, args),
    },
    {
      tool: {
        name: 'photoshop_delete_layer',
        description: 'Delete the active layer',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async () => deleteLayer(connection),
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
      handler: async (args) => createTextLayer(connection, args),
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
          },
          required: ['red', 'green', 'blue'],
        },
      },
      handler: async (args) => fillLayer(connection, args),
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
      handler: async () => getLayers(connection),
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
      handler: async (args) => selectLayerByName(connection, args),
    },
  ];
}

async function createLayer(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = args.name as string | undefined;

  try {
    const raw = await runSnippet(connection, ExtendScriptSnippets.newLayer(name));
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable create-layer result: ${String(raw)}`));
    }
    return atomicSuccess(`Layer created: ${String(parsed.layerName ?? name ?? 'unnamed')}`, parsed);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function deleteLayer(connection: PhotoshopConnection): Promise<ToolResult> {
  try {
    const raw = await runSnippet(connection, ExtendScriptSnippets.deleteLayer());
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable delete-layer result: ${String(raw)}`));
    }
    return atomicSuccess('Layer deleted', parsed);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function createTextLayer(
  connection: PhotoshopConnection,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const text = args.text as string;
  const x = (args.x as number) || 100;
  const y = (args.y as number) || 100;
  const fontSize = (args.fontSize as number) || 24;
  const fontName = args.fontName as string | undefined;

  try {
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
  args: Record<string, unknown>
): Promise<ToolResult> {
  const red = args.red as number;
  const green = args.green as number;
  const blue = args.blue as number;

  try {
    const raw = await runSnippet(connection, ExtendScriptSnippets.fillLayer(red, green, blue));
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable fill-layer result: ${String(raw)}`));
    }
    return atomicSuccess(`Layer filled with RGB(${red}, ${green}, ${blue})`, parsed);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function getLayers(connection: PhotoshopConnection): Promise<ToolResult> {
  try {
    const raw = await runSnippet(connection, ExtendScriptSnippets.getLayerNames());
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable get-layers result: ${String(raw)}`));
    }
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
  args: Record<string, unknown>
): Promise<ToolResult> {
  const name = args.name as string;

  try {
    const raw = await runSnippet(connection, ExtendScriptSnippets.selectLayerByName(name));
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable select-layer result: ${String(raw)}`));
    }
    return atomicSuccess(`Layer selected: ${String(parsed.layerName ?? name)}`, parsed, 'photoshop_get_state');
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
