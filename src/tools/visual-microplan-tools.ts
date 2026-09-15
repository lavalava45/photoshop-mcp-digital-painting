import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  normalizeToolResultForPlaceholders,
  parseVisualMicroPlan,
  resolveVisualMicroPlanArgs,
  VISUAL_MICROPLAN_ACTION_CLASSES,
  VISUAL_MICROPLAN_MAX_STEPS,
  VISUAL_MICROPLAN_DISPOSITIONS,
  VISUAL_MICROPLAN_VERDICTS,
  type PreviousPreviewVerdict,
  type VisualMicroPlan,
  type VisualMicroPlanStep,
} from '../core/visual-microplan.js';
import type { ToolDefinition, ToolRegistry, ToolResult } from '../core/tool-registry.js';

interface PendingPreviewBarrier {
  planId: string;
  sha256?: string;
  requiresExternalPreview: boolean;
}

interface StepStatus {
  id: string;
  tool: string;
  ok: boolean;
}

function jsonResult(body: Record<string, unknown>, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function getToolProperties(tool: Tool): Record<string, unknown> {
  const schema = tool.inputSchema as { properties?: Record<string, unknown> } | undefined;
  return schema?.properties ?? {};
}

function withPinnedDocumentId(
  registry: ToolRegistry,
  step: VisualMicroPlanStep,
  args: Record<string, unknown>,
  documentId: number
): Record<string, unknown> {
  const definition = registry.get(step.tool);
  if (!definition) throw new Error(`tool not found: ${step.tool}`);

  const acceptsDocumentId = Object.prototype.hasOwnProperty.call(
    getToolProperties(definition.tool),
    'document_id'
  );
  if (!acceptsDocumentId) return args;

  if (Object.prototype.hasOwnProperty.call(args, 'document_id')) {
    if (args.document_id !== documentId) {
      throw new Error(
        `step "${step.id}" document_id must match VisualMicroPlan document_id=${documentId}`
      );
    }
    return args;
  }

  return { ...args, document_id: documentId };
}

function previewMetadata(result: ToolResult): Record<string, unknown> | null {
  const normalized = normalizeToolResultForPlaceholders(result);
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return null;
  return normalized as Record<string, unknown>;
}

function imageContent(result: ToolResult): CallToolResult['content'] {
  return result.content.filter((item) => item.type === 'image');
}

function validatePreviousPreviewBarrier(
  plan: VisualMicroPlan,
  pending: PendingPreviewBarrier | undefined
): string | null {
  const previous = plan.previousPreview;
  if (!pending) {
    if (previous) return 'previous_preview was supplied but no preview verdict is pending';
    return null;
  }

  if (!previous) {
    return pending.requiresExternalPreview
      ? 'a prior visual mutation has no verified preview; call photoshop_get_preview, inspect it, then supply previous_preview before another VisualMicroPlan'
      : `preview verdict required for prior plan "${pending.planId}" before another visual mutation`;
  }

  if (pending.sha256 && previous.sha256 !== pending.sha256) {
    return `previous_preview.sha256 does not match the pending preview from plan "${pending.planId}"`;
  }

  if (previous.disposition === 'rollback' && plan.actionClass !== 'ROLLBACK') {
    return 'previous_preview.disposition=rollback requires the next VisualMicroPlan action_class=ROLLBACK';
  }

  return null;
}

function previousPreviewSummary(previous: PreviousPreviewVerdict | undefined): Record<string, unknown> | undefined {
  if (!previous) return undefined;
  return {
    sha256: previous.sha256,
    verdict: previous.verdict,
    disposition: previous.disposition,
  };
}

function visualMicroPlanToolSchema(): Tool {
  return {
    name: 'photoshop_execute_visual_microplan',
    description:
      'Execute exactly ONE painting/visual atomic bundle with preparation calls and a mandatory final preview in a single MCP round-trip. This tool exists to reduce host↔MCP chatter without weakening the digital-painting hard preview barrier. It allows read/configuration steps, exactly one approved visual mutation (paint_strokes, paint_dabs, fill_layer, or undo), then photoshop_get_preview immediately. The returned preview MUST be visually classified before another micro-plan. A later call is blocked until previous_preview acknowledges the prior preview SHA/verdict/disposition. Never use this tool to queue multiple semantic regions, stages, action classes, or independent visual problems.',
    inputSchema: {
      type: 'object',
      properties: {
        plan_id: {
          type: 'string',
          description: 'Unique id for this short-horizon visual micro-plan.',
        },
        summary: {
          type: 'string',
          description: 'One short sentence describing the single visual problem being addressed.',
        },
        stage: {
          type: 'string',
          description: 'Current painting stage; all steps must remain within this one stage decision.',
        },
        scale: {
          type: 'string',
          description: 'Current scale band (for example global, medium, small).',
        },
        region: {
          type: 'string',
          description: 'One semantic region or inseparable region set affected by the bundle.',
        },
        action_class: {
          type: 'string',
          enum: [...VISUAL_MICROPLAN_ACTION_CLASSES],
          description: 'ADD, REFINE, REPLACE, ERASE, or ROLLBACK.',
        },
        expected_visual_result: {
          type: 'string',
          description: 'Before/after acceptance question expressed as the expected visible result.',
        },
        document_id: {
          type: 'number',
          minimum: 1,
          description:
            'Required pinned Photoshop document id. The executor propagates it to every document-bound internal step and rejects cross-document overrides.',
        },
        protected_regions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Regions that the bundle must not damage.',
        },
        previous_preview: {
          type: 'object',
          description:
            'Required when the prior VisualMicroPlan left a preview barrier pending. The SHA must match the returned preview, proving that the caller is classifying that exact frame before another mutation.',
          properties: {
            sha256: { type: 'string' },
            verdict: { type: 'string', enum: [...VISUAL_MICROPLAN_VERDICTS] },
            disposition: { type: 'string', enum: [...VISUAL_MICROPLAN_DISPOSITIONS] },
          },
          required: ['sha256', 'verdict', 'disposition'],
          additionalProperties: false,
        },
        steps: {
          type: 'array',
          minItems: 2,
          maxItems: VISUAL_MICROPLAN_MAX_STEPS,
          description:
            'Ordered preparation steps, exactly one visual mutation, and final photoshop_get_preview. Argument values may reference an earlier normalized JSON result using $steps.<id>.<dot.path>.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              tool: { type: 'string' },
              args: { type: 'object', additionalProperties: true },
            },
            required: ['id', 'tool'],
            additionalProperties: false,
          },
        },
      },
      required: [
        'plan_id',
        'summary',
        'stage',
        'scale',
        'region',
        'action_class',
        'expected_visual_result',
        'document_id',
        'steps',
      ],
      additionalProperties: false,
    },
  };
}

