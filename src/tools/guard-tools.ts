import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import type { ToolDefinition, ToolResult } from '../core/tool-registry.js';
import { EmbeddedGuardRuntime, guardRuntimeErrorCode } from '../core/guard/runtime.js';
import {
  COMPACT_GUARD_PROTOCOL_VERSION,
  UXP_BRIDGE_REVISION,
  guardProtocolVersionError,
} from '../core/guard/protocol-version.js';
import { PAINTING_VISUAL_INTENTS } from '../core/painting-method-palette.js';
import {
  VISUAL_MICROPLAN_ACTION_CLASSES,
  VISUAL_MICROPLAN_MAX_LAYER_CREATIONS,
  VISUAL_MICROPLAN_MAX_MUTATIONS,
} from '../core/visual-microplan.js';
import {
  REFINEMENT_CHECK_STATUSES,
  REFINEMENT_CRITERIA,
  REFINEMENT_CRITERION_STATUSES,
  REFINEMENT_STYLE_BASIS_FIELDS,
  REPRESENTATION_CHANGE_STATUSES,
} from '../core/refinement-check.js';

const REVIEW_IMAGE_MAX_BLOCKS = 4;
const REVIEW_RESPONSE_MAX_BYTES = 6 * 1024 * 1024;
const REVIEW_METADATA_RESERVE_BYTES = 256 * 1024;
const REVIEW_IMAGE_MAX_ENCODED_BYTES = REVIEW_RESPONSE_MAX_BYTES - REVIEW_METADATA_RESERVE_BYTES;

function base64EncodedBytes(rawBytes: number): number {
  return 4 * Math.ceil(rawBytes / 3);
}

function reviewPackageOf(value: any): any | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (value.visual_review && typeof value.visual_review === 'object') return value.visual_review;
  if (value.result && typeof value.result === 'object' && value.result.visual_review) return value.result.visual_review;
  return undefined;
}

function json(value: unknown, isError = false): ToolResult {
  const output: any = value && typeof value === 'object' ? structuredClone(value) : value;
  const review = reviewPackageOf(output);
  const images: Array<{ type: 'image'; data: string; mimeType: string }> = [];
  if (review) {
    const requestedRoles = Array.isArray(review.delivery_policy?.preferred_content_order)
      ? review.delivery_policy.preferred_content_order.filter((role: unknown) => typeof role === 'string')
      : (review.after ? ['after'] : []);
    const roleFrame = (role: string) => role === 'after' ? review.after
      : role === 'after_crop' ? review.after?.crop
        : role === 'before_crop' ? review.before?.crop
          : role === 'before' ? review.before
            : undefined;
    const candidates = requestedRoles.map((role: string) => ({ role, frame: roleFrame(role) }));
    const delivered: Array<{ role: string; sha256: string; bytes: number; encoded_bytes: number; content_index: number }> = [];
    const omitted: Array<{ role: string; reason: string; bytes?: number; encoded_bytes?: number; max_total_bytes?: number }> = [];
    let totalBytes = 0;
    let totalEncodedBytes = 0;
    for (const candidate of candidates) {
      if (images.length >= REVIEW_IMAGE_MAX_BLOCKS) {
        omitted.push({ role: candidate.role, reason: 'image_block_limit' });
        continue;
      }
      const file = candidate.frame?.materialized_path;
      const expectedSha = candidate.frame?.sha256;
      if (typeof file !== 'string' || typeof expectedSha !== 'string' || !existsSync(file)) {
        omitted.push({ role: candidate.role, reason: 'materialized_image_unavailable' });
        continue;
      }
      let size: number;
      try {
        const stat = statSync(file);
        if (!stat.isFile()) {
          omitted.push({ role: candidate.role, reason: 'materialized_image_not_file' });
          continue;
        }
        size = stat.size;
      } catch {
        omitted.push({ role: candidate.role, reason: 'materialized_image_stat_failed' });
        continue;
      }
      const estimatedEncodedBytes = base64EncodedBytes(size);
      if (totalEncodedBytes + estimatedEncodedBytes > REVIEW_IMAGE_MAX_ENCODED_BYTES) {
        omitted.push({
          role: candidate.role,
          reason: 'response_byte_budget',
          bytes: size,
          encoded_bytes: estimatedEncodedBytes,
          max_total_bytes: REVIEW_RESPONSE_MAX_BYTES,
        });
        continue;
      }
      let bytes: Buffer;
      try {
        bytes = readFileSync(file);
      } catch {
        omitted.push({ role: candidate.role, reason: 'materialized_image_read_failed' });
        continue;
      }
      const actualSha = createHash('sha256').update(bytes).digest('hex');
      if (actualSha !== expectedSha) {
        omitted.push({ role: candidate.role, reason: 'sha256_mismatch' });
        continue;
      }
      const encodedBytes = base64EncodedBytes(bytes.byteLength);
      if (totalEncodedBytes + encodedBytes > REVIEW_IMAGE_MAX_ENCODED_BYTES) {
        omitted.push({
          role: candidate.role,
          reason: 'response_byte_budget',
          bytes: bytes.byteLength,
          encoded_bytes: encodedBytes,
          max_total_bytes: REVIEW_RESPONSE_MAX_BYTES,
        });
        continue;
      }
      const mimeType = typeof candidate.frame.mime_type === 'string' ? candidate.frame.mime_type : 'image/jpeg';
      images.push({ type: 'image', data: bytes.toString('base64'), mimeType });
      delivered.push({
        role: candidate.role,
        sha256: actualSha,
        bytes: bytes.byteLength,
        encoded_bytes: encodedBytes,
        content_index: images.length,
      });
      totalBytes += bytes.byteLength;
      totalEncodedBytes += encodedBytes;
    }
    const deliveredRoles = new Set(delivered.map(item => item.role));
    const deliveryComplete = requestedRoles.length > 0
      && requestedRoles.every((role: string) => deliveredRoles.has(role));
    review.delivery = {
      transport: delivered.length ? 'mcp_image_content' : 'metadata_only',
      delivered,
      omitted,
      raw_image_bytes: totalBytes,
      encoded_image_bytes: totalEncodedBytes,
      max_blocks: REVIEW_IMAGE_MAX_BLOCKS,
      max_total_bytes: REVIEW_RESPONSE_MAX_BYTES,
      max_encoded_image_bytes: REVIEW_IMAGE_MAX_ENCODED_BYTES,
      metadata_reserve_bytes: REVIEW_METADATA_RESERVE_BYTES,
      delivery_complete: deliveryComplete,
      expected_roles: requestedRoles,
      undelivered_roles: requestedRoles.filter((role: string) => !deliveredRoles.has(role)),
      note: 'Delivery + SHA establish frame identity only; visual interpretation remains the critic responsibility.',
    };
  }
  return {
    content: [{ type: 'text', text: JSON.stringify(output, null, 2) }, ...images],
    ...(isError ? { isError: true } : {}),
  };
}

function compactPassSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      request_key: {
        type: 'string',
        description: 'Unique stable idempotency key for this execution attempt. Re-delivering the same request_key must not repeat a mutation. Do not reuse it for a new attempt.',
      },
      problem_id: {
        type: 'string',
        description: 'Stable artistic problem identity shared across multiple distinct attempts at the same unresolved visual problem. Omit only when request_key intentionally also names the problem.',
      },
      document_id: { type: 'number', minimum: 1 },
      goal: {
        type: 'string',
        description: 'The single authoritative artistic goal for the pass.',
      },
      region: { type: 'string' },
      region_bounds: {
        type: 'object',
        properties: {
          left: { type: 'number' },
          top: { type: 'number' },
          right: { type: 'number' },
          bottom: { type: 'number' },
        },
        required: ['left', 'top', 'right', 'bottom'],
        additionalProperties: false,
        description: 'Optional document-space bounds for focused compact review of the semantic region.',
      },
      protected_regions: { type: 'array', items: { type: 'string' } },
      protected_layer_ids: { type: 'array', items: { type: 'number', minimum: 1 } },
      replace_protected_layer_ids: {
        type: 'array',
        items: { type: 'number', minimum: 1 },
        description: 'Exact protected layer ids intentionally replaced/erased by this pass. Every id must also be in protected_layer_ids and action_class must explicitly be REPLACE or ERASE.',
      },
      action_class: {
        type: 'string',
        enum: [...VISUAL_MICROPLAN_ACTION_CLASSES],
        description: 'Optional explicit artistic mutation intent. Required for protected-layer REPLACE/ERASE exceptions and late-stage paint_regions corrections. Omit for ordinary ADD inference.',
      },
      stage: {
        type: 'string',
        description: 'Optional override when no durable current stage exists; normally inherited from the art run.',
      },
      scale: {
        type: 'string',
        description: 'Optional override when no durable active scale exists; normally inherited from the art run.',
      },
      brush_role: {
        type: 'string',
        description: 'Optional durable brush-role hint when several preflighted roles fit. Omit to let Guard choose by working scale.',
      },
      significance_mode: { type: 'string', enum: ['normal', 'subtle_local'] },
      visual_intent: { type: 'string', enum: [...PAINTING_VISUAL_INTENTS] },
      impact_class: {
        type: 'string',
        enum: ['construct', 'subtract', 'edge', 'tone', 'texture', 'transition', 'transform', 'isolate', 'composite', 'cleanup'],
      },
      preferred_method_id: { type: 'string' },
      avoid_method_ids: { type: 'array', items: { type: 'string' } },
      affected_relations: { type: 'array', items: { type: 'string' } },
      affected_qualities: { type: 'array', items: { type: 'string' } },
      preservation_facts: { type: 'array', items: { type: 'string' } },
      independent_region: {
        type: 'boolean',
        description: 'True only when this pass is independent of the currently unresolved primary mismatch; preservation_facts must explain why.',
      },
      addresses_primary_mismatch: { type: 'boolean' },
      addresses_problem_id: { type: 'string' },
      actions: {
        type: 'array',
        minItems: 1,
        maxItems: 11,
        description: `Ordered actions for one bounded Guard pass, not an entire artistic stage. The current VisualMicroPlan executor supports at most ${VISUAL_MICROPLAN_MAX_MUTATIONS} contiguous visual mutations and at most ${VISUAL_MICROPLAN_MAX_LAYER_CREATIONS} created logical layer in one rollback unit. Preparation must precede the visual transaction. These are executor constraints, not pass-type labels.`,
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            tool: { type: 'string' },
            args: { type: 'object', additionalProperties: true },
            description: { type: 'string' },
            method_id: { type: 'string' },
            edge_boundary_ids: { type: 'array', items: { type: 'string' } },
          },
          required: ['id', 'tool'],
          additionalProperties: false,
        },
      },
    },
    required: ['request_key', 'goal', 'actions'],
    additionalProperties: false,
  };
}

function compactObservationSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      observed: {
        type: 'string',
        description: 'Preferred compact form: one short factual observation grounded in the delivered frame.',
      },
      target: {
        type: 'string',
        enum: ['resolved', 'unresolved', 'uncertain'],
        description: 'Preferred compact form: whether the artistic target is visibly resolved.',
      },
      regression: {
        type: ['string', 'null'],
        description: 'Optional visible regression. Omit or use null when none is observed.',
      },
      action: {
        type: 'string',
        enum: ['accept', 'correct', 'rollback'],
        description: 'Optional override. Normally Guard derives the disposition from target/regression.',
      },
      verdict: { type: 'string', enum: ['improvement', 'neutral', 'regression'] },
      disposition: { type: 'string', enum: ['accept', 'correct', 'rollback'] },
      observed_change: {
        type: 'string',
        description: 'Short factual observation grounded in the delivered previous frame.',
      },
      target_resolved: { type: 'string', enum: ['yes', 'no', 'uncertain'] },
      regressions: { type: 'array', items: { type: 'string' } },
      uncertainty: { type: 'string' },
      primary_mismatch: { type: 'string' },
      global_readability: { type: 'string', enum: ['improved', 'stable', 'degraded', 'unknown'] },
      primitive_footprint: { type: 'string', enum: ['none', 'acceptable', 'suspect', 'unknown'] },
      trend_signals: { type: 'array', items: { type: 'string' } },
      recognition: {
        type: 'object',
        properties: {
          subject: { type: 'string', enum: ['yes', 'no', 'uncertain'] },
          style: { type: 'string', enum: ['yes', 'no', 'uncertain', 'not_applicable'] },
          evaluator: { type: 'string', enum: ['producer', 'blinded', 'human', 'external'] },
          visible_features: { type: 'array', items: { type: 'string' } },
          lost_features: { type: 'array', items: { type: 'string' } },
        },
        required: ['subject', 'style'],
        additionalProperties: false,
      },
      observations: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            region: { type: 'string' },
            visible: { type: 'string' },
          },
          required: ['region', 'visible'],
          additionalProperties: false,
        },
      },
      planner_task_assessment: {
        type: 'object',
        description: 'Optional whole-task assessment. Omit it to keep the current Planner task active.',
        properties: {
          status: { type: 'string', enum: ['continue', 'completed', 'blocked'] },
          evidence_scope: { type: 'string', enum: ['task'] },
          evidence: { type: 'array', items: { type: 'string' } },
        },
        required: ['status', 'evidence_scope', 'evidence'],
        additionalProperties: false,
      },
      affected_relations: { type: 'array', items: { type: 'string' } },
      affected_qualities: { type: 'array', items: { type: 'string' } },
      preservation_facts: { type: 'array', items: { type: 'string' } },
      independent_region: { type: 'boolean' },
    },
    description: 'Compact visual closure. Supply observed + target, with optional regression/action. target is operation-local; planner_task_assessment is separate and optional.',
    additionalProperties: false,
  };
}

function cycleTool(name: string, description: string): Tool {
  return {
    name,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        protocol_version: {
          type: 'string',
          const: COMPACT_GUARD_PROTOCOL_VERSION,
          default: COMPACT_GUARD_PROTOCOL_VERSION,
          description: 'Compact Guard protocol revision. Omit during normal model use; the provider supplies the current revision internally.',
        },
        previous_operation_id: { type: 'string' },
        previous_observation: compactObservationSchema(),
        next_pass: compactPassSchema(),
      },
      additionalProperties: false,
    },
  };
}

