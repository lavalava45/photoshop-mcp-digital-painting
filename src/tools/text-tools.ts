import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { invokeUxpOperation } from '../platform/uxp-bridge-client.js';

export function createTextTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_list_fonts',
        description:
          'List installed fonts available to Photoshop.\n\n' +
          'Use when: choosing a font for photoshop_create_text_layer or photoshop_set_text_font.\n' +
          'TextItem.font requires the PostScript name — use postScriptName from results, or pass display name to set/create tools (they resolve automatically).\n\n' +
          'Returns: fonts array ({ name, postScriptName, family, style }), total count, truncated flag.\n' +
          'First call may be slow (app.fonts.length can exceed 1000). Side effects: none.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Optional substring filter (matches name, postScriptName, or family)',
            },
            limit: {
              type: 'number',
              description: 'Maximum fonts to return (default: 200)',
              default: 200,
              minimum: 1,
              maximum: 1000,
            },
          },
        },
      },
      handler: async (args) => listFonts(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_font',
        description:
          'Set font family and size for active text layer.\n\n' +
          'Accepts display name (e.g. "Arial") or PostScript name (e.g. "ArialMT") — resolved via app.fonts.\n' +
          'Use photoshop_list_fonts to discover available fonts.',
        inputSchema: {
          type: 'object',
          properties: {
            fontName: {
              type: 'string',
              description: 'Font display or PostScript name (see photoshop_list_fonts)',
            },
            fontSize: {
              type: 'number',
              description: 'Font size in points (optional)',
              minimum: 1,
            },
          },
          required: ['fontName'],
        },
      },
      handler: async (args) => setTextFont(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_color',
        description: 'Set color for active text layer',
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
      handler: async (args) => setTextColor(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_set_text_alignment',
        description: 'Set text alignment for active text layer',
        inputSchema: {
          type: 'object',
          properties: {
            alignment: {
              type: 'string',
              description: 'Text alignment',
              enum: ['LEFT', 'CENTER', 'RIGHT', 'LEFTJUSTIFIED', 'CENTERJUSTIFIED', 'RIGHTJUSTIFIED', 'FULLYJUSTIFIED'],
            },
          },
          required: ['alignment'],
        },
      },
      handler: async (args) => setTextAlignment(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_update_text_content',
        description: 'Update the text content of active text layer',
        inputSchema: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: 'New text content',
            },
          },
          required: ['text'],
        },
      },
      handler: async (args) => updateTextContent(connection, backendRouter, args),
    },
  ];
}

async function listFonts(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const query = args.query as string | undefined;
  const limit = (args.limit as number | undefined) ?? 200;

  try {
    const backend = await backendRouter.backendFor('text.fonts.list');
    let result: unknown;
    if (backend.kind === 'uxp') {
      const uxpResult = await invokeUxpOperation(
        'list_fonts',
        {
          ...(query !== undefined ? { query } : {}),
          limit,
        },
        'uxp_list_fonts_failed'
      );
      if (!uxpResult.ok || !uxpResult.data) {
        throw new Error(uxpResult.error ?? 'uxp_list_fonts_failed');
      }
      result = uxpResult.data;
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      const script = ExtendScriptSnippets.listFonts(query, limit);
      result = await api.executeScript(script);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Fonts listed${query ? ` (query: "${query}")` : ''}\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error listing fonts: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setTextFont(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const fontName = args.fontName as string;
  const fontSize = args.fontSize as number | undefined;

  try {
    const backend = await backendRouter.backendFor('text.font.write');
    let result: unknown;
    if (backend.kind === 'uxp') {
      const uxpResult = await invokeUxpOperation(
        'set_text_font',
        {
          ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
          fontName,
          ...(fontSize !== undefined ? { fontSize } : {}),
        },
        'uxp_set_text_font_failed'
      );
      if (!uxpResult.ok || !uxpResult.data) {
        throw new Error(uxpResult.error ?? 'uxp_set_text_font_failed');
      }
      result = uxpResult.data;
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      const script = ExtendScriptSnippets.setTextFont(fontName, fontSize);
      result = await api.executeScript(script);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Text font set to ${fontName}${fontSize ? `, size ${fontSize}pt` : ''}\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting text font: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setTextColor(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const red = args.red as number;
  const green = args.green as number;
  const blue = args.blue as number;

  try {
    const backend = await backendRouter.backendFor('text.color.write');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'set_text_color',
        {
          ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
          red,
          green,
          blue,
        },
        'uxp_set_text_color_failed'
      );
      if (!result.ok) throw new Error(result.error ?? 'uxp_set_text_color_failed');
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      const script = ExtendScriptSnippets.setTextColor(red, green, blue);
      await api.executeScript(script);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Text color set to RGB(${red}, ${green}, ${blue})`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting text color: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function setTextAlignment(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const alignment = args.alignment as string;

  try {
    const backend = await backendRouter.backendFor('text.alignment.write');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'set_text_alignment',
        {
          ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
          alignment,
        },
        'uxp_set_text_alignment_failed'
      );
      if (!result.ok) throw new Error(result.error ?? 'uxp_set_text_alignment_failed');
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      const script = ExtendScriptSnippets.setTextAlignment(alignment);
      await api.executeScript(script);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Text alignment set to ${alignment}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error setting text alignment: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function updateTextContent(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const text = args.text as string;

  try {
    const backend = await backendRouter.backendFor('text.content.write');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'update_text_content',
        {
          ...(documentIdFromArgs(args) !== undefined ? { document_id: documentIdFromArgs(args) } : {}),
          text,
        },
        'uxp_update_text_content_failed'
      );
      if (!result.ok) throw new Error(result.error ?? 'uxp_update_text_content_failed');
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      const script = ExtendScriptSnippets.updateTextContent(text);
      await api.executeScript(script);
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Text content updated to: "${text}"`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error updating text content: ${error instanceof Error ? error.message : String(error)}`,
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
