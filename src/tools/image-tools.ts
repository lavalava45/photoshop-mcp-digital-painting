import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { documentGuardScript } from '../core/document-target.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { invokeUxpOperation } from '../platform/uxp-bridge-client.js';

function documentIdParams(args: Record<string, unknown>): Record<string, unknown> {
  return typeof args.document_id === 'number' &&
    Number.isSafeInteger(args.document_id) &&
    args.document_id > 0
    ? { document_id: args.document_id }
    : {};
}

export function createImageTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_resize_image',
        description: 'Resize the active image to specified dimensions',
        inputSchema: {
          type: 'object',
          properties: {
            width: {
              type: 'number',
              description: 'New width in pixels',
              minimum: 1,
            },
            height: {
              type: 'number',
              description: 'New height in pixels',
              minimum: 1,
            },
          },
          required: ['width', 'height'],
        },
      },
      handler: async (args) => resizeImage(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_crop_document',
        description: 'Crop the document to specified bounds',
        inputSchema: {
          type: 'object',
          properties: {
            left: {
              type: 'number',
              description: 'Left edge position in pixels',
              minimum: 0,
            },
            top: {
              type: 'number',
              description: 'Top edge position in pixels',
              minimum: 0,
            },
            right: {
              type: 'number',
              description: 'Right edge position in pixels',
              minimum: 1,
            },
            bottom: {
              type: 'number',
              description: 'Bottom edge position in pixels',
              minimum: 1,
            },
          },
          required: ['left', 'top', 'right', 'bottom'],
        },
      },
      handler: async (args) => cropDocument(connection, backendRouter, args),
    },
  ];
}

async function resizeImage(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const width = args.width as number;
  const height = args.height as number;

  try {
    const backend = await backendRouter.backendFor('document.resize');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'resize_image',
        { width, height, ...documentIdParams(args) },
        'uxp_resize_image_failed'
      );
      if (!result.ok) throw new Error(result.error ?? 'uxp_resize_image_failed');
    } else {
      const api = await new PhotoshopAPIFactory(connection).createAPI();
      const script = ExtendScriptSnippets.resizeImage(width, height);
      const documentId = documentIdParams(args).document_id;
      await api.executeScript(
        typeof documentId === 'number'
          ? `${documentGuardScript(documentId)}\n${script}`
          : script
      );
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Image resized to ${width}x${height}px`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error resizing image: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function cropDocument(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const left = args.left as number;
  const top = args.top as number;
  const right = args.right as number;
  const bottom = args.bottom as number;

  try {
    const backend = await backendRouter.backendFor('document.crop');
    let result: unknown;
    if (backend.kind === 'uxp') {
      const uxpResult = await invokeUxpOperation(
        'crop_document',
        { left, top, right, bottom, ...documentIdParams(args) },
        'uxp_crop_document_failed'
      );
      if (!uxpResult.ok) throw new Error(uxpResult.error ?? 'uxp_crop_document_failed');
      result = uxpResult.data;
    } else {
      const api = await new PhotoshopAPIFactory(connection).createAPI();
      const script = ExtendScriptSnippets.cropDocument(left, top, right, bottom);
      const documentId = documentIdParams(args).document_id;
      result = await api.executeScript(
        typeof documentId === 'number'
          ? `${documentGuardScript(documentId)}\n${script}`
          : script
      );
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: `Document cropped\nResult: ${JSON.stringify(result)}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error cropping document: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}
