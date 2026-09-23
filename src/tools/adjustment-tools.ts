import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { documentGuardScript } from '../core/document-target.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets, type CurvesPreset } from '../api/extendscript.js';
import { PhotoshopBackendRouter, type PhotoshopPrimitive } from '../platform/photoshop-backend.js';
import { invokeUxpOperation } from '../platform/uxp-bridge-client.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

const CURVES_PRESETS: CurvesPreset[] = ['auto_tone', 'neutral'];

function parseCurvesPreset(value: unknown): CurvesPreset {
  if (typeof value === 'string' && CURVES_PRESETS.includes(value as CurvesPreset)) {
    return value as CurvesPreset;
  }
  return 'auto_tone';
}

function documentIdParams(args: Record<string, unknown>): Record<string, unknown> {
  return typeof args.document_id === 'number' &&
    Number.isSafeInteger(args.document_id) &&
    args.document_id > 0
    ? { document_id: args.document_id }
    : {};
}

function guardLegacyScript(args: Record<string, unknown>, script: string): string {
  const documentId = documentIdParams(args).document_id;
  return typeof documentId === 'number'
    ? `${documentGuardScript(documentId)}\n${script}`
    : script;
}

export function createAdjustmentTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_adjust_brightness_contrast',
        description:
          'Adjust brightness and contrast of the active layer.\n\n' +
          'Users often say: fix exposure, add contrast, brighten, darken.',
        inputSchema: {
          type: 'object',
          properties: {
            brightness: {
              type: 'number',
              description: 'Brightness adjustment (-100 to 100)',
              minimum: -100,
              maximum: 100,
            },
            contrast: {
              type: 'number',
              description: 'Contrast adjustment (-100 to 100)',
              minimum: -100,
              maximum: 100,
            },
          },
          required: ['brightness', 'contrast'],
        },
      },
      handler: async (args) => adjustBrightnessContrast(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_adjust_hue_saturation',
        description: 'Adjust hue, saturation, and lightness of the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            hue: {
              type: 'number',
              description: 'Hue shift (-180 to 180)',
              minimum: -180,
              maximum: 180,
            },
            saturation: {
              type: 'number',
              description: 'Saturation adjustment (-100 to 100)',
              minimum: -100,
              maximum: 100,
            },
            lightness: {
              type: 'number',
              description: 'Lightness adjustment (-100 to 100)',
              minimum: -100,
              maximum: 100,
            },
          },
          required: ['hue', 'saturation', 'lightness'],
        },
      },
      handler: async (args) => adjustHueSaturation(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_auto_levels',
        description:
          'Apply auto levels adjustment to the active layer.\n\n' +
          'Users often say: fix flat image, auto tone, make it pop (mild).',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async (args) => autoLevels(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_auto_contrast',
        description: 'Apply auto contrast adjustment to the active layer',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async (args) => autoContrast(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_adjust_curves',
        description:
          'Create a Curves adjustment layer on the active document.\n\n' +
          'Users often say: make it pop, S-curve, fix flat image, auto tone, improve contrast.\n\n' +
          'Use when: global tonal correction via a non-destructive Curves adjustment layer.\n' +
          'Do NOT use when: stylistic cinematic grade — use photoshop_recipe_apply_color_grade.\n\n' +
          'Returns: JSON { ok, summary, details: { layer_name, preset } }.\n' +
          'Preconditions: active document. Side effects: adds Curves adjustment layer.',
        inputSchema: {
          type: 'object',
          properties: {
            preset: {
              type: 'string',
              enum: CURVES_PRESETS,
              description: 'auto_tone (S-curve) or neutral (identity curve)',
              default: 'auto_tone',
            },
          },
        },
      },
      handler: async (args) => adjustCurves(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_desaturate',
        description: 'Desaturate the active layer (convert to grayscale)',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async (args) => desaturate(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_invert',
        description: 'Invert colors of the active layer',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      handler: async (args) => invert(connection, backendRouter, args),
    },
  ];
}

async function runSimpleAdjustment(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>,
  primitive: PhotoshopPrimitive,
  action: string,
  params: Record<string, unknown>,
  legacyScript: string,
  successText: string,
  errorPrefix: string
): Promise<ToolResult> {
  try {
    const backend = await backendRouter.backendFor(primitive);
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        action,
        { ...params, ...documentIdParams(args) },
        `uxp_${action}_failed`
      );
      if (!result.ok) throw new Error(result.error ?? `uxp_${action}_failed`);
    } else {
      const apiFactory = new PhotoshopAPIFactory(connection);
      const api = await apiFactory.createAPI();
      await api.executeScript(guardLegacyScript(args, legacyScript));
    }
    return { content: [{ type: 'text' as const, text: successText }] };
  } catch (error) {
    return {
      content: [{
        type: 'text' as const,
        text: `${errorPrefix}: ${error instanceof Error ? error.message : String(error)}`,
      }],
      isError: true,
    };
  }
}

