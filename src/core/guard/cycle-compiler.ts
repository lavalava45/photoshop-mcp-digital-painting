import { createHash } from 'node:crypto';
import type { ToolRegistry, ToolResult } from '../tool-registry.js';
import { DOCUMENT_ID_SCHEMA_EXCLUDES } from '../document-target.js';
import { compileVisualMicroPlan } from '../visual-microplan-compiler.js';
import { preflightVisualMicroPlanForExecution } from '../../tools/visual-microplan-tools.js';
import { isVisual, parseTexts } from './session-store.js';
import { compileArtisticOperation } from '../artistic-operation-contract.js';
import { UXP_BRIDGE_REVISION } from './protocol-version.js';
import {
  VISUAL_MICROPLAN_ACTION_CLASSES,
  VISUAL_MICROPLAN_MAX_LAYER_CREATIONS,
  VISUAL_MICROPLAN_MAX_MUTATIONS,
  VISUAL_MICROPLAN_MUTATION_TOOLS,
  visualMicroPlanMethodClassForStep,
  visualMicroPlanRequiresLocalInspection,
  type VisualMicroPlanSignificanceMode,
} from '../visual-microplan.js';
import type { GuardProjectionContext } from './projection-context.js';
import {
  collectOperationContractViolations,
  type GuardOperationContractViolation,
} from './operation-contract.js';
import { resolveVisualReviewProfile } from './visual-review-profile.js';

export interface GuardCycleCompilerStore {
  read?(id: string): Record<string, unknown> | undefined;
  collectClosePreviousErrors(input: Record<string, unknown>): string[];
  compactClosureDefaults?(id: string): {
    previous_report?: Record<string, unknown>;
    previous_operation_ack?: Record<string, unknown>;
  };
  compactPassContext?(documentId: number): {
    stage?: string;
    scale?: string;
    active_problem_id?: string;
    active_problem_scale?: string;
    brush_roles?: Array<Record<string, unknown>>;
    art_director?: Record<string, unknown> | null;
  };
  planAcceptedAnchorRestore?(
    documentId: number,
    anchorOperationId: string,
    suppliedRecords?: Array<Record<string, unknown>>,
    projectionContext?: GuardProjectionContext
  ): Record<string, unknown>;
  collectPreflightErrors(
    request: Record<string, unknown>,
    options?: {
      plannedPreviousOperationId?: string;
      plannedPreviousVisualVerdict?: boolean;
      projectionContext?: GuardProjectionContext;
      stateOnly?: boolean;
    }
  ): string[];
}

export interface GuardCycleCompileViolation {
  scope: 'cycle' | 'finalization' | 'next_operation';
  code: string;
  message: string;
}

export interface GuardCycleCompileResult {
  input: Record<string, unknown>;
  nextOperation?: Record<string, unknown>;
  rejection?: ToolResult;
  violations: GuardCycleCompileViolation[];
  normalizations: Array<{ code: string; message: string }>;
}

export interface GuardCycleCompilerOptions {
  collectDynamicOperationViolations?: (
    operation: Record<string, unknown>
  ) => Promise<GuardCycleCompileViolation[]>;
  projectionContext?: GuardProjectionContext;
  nextOperationValidation?: 'full' | 'state-only';
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

type JsonSchemaNode = {
  type?: string | string[];
  enum?: unknown[];
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  items?: JsonSchemaNode;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  additionalProperties?: boolean | JsonSchemaNode;
};

function schemaTypeMatches(value: unknown, type: string): boolean {
  if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'null') return value === null;
  return true;
}

