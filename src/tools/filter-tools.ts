import { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { PhotoshopConnection } from '../platform/connection.js';
import { PhotoshopAPIFactory } from '../api/photoshop-api.js';
import { ExtendScriptSnippets } from '../api/extendscript.js';
import { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
import { invokeUxpOperation } from '../platform/uxp-bridge-client.js';
import {
  atomicFailureFromError,
  atomicSuccess,
  parseSnippetResult,
  runSnippet,
} from './atomic-shared.js';

const SMART_BLUR_MODES = ['NORMAL', 'EDGEONLY', 'OVERLAYEDGE'] as const;
const SMART_BLUR_QUALITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
type SmartBlurMode = (typeof SMART_BLUR_MODES)[number];
type SmartBlurQuality = (typeof SMART_BLUR_QUALITIES)[number];

export function createFilterTools(
  connection: PhotoshopConnection,
  backendRouter = new PhotoshopBackendRouter(connection)
): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_apply_gaussian_blur',
        description: 'Apply Gaussian Blur filter to the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            radius: {
              type: 'number',
              description: 'Blur radius in pixels (0.1-250)',
              minimum: 0.1,
              maximum: 250,
            },
          },
          required: ['radius'],
        },
      },
      handler: async (args) => applyGaussianBlur(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_apply_sharpen',
        description: 'Apply Unsharp Mask (sharpen) filter to the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            amount: {
              type: 'number',
              description: 'Sharpening amount in percent (1-500)',
              minimum: 1,
              maximum: 500,
            },
            radius: {
              type: 'number',
              description: 'Radius in pixels (0.1-250)',
              minimum: 0.1,
              maximum: 250,
            },
            threshold: {
              type: 'number',
              description: 'Threshold levels (0-255)',
              minimum: 0,
              maximum: 255,
              default: 0,
            },
          },
          required: ['amount', 'radius'],
        },
      },
      handler: async (args) => applySharpen(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_apply_noise',
        description: 'Apply Add Noise filter to the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            amount: {
              type: 'number',
              description: 'Noise amount in percent (0.1-400)',
              minimum: 0.1,
              maximum: 400,
            },
            distribution: {
              type: 'string',
              description: 'Noise distribution type',
              enum: ['UNIFORM', 'GAUSSIAN'],
              default: 'UNIFORM',
            },
            monochromatic: {
              type: 'boolean',
              description: 'Apply monochromatic noise',
              default: false,
            },
          },
          required: ['amount'],
        },
      },
      handler: async (args) => applyNoise(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_apply_motion_blur',
        description: 'Apply Motion Blur filter to the active layer',
        inputSchema: {
          type: 'object',
          properties: {
            angle: {
              type: 'number',
              description: 'Blur angle in degrees (-360 to 360)',
              minimum: -360,
              maximum: 360,
            },
            radius: {
              type: 'number',
              description: 'Blur distance in pixels (1-999)',
              minimum: 1,
              maximum: 999,
            },
          },
          required: ['angle', 'radius'],
        },
      },
      handler: async (args) => applyMotionBlur(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_apply_high_pass',
        description:
          'Apply the High Pass filter to the active raster layer — edge/detail extraction for sharpening workflows or frequency separation prep.\n\n' +
          'Users often say: high pass filter, sharpen edges, extract details, frequency separation high layer.\n\n' +
          'Use when: sharpening via overlay blend, detail extraction, or prepping a high-frequency layer.\n' +
          'Do NOT use on text, Smart Objects, or the Background layer — rasterize or convert first (photoshop_rasterize_layer).\n\n' +
          'Returns: JSON { ok, summary, details: { filter, radius, context } }.\n' +
          'Preconditions: active document; normal (raster) layer selected. Side effects: one history step.',
        inputSchema: {
          type: 'object',
          properties: {
            radius: {
              type: 'number',
              description: 'Edge retention radius in pixels (0.1-250)',
              minimum: 0.1,
              maximum: 250,
            },
          },
          required: ['radius'],
        },
      },
      handler: async (args) => applyHighPass(connection, backendRouter, args),
    },
    {
      tool: {
        name: 'photoshop_apply_smart_blur',
        description:
          'Apply the Smart Blur filter to the active raster layer — edge-preserving blur for smoothing skin or simplifying backgrounds.\n\n' +
          'Users often say: smart blur, edge-preserving blur, smooth skin blur, blur but keep edges.\n\n' +
          'Use when: subtle smoothing that respects edges (portraits, product cleanup).\n' +
          'Do NOT use on text, Smart Objects, or the Background layer — rasterize first (photoshop_rasterize_layer).\n' +
          'Do NOT use when: uniform blur is enough — use photoshop_apply_gaussian_blur.\n\n' +
          'Returns: JSON { ok, summary, details: { filter, radius, threshold, mode, quality, context } }.\n' +
          'Preconditions: active document; normal (raster) layer selected. Side effects: one history step.',
        inputSchema: {
          type: 'object',
          properties: {
            radius: {
              type: 'number',
              description: 'Blur radius (0.1-100)',
              minimum: 0.1,
              maximum: 100,
            },
            threshold: {
              type: 'number',
              description: 'Blur threshold — higher values restrict blur to stronger edges (0.1-100)',
              minimum: 0.1,
              maximum: 100,
            },
            mode: {
              type: 'string',
              enum: [...SMART_BLUR_MODES],
              description: 'Smart blur mode (default: NORMAL)',
              default: 'NORMAL',
            },
            quality: {
              type: 'string',
              enum: [...SMART_BLUR_QUALITIES],
              description: 'Blur quality / smoothness (default: MEDIUM)',
              default: 'MEDIUM',
            },
          },
          required: ['radius', 'threshold'],
        },
      },
      handler: async (args) => applySmartBlur(connection, backendRouter, args),
    },
  ];
}

