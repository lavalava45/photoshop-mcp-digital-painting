import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { documentGuardScript } from '../core/document-target.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { invokeUxpOperation } from '../platform/uxp-bridge-client.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

const STACK_MODES = {
  mean: 'stackModeMean',
  median: 'stackModeMedian',
  maximum: 'stackModeMaximum',
  minimum: 'stackModeMinimum',
  summation: 'stackModeSummation',
  stddev: 'stackModeStandardDeviation',
} as const;
type StackMode = keyof typeof STACK_MODES;

function documentIdParams(args: Record<string, unknown>): Record<string, unknown> {
  return typeof args.document_id === 'number' &&
    Number.isSafeInteger(args.document_id) &&
    args.document_id > 0
    ? { document_id: args.document_id }
    : {};
}

export function createStackTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_image_stack',
        description:
          'Load 2+ image files into one document, convert to a smart object and apply a stack mode (mean/median/max/min/...). Classic "remove tourists from N shots" or noise reduction.\n\n' +
          'Users often say: remove tourists, median stack, average these photos, noise stack, turistleri sil.\n\n' +
          'Use when: the user has multiple aligned shots of the same scene and wants a statistical blend.\n' +
          'Do NOT use when: removing a single object from one photo — use photoshop_recipe_remove_distraction or photoshop_content_aware_fill.\n\n' +
          'Returns: JSON { ok, summary, details: { file_count, mode, layer_name } }.\n' +
          'Preconditions: 2+ existing image files. Side effects: opens the files; the stacked result becomes the active document.',
        inputSchema: {
          type: 'object',
          properties: {
            files: {
              type: 'array',
              items: { type: 'string' },
              description: 'Absolute paths of the images to stack (min 2)',
              minItems: 2,
            },
            mode: {
              type: 'string',
              enum: Object.keys(STACK_MODES),
              description: 'Stack mode — median removes transient objects, mean reduces noise',
              default: 'median',
            },
          },
          required: ['files'],
        },
      },
      handler: async (args) => imageStack(connection, backendRouter, args),
    },
  ];
}

async function imageStack(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const files = Array.isArray(args.files)
    ? args.files.filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    : [];
  if (files.length < 2) {
    return atomicFailureFromError(new Error('files must contain at least 2 image paths'));
  }
  const mode: StackMode =
    typeof args.mode === 'string' && args.mode in STACK_MODES ? (args.mode as StackMode) : 'median';

  try {
    const backend = await backendRouter.backendFor('image.stack');
    let parsed: Record<string, unknown>;
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'image_stack',
        {
          files,
          mode,
          stack_mode: STACK_MODES[mode],
          ...documentIdParams(args),
        },
        'uxp_image_stack_failed',
        120_000
      );
      if (!result.ok || !result.data) throw new Error(result.error ?? 'uxp_image_stack_failed');
      parsed = result.data;
    } else {
      const script = ExtendScriptSnippets.imageStackMode(files, STACK_MODES[mode]);
      const documentId = documentIdParams(args).document_id;
      const raw = await runSnippet(
        connection,
        typeof documentId === 'number'
          ? `${documentGuardScript(documentId)}\n${script}`
          : script
      );
      const legacyParsed = parseSnippetResult(raw);
      if (!legacyParsed) {
        return atomicFailureFromError(new Error(`Unparseable image stack result: ${String(raw)}`));
      }
      parsed = legacyParsed;
    }
    if (parsed.ok === false) {
      return atomicFailureFromError(new Error(String(parsed.message || 'Image stack failed')));
    }
    return atomicSuccess(`Image stack applied (${mode}, ${files.length} files)`, {
      mode,
      file_count: files.length,
      layer_name: parsed.layer_name,
    });
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