async function adjustBrightnessContrast(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const brightness = args.brightness as number;
  const contrast = args.contrast as number;
  return runSimpleAdjustment(
    connection,
    backendRouter,
    args,
    'adjustment.brightness_contrast',
    'adjust_brightness_contrast',
    { brightness, contrast },
    ExtendScriptSnippets.adjustBrightnessContrast(brightness, contrast),
    `Brightness/Contrast adjusted: brightness ${brightness}, contrast ${contrast}`,
    'Error adjusting brightness/contrast'
  );
}

async function adjustHueSaturation(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const hue = args.hue as number;
  const saturation = args.saturation as number;
  const lightness = args.lightness as number;
  return runSimpleAdjustment(
    connection,
    backendRouter,
    args,
    'adjustment.hue_saturation',
    'adjust_hue_saturation',
    { hue, saturation, lightness },
    ExtendScriptSnippets.adjustHueSaturation(hue, saturation, lightness),
    `Hue/Saturation adjusted: hue ${hue}, saturation ${saturation}, lightness ${lightness}`,
    'Error adjusting hue/saturation'
  );
}

async function autoLevels(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  return runSimpleAdjustment(
    connection,
    backendRouter,
    args,
    'adjustment.auto_levels',
    'auto_levels',
    {},
    ExtendScriptSnippets.autoLevels(),
    'Auto Levels applied',
    'Error applying auto levels'
  );
}

async function adjustCurves(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const preset = parseCurvesPreset(args.preset);

  try {
    const backend = await backendRouter.backendFor('adjustment.curves');
    let parsed: Record<string, unknown>;
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'adjust_curves',
        { preset, ...documentIdParams(args) },
        'uxp_adjust_curves_failed'
      );
      if (!result.ok || !result.data) throw new Error(result.error ?? 'uxp_adjust_curves_failed');
      parsed = result.data;
    } else {
      const raw = await runSnippet(
        connection,
        guardLegacyScript(args, ExtendScriptSnippets.adjustCurves(preset))
      );
      const legacyParsed = parseSnippetResult(raw);
      if (!legacyParsed) {
        return atomicFailureFromError(new Error(`Snippet returned unparseable payload: ${String(raw)}`));
      }
      parsed = legacyParsed;
    }

    const layerName =
      typeof parsed.layer_name === 'string' ? parsed.layer_name : 'Curves adjustment layer';
    return atomicSuccess(`Curves adjustment layer created (${preset})`, {
      layer_name: layerName,
      preset,
      ...parsed,
    });
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

async function autoContrast(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  return runSimpleAdjustment(
    connection,
    backendRouter,
    args,
    'adjustment.auto_contrast',
    'auto_contrast',
    {},
    ExtendScriptSnippets.autoContrast(),
    'Auto Contrast applied',
    'Error applying auto contrast'
  );
}

async function desaturate(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  return runSimpleAdjustment(
    connection,
    backendRouter,
    args,
    'adjustment.desaturate',
    'desaturate',
    {},
    ExtendScriptSnippets.desaturate(),
    'Layer desaturated (converted to grayscale)',
    'Error desaturating layer'
  );
}

async function invert(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  return runSimpleAdjustment(
    connection,
    backendRouter,
    args,
    'adjustment.invert',
    'invert',
    {},
    ExtendScriptSnippets.invert(),
    'Colors inverted',
    'Error inverting colors'
  );
}