async function runFilterSnippet(
  connection: PhotoshopConnection,
  script: string,
  successSummary: string,
  detailsKeys: string[]
): Promise<ToolResult> {
  try {
    const raw = await runSnippet(connection, script);
    const parsed = parseSnippetResult(raw);
    if (!parsed) {
      return atomicFailureFromError(new Error(`Unparseable filter result: ${String(raw)}`));
    }
    if (parsed.ok === false) {
      return atomicFailureFromError(
        new Error(String(parsed.message || 'Filter operation failed')),
        parsed.suggested_next_tool
          ? { suggested_next_tool: String(parsed.suggested_next_tool) }
          : undefined
      );
    }
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

function validateHighPassRadius(radius: unknown): number | ToolResult {
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0.1 || radius > 250) {
    return atomicFailureFromError(new Error('radius must be a number between 0.1 and 250'));
  }
  return radius;
}

function validateSmartBlurRadius(radius: unknown): number | ToolResult {
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 0.1 || radius > 100) {
    return atomicFailureFromError(new Error('radius must be a number between 0.1 and 100'));
  }
  return radius;
}

function validateSmartBlurThreshold(threshold: unknown): number | ToolResult {
  if (
    typeof threshold !== 'number' ||
    !Number.isFinite(threshold) ||
    threshold < 0.1 ||
    threshold > 100
  ) {
    return atomicFailureFromError(new Error('threshold must be a number between 0.1 and 100'));
  }
  return threshold;
}