export function createVisualMicroPlanTools(registry: ToolRegistry): ToolDefinition[] {
  const pendingByDocument = new Map<number, PendingPreviewBarrier>();

  return [
    {
      tool: visualMicroPlanToolSchema(),
      handler: async (args) => {
        let plan: VisualMicroPlan;
        try {
          plan = parseVisualMicroPlan(args);
        } catch (error) {
          return jsonResult(
            {
              ok: false,
              code: 'invalid_visual_microplan',
              message: error instanceof Error ? error.message : String(error),
            },
            true
          );
        }

        const pending = pendingByDocument.get(plan.documentId);
        const barrierError = validatePreviousPreviewBarrier(plan, pending);
        if (barrierError) {
          return jsonResult(
            {
              ok: false,
              code: 'preview_verdict_required',
              message: barrierError,
              document_id: plan.documentId,
              pending_plan_id: pending?.planId,
              pending_preview_sha256: pending?.sha256,
            },
            true
          );
        }

        // Consuming a verdict releases only the prior barrier. A new barrier is
        // installed immediately after this plan's visual mutation is previewed.
        if (pending) pendingByDocument.delete(plan.documentId);

        const results: Record<string, unknown> = {};
        const statuses: StepStatus[] = [];

        const executeStep = async (step: VisualMicroPlanStep): Promise<ToolResult> => {
          const definition = registry.get(step.tool);
          if (!definition) throw new Error(`tool not found: ${step.tool}`);
          const resolved = resolveVisualMicroPlanArgs(step.args, results);
          if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
            throw new Error(`step "${step.id}" resolved args must be an object`);
          }
          const pinnedArgs = withPinnedDocumentId(
            registry,
            step,
            resolved as Record<string, unknown>,
            plan.documentId
          );
          return registry.execute(step.tool, pinnedArgs);
        };

        for (let index = 0; index < plan.mutationIndex; index++) {
          const step = plan.steps[index]!;
          try {
            const result = await executeStep(step);
            const ok = result.isError !== true;
            statuses.push({ id: step.id, tool: step.tool, ok });
            results[step.id] = normalizeToolResultForPlaceholders(result);
            if (!ok) {
              return jsonResult(
                {
                  ok: false,
                  code: 'microplan_prepare_failed',
                  message: `preparation step "${step.id}" failed before any visual mutation`,
                  plan_id: plan.planId,
                  document_id: plan.documentId,
                  failed_step: step.id,
                  steps: statuses,
                  completed_results: results,
                  repair_scope: 'remaining_only',
                  visual_mutation_started: false,
                },
                true
              );
            }
          } catch (error) {
            return jsonResult(
              {
                ok: false,
                code: 'microplan_prepare_failed',
                message: error instanceof Error ? error.message : String(error),
                plan_id: plan.planId,
                document_id: plan.documentId,
                failed_step: step.id,
                steps: statuses,
                completed_results: results,
                repair_scope: 'remaining_only',
                visual_mutation_started: false,
              },
              true
            );
          }
        }

        const mutationStep = plan.steps[plan.mutationIndex]!;
        let mutationResult: ToolResult;
        try {
          mutationResult = await executeStep(mutationStep);
        } catch (error) {
          mutationResult = jsonResult(
            {
              ok: false,
              code: 'visual_mutation_execution_error',
              message: error instanceof Error ? error.message : String(error),
            },
            true
          );
        }
        const mutationOk = mutationResult.isError !== true;
        statuses.push({ id: mutationStep.id, tool: mutationStep.tool, ok: mutationOk });
        results[mutationStep.id] = normalizeToolResultForPlaceholders(mutationResult);

        // A mutation error may still have partially changed Photoshop (for example
        // an AUTO paint batch timing out after earlier chunks). Never retry here;
        // force the same reconciliation preview as a successful mutation.
        const captureStep = plan.steps[plan.captureIndex]!;
        let captureResult: ToolResult;
        try {
          captureResult = await executeStep(captureStep);
        } catch (error) {
          captureResult = jsonResult(
            {
              ok: false,
              code: 'preview_execution_error',
              message: error instanceof Error ? error.message : String(error),
            },
            true
          );
        }

        const captureOk = captureResult.isError !== true;
        statuses.push({ id: captureStep.id, tool: captureStep.tool, ok: captureOk });
        results[captureStep.id] = normalizeToolResultForPlaceholders(captureResult);

        if (!captureOk) {
          pendingByDocument.set(plan.documentId, {
            planId: plan.planId,
            requiresExternalPreview: true,
          });
          return jsonResult(
            {
              ok: false,
              code: 'preview_required_before_next_mutation',
              message:
                'the visual mutation ran but its mandatory preview failed; do not retry or start another mutation until photoshop_get_preview succeeds and is visually classified',
              plan_id: plan.planId,
              document_id: plan.documentId,
              mutation_ok: mutationOk,
              mutation_result: results[mutationStep.id],
              steps: statuses,
              barrier: {
                status: 'blocked_until_external_preview_and_verdict',
                next_visual_mutation_allowed: false,
              },
            },
            true
          );
        }

        const metadata = previewMetadata(captureResult);
        const sha256 = typeof metadata?.sha256 === 'string' ? metadata.sha256 : undefined;
        if (!sha256) {
          pendingByDocument.set(plan.documentId, {
            planId: plan.planId,
            requiresExternalPreview: true,
          });
          return jsonResult(
            {
              ok: false,
              code: 'preview_metadata_missing',
              message: 'preview completed but did not return sha256 metadata; barrier remains closed',
              plan_id: plan.planId,
              document_id: plan.documentId,
              mutation_ok: mutationOk,
              steps: statuses,
            },
            true
          );
        }

        pendingByDocument.set(plan.documentId, {
          planId: plan.planId,
          sha256,
          requiresExternalPreview: false,
        });

        const body: Record<string, unknown> = {
          ok: mutationOk,
          ...(mutationOk ? {} : { code: 'visual_mutation_failed_or_partial' }),
          plan_id: plan.planId,
          document_id: plan.documentId,
          summary: plan.summary,
          stage: plan.stage,
          scale: plan.scale,
          region: plan.region,
          action_class: plan.actionClass,
          expected_visual_result: plan.expectedVisualResult,
          protected_regions: plan.protectedRegions,
          acknowledged_previous_preview: previousPreviewSummary(plan.previousPreview),
          mutation_result: results[mutationStep.id],
          preview: metadata,
          steps: statuses,
          barrier: {
            status: 'awaiting_visual_verdict',
            preview_sha256: sha256,
            next_visual_mutation_allowed: false,
            next_microplan_requires_previous_preview: true,
          },
        };

        return {
          content: [
            { type: 'text', text: JSON.stringify(body, null, 2) },
            ...imageContent(captureResult),
          ],
          ...(mutationOk ? {} : { isError: true }),
        };
      },
    },
  ];
}
