import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { ExtendScriptSnippets, type GradientMaskDirection } from '../api/extendscript.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { invokeUxpApplyGradientMask, invokeUxpOperation } from '../platform/uxp-bridge-client.js';
import { clampInt } from './recipes/_shared.js';
import {
  atomicFailure,
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';
import type { PhotoshopErrorCode } from '../errors/envelope.js';

function mapClippingSnippetFailure(parsed: Record<string, unknown>): ToolResult | null {
  if (parsed.ok !== false) return null;
  const rawCode = typeof parsed.code === 'string' ? parsed.code : 'extendscript_runtime_error';
  const allowed: PhotoshopErrorCode[] = [
    'no_active_document',
    'no_active_layer',
    'layer_not_found',
    'no_base_layer_below',
    'not_clipping',
    'extendscript_runtime_error',
  ];
  const code: PhotoshopErrorCode =
    rawCode === 'no_document'
      ? 'no_active_document'
      : allowed.includes(rawCode as PhotoshopErrorCode)
        ? (rawCode as PhotoshopErrorCode)
        : 'extendscript_runtime_error';
  return atomicFailure({
    ok: false,
    code,
    message: String(parsed.message || 'Clipping mask operation failed'),
    suggested_next_tool:
      typeof parsed.suggested_next_tool === 'string'
        ? parsed.suggested_next_tool
        : code === 'no_base_layer_below' || code === 'not_clipping'
          ? 'photoshop_get_layers'
          : 'photoshop_get_state',
  });
}

async function runClippingMaskSnippet(
  connection: PhotoshopConnection,
  script: string,
  successSummary: string,
  detailsKeys: string[]
): Promise<ToolResult> {
  try {
    const raw = await runSnippet(connection, script);
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable clipping mask result: ${String(raw)}`));
    }
    const failure = mapClippingSnippetFailure(parsed);
    if (failure) return failure;
    const details: Record<string, unknown> = {};
    for (const key of detailsKeys) {
      if (parsed[key] !== undefined) details[key] = parsed[key];
    }
    if (parsed.context !== undefined) details.context = parsed.context;
    return atomicSuccess(successSummary, details);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}

const GRADIENT_DIRECTIONS: GradientMaskDirection[] = [
  'top_to_bottom',
  'bottom_to_top',
  'left_to_right',
  'right_to_left',
];

function parseGradientDirection(value: unknown): GradientMaskDirection {
  if (typeof value === 'string' && GRADIENT_DIRECTIONS.includes(value as GradientMaskDirection)) {
    return value as GradientMaskDirection;
  }
  return 'bottom_to_top';
}

export function createMaskTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_apply_gradient_mask',
        description:
          'Apply a linear black-to-white gradient on the active layer mask channel (fade/blend).\n\n' +
          'Users often say: fade into background, gradient mask, blend subject, soft edge fade.\n\n' +
          'This paints on an existing layer mask — not a Gradient Fill layer.\n' +
          'Use when: softening edges or fading a layer into the background through its mask.\n' +
          'Do NOT use when: subject is not isolated — use photoshop_recipe_remove_background or photoshop_create_layer_mask first.\n\n' +
          'Returns: JSON { ok, summary, details: { applied, direction, angle, mask_auto_created? } }.\n' +
          'Preconditions: active document and active layer. Creates a reveal-all mask if none exists.\n' +
          'Side effects: modifies layer mask pixels; two history steps when mask is auto-created.',
        inputSchema: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: GRADIENT_DIRECTIONS,
              description: 'Gradient fade direction on the mask (default bottom_to_top)',
              default: 'bottom_to_top',
            },
            start_pct: {
              type: 'number',
              description: 'Gradient start along fade axis (0-100)',
              minimum: 0,
              maximum: 100,
              default: 0,
            },
            end_pct: {
              type: 'number',
              description: 'Gradient end along fade axis (0-100)',
              minimum: 0,
              maximum: 100,
              default: 100,
            },
            angle_deg: {
              type: 'number',
              description: 'Override gradient angle in degrees (optional)',
            },
          },
        },
      },
      handler: async (args) => applyGradientMask(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_create_clipping_mask',
        description:
          'Create a clipping mask on the active layer (or a named layer).\n\n' +
          'Users often say: clip to layer below, clipping mask, clip this layer, mask to shape below.\n\n' +
          'Use when: the active layer should be visible only where the layer directly below it has opaque pixels.\n' +
          'Do NOT use when: the layer is already clipped — returns success with already_clipping.\n' +
          'Do NOT use when: the layer is the bottom-most layer — there is no base layer to clip into.\n\n' +
          'Returns: JSON { ok, summary, details: { layer_name, is_clipping, already_clipping? } }.\n' +
          'Preconditions: active document; target layer must sit directly above the base layer below it in the same group/stack.\n' +
          'Side effects: one history step (groupEvent).',
        inputSchema: {
          type: 'object',
          properties: {
            layer_name: {
              type: 'string',
              description: 'Optional exact layer name (recursive search). Default: active layer.',
            },
          },
        },
      },
      handler: async (args) => createClippingMask(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_release_clipping_mask',
        description:
          'Release (remove) the clipping mask from the active layer (or a named layer).\n\n' +
          'Users often say: unclip, release clipping mask, remove clipping mask.\n\n' +
          'Use when: a clipped layer should become independent again.\n' +
          'Do NOT use when: the layer is not clipped — returns not_clipping error.\n\n' +
          'Returns: JSON { ok, summary, details: { layer_name, is_clipping: false } }.\n' +
          'Preconditions: active document; target layer must currently be a clipping mask (grouped).\n' +
          'Side effects: sets layer.grouped = false; one history step.',
        inputSchema: {
          type: 'object',
          properties: {
            layer_name: {
              type: 'string',
              description: 'Optional exact layer name (recursive search). Default: active layer.',
            },
          },
        },
      },
      handler: async (args) => releaseClippingMask(connection, backendRouter, args),
    },
  ];
}

async function createClippingMask(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const layerName = typeof args.layer_name === 'string' ? args.layer_name.trim() : undefined;
  try {
    const backend = await backendRouter.backendFor('layer.clipping.create');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'create_clipping_mask',
        layerName ? { layer_name: layerName } : {},
        'uxp_create_clipping_mask_failed'
      );
      if (!result.ok || !result.data) {
        throw new Error(result.error ?? 'uxp_create_clipping_mask_failed');
      }
      const failure = mapClippingSnippetFailure(result.data);
      if (failure) return failure;
      const details: Record<string, unknown> = {};
      for (const key of ['layer_name', 'is_clipping', 'already_clipping']) {
        if (result.data[key] !== undefined) details[key] = result.data[key];
      }
      if (result.data.context !== undefined) details.context = result.data.context;
      return atomicSuccess(
        layerName ? `Clipping mask created on "${layerName}"` : 'Clipping mask created on active layer',
        details
      );
    }
  } catch (error) {
    return atomicFailureFromError(error);
  }
  return runClippingMaskSnippet(
    connection,
    ExtendScriptSnippets.createClippingMask(layerName),
    layerName ? `Clipping mask created on "${layerName}"` : 'Clipping mask created on active layer',
    ['layer_name', 'is_clipping', 'already_clipping']
  );
}

async function releaseClippingMask(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const layerName = typeof args.layer_name === 'string' ? args.layer_name.trim() : undefined;
  try {
    const backend = await backendRouter.backendFor('layer.clipping.release');
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'release_clipping_mask',
        layerName ? { layer_name: layerName } : {},
        'uxp_release_clipping_mask_failed'
      );
      if (!result.ok || !result.data) {
        throw new Error(result.error ?? 'uxp_release_clipping_mask_failed');
      }
      const failure = mapClippingSnippetFailure(result.data);
      if (failure) return failure;
      const details: Record<string, unknown> = {};
      for (const key of ['layer_name', 'is_clipping']) {
        if (result.data[key] !== undefined) details[key] = result.data[key];
      }
      if (result.data.context !== undefined) details.context = result.data.context;
      return atomicSuccess(
        layerName ? `Clipping mask released from "${layerName}"` : 'Clipping mask released from active layer',
        details
      );
    }
  } catch (error) {
    return atomicFailureFromError(error);
  }
  return runClippingMaskSnippet(
    connection,
    ExtendScriptSnippets.releaseClippingMask(layerName),
    layerName ? `Clipping mask released from "${layerName}"` : 'Clipping mask released from active layer',
    ['layer_name', 'is_clipping']
  );
}

async function applyGradientMask(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const direction = parseGradientDirection(args.direction);
  const startPct = clampInt(args.start_pct, 0, 100, 0);
  const endPct = clampInt(args.end_pct, 0, 100, 100);
  const angleDeg = typeof args.angle_deg === 'number' ? args.angle_deg : undefined;

  try {
    const backend = await backendRouter.backendFor('layer.mask.gradient');
    if (backend.kind === 'uxp') {
      const documentId =
        typeof args.document_id === 'number' &&
        Number.isSafeInteger(args.document_id) &&
        args.document_id > 0
          ? args.document_id
          : undefined;
      const result = await invokeUxpApplyGradientMask({
        ...(documentId !== undefined ? { document_id: documentId } : {}),
        direction,
        start_pct: startPct,
        end_pct: endPct,
        ...(angleDeg !== undefined ? { angle_deg: angleDeg } : {}),
      });
      if (!result.ok || !result.data) throw new Error(result.error ?? 'uxp_apply_gradient_mask_failed');
      return atomicSuccess('Gradient applied on layer mask', result.data);
    }
    const raw = await runSnippet(
      connection,
      ExtendScriptSnippets.applyGradientMask(direction, startPct, endPct, angleDeg)
    );
    const parsed = parseSnippetResult(raw);
    if (!parsed) throw new Error(`Unparseable gradient-mask result: ${String(raw)}`);
    return atomicSuccess('Gradient applied on layer mask', parsed);
  } catch (error) {
    return atomicFailureFromError(error);
  }
}