async function applyGaussianBlur(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const radius = args.radius as number;

  try {
    const backend = await backendRouter.backendFor('filter.gaussian_blur' as Parameters<PhotoshopBackendRouter['backendFor']>[0]);
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation('apply_gaussian_blur', { radius }, 'uxp_apply_gaussian_blur_failed');
      if (!result.ok) throw new Error(result.error ?? 'uxp_apply_gaussian_blur_failed');
      return { content: [{ type: 'text' as const, text: `Gaussian Blur applied with radius ${radius}px` }] };
    }
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.applyGaussianBlur(radius);
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Gaussian Blur applied with radius ${radius}px`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error applying Gaussian Blur: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function applySharpen(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const amount = args.amount as number;
  const radius = args.radius as number;
  const threshold = (args.threshold as number) || 0;

  try {
    const backend = await backendRouter.backendFor('filter.sharpen' as Parameters<PhotoshopBackendRouter['backendFor']>[0]);
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation('apply_sharpen', { amount, radius, threshold }, 'uxp_apply_sharpen_failed');
      if (!result.ok) throw new Error(result.error ?? 'uxp_apply_sharpen_failed');
      return { content: [{ type: 'text' as const, text: `Unsharp Mask applied: amount ${amount}%, radius ${radius}px, threshold ${threshold}` }] };
    }
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.applyUnsharpMask(amount, radius, threshold);
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Unsharp Mask applied: amount ${amount}%, radius ${radius}px, threshold ${threshold}`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error applying sharpen: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function applyNoise(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const amount = args.amount as number;
  const distribution = (args.distribution as string) || 'UNIFORM';
  const monochromatic = (args.monochromatic as boolean) || false;

  try {
    const backend = await backendRouter.backendFor('filter.noise' as Parameters<PhotoshopBackendRouter['backendFor']>[0]);
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation('apply_noise', { amount, distribution, monochromatic }, 'uxp_apply_noise_failed');
      if (!result.ok) throw new Error(result.error ?? 'uxp_apply_noise_failed');
      return { content: [{ type: 'text' as const, text: `Add Noise applied: ${amount}% (${distribution}${monochromatic ? ', monochromatic' : ''})` }] };
    }
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.applyAddNoise(amount, distribution, monochromatic);
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Add Noise applied: ${amount}% (${distribution}${monochromatic ? ', monochromatic' : ''})`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error applying noise: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function applyMotionBlur(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const angle = args.angle as number;
  const radius = args.radius as number;

  try {
    const backend = await backendRouter.backendFor('filter.motion_blur' as Parameters<PhotoshopBackendRouter['backendFor']>[0]);
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation('apply_motion_blur', { angle, radius }, 'uxp_apply_motion_blur_failed');
      if (!result.ok) throw new Error(result.error ?? 'uxp_apply_motion_blur_failed');
      return { content: [{ type: 'text' as const, text: `Motion Blur applied: angle ${angle}°, radius ${radius}px` }] };
    }
    const apiFactory = new PhotoshopAPIFactory(connection);
    const api = await apiFactory.createAPI();

    const script = ExtendScriptSnippets.applyMotionBlur(angle, radius);
    await api.executeScript(script);

    return {
      content: [
        {
          type: 'text' as const,
          text: `Motion Blur applied: angle ${angle}°, radius ${radius}px`,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error applying motion blur: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

async function applyHighPass(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const radiusResult = validateHighPassRadius(args.radius);
  if (typeof radiusResult !== 'number') return radiusResult;

  try {
    const backend = await backendRouter.backendFor('filter.high_pass' as Parameters<PhotoshopBackendRouter['backendFor']>[0]);
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation('apply_high_pass', { radius: radiusResult }, 'uxp_apply_high_pass_failed');
      if (!result.ok || !result.data) throw new Error(result.error ?? 'uxp_apply_high_pass_failed');
      return atomicSuccess(`High Pass filter applied (radius ${radiusResult}px)`, {
        filter: result.data.filter,
        radius: result.data.radius,
        ...(result.data.context !== undefined ? { context: result.data.context } : {}),
      });
    }
  } catch (error) {
    return atomicFailureFromError(error);
  }
  return runFilterSnippet(
    connection,
    ExtendScriptSnippets.applyHighPass(radiusResult),
    `High Pass filter applied (radius ${radiusResult}px)`,
    ['filter', 'radius']
  );
}

async function applySmartBlur(
  connection: PhotoshopConnection,
  backendRouter: PhotoshopBackendRouter,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const radiusResult = validateSmartBlurRadius(args.radius);
  if (typeof radiusResult !== 'number') return radiusResult;

  const thresholdResult = validateSmartBlurThreshold(args.threshold);
  if (typeof thresholdResult !== 'number') return thresholdResult;

  const mode: SmartBlurMode =
    typeof args.mode === 'string' && (SMART_BLUR_MODES as readonly string[]).includes(args.mode)
      ? (args.mode as SmartBlurMode)
      : 'NORMAL';
  const quality: SmartBlurQuality =
    typeof args.quality === 'string' &&
    (SMART_BLUR_QUALITIES as readonly string[]).includes(args.quality)
      ? (args.quality as SmartBlurQuality)
      : 'MEDIUM';

  try {
    const backend = await backendRouter.backendFor('filter.smart_blur' as Parameters<PhotoshopBackendRouter['backendFor']>[0]);
    if (backend.kind === 'uxp') {
      const result = await invokeUxpOperation(
        'apply_smart_blur',
        { radius: radiusResult, threshold: thresholdResult, mode, quality },
        'uxp_apply_smart_blur_failed'
      );
      if (!result.ok || !result.data) throw new Error(result.error ?? 'uxp_apply_smart_blur_failed');
      const details: Record<string, unknown> = {};
      for (const key of ['filter', 'radius', 'threshold', 'mode', 'quality']) {
        if (result.data[key] !== undefined) details[key] = result.data[key];
      }
      if (result.data.context !== undefined) details.context = result.data.context;
      return atomicSuccess(`Smart Blur applied (radius ${radiusResult}px, threshold ${thresholdResult})`, details);
    }
  } catch (error) {
    return atomicFailureFromError(error);
  }
  return runFilterSnippet(
    connection,
    ExtendScriptSnippets.applySmartBlur(radiusResult, thresholdResult, mode, quality),
    `Smart Blur applied (radius ${radiusResult}px, threshold ${thresholdResult})`,
    ['filter', 'radius', 'threshold', 'mode', 'quality']
  );
}