function collectSchemaErrors(value: unknown, schemaValue: unknown, path: string): string[] {
  if (!schemaValue || typeof schemaValue !== 'object' || Array.isArray(schemaValue)) return [];
  const schema = schemaValue as JsonSchemaNode;
  const errors: string[] = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some(type => schemaTypeMatches(value, type))) {
    errors.push(`${path} must be ${types.join('|')}`);
    return errors;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(candidate => Object.is(candidate, value))) {
    errors.push(`${path} must be one of ${schema.enum.map(item => JSON.stringify(item)).join(', ')}`);
  }
  if (value && typeof value === 'object' && !Array.isArray(value)
    && (!types.length || types.includes('object'))) {
    const object = value as Record<string, unknown>;
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(object, required)) errors.push(`${path}.${required} is required`);
    }
    for (const [key, item] of Object.entries(object)) {
      const child = schema.properties?.[key];
      if (child) errors.push(...collectSchemaErrors(item, child, `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        errors.push(...collectSchemaErrors(item, schema.additionalProperties, `${path}.${key}`));
      }
    }
  }
  if (Array.isArray(value) && (!types.length || types.includes('array'))) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path} must contain at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path} must contain at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      value.forEach((item, index) => errors.push(...collectSchemaErrors(item, schema.items, `${path}[${index}]`)));
    }
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path} must be >= ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path} must be <= ${schema.maximum}`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path} is too short`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path} is too long`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${path} has invalid format`);
  }
  return errors;
}

function jsonResult(body: Record<string, unknown>, isError = false): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

function rejectionBody(result: ToolResult | undefined): Record<string, unknown> | undefined {
  const body = result ? parseTexts(result).find((candidate: unknown) =>
    !!candidate && typeof candidate === 'object' && !Array.isArray(candidate)
  ) : undefined;
  return body as Record<string, unknown> | undefined;
}

function operationSchemaErrors(operation: Record<string, unknown>, registry: ToolRegistry): string[] {
  const tool = typeof operation.tool === 'string' ? operation.tool : '';
  const definition = registry.get(tool);
  if (!definition) return tool ? [`Tool ${tool} missing from this fork catalog`] : [];
  const args = operation.args ?? {};
  const errors = collectSchemaErrors(args, definition.tool.inputSchema, 'args');
  const schema = definition.tool.inputSchema as { properties?: Record<string, unknown> } | undefined;
  const acceptsDocumentId = !DOCUMENT_ID_SCHEMA_EXCLUDES.has(tool)
    && !!schema?.properties
    && Object.prototype.hasOwnProperty.call(schema.properties, 'document_id');
  if (tool !== 'photoshop_get_state' && acceptsDocumentId) {
    const documentId = (args as Record<string, unknown>)?.document_id;
    if (!Number.isSafeInteger(documentId) || Number(documentId) <= 0) {
      errors.push(`Pass a positive pinned document_id for ${tool}; obtain it from photoshop_get_state/photoshop_list_documents first`);
    }
  }
  return errors;
}

function violation(
  scope: GuardCycleCompileViolation['scope'],
  code: string,
  message: string
): GuardCycleCompileViolation {
  return { scope, code, message };
}

function uniqueViolations(violations: GuardCycleCompileViolation[]): GuardCycleCompileViolation[] {
  const seen = new Set<string>();
  return violations.filter((item) => {
    const key = `${item.scope}\u0000${item.code}\u0000${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function compactObservationToVerdict(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const observation = structuredClone(value) as Record<string, unknown>;
  const compactObserved = text(observation.observed);
  const compactTarget = text(observation.target)?.toLowerCase();
  if (compactObserved && compactTarget && ['resolved', 'unresolved', 'uncertain'].includes(compactTarget)) {
    const regression = text(observation.regression);
    const action = text(observation.action)?.toLowerCase();
    const targetResolved = compactTarget === 'resolved' ? 'yes'
      : compactTarget === 'unresolved' ? 'no'
        : 'uncertain';
    const disposition = ['accept', 'correct', 'rollback'].includes(action ?? '')
      ? action
      : regression ? 'correct'
        : compactTarget === 'resolved' ? 'accept' : 'correct';
    const verdict = disposition === 'rollback' || regression
      ? 'regression'
      : compactTarget === 'resolved' ? 'improvement' : 'neutral';
    return {
      verdict,
      disposition,
      observed_change: compactObserved,
      target_resolved: targetResolved,
      regressions: regression ? [regression] : [],
      uncertainty: text(observation.uncertainty)
        ?? (compactTarget === 'uncertain' ? 'The delivered frame remains visually uncertain.' : 'none observed'),
      observations: Array.isArray(observation.observations)
        ? observation.observations
        : [{ region: 'delivered review frame', visible: compactObserved }],
      primary_mismatch: text(observation.primary_mismatch)
        ?? (compactTarget === 'resolved'
          ? 'No blocking mismatch is visible in the supplied observation.'
          : 'The requested visual target remains unresolved or uncertain in the supplied observation.'),
      global_readability: text(observation.global_readability) ?? 'unknown',
      primitive_footprint: text(observation.primitive_footprint) ?? 'unknown',
      trend_signals: Array.isArray(observation.trend_signals) ? observation.trend_signals : [],
      ...(Array.isArray(observation.review_findings) ? { review_findings: observation.review_findings } : {}),
      ...(observation.recognition !== undefined ? { recognition: observation.recognition } : {}),
      ...(observation.planner_task_assessment !== undefined
        ? { planner_task_assessment: observation.planner_task_assessment }
        : {}),
      ...(Array.isArray(observation.affected_relations) ? { affected_relations: observation.affected_relations } : {}),
      ...(Array.isArray(observation.affected_qualities) ? { affected_qualities: observation.affected_qualities } : {}),
      ...(Array.isArray(observation.preservation_facts) ? { preservation_facts: observation.preservation_facts } : {}),
      ...(observation.independent_region === true ? { independent_region: true } : {}),
    };
  }
  const observedChange = text(observation.observed_change);
  if (!observedChange) return observation;
  const targetResolved = text(observation.target_resolved);
  return {
    ...observation,
    observations: Array.isArray(observation.observations)
      ? observation.observations
      : [{
          region: 'delivered review frame',
          visible: observedChange,
        }],
    primary_mismatch: text(observation.primary_mismatch)
      ?? (targetResolved === 'yes'
        ? 'No blocking mismatch was stated beyond the supplied frame observation.'
        : 'The target remains unresolved or uncertain; see the supplied frame observation.'),
    global_readability: text(observation.global_readability) ?? 'unknown',
    primitive_footprint: text(observation.primitive_footprint) ?? 'unknown',
    trend_signals: Array.isArray(observation.trend_signals) ? observation.trend_signals : [],
  };
}

function normalizeCompactOperation(
  operation: Record<string, unknown>
): {
  operation: Record<string, unknown>;
  violations: GuardCycleCompileViolation[];
  normalizations: Array<{ code: string; message: string }>;
} {
  const compiled = structuredClone(operation);
  const violations: GuardCycleCompileViolation[] = [];
  const normalizations: Array<{ code: string; message: string }> = [];
  const requestKey = text(compiled.request_key);
  const explicitId = text(compiled.id);
  if (requestKey && explicitId && requestKey !== explicitId) {
    violations.push(violation(
      'next_operation',
      'request_key_conflict',
      'next_operation.request_key and id must identify the same durable request when both are supplied'
    ));
  }
  if (!explicitId && requestKey) compiled.id = requestKey;

  const goal = text(compiled.goal);
  if (goal) {
    compiled.summary ??= goal;
    compiled.purpose ??= 'Execute the requested bounded Photoshop pass.';
  }
  if (requestKey && goal) compiled.problem_id ??= requestKey;

  if (compiled.tool === 'photoshop_execute_visual_microplan') {
    const args = compiled.args && typeof compiled.args === 'object' && !Array.isArray(compiled.args)
      ? structuredClone(compiled.args) as Record<string, unknown>
      : {};
    const operationId = text(compiled.id);
    const rootGoal = goal ?? text(args.intent) ?? text(args.summary);
    if (operationId) args.plan_id ??= operationId;
    if (rootGoal) {
      // One root goal is authoritative. Legacy args.intent/summary remain valid
      // when no compact goal is supplied, but compact callers need not repeat it.
      if (goal) args.intent = goal;
      else args.intent ??= rootGoal;
      args.summary ??= rootGoal;
      compiled.summary ??= rootGoal;
      compiled.purpose ??= 'Execute the requested bounded visual pass.';
    }
    compiled.problem_id ??= text(args.problem_id) ?? operationId;
    if (compiled.problem_id !== undefined) args.problem_id ??= compiled.problem_id;
    compiled.region ??= args.region;
    compiled.stage ??= args.stage;
    compiled.scale ??= args.scale;
    compiled.args = args;
  }

  if (compiled.preview_args && typeof compiled.preview_args === 'object' && !Array.isArray(compiled.preview_args)) {
    const previewArgs = structuredClone(compiled.preview_args) as Record<string, unknown>;
    if (previewArgs.document_id !== undefined) {
      const operationArgs = compiled.args && typeof compiled.args === 'object' && !Array.isArray(compiled.args)
        ? compiled.args as Record<string, unknown>
        : {};
      if (previewArgs.document_id === operationArgs.document_id) {
        delete previewArgs.document_id;
        compiled.preview_args = previewArgs;
        normalizations.push({
          code: 'duplicate_preview_document_id_removed',
          message: 'Removed preview_args.document_id because it duplicated the pinned next_operation.args.document_id.',
        });
      } else {
        violations.push(violation(
          'next_operation',
          'preview_document_mismatch',
          `preview_args.document_id=${String(previewArgs.document_id)} does not match pinned next_operation.args.document_id=${String(operationArgs.document_id)}`
        ));
      }
    }
  }

  delete compiled.request_key;
  delete compiled.goal;
  return { operation: compiled, violations, normalizations };
}

const COMPACT_DOCUMENT_BOOTSTRAP_TOOLS = new Set([
  'photoshop_create_document',
  'photoshop_open_image',
]);

function compactStepMethodClass(step: Record<string, unknown>): string | undefined {
  const args = step.args && typeof step.args === 'object' && !Array.isArray(step.args)
    ? step.args as Record<string, unknown>
    : {};
  return visualMicroPlanMethodClassForStep({ tool: text(step.tool) ?? '', args });
}

function compactRiskForMethod(method: string | undefined): 'low' | 'moderate' | 'high' {
  if (method === 'rollback' || method === 'erase') return 'high';
  if (method === 'smudge' || method === 'fill') return 'moderate';
  return 'low';
}

function compactChangeDomain(method: string | undefined): string {
  if (method === 'region') return 'local-shape';
  if (method === 'erase' || method === 'line') return 'local-edge';
  return 'local-tone';
}

function compileCompactPass(
  raw: Record<string, unknown>,
  store: GuardCycleCompilerStore,
  registry: ToolRegistry
): { operation?: Record<string, unknown>; violations: GuardCycleCompileViolation[] } {
  const violations: GuardCycleCompileViolation[] = [];
  const requestKey = text(raw.request_key);
  const goal = text(raw.goal);
  const documentId = raw.document_id;
  const restoreAnchorOperationId = text(raw.restore_anchor_operation_id);
  const actions = Array.isArray(raw.actions)
    ? structuredClone(raw.actions) as Array<Record<string, unknown>>
    : [];
  if (!requestKey || !goal || (!restoreAnchorOperationId && !actions.length)) {
    return { violations };
  }
  if (restoreAnchorOperationId) {
    if (!Number.isSafeInteger(documentId) || Number(documentId) <= 0) {
      violations.push(violation(
        'next_operation',
        'accepted_anchor_restore_document_required',
        'next_pass.document_id is required for accepted-anchor restore'
      ));
      return { violations };
    }
    if (actions.length) {
      violations.push(violation(
        'next_operation',
        'accepted_anchor_restore_actions_forbidden',
        'restore_anchor_operation_id is one logical Guard recovery request and cannot be combined with next_pass.actions'
      ));
      return { violations };
    }
    if (!store.planAcceptedAnchorRestore) {
      violations.push(violation(
        'next_operation',
        'accepted_anchor_restore_unavailable',
        'The current Guard runtime does not expose accepted-anchor restore planning'
      ));
      return { violations };
    }
    try {
      const plan = store.planAcceptedAnchorRestore(Number(documentId), restoreAnchorOperationId);
      return {
        operation: {
          request_key: requestKey,
          goal,
          problem_id: text(raw.problem_id) ?? `restore:${restoreAnchorOperationId}`,
          tool: 'photoshop_undo',
          args: {
            document_id: Number(documentId),
            steps: Number(plan.required_undo_steps),
          },
          summary: goal,
          purpose: `Restore registered accepted artistic anchor ${restoreAnchorOperationId} without replaying later mutations.`,
          significance_mode: 'normal',
          preview_args: { max_dimension_px: 1600, quality: 10 },
          accepted_anchor_restore: {
            protocol: 'photoshop.guard.accepted_anchor_restore.v1',
            anchor_operation_id: restoreAnchorOperationId,
            anchor_sha256: plan.anchor_sha256,
            anchor_path: plan.anchor_path,
            required_undo_steps: plan.required_undo_steps,
            history_operation_ids: plan.history_operation_ids,
          },
        },
        violations,
      };
    } catch (error) {
      violations.push(violation(
        'next_operation',
        'accepted_anchor_restore_rejected',
        error instanceof Error ? error.message : String(error)
      ));
      return { violations };
    }
  }
  const problemId = text(raw.problem_id) ?? text(raw.addresses_problem_id) ?? requestKey;
  const existingRequestRecord = store.read?.(requestKey);
  const existingReviewProfile = existingRequestRecord?.visual_review_profile
    && typeof existingRequestRecord.visual_review_profile === 'object'
    && !Array.isArray(existingRequestRecord.visual_review_profile)
    ? structuredClone(existingRequestRecord.visual_review_profile) as ReturnType<typeof resolveVisualReviewProfile>
    : undefined;

  const onlyAction = actions.length === 1 ? actions[0] : undefined;
  const onlyTool = onlyAction ? text(onlyAction.tool) : undefined;
  const bootstrap = !!onlyTool && COMPACT_DOCUMENT_BOOTSTRAP_TOOLS.has(onlyTool);
  if (!bootstrap && (!Number.isSafeInteger(documentId) || Number(documentId) <= 0)) {
    violations.push(violation(
      'next_operation',
      'compact_pass_document_required',
      'next_pass.document_id is required for every non-bootstrap Photoshop pass'
    ));
    return { violations };
  }
  if (bootstrap && documentId !== undefined) {
    violations.push(violation(
      'next_operation',
      'compact_bootstrap_document_forbidden',
      'next_pass.document_id must be omitted for photoshop_create_document/photoshop_open_image because the target document does not exist yet'
    ));
  }

  // A compact semantic pass is not synonymous with VisualMicroPlan. Bootstrap,
  // Curves/masks/blend/transform/property mutations and other single registered
  // Photoshop operations keep their native semantics and are guarded directly.
  // VisualMicroPlan remains the compact bundle for its paint/fill/undo family.
  if (onlyAction && onlyTool && !VISUAL_MICROPLAN_MUTATION_TOOLS.has(onlyTool)) {
    const actionArgs = onlyAction.args && typeof onlyAction.args === 'object' && !Array.isArray(onlyAction.args)
      ? structuredClone(onlyAction.args) as Record<string, unknown>
      : {};
    if (!bootstrap) actionArgs.document_id ??= Number(documentId);
    const context = !bootstrap && Number.isSafeInteger(documentId)
      ? store.compactPassContext?.(Number(documentId)) ?? {}
      : {};
    const art = context.art_director && typeof context.art_director === 'object'
      ? context.art_director as Record<string, unknown>
      : undefined;
    const plannerDirectiveId = text(art?.directive_id);
    const plannerTaskId = text(art?.current_task_id);
    const scale = text(raw.scale) ?? text(context.scale);
    const stage = text(raw.stage) ?? text(context.stage);
    const region = text(raw.region) ?? (bootstrap ? 'document-bootstrap' : 'whole-canvas');
    const significanceMode = text(raw.significance_mode) ?? 'normal';
    const regionBounds = raw.region_bounds && typeof raw.region_bounds === 'object' && !Array.isArray(raw.region_bounds)
      ? structuredClone(raw.region_bounds) as Record<string, unknown>
      : undefined;
    const directActionClass = text(raw.action_class)?.toUpperCase();
    const directImpactClass = text(raw.impact_class);
    const directOperation: Record<string, unknown> = {
      request_key: requestKey,
      goal,
      ...(!bootstrap ? { problem_id: problemId } : {}),
      tool: onlyTool,
      args: actionArgs,
      summary: goal,
      purpose: 'Execute one bounded compact Photoshop operation.',
      region,
      ...(stage ? { stage } : {}),
      ...(scale ? { scale } : {}),
      ...(text(raw.significance_mode) ? { significance_mode: significanceMode } : {}),
      ...(!bootstrap ? { artistic_commentary: goal } : {}),
      ...(plannerDirectiveId && plannerTaskId ? {
        planner_directive_id: plannerDirectiveId,
        planner_task_id: plannerTaskId,
        painter_scope: scale === 'medium' ? 'medium' : 'local',
        change_domains: ['local-tone'],
        ...(Array.isArray(raw.affected_relations) ? { affected_relations: raw.affected_relations } : {}),
        ...(Array.isArray(raw.affected_qualities) ? { affected_qualities: raw.affected_qualities } : {}),
        ...(Array.isArray(raw.preservation_facts) ? { preservation_facts: raw.preservation_facts } : {}),
        ...(raw.independent_region === true ? { independent_region: true } : {}),
        ...(raw.addresses_primary_mismatch === true ? { addresses_primary_mismatch: true } : {}),
        ...(text(raw.addresses_problem_id) ? { addresses_problem_id: text(raw.addresses_problem_id) } : {}),
      } : {}),
    };

    const visualIntent = text(raw.visual_intent);
    const impactClass = text(raw.impact_class);
    if (!bootstrap && isVisual(onlyTool)) {
      const visualReviewProfile = existingReviewProfile ?? resolveVisualReviewProfile({
        scale,
        significance_mode: significanceMode,
        action_class: directActionClass,
        impact_class: directImpactClass,
        has_region_bounds: !!regionBounds,
        open_problem_scale: text(context.active_problem_id) === problemId
          ? text(context.active_problem_scale)
          : undefined,
      });
      if (visualReviewProfile.require_region && !regionBounds) {
        violations.push(violation(
          'next_operation',
          'compact_review_region_bounds_required',
          `${visualReviewProfile.level} visual review requires next_pass.region_bounds in source-document pixels`
        ));
      }
      directOperation.visual_review_profile = visualReviewProfile;
      directOperation.preview_args = {
        max_dimension_px: visualReviewProfile.whole_max_dimension_px,
        quality: 8,
        ...(visualReviewProfile.require_region && regionBounds ? {
          focus_region: regionBounds,
          focus_max_dimension_px: visualReviewProfile.focus_max_dimension_px,
        } : {}),
      };
    }
    // Document bootstrap is infrastructure, not an artistic painting method.
    // Callers may accidentally carry stage/intent metadata from the painting
    // request into create/open. Never route bootstrap through method selection:
    // doing so can misclassify GLOBAL_BLOCK_IN + mass/construct as
    // region-block-in and reject the real create/open tool before dispatch.
    if (!bootstrap && (visualIntent || impactClass || text(raw.preferred_method_id))) {
      if (!visualIntent || !impactClass) {
        violations.push(violation(
          'next_operation',
          'artistic_method_contract_incomplete',
          'visual_intent and impact_class must be supplied together when declaring a compact artistic method contract'
        ));
      } else {
        try {
          const plan = compileArtisticOperation(registry, {
            visualIntent: visualIntent as never,
            impactClass: impactClass as never,
            stage,
            preferredMethodId: text(raw.preferred_method_id),
            avoidMethodIds: Array.isArray(raw.avoid_method_ids) ? raw.avoid_method_ids.map(text).filter(Boolean) as string[] : [],
            documentId: Number(documentId),
            runtimeRevision: UXP_BRIDGE_REVISION,
          });
          if (!plan.allowedExecutionTools.includes(onlyTool)) {
            violations.push(violation(
              'next_operation',
              'artistic_method_execution_mismatch',
              `declared method ${plan.method.id} allows ${plan.allowedExecutionTools.join('|')} but compact pass executes ${onlyTool}`
            ));
          }
          // Validate the compact artistic-method contract here, but keep it
          // compiler-local. `artistic_operation` is not a public Guard request
          // field, so forwarding it would make a valid single-operation compact
          // pass reject itself during operation-contract validation.
        } catch (error) {
          violations.push(violation(
            'next_operation',
            'artistic_method_unavailable',
            error instanceof Error ? error.message : String(error)
          ));
        }
      }
    }
    return { operation: directOperation, violations };
  }

  if (!Number.isSafeInteger(documentId) || Number(documentId) <= 0) {
    violations.push(violation(
      'next_operation',
      'compact_pass_document_required',
      'next_pass.document_id is required for VisualMicroPlan painting passes'
    ));
    return { violations };
  }

  const mutationSteps = actions.filter(step => VISUAL_MICROPLAN_MUTATION_TOOLS.has(text(step.tool) ?? ''));
  const methodClasses = [...new Set(mutationSteps.map(compactStepMethodClass).filter(Boolean))] as string[];
  if (methodClasses.length > 1) {
    violations.push(violation(
      'next_operation',
      'compact_pass_mixed_method_class',
      `next_pass actions contain incompatible mutation method classes: ${methodClasses.join(', ')}; split them into bounded passes`
    ));
  }
  if (mutationSteps.length > VISUAL_MICROPLAN_MAX_MUTATIONS) {
    violations.push(violation(
      'next_operation',
      'compact_pass_visual_mutation_limit',
      `next_pass may contain at most ${VISUAL_MICROPLAN_MAX_MUTATIONS} visual mutations; split the artistic stage into sequential Guard passes`
    ));
  }
  const methodClass = methodClasses[0];
  const risk = mutationSteps
    .map(step => compactRiskForMethod(compactStepMethodClass(step)))
    .sort((a, b) => ['low', 'moderate', 'high'].indexOf(b) - ['low', 'moderate', 'high'].indexOf(a))[0]
    ?? 'low';
  const explicitActionClass = text(raw.action_class)?.toUpperCase();
  if (explicitActionClass && !VISUAL_MICROPLAN_ACTION_CLASSES.includes(explicitActionClass as never)) {
    violations.push(violation(
      'next_operation',
      'compact_action_class_invalid',
      `next_pass.action_class must be one of ${VISUAL_MICROPLAN_ACTION_CLASSES.join('|')}`
    ));
  }
  if (Array.isArray(raw.replace_protected_layer_ids) && raw.replace_protected_layer_ids.length > 0 && !explicitActionClass) {
    violations.push(violation(
      'next_operation',
      'compact_replace_action_required',
      'replace_protected_layer_ids requires explicit next_pass.action_class=REPLACE or ERASE'
    ));
  }
  const actionClass = explicitActionClass
    ?? (methodClass === 'rollback' ? 'ROLLBACK' : methodClass === 'erase' ? 'ERASE' : 'ADD');

  const context = store.compactPassContext?.(Number(documentId)) ?? {};
  const stage = text(raw.stage) ?? text(context.stage) ?? (methodClass === 'region' ? 'GLOBAL_BLOCK_IN' : undefined);
  const scale = text(raw.scale) ?? text(context.scale) ?? (methodClass === 'region' ? 'global' : undefined);
  const region = text(raw.region) ?? 'whole-canvas';
  const significanceMode = text(raw.significance_mode) ?? 'normal';
  const regionBounds = raw.region_bounds && typeof raw.region_bounds === 'object' && !Array.isArray(raw.region_bounds)
    ? structuredClone(raw.region_bounds) as Record<string, unknown>
    : undefined;
  const createSteps = actions.filter(step => text(step.tool) === 'photoshop_create_layer');
  if (createSteps.length > VISUAL_MICROPLAN_MAX_LAYER_CREATIONS) {
    violations.push(violation(
      'next_operation',
      'compact_pass_multiple_layer_creation',
      `next_pass may create at most ${VISUAL_MICROPLAN_MAX_LAYER_CREATIONS} logical layer; the current VisualMicroPlan represents one rollback unit`
    ));
  }

  const createStep = createSteps.length === 1 ? createSteps[0] : undefined;
  const createArgs = createStep?.args && typeof createStep.args === 'object' && !Array.isArray(createStep.args)
    ? createStep.args as Record<string, unknown>
    : {};
  const layerName = text(createArgs.name) ?? `Pass ${requestKey}`;
  const layerSeparationCheck = createStep ? {
    change_kind: 'other',
    substantial: true,
    rollback_value: 'moderate',
    independent_adjustment_expected: true,
    reasons: ['The compact pass explicitly creates one independently addressable Photoshop layer.'],
  } : {
    change_kind: 'continuation',
    substantial: true,
    rollback_value: 'low',
    independent_adjustment_expected: false,
    reasons: ['The compact pass continues the current logical layer without creating a new rollback unit.'],
  };
  const logicalLayer = createStep ? {
    decision: 'create-new',
    hypothesis_id: `${requestKey}-layer`,
    hypothesis: goal,
    rollback_value: 'moderate',
    expected_independent_rollback: true,
    separation_reasons: ['The pass explicitly creates a dedicated layer.'],
    layer_name: layerName,
  } : undefined;

  let selectedPreset = actions
    .filter(step => text(step.tool) === 'photoshop_select_brush_preset')
    .map(step => step.args && typeof step.args === 'object' && !Array.isArray(step.args)
      ? text((step.args as Record<string, unknown>).name)
      : undefined)
    .filter(Boolean)
    .at(-1);
  const roles = Array.isArray(context.brush_roles) ? context.brush_roles : [];
  const explicitBrushRole = text(raw.brush_role);
  let brushRole = selectedPreset ? roles.find(role => {
    const accepted = new Set([
      text(role.preferred_preset),
      ...(Array.isArray(role.alternative_presets) ? role.alternative_presets.map(text) : []),
    ].filter(Boolean));
    return accepted.has(selectedPreset);
  }) : undefined;
  if (!brushRole && explicitBrushRole) {
    brushRole = roles.find(role => text(role.role_id) === explicitBrushRole);
  }
  if (!brushRole && methodClass === 'paint') {
    brushRole = roles.find(role => text(role.working_scale)?.toLowerCase() === text(scale)?.toLowerCase())
      ?? roles[0];
  }
  if (methodClass === 'paint' && brushRole && !selectedPreset) {
    selectedPreset = text(brushRole.preferred_preset);
    if (selectedPreset) {
      const ids = new Set(actions.map(step => text(step.id)).filter(Boolean));
      let selectId = 'guard_select_brush';
      while (ids.has(selectId)) selectId += '_';
      actions.unshift({
        id: selectId,
        tool: 'photoshop_select_brush_preset',
        args: { name: selectedPreset },
        description: 'Guard-selected preflighted brush role for this compact pass.',
      });
    }
  }
  const paintStrategy = methodClass === 'paint' && brushRole ? {
    material_role: Array.isArray(brushRole.material_roles) ? text(brushRole.material_roles[0]) : undefined,
    visual_intent: Array.isArray(brushRole.visual_intents) ? text(brushRole.visual_intents[0]) : undefined,
    brush_role: text(brushRole.role_id),
    ...(selectedPreset ? { preset_name: selectedPreset } : {}),
    pressure_policy: text(brushRole.pressure_policy),
  } : undefined;

  const art = context.art_director && typeof context.art_director === 'object'
    ? context.art_director as Record<string, unknown>
    : undefined;
  const changeDomains = [...new Set(mutationSteps.map(step => compactChangeDomain(compactStepMethodClass(step))))];
  const plannerDirectiveId = text(art?.directive_id);
  const plannerTaskId = text(art?.current_task_id);
  const painterScope = scale === 'medium' ? 'medium' : 'local';
  const visualIntent = text(raw.visual_intent);
  const impactClass = text(raw.impact_class);
  if (visualIntent || impactClass || text(raw.preferred_method_id)) {
    if (!visualIntent || !impactClass) {
      violations.push(violation(
        'next_operation',
        'artistic_method_contract_incomplete',
        'visual_intent and impact_class must be supplied together when declaring a compact artistic method contract'
      ));
    } else {
      try {
        const plan = compileArtisticOperation(registry, {
          visualIntent: visualIntent as never,
          impactClass: impactClass as never,
          stage,
          preferredMethodId: text(raw.preferred_method_id),
          avoidMethodIds: Array.isArray(raw.avoid_method_ids) ? raw.avoid_method_ids.map(text).filter(Boolean) as string[] : [],
          documentId: Number(documentId),
          runtimeRevision: UXP_BRIDGE_REVISION,
        });
        const executedMutationTools = [...new Set(mutationSteps.map(step => text(step.tool)).filter(Boolean))] as string[];
        const drift = executedMutationTools.filter(tool => !plan.allowedExecutionTools.includes(tool));
        if (drift.length) {
          violations.push(violation(
            'next_operation',
            'artistic_method_execution_mismatch',
            `declared method ${plan.method.id} allows ${plan.allowedExecutionTools.join('|')} but compact pass executes ${drift.join('|')}`
          ));
        }
        // The compact artistic contract is validated here, but it is not forwarded
        // as an `artistic_operation` field. VisualMicroPlan's public schema carries
        // the executable contract through method_class / paint_strategy / step
        // method_id and rejects unknown root fields fail-closed.
      } catch (error) {
        violations.push(violation(
          'next_operation',
          'artistic_method_unavailable',
          error instanceof Error ? error.message : String(error)
        ));
      }
    }
  }

  const requiresLocalInspection = visualMicroPlanRequiresLocalInspection(
    scale ?? '',
    significanceMode as VisualMicroPlanSignificanceMode
  );
  const visualReviewProfile = existingReviewProfile ?? resolveVisualReviewProfile({
    scale,
    significance_mode: significanceMode,
    action_class: actionClass,
    impact_class: impactClass,
    has_region_bounds: !!regionBounds,
    open_problem_scale: text(context.active_problem_id) === problemId
      ? text(context.active_problem_scale)
      : undefined,
  });
  if (requiresLocalInspection && !regionBounds) {
    violations.push(violation(
      'next_operation',
      'compact_local_region_bounds_required',
      'local/small/subtle visual passes require next_pass.region_bounds so Guard can generate matching BEFORE/AFTER focus previews'
    ));
  }
  if (visualReviewProfile.require_region && !regionBounds && !requiresLocalInspection) {
    violations.push(violation(
      'next_operation',
      'compact_review_region_bounds_required',
      `${visualReviewProfile.level} visual review requires next_pass.region_bounds in source-document pixels; Guard will not invent a crop center`
    ));
  }
  if (regionBounds && visualReviewProfile.require_region) {
    const firstMutationIndex = actions.findIndex(step => VISUAL_MICROPLAN_MUTATION_TOOLS.has(text(step.tool) ?? ''));
    if (firstMutationIndex >= 0) {
      if (visualReviewProfile.require_before_after) {
        actions.splice(firstMutationIndex, 0, {
          id: 'guard_before_preview',
          tool: 'photoshop_get_preview',
          args: {
            max_dimension_px: visualReviewProfile.whole_max_dimension_px,
            quality: 8,
            focus_region: regionBounds,
            focus_max_dimension_px: visualReviewProfile.focus_max_dimension_px ?? 1200,
          },
        });
      }
      actions.push({
        id: 'guard_after_preview',
        tool: 'photoshop_get_preview',
        args: {
          max_dimension_px: visualReviewProfile.whole_max_dimension_px,
          quality: 8,
          focus_region: regionBounds,
          focus_max_dimension_px: visualReviewProfile.focus_max_dimension_px ?? 1200,
        },
      });
    }
  }

  const args: Record<string, unknown> = {
    document_id: documentId,
    stage,
    scale,
    region,
    ...(regionBounds ? { region_bounds: regionBounds } : {}),
    method_class: methodClass,
    risk,
    expected_visual_delta: goal,
    verification_envelope: visualReviewProfile.require_before_after
      ? { mode: 'before_after', min_focus_dimension_px: 800 }
      : { mode: 'after_only' },
    layer_separation_check: layerSeparationCheck,
    ...(logicalLayer ? { logical_layer: logicalLayer } : {}),
    action_class: actionClass,
    problem_id: problemId,
    expected_visual_result: goal,
    failure_signals: [],
    significance_mode: significanceMode,
    ...(text(raw.pattern_intent) ? { pattern_intent: text(raw.pattern_intent) } : {}),
    ...(Array.isArray(raw.motif_instances) ? { motif_instances: structuredClone(raw.motif_instances) } : {}),
    ...(Array.isArray(raw.protected_regions) ? { protected_regions: raw.protected_regions } : {}),
    ...(Array.isArray(raw.protected_layer_ids) ? { protected_layer_ids: raw.protected_layer_ids } : {}),
    ...(Array.isArray(raw.replace_protected_layer_ids) ? { replace_protected_layer_ids: raw.replace_protected_layer_ids } : {}),
    ...(paintStrategy ? { paint_strategy: paintStrategy } : {}),
    ...(plannerDirectiveId && plannerTaskId ? {
      planner_directive_id: plannerDirectiveId,
      planner_task_id: plannerTaskId,
      painter_scope: painterScope,
      change_domains: changeDomains,
      ...(Array.isArray(raw.affected_relations) ? { affected_relations: raw.affected_relations } : {}),
      ...(Array.isArray(raw.affected_qualities) ? { affected_qualities: raw.affected_qualities } : {}),
      ...(Array.isArray(raw.preservation_facts) ? { preservation_facts: raw.preservation_facts } : {}),
      ...(raw.independent_region === true ? { independent_region: true } : {}),
      ...(raw.addresses_primary_mismatch === true ? { addresses_primary_mismatch: true } : {}),
      ...(text(raw.addresses_problem_id) ? { addresses_problem_id: text(raw.addresses_problem_id) } : {}),
    } : {}),
    steps: actions,
  };

  return {
    operation: {
      request_key: requestKey,
      goal,
      problem_id: problemId,
      tool: 'photoshop_execute_visual_microplan',
      args,
      significance_mode: significanceMode,
      visual_review_profile: visualReviewProfile,
      preview_args: {
        max_dimension_px: visualReviewProfile.whole_max_dimension_px,
        quality: 8,
      },
      artistic_commentary: goal,
      ...(plannerDirectiveId && plannerTaskId ? {
        planner_directive_id: plannerDirectiveId,
        planner_task_id: plannerTaskId,
        painter_scope: painterScope,
        change_domains: changeDomains,
        ...(Array.isArray(raw.affected_relations) ? { affected_relations: raw.affected_relations } : {}),
        ...(Array.isArray(raw.affected_qualities) ? { affected_qualities: raw.affected_qualities } : {}),
        ...(Array.isArray(raw.preservation_facts) ? { preservation_facts: raw.preservation_facts } : {}),
        ...(raw.independent_region === true ? { independent_region: true } : {}),
        ...(raw.addresses_primary_mismatch === true ? { addresses_primary_mismatch: true } : {}),
        ...(text(raw.addresses_problem_id) ? { addresses_problem_id: text(raw.addresses_problem_id) } : {}),
      } : {}),
    },
    violations,
  };
}

function operationContractViolations(
  operation: Record<string, unknown>
): GuardCycleCompileViolation[] {
  return collectOperationContractViolations(operation).map((item: GuardOperationContractViolation) =>
    violation('next_operation', item.code, item.message)
  );
}

async function compileNextOperation(
  operation: Record<string, unknown>,
  store: GuardCycleCompilerStore,
  registry: ToolRegistry,
  plannedPreviousOperationId?: string,
  plannedPreviousVisualVerdict = false,
  options: GuardCycleCompilerOptions = {}
): Promise<{
  operation: Record<string, unknown>;
  violations: GuardCycleCompileViolation[];
  normalizations: Array<{ code: string; message: string }>;
}> {
  const stateOnly = options.nextOperationValidation === 'state-only';
  const normalized = stateOnly
    ? {
        operation: structuredClone(operation),
        violations: [] as GuardCycleCompileViolation[],
        normalizations: [] as Array<{ code: string; message: string }>,
      }
    : normalizeCompactOperation(operation);
  let compiled = normalized.operation;
  const violations: GuardCycleCompileViolation[] = stateOnly
    ? []
    : [
        ...normalized.violations,
        ...operationContractViolations(compiled),
      ];
  let visualMicroPlanCompiled = stateOnly || compiled.tool !== 'photoshop_execute_visual_microplan';

  if (!stateOnly && compiled.tool === 'photoshop_execute_visual_microplan') {
    try {
      compiled = {
        ...compiled,
        args: compileVisualMicroPlan((compiled.args ?? {}) as Record<string, unknown>),
        ...(typeof compiled.stage === 'string' && /^block[ _-]?in$/i.test(compiled.stage.trim())
          ? { stage: 'GLOBAL_BLOCK_IN' }
          : {}),
      };
      visualMicroPlanCompiled = true;
    } catch (error) {
      violations.push(violation(
        'next_operation',
        'invalid_visual_microplan',
        error instanceof Error ? error.message : String(error)
      ));
    }
  }

  for (const message of store.collectPreflightErrors(compiled, {
    plannedPreviousOperationId,
    plannedPreviousVisualVerdict,
    projectionContext: options.projectionContext,
    stateOnly,
  })) {
    violations.push(violation('next_operation', 'guard_preflight_failed', message));
  }
  if (!stateOnly) {
    for (const message of operationSchemaErrors(compiled, registry)) {
      violations.push(violation('next_operation', 'tool_schema_invalid', message));
    }
  }

  if (!stateOnly && options.collectDynamicOperationViolations) {
    try {
      violations.push(...await options.collectDynamicOperationViolations(compiled));
    } catch (error) {
      violations.push(violation(
        'next_operation',
        'dynamic_preflight_failed',
        error instanceof Error ? error.message : String(error)
      ));
    }
  }

  if (!stateOnly && compiled.tool === 'photoshop_execute_visual_microplan' && visualMicroPlanCompiled) {
    const planRejection = await preflightVisualMicroPlanForExecution(
      (compiled.args ?? {}) as Record<string, unknown>,
      registry
    );
    const body = rejectionBody(planRejection);
    if (Array.isArray(body?.errors)) {
      const planCode = typeof body?.code === 'string' ? body.code : 'invalid_visual_microplan';
      for (const message of body.errors.map(String)) {
        violations.push(violation('next_operation', planCode, message));
      }
    }
  }

  return {
    operation: compiled,
    violations: uniqueViolations(violations),
    normalizations: normalized.normalizations,
  };
}

export async function compileGuardCycle(
  input: Record<string, unknown>,
  store: GuardCycleCompilerStore,
  registry: ToolRegistry,
  options: GuardCycleCompilerOptions = {}
): Promise<GuardCycleCompileResult> {
  const compiledInput = structuredClone(input);
  const violations: GuardCycleCompileViolation[] = [];
  const normalizations: Array<{ code: string; message: string }> = [];
  const internalStateOnlyRevalidation = options.nextOperationValidation === 'state-only';
  const compactPreviousOperationId = text(compiledInput.previous_operation_id);
  const compactPreviousObservationSupplied = compiledInput.previous_observation !== undefined;
  if (!internalStateOnlyRevalidation) {
    const removedLegacyFields: Array<[string, string]> = [
      ['next_operation', 'next_pass'],
      ['previous_report', 'previous_observation'],
      ['previous_operation_ack', 'previous_operation_id + previous_observation'],
      ['previous_visual_verdict', 'previous_observation'],
      ['previous_report_ack', 'previous_operation_id + previous_observation'],
    ];
    const legacyViolations = removedLegacyFields
      .filter(([field]) => Object.prototype.hasOwnProperty.call(compiledInput, field))
      .map(([field, replacement]) => violation(
        'cycle',
        'legacy_contract_removed',
        `legacy_contract_removed: ${field} is no longer accepted on the public Guard cycle contract; use ${replacement}`
      ));
    if (legacyViolations.length) {
      const unique = uniqueViolations(legacyViolations);
      const cycleFingerprint = fingerprint(compiledInput);
      const rejectionFingerprint = fingerprint({ cycle_fingerprint: cycleFingerprint, violations: unique });
      const errors = unique.map((item) => item.message);
      return {
        input: compiledInput,
        nextOperation: undefined,
        violations: unique,
        normalizations,
        rejection: jsonResult({
          ok: false,
          code: 'legacy_contract_removed',
          execution: 'not-executed',
          terminal: true,
          previous_operation_closed: false,
          next_operation_dispatched: false,
          visual_mutation_started: false,
          cycle_fingerprint: cycleFingerprint,
          rejection_fingerprint: rejectionFingerprint,
          error_codes: ['legacy_contract_removed'],
          violations: unique,
          errors,
          normalizations,
          cycle_errors: errors,
          finalization_errors: [],
          next_operation_errors: [],
          guard_debt: {
            visual_barrier: false,
            preview: false,
            visual_report: false,
            operation_ack: false,
            visual_verdict: false,
            rollback: false,
            reconciliation: false,
          },
          compact_correction_recipe: {
            repeat_same_semantic_cycle: true,
            previous_operation_closed: false,
            photoshop_mutation_started: false,
          },
          next_required_action: 'Remove every legacy cycle field listed above and resubmit one compact cycle using previous_operation_id + previous_observation + optional next_pass.',
          message: errors.join('\n'),
        }, true),
      };
    }
  }
  if (compiledInput.previous_observation !== undefined) {
    const previousOperationId = text(compiledInput.previous_operation_id);
    const expanded = compactObservationToVerdict(compiledInput.previous_observation);
    if (expanded) compiledInput.previous_visual_verdict ??= expanded;
    delete compiledInput.previous_observation;
    if (previousOperationId && store.compactClosureDefaults) {
      const defaults = store.compactClosureDefaults(previousOperationId);
      compiledInput.previous_report ??= defaults.previous_report;
      compiledInput.previous_operation_ack ??= defaults.previous_operation_ack;
      compiledInput._compact_closure = true;
    }
  }
  const rawNextPass = compiledInput.next_pass;
  if (rawNextPass !== undefined && compiledInput.next_operation !== undefined) {
    violations.push(violation(
      'cycle',
      'competing_next_request_forms',
        'Internal compiler invariant violated: next_pass and compiled next_operation cannot coexist'
    ));
  } else if (rawNextPass !== undefined) {
    if (!rawNextPass || typeof rawNextPass !== 'object' || Array.isArray(rawNextPass)) {
      violations.push(violation(
        'cycle',
        'invalid_next_pass',
        'photoshop_guard_cycle next_pass must be an object when supplied'
      ));
    } else {
      const compact = compileCompactPass(rawNextPass as Record<string, unknown>, store, registry);
      violations.push(...compact.violations);
      if (compact.operation) compiledInput.next_operation = compact.operation;
    }
    delete compiledInput.next_pass;
  }
  const rawNextOperation = compiledInput.next_operation;
  const hasNextOperation = rawNextOperation !== undefined;
  let nextOperation: Record<string, unknown> | undefined;

  if (hasNextOperation && (!rawNextOperation || typeof rawNextOperation !== 'object' || Array.isArray(rawNextOperation))) {
    violations.push(violation(
      'cycle',
      'invalid_next_operation',
      'photoshop_guard_cycle next_operation must be an object when supplied'
    ));
  }
  if (!hasNextOperation) {
    const previousOperationId = compiledInput.previous_operation_id;
    if (typeof previousOperationId !== 'string' || !previousOperationId.trim()) {
      violations.push(violation(
        'cycle',
        'missing_cycle_operation',
        'photoshop_guard_cycle requires next_pass or previous_operation_id for close-only finalization'
      ));
    }
  }

  if (!internalStateOnlyRevalidation && compactPreviousOperationId && !compactPreviousObservationSupplied) {
    violations.push(violation(
      'finalization',
      'previous_observation_required',
      `previous_observation is required to close operation ${compactPreviousOperationId} on the compact Guard contract`
    ));
  } else {
    for (const message of store.collectClosePreviousErrors(compiledInput)) {
      violations.push(violation('finalization', 'previous_operation_finalization_invalid', message));
    }
  }

  if (hasNextOperation && rawNextOperation && typeof rawNextOperation === 'object' && !Array.isArray(rawNextOperation)) {
    const plannedPreviousOperationId = typeof compiledInput.previous_operation_id === 'string'
      ? compiledInput.previous_operation_id.trim() || undefined
      : undefined;
    const plannedPreviousVisualVerdict = !!compiledInput.previous_visual_verdict;
    const next = await compileNextOperation(
      rawNextOperation as Record<string, unknown>,
      store,
      registry,
      plannedPreviousOperationId,
      plannedPreviousVisualVerdict,
      options
    );
    nextOperation = next.operation;
    violations.push(...next.violations);
    normalizations.push(...next.normalizations);
    compiledInput.next_operation = next.operation;
  }

  const unique = uniqueViolations(violations);
  if (!unique.length) return { input: compiledInput, nextOperation, violations: [], normalizations };

  const cycleFingerprint = fingerprint(compiledInput);
  const rejectionFingerprint = fingerprint({ cycle_fingerprint: cycleFingerprint, violations: unique });
  const finalizationErrors = unique.filter((item) => item.scope === 'finalization').map((item) => item.message);
  const nextOperationErrors = unique.filter((item) => item.scope === 'next_operation').map((item) => item.message);
  const cycleErrors = unique.filter((item) => item.scope === 'cycle').map((item) => item.message);
  const errors = unique.map((item) => item.message);
  const errorCodes = [...new Set(unique.map((item) => item.code))];
  const nextArgs = nextOperation?.args && typeof nextOperation.args === 'object' && !Array.isArray(nextOperation.args)
    ? nextOperation.args as Record<string, unknown>
    : {};
  const nextDocumentId = Number.isSafeInteger(nextArgs.document_id) && Number(nextArgs.document_id) > 0
    ? Number(nextArgs.document_id)
    : undefined;
  const passContext = nextDocumentId ? store.compactPassContext?.(nextDocumentId) : undefined;
  const artDirector = passContext?.art_director && typeof passContext.art_director === 'object'
    ? passContext.art_director as Record<string, unknown>
    : undefined;
  const currentTaskId = text(artDirector?.current_task_id);
  const tasks = Array.isArray(artDirector?.tasks) ? artDirector.tasks as Array<Record<string, unknown>> : [];
  const currentTask = currentTaskId ? tasks.find(task => text(task.task_id) === currentTaskId) : undefined;
  return {
    input: compiledInput,
    nextOperation,
    violations: unique,
    normalizations,
    rejection: jsonResult({
      ok: false,
      code: 'guard_cycle_preflight_rejected',
      execution: 'not-executed',
      terminal: true,
      previous_operation_closed: false,
      next_operation_dispatched: false,
      visual_mutation_started: false,
      cycle_fingerprint: cycleFingerprint,
      rejection_fingerprint: rejectionFingerprint,
      error_codes: errorCodes,
      violations: unique,
      errors,
      normalizations,
      planner_context: artDirector ? {
        directive_id: text(artDirector.directive_id) ?? null,
        planner_task_id: currentTaskId ?? null,
        planner_task_status: text(currentTask?.status) ?? null,
      } : null,
      cycle_errors: cycleErrors,
      finalization_errors: finalizationErrors,
      next_operation_errors: nextOperationErrors,
      message: errors.join('\n'),
      next_operation_guard_debt: {
        visual_barrier: false,
        preview: false,
        visual_report: false,
        operation_ack: false,
        visual_verdict: false,
        rollback: false,
        reconciliation: false,
      },
      guard_debt: {
        visual_barrier: false,
        preview: false,
        visual_report: false,
        operation_ack: false,
        visual_verdict: false,
        rollback: false,
        reconciliation: false,
      },
      canonical_next_operation: {
        action: 'correct-and-resubmit-cycle',
        tool: typeof nextOperation?.tool === 'string' ? nextOperation.tool : null,
        replaces_rejection_fingerprint: rejectionFingerprint,
        requirement: 'Correct all listed deterministic cycle errors together, then resubmit the same semantic Guard cycle.',
      },
      compact_correction_recipe: {
        repeat_same_semantic_cycle: true,
        previous_operation_closed: false,
        photoshop_mutation_started: false,
        ...(currentTaskId ? { planner_task_id: currentTaskId } : {}),
        ...(text(currentTask?.status) ? { planner_task_status: text(currentTask?.status) } : {}),
      },
      next_required_action:
        'Correct all listed deterministic finalization and next-operation errors together, then resubmit the same Guard cycle. The previous operation was not closed and no next Photoshop operation was dispatched.',
    }, true),
  };
}
