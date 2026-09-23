import { ToolDefinition } from '../core/tool-registry.js';
import {
  PAINTING_IMPACT_CLASSES,
  PAINTING_VISUAL_INTENTS,
  paintingMethodCapabilities,
  selectPaintingMethod,
  type PaintingImpactClass,
  type PaintingVisualIntent,
} from '../core/painting-method-palette.js';
import type { ToolRegistry } from '../core/tool-registry.js';
import { EDGE_CLASSES, selectEdgeMethod, type EdgeClass } from '../core/edge-control.js';

function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

export function createMethodPaletteTools(registry: ToolRegistry): ToolDefinition[] {
  return [
    {
      tool: {
        name: 'photoshop_get_painting_method_capabilities',
        description:
          'Return the executable painting-method capability map derived from tools actually registered in this runtime. Unsupported methods remain explicit instead of being invented.',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => json({
        ok: true,
        contract: 'visual_intent -> impact_class -> method -> registered runtime tool + required preparation/state -> verification expectation -> fallback',
        capabilities: paintingMethodCapabilities(registry),
      }),
    },
    {
      tool: {
        name: 'photoshop_select_painting_method',
        description:
          'Select an executable Photoshop painting method from the actual runtime capability map. This is a planning/read-only tool; it does not mutate Photoshop.',
        inputSchema: {
          type: 'object',
          properties: {
            visual_intent: { type: 'string', enum: [...PAINTING_VISUAL_INTENTS] },
            impact_class: { type: 'string', enum: [...PAINTING_IMPACT_CLASSES] },
            avoid_method_ids: { type: 'array', items: { type: 'string' } },
            stage: {
              type: 'string',
              description: 'Optional painting stage. Early block-in stages may intentionally prefer the temporary closed-region scaffold for generic mass construction.',
            },
            edge_class: { type: 'string', enum: [...EDGE_CLASSES] },
            preferred_method_id: { type: 'string' },
          },
          required: ['visual_intent', 'impact_class'],
          additionalProperties: false,
        },
      },
      handler: async (args) => {
        const visualIntent = args.visual_intent as PaintingVisualIntent;
        const impactClass = args.impact_class as PaintingImpactClass;
        const avoid = Array.isArray(args.avoid_method_ids)
          ? args.avoid_method_ids.filter((value): value is string => typeof value === 'string')
          : [];
        try {
          const selection = selectPaintingMethod(registry, visualIntent, impactClass, avoid, {
            stage: typeof args.stage === 'string' ? args.stage : undefined,
          });
          const edgeClass = typeof args.edge_class === 'string' ? args.edge_class as EdgeClass : undefined;
          const edgeSelection = edgeClass
            ? selectEdgeMethod(registry, edgeClass, {
                preferredMethodId: typeof args.preferred_method_id === 'string' ? args.preferred_method_id : undefined,
                avoidMethodIds: avoid,
              })
            : undefined;
          return json({ ok: true, selection, ...(edgeSelection ? { edge_selection: edgeSelection } : {}) });
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: JSON.stringify({
              ok: false,
              code: 'no_painting_method_available',
              message: error instanceof Error ? error.message : String(error),
            }) }],
          };
        }
      },
    },
  ];
}