export function createGuardTools(runtime: EmbeddedGuardRuntime): ToolDefinition[] {
  const compactCycleArgs = (args: Record<string, unknown>): Record<string, unknown> => {
    if (args.protocol_version !== undefined && args.protocol_version !== COMPACT_GUARD_PROTOCOL_VERSION) {
      const error = new Error(guardProtocolVersionError(args.protocol_version));
      Object.assign(error, { code: 'guard_protocol_version_mismatch' });
      throw error;
    }
    const normalized = { ...args };
    delete normalized.protocol_version;
    return normalized;
  };
  return [
    {
      tool: {
        name: 'photoshop_guard_capabilities',
        description: 'Describe the embedded durable Photoshop Guard, acknowledgement/barrier behavior and current public mutation mode.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      handler: async () => json({
        ...runtime.capabilities(),
        compact_guard_protocol_version: COMPACT_GUARD_PROTOCOL_VERSION,
        expected_uxp_bridge_revision: UXP_BRIDGE_REVISION,
      }),
    },
    {
      tool: {
        name: 'photoshop_guard_set_art_run',
        description:
          'Bind a Photoshop document to one repository-local art-project folder. Non-trivial painting is the default profile and remains fail-closed until this same art run records a live brush_preflight role map from the installed Photoshop preset inventory. Re-call with the same immutable process_dir after inventory/probes to persist brush_preflight.',
        inputSchema: {
          type: 'object',
          properties: {
            document_id: { type: 'number', minimum: 1 },
            process_dir: {
              type: 'string',
              description: 'Repository-relative path exactly processes/<subject>-process/<run-name> using lowercase kebab-case.',
            },
            commentary_mode: {
              type: 'string',
              enum: ['technical', 'artistic', 'mixed'],
              default: 'mixed',
            },
            commentary_detail: {
              type: 'string',
              enum: ['short', 'normal', 'detailed'],
              default: 'normal',
            },
            painting_profile: {
              type: 'string',
              enum: ['nontrivial_painting', 'simple_graphic'],
              default: 'nontrivial_painting',
              description: 'nontrivial_painting requires brush preflight and VisualMicroPlan-mediated paint; simple_graphic may be upgraded in place to nontrivial_painting when the stronger obligations are supplied.',
            },
            profile_transition_reason: {
              type: 'string',
              description: 'Concrete user/task reason for an in-place simple_graphic -> nontrivial_painting upgrade.',
            },
            brush_preflight: {
              type: 'object',
              description: 'Durable live brush-role map recorded after bounded installed-preset inventory, effective-settings readback and any role-critical footprint probes.',
              properties: {
                completed: { type: 'boolean' },
                inventory_observed: { type: 'boolean' },
                inventory_total: { type: 'number', minimum: 1 },
                inventory_query: { type: 'string' },
                roles: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 16,
                  items: {
                    type: 'object',
                    properties: {
                      role_id: { type: 'string' },
                      purpose: { type: 'string' },
                      material_roles: { type: 'array', minItems: 1, items: { type: 'string' } },
                      visual_intents: {
                        type: 'array',
                        minItems: 1,
                        items: { type: 'string', enum: [...PAINTING_VISUAL_INTENTS] },
                      },
                      preferred_preset: { type: 'string' },
                      alternative_presets: { type: 'array', items: { type: 'string' } },
                      effective_settings: {
                        type: 'object',
                        properties: {
                          size: { type: 'number' },
                          hardness: { type: 'number' },
                          roundness: { type: 'number' },
                          opacity: { type: 'number' },
                          flow: { type: 'number' },
                          spacing: { type: 'number' },
                          use_pressure_size: { type: 'boolean' },
                          use_pressure_opacity: { type: 'boolean' },
                          airbrush: { type: 'boolean' },
                          smoothing_enabled: { type: 'boolean' },
                          smoothing: { type: 'number' },
                        },
                        required: [
                          'size', 'hardness', 'roundness', 'opacity', 'flow', 'spacing',
                          'use_pressure_size', 'use_pressure_opacity', 'airbrush',
                          'smoothing_enabled', 'smoothing',
                        ],
                        additionalProperties: false,
                      },
                      working_scale: { type: 'string' },
                      pressure_policy: {
                        type: 'string',
                        enum: ['none', 'native-preset', 'simulated-size', 'simulated-opacity', 'simulated-size-opacity'],
                      },
                      probe_status: { type: 'string', enum: ['pass', 'cached', 'not-needed'] },
                      caveat: { type: 'string' },
                    },
                    required: [
                      'role_id', 'purpose', 'material_roles', 'visual_intents', 'preferred_preset',
                      'effective_settings', 'working_scale', 'pressure_policy', 'probe_status',
                    ],
                    additionalProperties: false,
                  },
                },
              },
              required: ['completed', 'inventory_observed', 'inventory_total', 'roles'],
              additionalProperties: false,
            },
          },
          required: ['document_id', 'process_dir'],
          additionalProperties: false,
        },
      },
      handler: async (args) => {
        try { return json(await runtime.artRunWithCapabilitySnapshot(args)); }
        catch (error) { return json({ ok: false, code: 'guard_art_run_rejected', message: error instanceof Error ? error.message : String(error) }, true); }
      },
    },
    {
      tool: {
        name: 'photoshop_guard_status',
        description: 'Read compact durable continuation state plus paint_readiness for an established local Photoshop workflow. paint_readiness reports document/art-run/brush-preflight status and distinguishes brush-independent from brush-dependent visual readiness instead of treating missing brush preflight as a global paint blocker. Use after host/tool interruption before concluding the Photoshop/CoS route is unavailable. Includes recoverable exact pending receipt tokens and preview SHA/path needed after a lost async poll result; never replay a prior mutation to recover state.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      handler: async () => json(await runtime.statusWithCapabilitySnapshots()),
    },
    {
      tool: {
        name: 'photoshop_guard_resume',
        description: 'Resume one established local Photoshop workflow from durable Guard state after interruption, without replaying any prior mutation. Drawing/image continuation remains bound to the local Photoshop document unless the user explicitly changes execution mode. Returns the exact pending receipt token and visual preview SHA/path when recovery must continue after a lost async poll result.',
        inputSchema: {
          type: 'object',
          properties: { document_id: { type: 'number', minimum: 1 } },
          additionalProperties: false,
        },
      },
      handler: async (args) => json(runtime.resume(typeof args.document_id === 'number' ? args.document_id : undefined)),
    },
    {
      tool: cycleTool(
        'photoshop_guard_cycle',
        'Run one durable compact Photoshop cycle inside the embedded Guard. Start with next_pass; after inspecting the returned frame, continue or finalize with previous_operation_id + previous_observation and optionally another next_pass. Technical report/receipt/verdict closure is derived internally.'
      ),
      handler: async (args) => {
        try { return json(await runtime.cycle(compactCycleArgs(args))); }
        catch (error) { return json({ ok: false, code: guardRuntimeErrorCode(error, 'guard_cycle_rejected'), message: error instanceof Error ? error.message : String(error) }, true); }
      },
    },
    {
      tool: cycleTool(
        'photoshop_guard_cycle_auto',
        'Preferred normal entry point for local Photoshop creation/editing/painting/continuation. In an established workflow stay on this route unless the user explicitly changes execution mode. One Guard pass is NOT an entire artistic stage: a whole-canvas/recognition block-in may require several sequential passes. request_key identifies the unique execution attempt; problem_id identifies the stable artistic problem across attempts. Guard derives technical method/preview requirements from the actual actions. Start with next_pass={request_key,problem_id?,document_id,goal,region/protection,action_class?,actions}; after inspecting the returned frame continue/finalize with previous_operation_id + previous_observation and optionally another next_pass. Guard derives technical report, exact receipt acknowledgement and internal visual closure. Short work runs synchronously; longer work returns a durable job_id for photoshop_guard_job_poll.'
      ),
      handler: async (args) => {
        try { return json(await runtime.cycleAuto(compactCycleArgs(args))); }
        catch (error) { return json({ ok: false, code: guardRuntimeErrorCode(error, 'guard_cycle_rejected'), message: error instanceof Error ? error.message : String(error) }, true); }
      },
    },
    {
      tool: {
        name: 'photoshop_guard_job_poll',
        description: 'Poll a durable embedded-Guard background job. Running/uncertain jobs must not be replaced by a second mutation.',
        inputSchema: {
          type: 'object',
          properties: { job_id: { type: 'string' } },
          required: ['job_id'],
          additionalProperties: false,
        },
      },
      handler: async (args) => {
        try { return json(runtime.pollJob(String(args.job_id ?? ''))); }
        catch (error) { return json({ ok: false, code: 'guard_job_not_found', message: error instanceof Error ? error.message : String(error) }, true); }
      },
    },
    {
      tool: {
        name: 'photoshop_guard_reconcile',
        description: 'Resolve an interrupted/uncertain operation from fresh evidence. Normal recovery requires same-document state + preview. If the user explicitly closed the target document first, a fresh photoshop_list_documents record proving that document absent may close the workflow as abandoned. The original operation remains non-replayable.',
        inputSchema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            state_id: { type: 'string' },
            preview_id: { type: 'string' },
            documents_id: { type: 'string', description: 'Fresh Guard operation id for photoshop_list_documents; used only for closed-document abandonment recovery.' },
            document_closed_confirmed: { type: 'boolean', description: 'Must be true only after the user explicitly confirms the interrupted target document was closed.' },
            outcome: { type: 'string', enum: ['completed', 'not-executed', 'partial', 'abandoned'] },
            reason: { type: 'string' },
          },
          required: ['id'],
          additionalProperties: false,
        },
      },
      handler: async (args) => {
        try { return json(await runtime.reconcile(args)); }
        catch (error) { return json({ ok: false, code: 'guard_reconcile_rejected', message: error instanceof Error ? error.message : String(error) }, true); }
      },
    },
    {
      tool: {
        name: 'photoshop_guard_set_priorities',
        description: 'Persist whole-frame visual problem priorities so the Guard blocks finer work while a larger must-fix remains open.',
        inputSchema: {
          type: 'object',
          properties: {
            document_id: { type: 'number', minimum: 1 },
            current_stage: { type: 'string' },
            problems: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  problem_id: { type: 'string' },
                  scale: { type: 'string', enum: ['global', 'medium', 'small', 'detail', 'local', 'micro'] },
                  severity: { type: 'string', enum: ['must-fix', 'should-fix', 'optional'] },
                  status: { type: 'string', enum: ['open', 'resolved'] },
                  region: { type: 'string' },
                  hypothesis: { type: 'string' },
                },
                required: ['problem_id', 'scale', 'severity'],
                additionalProperties: false,
              },
            },
          },
          required: ['document_id', 'problems'],
          additionalProperties: false,
        },
      },
      handler: async (args) => {
        try { return json(runtime.priorities(args)); }
        catch (error) { return json({ ok: false, code: 'guard_priority_rejected', message: error instanceof Error ? error.message : String(error) }, true); }
      },
    },
    {
      tool: {
        name: 'photoshop_guard_art_director',
        description: 'Manage the high-level Art Director/Planner state separately from Painter execution. Review issues a bounded directive/task queue and adaptive review horizon; interrupt returns early from Painter to Planner; complete closes a fully satisfied directive.',
        inputSchema: {
          type: 'object',
          properties: {
            document_id: { type: 'number', minimum: 1 },
            action: { type: 'string', enum: ['review', 'interrupt', 'complete'] },
            reason: {
              type: 'string',
              enum: [
                'serious_visual_error',
                'unexpected_global_composition_value_shift',
                'likeness_main_shape_degraded',
                'unsafe_to_execute_directive',
              ],
            },
            detail: { type: 'string' },
            final_comparison: {
              type: 'object',
              description: 'Required for action=complete. Compare the current state with the strongest previous accepted state before declaring the directive finished.',
              properties: {
                scope: { type: 'string', enum: ['compared', 'no_previous'] },
                current_operation_id: { type: 'string' },
                best_previous_operation_id: { type: 'string' },
                preferred: { type: 'string', enum: ['current', 'previous', 'tie'] },
                reason: { type: 'string' },
                criteria: {
                  type: 'object',
                  properties: {
                    coherence: { type: 'string' },
                    expressiveness: { type: 'string' },
                    color: { type: 'string' },
                    rhythm: { type: 'string' },
                    detail_selectivity: { type: 'string' },
                  },
                  required: ['coherence', 'expressiveness', 'color', 'rhythm', 'detail_selectivity'],
                  additionalProperties: false,
                },
              },
              required: ['scope', 'preferred', 'reason', 'criteria'],
              additionalProperties: false,
            },
            directive: {
              type: 'object',
              properties: {
                directive_id: { type: 'string' },
                goal: { type: 'string' },
                style_contract: {
                  type: 'object',
                  description: 'Compact durable artistic intent. Supply only relevant fields, with at least three concrete constraints.',
                  properties: {
                    realism_level: { type: 'string' },
                    shape_language: { type: 'string' },
                    composition_bias: { type: 'string' },
                    edge_policy: { type: 'string' },
                    contour_role: { type: 'string' },
                    mark_visibility: { type: 'string' },
                    value_policy: { type: 'string' },
                    color_policy: { type: 'string' },
                    spatial_treatment: { type: 'string' },
                    material_treatment: { type: 'string' },
                    detail_density: { type: 'string' },
                    texture_policy: { type: 'string' },
                    primitive_footprint_tolerance: { type: 'string' },
                    layer_or_mask_bias: { type: 'string' },
                    finish_criteria: { type: 'string' },
                  },
                  additionalProperties: false,
                },
                artistic_evaluation_contract: {
                  type: 'object',
                  description: 'Revision-bound, open-ended image-observable criteria derived from this run brief. It interprets the brief without defining a style taxonomy.',
                  properties: {
                    contract_id: { type: 'string' },
                    revision: { type: 'number', minimum: 1 },
                    positive_criteria: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } },
                    failure_signals: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } },
                    protected_qualities: { type: 'array', maxItems: 8, items: { type: 'string' } },
                    stage_transition_expectations: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } },
                    final_evidence_requirements: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } },
                    provenance: {
                      type: 'array', minItems: 1, maxItems: 8,
                      items: {
                        type: 'object',
                        properties: {
                          source: { type: 'string' },
                          detail: { type: 'string' },
                        },
                        required: ['source', 'detail'],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ['contract_id', 'revision', 'positive_criteria', 'failure_signals', 'stage_transition_expectations', 'final_evidence_requirements', 'provenance'],
                  additionalProperties: false,
                },
                composition_freedom: { type: 'string', enum: ['fixed', 'constrained', 'free'] },
                composition_exploration: {
                  type: 'object',
                  description: 'Composition-mode contract. Free composition requires at least two cheap alternatives and an explicit selected hypothesis.',
                  properties: {
                    hypotheses: {
                      type: 'array',
                      maxItems: 4,
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string' },
                          summary: { type: 'string' },
                          large_masses: { type: 'string' },
                          negative_space: { type: 'string' },
                          light_pattern: { type: 'string' },
                        },
                        required: ['id', 'summary', 'large_masses', 'negative_space', 'light_pattern'],
                        additionalProperties: false,
                      },
                    },
                    selected_id: { type: 'string' },
                    selection_reason: { type: 'string' },
                    material_choice_unresolved: { type: 'boolean' },
                  },
                  additionalProperties: false,
                },
                assessment: {
                  type: 'object',
                  properties: {
                    composition: { type: 'string' },
                    focal_hierarchy: { type: 'string' },
                    large_value_masses: { type: 'string' },
                    lighting: { type: 'string' },
                    silhouette: { type: 'string' },
                    depth: { type: 'string' },
                    likeness_main_shape: { type: 'string' },
                    overall_detail_level: { type: 'string' },
                    mood: { type: 'string' },
                    color_relationships: { type: 'string' },
                    shape_language: { type: 'string' },
                    edge_hierarchy: { type: 'string' },
                    intentional_omission: { type: 'string' },
                    next_priority: { type: 'string' },
                  },
                  required: [
                    'composition', 'focal_hierarchy', 'large_value_masses', 'lighting', 'silhouette',
                    'depth', 'likeness_main_shape', 'overall_detail_level',
                    'mood', 'color_relationships', 'shape_language', 'edge_hierarchy', 'intentional_omission',
                    'next_priority',
                  ],
                  additionalProperties: false,
                },
                value_check: {
                  type: 'object',
                  description: 'Observed grayscale/value review for representational workflows. DETAIL is blocked when this status is fail or when observed evidence is missing. style-not-applicable and override require explicit reasons.',
                  properties: {
                    status: { type: 'string', enum: ['pass', 'fail', 'override', 'style-not-applicable'] },
                    observed: { type: 'boolean' },
                    preview_sha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
                    evidence_operation_id: {
                      type: 'string',
                      description: 'Guard operation id of the successful photoshop_analyze_value_structure call that produced the observed grayscale evidence.',
                    },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    limitations: { type: 'array', items: { type: 'string' } },
                    applicability_reason: { type: 'string' },
                    override_reason: { type: 'string' },
                    criteria: {
                      type: 'object',
                      properties: {
                        large_value_grouping: {
                          type: 'object',
                          properties: { status: { type: 'string', enum: ['pass', 'fail', 'uncertain', 'not-applicable'] }, note: { type: 'string' } },
                          required: ['status', 'note'], additionalProperties: false,
                        },
                        focal_hierarchy: {
                          type: 'object',
                          properties: { status: { type: 'string', enum: ['pass', 'fail', 'uncertain', 'not-applicable'] }, note: { type: 'string' } },
                          required: ['status', 'note'], additionalProperties: false,
                        },
                        silhouette_separation: {
                          type: 'object',
                          properties: { status: { type: 'string', enum: ['pass', 'fail', 'uncertain', 'not-applicable'] }, note: { type: 'string' } },
                          required: ['status', 'note'], additionalProperties: false,
                        },
                        local_contrast_budget: {
                          type: 'object',
                          properties: { status: { type: 'string', enum: ['pass', 'fail', 'uncertain', 'not-applicable'] }, note: { type: 'string' } },
                          required: ['status', 'note'], additionalProperties: false,
                        },
                        detail_before_form: {
                          type: 'object',
                          properties: { status: { type: 'string', enum: ['pass', 'fail', 'uncertain', 'not-applicable'] }, note: { type: 'string' } },
                          required: ['status', 'note'], additionalProperties: false,
                        },
                      },
                      additionalProperties: false,
                    },
                  },
                  required: ['status', 'observed'],
                  additionalProperties: false,
                },
                refinement_check: {
                  type: 'object',
                  description: 'Durable subject-agnostic progressive-refinement stage-exit evidence. DETAIL is blocked while this is pending/fail. A pass requires perceptually meaningful representation change and resolved lower-frequency form/block-in debt. style-not-applicable must be justified by an exact declared style_contract field.',
                  properties: {
                    status: { type: 'string', enum: [...REFINEMENT_CHECK_STATUSES] },
                    observed: { type: 'boolean' },
                    preview_sha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
                    evidence_operation_id: {
                      type: 'string',
                      description: 'Guard operation id of the successful visual operation whose preview is the exact current frame being assessed.',
                    },
                    representation_change: { type: 'string', enum: [...REPRESENTATION_CHANGE_STATUSES] },
                    confidence: { type: 'number', minimum: 0, maximum: 1 },
                    limitations: { type: 'array', items: { type: 'string' } },
                    applicability_reason: { type: 'string' },
                    style_contract_basis: {
                      type: 'object',
                      properties: {
                        field: { type: 'string', enum: [...REFINEMENT_STYLE_BASIS_FIELDS] },
                        criterion: { type: 'string' },
                      },
                      required: ['field', 'criterion'],
                      additionalProperties: false,
                    },
                    criteria: {
                      type: 'object',
                      properties: Object.fromEntries(REFINEMENT_CRITERIA.map(key => [key, {
                        type: 'object',
                        properties: {
                          status: { type: 'string', enum: [...REFINEMENT_CRITERION_STATUSES] },
                          note: { type: 'string' },
                        },
                        required: ['status', 'note'],
                        additionalProperties: false,
                      }])),
                      additionalProperties: false,
                    },
                  },
                  required: ['status', 'observed'],
                  additionalProperties: false,
                },
                priorities: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string' } },
                review_after_microplans: {
                  type: 'number', minimum: 1, maximum: 20,
                  description: 'Planner-selected review horizon. Usually around 5-10 completed Painter micro-plans, but intentionally not a fixed magic constant.',
                },
                forbidden_without_review: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: [
                      'composition', 'large-value', 'lighting-structure', 'silhouette',
                      'depth-structure', 'likeness-main-shape', 'background-scope',
                    ],
                  },
                },
                tasks: {
                  type: 'array', minItems: 1, maxItems: 8,
                  items: {
                    type: 'object',
                    properties: {
                      task_id: { type: 'string' },
                      summary: { type: 'string' },
                      region: { type: 'string' },
                      allowed_scales: {
                        type: 'array',
                        items: { type: 'string', enum: ['medium', 'small', 'detail', 'local', 'micro'] },
                      },
                      allowed_global_changes: {
                        type: 'array',
                        items: {
                          type: 'string',
                          enum: [
                            'composition', 'large-value', 'lighting-structure', 'silhouette',
                            'depth-structure', 'likeness-main-shape', 'background-scope',
                          ],
                        },
                      },
                      affected_relations: { type: 'array', items: { type: 'string' } },
                      affected_qualities: { type: 'array', items: { type: 'string' } },
                    },
                    required: ['task_id', 'summary'],
                    additionalProperties: false,
                  },
                },
              },
              required: ['directive_id', 'goal', 'style_contract', 'artistic_evaluation_contract', 'composition_freedom', 'composition_exploration', 'assessment', 'value_check', 'refinement_check', 'priorities', 'review_after_microplans', 'tasks'],
              additionalProperties: false,
            },
            global_brief_assessment: {
              type: 'object',
              description: 'Bounded whole-brief evaluation. A global artistic claim is independently validated only when contract revision, current frame SHA and an authorized critic result all match.',
              properties: {
                outcome: { type: 'string', enum: ['satisfied', 'unsatisfied', 'regression', 'uncertain', 'not-evaluated'] },
                contract_id: { type: 'string' },
                contract_revision: { type: 'number', minimum: 1 },
                frame_sha256: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' },
                critic_authority: { type: 'string', enum: ['authorized', 'shadow'] },
                critic_result_id: { type: 'string' },
                criteria: { type: 'array', items: { type: 'string' } },
                reason: { type: 'string' },
              },
              required: ['outcome'],
              additionalProperties: false,
            },
            anchor_decision: {
              type: 'object',
              description: 'Whole-image anchor decision. Promotion is explicit and must reference a classified durable frame; keeping a local edit never promotes an anchor implicitly.',
              properties: {
                action: { type: 'string', enum: ['promote_primary', 'retain_primary', 'preserve_alternative'] },
                operation_id: { type: 'string' },
                rationale: { type: 'string' },
                preserve_previous_as_alternative: { type: 'boolean' },
              },
              required: ['action', 'rationale'],
              additionalProperties: false,
            },
            incomplete_hypothesis: {
              type: 'object',
              description: 'Bounded artistic hypothesis that may temporarily lose a named quality but must retain a real rollback anchor and finite review horizon.',
              properties: {
                lost_quality: { type: 'string' },
                intended_relationship: { type: 'string' },
                observable_completion_condition: { type: 'string' },
                rollback_operation_id: { type: 'string' },
                rollback_path: { type: 'string' },
                max_review_horizon: { type: 'number', minimum: 1, maximum: 8 },
              },
              required: ['lost_quality', 'intended_relationship', 'observable_completion_condition', 'max_review_horizon'],
              additionalProperties: false,
            },
            incomplete_hypothesis_resolution: {
              type: 'string',
              enum: ['resolved', 'accepted', 'reversed'],
            },
            whole_image_glance: {
              type: 'object',
              description: 'Independent whole-image observation only at a stage, global-change, or final boundary.',
              properties: {
                trigger: { type: 'string', enum: ['stage_boundary', 'global_change', 'final_review'] },
                observation: { type: 'string' },
                operation_id: { type: 'string' },
              },
              required: ['trigger', 'observation'],
              additionalProperties: false,
            },
          },
          required: ['document_id', 'action'],
          additionalProperties: false,
        },
      },
      handler: async (args) => {
        try { return json(runtime.artDirector(args)); }
        catch (error) { return json({ ok: false, code: 'guard_art_director_rejected', message: error instanceof Error ? error.message : String(error) }, true); }
      },
    },
    {
      tool: {
        name: 'photoshop_guard_recover_lock',
        description: 'Recover stale Guard/execution lock files only when their owning process is no longer alive. A live-PID async job whose heartbeat/deadline lease is stalled is reported as embedded_guard_job_stalled and remains locked; restart only the Photoshop MCP child before recovery. Never replays a mutation.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      },
      handler: async () => {
        try { return json(runtime.recoverLocks()); }
        catch (error) { return json({ ok: false, code: 'guard_lock_recovery_rejected', message: error instanceof Error ? error.message : String(error) }, true); }
      },
    },
  ];
}
