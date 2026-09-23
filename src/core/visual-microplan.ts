import type { ToolResult } from './tool-registry.js';
import { parseEdgeIntents, type EdgeIntent } from './edge-control.js';
import { PAINTING_VISUAL_INTENTS, type PaintingVisualIntent } from './painting-method-palette.js';

export const VISUAL_MICROPLAN_ACTION_CLASSES = [
  'ADD',
  'REFINE',
  'REPLACE',
  'ERASE',
  'ROLLBACK',
] as const;

export type VisualMicroPlanActionClass = (typeof VISUAL_MICROPLAN_ACTION_CLASSES)[number];

export const VISUAL_MICROPLAN_VERDICTS = ['improvement', 'neutral', 'regression'] as const;
export type VisualMicroPlanVerdict = (typeof VISUAL_MICROPLAN_VERDICTS)[number];

export const VISUAL_MICROPLAN_TARGET_RESOLUTION = ['yes', 'no', 'uncertain'] as const;
export type VisualMicroPlanTargetResolution = (typeof VISUAL_MICROPLAN_TARGET_RESOLUTION)[number];

export const VISUAL_MICROPLAN_DISPOSITIONS = ['accept', 'correct', 'rollback'] as const;
export type VisualMicroPlanDisposition = (typeof VISUAL_MICROPLAN_DISPOSITIONS)[number];

export const VISUAL_MICROPLAN_SIGNIFICANCE_MODES = ['normal', 'subtle_local'] as const;
export type VisualMicroPlanSignificanceMode = (typeof VISUAL_MICROPLAN_SIGNIFICANCE_MODES)[number];

export const VISUAL_MICROPLAN_RISKS = ['low', 'moderate', 'high'] as const;
export type VisualMicroPlanRisk = (typeof VISUAL_MICROPLAN_RISKS)[number];

export const VISUAL_MICROPLAN_METHOD_CLASSES = [
  'paint',
  'line',
  'region',
  'smudge',
  'erase',
  'preset-brush',
  'fill',
  'rollback',
] as const;
export type VisualMicroPlanMethodClass = (typeof VISUAL_MICROPLAN_METHOD_CLASSES)[number];

export const VISUAL_MICROPLAN_LOGICAL_LAYER_DECISIONS = [
  'create-new',
  'continue-logical-layer',
  'temporary-hypothesis',
  'keep',
  'adjust',
  'discard',
  'merge',
] as const;
export type VisualMicroPlanLogicalLayerDecision = (typeof VISUAL_MICROPLAN_LOGICAL_LAYER_DECISIONS)[number];

export const VISUAL_MICROPLAN_ROLLBACK_VALUES = ['low', 'moderate', 'high'] as const;
export type VisualMicroPlanRollbackValue = (typeof VISUAL_MICROPLAN_ROLLBACK_VALUES)[number];

export const VISUAL_MICROPLAN_LAYER_CHANGE_KINDS = [
  'continuation',
  'new-object',
  'new-material',
  'new-light',
  'new-plane',
  'other',
] as const;
export type VisualMicroPlanLayerChangeKind = (typeof VISUAL_MICROPLAN_LAYER_CHANGE_KINDS)[number];

export const VISUAL_MICROPLAN_PAINTER_SCOPES = ['local', 'medium'] as const;
export type VisualMicroPlanPainterScope = (typeof VISUAL_MICROPLAN_PAINTER_SCOPES)[number];

export const VISUAL_MICROPLAN_PRESSURE_POLICIES = [
  'none',
  'native-preset',
  'simulated-size',
  'simulated-opacity',
  'simulated-size-opacity',
] as const;
export type VisualMicroPlanPressurePolicy = (typeof VISUAL_MICROPLAN_PRESSURE_POLICIES)[number];

export const VISUAL_MICROPLAN_CHANGE_DOMAINS = [
  'local-tone',
  'local-edge',
  'local-texture',
  'local-shape',
  'composition',
  'large-value',
  'lighting-structure',
  'silhouette',
  'depth-structure',
  'likeness-main-shape',
  'background-scope',
] as const;
export type VisualMicroPlanChangeDomain = (typeof VISUAL_MICROPLAN_CHANGE_DOMAINS)[number];

/**
 * Tools that may run before the one visual mutation. They can read state or
 * configure execution, but they must not alter visible canvas pixels.
 */
export const VISUAL_MICROPLAN_PREPARE_TOOLS = new Set([
  'photoshop_get_state',
  'photoshop_get_layers',
  'photoshop_select_layer_by_name',
  'photoshop_create_layer',
  'photoshop_get_history',
  'photoshop_list_brush_presets',
  'photoshop_select_brush_preset',
  'photoshop_get_brush_settings',
  'photoshop_set_brush',
  'photoshop_set_foreground_color',
  'photoshop_sample_color',
  'photoshop_measure_points',
  'photoshop_transform_landmarks',
  'photoshop_compare_landmarks',
  'photoshop_list_guides',
]);

/** One semantic micro-plan may contain a small contiguous bundle of these mutations. */
export const VISUAL_MICROPLAN_MUTATION_TOOLS = new Set([
  'photoshop_paint_strokes',
  'photoshop_paint_dabs',
  'photoshop_paint_regions',
  'photoshop_fill_layer',
  'photoshop_undo',
]);

export const VISUAL_MICROPLAN_CAPTURE_TOOL = 'photoshop_get_preview';
export const VISUAL_MICROPLAN_MAX_STEPS = 12;
export const VISUAL_MICROPLAN_MAX_MUTATIONS = 4;

export interface VisualMicroPlanStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  region?: string;
  description?: string;
  methodClass?: VisualMicroPlanMethodClass;
  risk?: VisualMicroPlanRisk;
  methodId?: string;
  edgeBoundaryIds?: string[];
}

export interface PreviousPreviewVerdict {
  sha256: string;
  observedChange: string;
  targetResolved: VisualMicroPlanTargetResolution;
  regressions: string[];
  uncertainty: string;
  verdict: VisualMicroPlanVerdict;
  disposition: VisualMicroPlanDisposition;
}

export interface VisualMicroPlan {
  planId: string;
  summary: string;
  stage: string;
  scale: string;
  region: string;
  regionBounds?: Record<string, number>;
  intent: string;
  methodClass: VisualMicroPlanMethodClass;
  risk: VisualMicroPlanRisk;
  expectedVisualDelta: string;
  verificationEnvelope: {
    mode: 'after_only' | 'before_after';
    minFocusDimensionPx?: number;
  };
  layerSeparationCheck: {
    changeKind: VisualMicroPlanLayerChangeKind;
    substantial: boolean;
    rollbackValue: VisualMicroPlanRollbackValue;
    independentAdjustmentExpected: boolean;
    reasons: string[];
    requiresIsolation: boolean;
  };
  logicalLayer?: {
    decision: VisualMicroPlanLogicalLayerDecision;
    hypothesisId: string;
    hypothesis: string;
    rollbackValue: VisualMicroPlanRollbackValue;
    expectedIndependentRollback: boolean;
    separationReasons: string[];
    layerId?: number;
    layerName?: string;
    mergeTargetLayerId?: number;
    createStepId?: string;
  };
  plannerDirectiveId?: string;
  plannerTaskId?: string;
  painterScope?: VisualMicroPlanPainterScope;
  changeDomains: VisualMicroPlanChangeDomain[];
  affectedRelations: string[];
  affectedQualities: string[];
  preservationFacts: string[];
  independentRegion: boolean;
  addressesPrimaryMismatch: boolean;
  addressesProblemId?: string;
  paintStrategy?: {
    materialRole: string;
    visualIntent: PaintingVisualIntent;
    brushRole: string;
    presetName?: string;
    pressurePolicy: VisualMicroPlanPressurePolicy;
  };
  edges: EdgeIntent[];
  problemId?: string;
  actionClass: VisualMicroPlanActionClass;
  expectedVisualResult: string;
  failureSignals: string[];
  recognitionFeatures: string[];
  styleRecognitionFeatures: string[];
  protectedRegions: string[];
  protectedLayerIds: number[];
  replaceProtectedLayerIds: number[];
  documentId: number;
  significanceMode: VisualMicroPlanSignificanceMode;
  previousPreview?: PreviousPreviewVerdict;
  steps: VisualMicroPlanStep[];
  mutationIndex: number;
  mutationIndexes: number[];
  lastMutationIndex: number;
  beforeCaptureIndex?: number;
  captureIndex: number;
}

const PLACEHOLDER_RE = /^\$steps\.([^.]+)(?:\.(.+))?$/;

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value.trim();
}

function parseStringArray(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of strings`);
  return value.map((item, index) => requireString(item, `${name}[${index}]`));
}

function parseEnum<T extends readonly string[]>(value: unknown, name: string, values: T): T[number] {
  const parsed = requireString(value, name).toLowerCase();
  if (!values.includes(parsed as T[number])) {
    throw new Error(`${name} must be one of ${values.join(', ')}`);
  }
  return parsed as T[number];
}

function methodClassForStep(step: VisualMicroPlanStep): VisualMicroPlanMethodClass | undefined {
  if (step.tool === 'photoshop_undo') return 'rollback';
  if (step.tool === 'photoshop_fill_layer') return 'fill';
  if (step.tool === 'photoshop_paint_regions') return 'region';
  if (step.tool === 'photoshop_paint_dabs') return 'paint';
  if (step.tool === 'photoshop_paint_strokes') {
    const strokes = step.args.strokes;
    if (!Array.isArray(strokes) || strokes.length === 0) return undefined;
    const modes = new Set(strokes.map(stroke => {
      if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)) return 'INVALID';
      const raw = (stroke as Record<string, unknown>).tool;
      return typeof raw === 'string' && raw.trim() ? raw.trim().toUpperCase() : 'BRUSH';
    }));
    if (modes.size !== 1) return undefined;
    const mode = [...modes][0];
    if (mode === 'PENCIL') return 'line';
    if (mode === 'SMUDGE') return 'smudge';
    if (mode === 'ERASER') return 'erase';
    if (mode === 'BRUSH') return 'paint';
  }
  return undefined;
}

function riskRank(risk: VisualMicroPlanRisk): number {
  return VISUAL_MICROPLAN_RISKS.indexOf(risk);
}

function positiveInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function rawMutationTargetRefs(step: VisualMicroPlanStep): unknown[] {
  if (step.tool === 'photoshop_paint_regions') {
    const regions = step.args.regions;
    if (!Array.isArray(regions)) return [];
    return regions.map(region =>
      region && typeof region === 'object' && !Array.isArray(region)
        ? (region as Record<string, unknown>).layer_id
        : undefined
    );
  }
  return [step.args.layer_id];
}

function parsePositiveIntegerArray(value: unknown, name: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${name} must be an array of positive integers`);
  const seen = new Set<number>();
  return value.map((item, index) => {
    if (typeof item !== 'number' || !Number.isSafeInteger(item) || item <= 0) {
      throw new Error(`${name}[${index}] must be a positive integer`);
    }
    if (seen.has(item)) throw new Error(`${name} must not contain duplicate layer ids`);
    seen.add(item);
    return item;
  });
}

function isRecognitionBlockInStage(stage: string): boolean {
  return stage.trim().toUpperCase().replace(/[\s-]+/g, '_') === 'RECOGNITION_BLOCK_IN';
}

function isRegionBlockInStage(stage: string): boolean {
  const normalized = stage.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return normalized === 'RECOGNITION_BLOCK_IN'
    || normalized === 'COMPOSITION'
    || normalized === 'SHAPE'
    || normalized === 'GLOBAL_BLOCK_IN';
}

function parseArgsObject(value: unknown, name: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function focusRegion(args: Record<string, unknown>, name: string): Record<string, number> | undefined {
  const value = args.focus_region;
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name}.focus_region must be an object`);
  }
  const source = value as Record<string, unknown>;
  const region = {
    left: Number(source.left),
    top: Number(source.top),
    right: Number(source.right),
    bottom: Number(source.bottom),
  };
  if (!Object.values(region).every(Number.isFinite) || region.right <= region.left || region.bottom <= region.top) {
    throw new Error(`${name}.focus_region must contain finite positive bounds`);
  }
  return region;
}

function sameFocusRegion(a: Record<string, number>, b: Record<string, number>): boolean {
  return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
}

function requiresLocalInspection(scale: string, significanceMode: VisualMicroPlanSignificanceMode): boolean {
  return significanceMode === 'subtle_local' || /(^|[-_\s])(small|micro|detail|local)([-_\s]|$)/i.test(scale);
}

function parsePreviousPreview(value: unknown): PreviousPreviewVerdict | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('previous_preview must be an object');
  }
  const record = value as Record<string, unknown>;
  const sha256 = requireString(record.sha256, 'previous_preview.sha256');
  const observedChange = requireString(record.observed_change, 'previous_preview.observed_change');
  const targetResolved = requireString(record.target_resolved, 'previous_preview.target_resolved').toLowerCase();
  if (!VISUAL_MICROPLAN_TARGET_RESOLUTION.includes(targetResolved as VisualMicroPlanTargetResolution)) {
    throw new Error(
      `previous_preview.target_resolved must be one of ${VISUAL_MICROPLAN_TARGET_RESOLUTION.join(', ')}`
    );
  }
  const regressions = parseStringArray(record.regressions, 'previous_preview.regressions');
  const uncertainty = requireString(record.uncertainty, 'previous_preview.uncertainty');
  const verdict = requireString(record.verdict, 'previous_preview.verdict');
  const disposition = requireString(record.disposition, 'previous_preview.disposition');
  if (!VISUAL_MICROPLAN_VERDICTS.includes(verdict as VisualMicroPlanVerdict)) {
    throw new Error(`previous_preview.verdict must be one of ${VISUAL_MICROPLAN_VERDICTS.join(', ')}`);
  }
  if (!VISUAL_MICROPLAN_DISPOSITIONS.includes(disposition as VisualMicroPlanDisposition)) {
    throw new Error(
      `previous_preview.disposition must be one of ${VISUAL_MICROPLAN_DISPOSITIONS.join(', ')}`
    );
  }
  if (verdict === 'regression' && disposition === 'accept') {
    throw new Error('a regression preview cannot be accepted; use correct or rollback');
  }
  return {
    sha256,
    observedChange,
    targetResolved: targetResolved as VisualMicroPlanTargetResolution,
    regressions,
    uncertainty,
    verdict: verdict as VisualMicroPlanVerdict,
    disposition: disposition as VisualMicroPlanDisposition,
  };
}

function visitPlaceholderStrings(value: unknown, visitor: (value: string) => void): void {
  if (typeof value === 'string') {
    visitor(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitPlaceholderStrings(item, visitor);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      visitPlaceholderStrings(item, visitor);
    }
  }
}

function validateBackwardReferences(steps: VisualMicroPlanStep[]): void {
  const positions = new Map<string, number>();
  steps.forEach((step, index) => positions.set(step.id, index));

  steps.forEach((step, index) => {
    visitPlaceholderStrings(step.args, (value) => {
      const match = PLACEHOLDER_RE.exec(value);
      if (!match) return;
      const referencedId = match[1]!;
      const referencedIndex = positions.get(referencedId);
      if (referencedIndex === undefined) {
        throw new Error(`step "${step.id}" references unknown step "${referencedId}"`);
      }
      if (referencedIndex >= index) {
        throw new Error(`step "${step.id}" may reference only an earlier step, not "${referencedId}"`);
      }
    });
  });
}

export function parseVisualMicroPlan(args: Record<string, unknown>): VisualMicroPlan {
  const documentId = args.document_id;
  if (
    typeof documentId !== 'number' ||
    !Number.isFinite(documentId) ||
    !Number.isInteger(documentId) ||
    documentId <= 0
  ) {
    throw new Error('document_id is required and must be a positive integer');
  }

  const planId = requireString(args.plan_id, 'plan_id');
  const summary = requireString(args.summary, 'summary');
  const stage = requireString(args.stage, 'stage');
  const scale = requireString(args.scale, 'scale');
  const region = requireString(args.region, 'region');
  const regionBounds = args.region_bounds === undefined ? undefined : focusRegion({ focus_region: args.region_bounds }, 'region_bounds');
  const intent = requireString(args.intent, 'intent');
  const methodClass = parseEnum(args.method_class, 'method_class', VISUAL_MICROPLAN_METHOD_CLASSES) as VisualMicroPlanMethodClass;
  const risk = parseEnum(args.risk, 'risk', VISUAL_MICROPLAN_RISKS) as VisualMicroPlanRisk;
  const expectedVisualDelta = requireString(args.expected_visual_delta, 'expected_visual_delta');
  const edges = parseEdgeIntents(args.edges);
  const plannerDirectiveId = args.planner_directive_id === undefined
    ? undefined
    : requireString(args.planner_directive_id, 'planner_directive_id');
  const plannerTaskId = args.planner_task_id === undefined
    ? undefined
    : requireString(args.planner_task_id, 'planner_task_id');
  if ((plannerDirectiveId && !plannerTaskId) || (!plannerDirectiveId && plannerTaskId)) {
    throw new Error('planner_directive_id and planner_task_id must be supplied together');
  }
  const painterScope = args.painter_scope === undefined
    ? undefined
    : parseEnum(args.painter_scope, 'painter_scope', VISUAL_MICROPLAN_PAINTER_SCOPES) as VisualMicroPlanPainterScope;
  if ((plannerDirectiveId || plannerTaskId) && !painterScope) {
    throw new Error('Painter-bound VisualMicroPlan requires painter_scope');
  }
  const changeDomains = args.change_domains === undefined
    ? []
    : parseStringArray(args.change_domains, 'change_domains').map((value, index) => {
        const parsed = value.toLowerCase();
        if (!VISUAL_MICROPLAN_CHANGE_DOMAINS.includes(parsed as VisualMicroPlanChangeDomain)) {
          throw new Error(`change_domains[${index}] must be one of ${VISUAL_MICROPLAN_CHANGE_DOMAINS.join(', ')}`);
        }
        return parsed as VisualMicroPlanChangeDomain;
      });
  const affectedRelations = args.affected_relations === undefined
    ? []
    : parseStringArray(args.affected_relations, 'affected_relations');
  const affectedQualities = args.affected_qualities === undefined
    ? []
    : parseStringArray(args.affected_qualities, 'affected_qualities');
  const preservationFacts = args.preservation_facts === undefined
    ? []
    : parseStringArray(args.preservation_facts, 'preservation_facts');
  const independentRegion = args.independent_region === true;
  if (args.independent_region !== undefined && typeof args.independent_region !== 'boolean') {
    throw new Error('independent_region must be boolean');
  }
  const addressesPrimaryMismatch = args.addresses_primary_mismatch === true;
  if (args.addresses_primary_mismatch !== undefined && typeof args.addresses_primary_mismatch !== 'boolean') {
    throw new Error('addresses_primary_mismatch must be boolean');
  }
  const addressesProblemId = args.addresses_problem_id === undefined
    ? undefined
    : requireString(args.addresses_problem_id, 'addresses_problem_id');
  if ((plannerDirectiveId || plannerTaskId) && changeDomains.length === 0) {
    throw new Error('Painter-bound VisualMicroPlan requires at least one change_domains entry');
  }
  let paintStrategy: VisualMicroPlan['paintStrategy'];
  if (args.paint_strategy !== undefined) {
    const raw = parseArgsObject(args.paint_strategy, 'paint_strategy');
    const visualIntent = parseEnum(
      raw.visual_intent,
      'paint_strategy.visual_intent',
      PAINTING_VISUAL_INTENTS
    ) as PaintingVisualIntent;
    const pressurePolicy = parseEnum(
      raw.pressure_policy,
      'paint_strategy.pressure_policy',
      VISUAL_MICROPLAN_PRESSURE_POLICIES
    ) as VisualMicroPlanPressurePolicy;
    paintStrategy = {
      materialRole: requireString(raw.material_role, 'paint_strategy.material_role'),
      visualIntent,
      brushRole: requireString(raw.brush_role, 'paint_strategy.brush_role'),
      ...(raw.preset_name === undefined ? {} : { presetName: requireString(raw.preset_name, 'paint_strategy.preset_name') }),
      pressurePolicy,
    };
  }
  const verificationRaw = parseArgsObject(args.verification_envelope, 'verification_envelope');
  const verificationMode = parseEnum(
    verificationRaw.mode,
    'verification_envelope.mode',
    ['after_only', 'before_after'] as const
  ) as 'after_only' | 'before_after';
  const minFocusDimensionPxRaw = verificationRaw.min_focus_dimension_px;
  const minFocusDimensionPx = minFocusDimensionPxRaw === undefined ? undefined : Number(minFocusDimensionPxRaw);
  if (minFocusDimensionPx !== undefined && (!Number.isFinite(minFocusDimensionPx) || minFocusDimensionPx <= 0)) {
    throw new Error('verification_envelope.min_focus_dimension_px must be a positive number');
  }

  const separationRaw = parseArgsObject(args.layer_separation_check, 'layer_separation_check');
  const separationChangeKind = parseEnum(
    separationRaw.change_kind,
    'layer_separation_check.change_kind',
    VISUAL_MICROPLAN_LAYER_CHANGE_KINDS
  ) as VisualMicroPlanLayerChangeKind;
  if (typeof separationRaw.substantial !== 'boolean') {
    throw new Error('layer_separation_check.substantial must be boolean');
  }
  const separationRollbackValue = parseEnum(
    separationRaw.rollback_value,
    'layer_separation_check.rollback_value',
    VISUAL_MICROPLAN_ROLLBACK_VALUES
  ) as VisualMicroPlanRollbackValue;
  if (typeof separationRaw.independent_adjustment_expected !== 'boolean') {
    throw new Error('layer_separation_check.independent_adjustment_expected must be boolean');
  }
  const separationReasons = parseStringArray(
    separationRaw.reasons,
    'layer_separation_check.reasons'
  );
  if (!separationReasons.length) {
    throw new Error('layer_separation_check.reasons requires at least one concrete reason');
  }
  const independentNewKinds = new Set<VisualMicroPlanLayerChangeKind>([
    'new-object',
    'new-material',
    'new-light',
    'new-plane',
  ]);
  const requiresIsolation =
    separationRaw.substantial &&
    independentNewKinds.has(separationChangeKind) &&
    (separationRollbackValue !== 'low' || separationRaw.independent_adjustment_expected);
  const layerSeparationCheck: VisualMicroPlan['layerSeparationCheck'] = {
    changeKind: separationChangeKind,
    substantial: separationRaw.substantial,
    rollbackValue: separationRollbackValue,
    independentAdjustmentExpected: separationRaw.independent_adjustment_expected,
    reasons: separationReasons,
    requiresIsolation,
  };

  let logicalLayer: VisualMicroPlan['logicalLayer'];
  if (args.logical_layer !== undefined) {
    const raw = parseArgsObject(args.logical_layer, 'logical_layer');
    const decision = parseEnum(
      raw.decision,
      'logical_layer.decision',
      VISUAL_MICROPLAN_LOGICAL_LAYER_DECISIONS
    ) as VisualMicroPlanLogicalLayerDecision;
    const hypothesisId = requireString(raw.hypothesis_id, 'logical_layer.hypothesis_id');
    const hypothesis = requireString(raw.hypothesis, 'logical_layer.hypothesis');
    const rollbackValue = parseEnum(
      raw.rollback_value,
      'logical_layer.rollback_value',
      VISUAL_MICROPLAN_ROLLBACK_VALUES
    ) as VisualMicroPlanRollbackValue;
    if (typeof raw.expected_independent_rollback !== 'boolean') {
      throw new Error('logical_layer.expected_independent_rollback must be boolean');
    }
    logicalLayer = {
      decision,
      hypothesisId,
      hypothesis,
      rollbackValue,
      expectedIndependentRollback: raw.expected_independent_rollback,
      separationReasons: parseStringArray(raw.separation_reasons, 'logical_layer.separation_reasons'),
      ...(positiveInteger(raw.layer_id, 'logical_layer.layer_id') === undefined ? {} : { layerId: positiveInteger(raw.layer_id, 'logical_layer.layer_id') }),
      ...(raw.layer_name === undefined ? {} : { layerName: requireString(raw.layer_name, 'logical_layer.layer_name') }),
      ...(positiveInteger(raw.merge_target_layer_id, 'logical_layer.merge_target_layer_id') === undefined
        ? {}
        : { mergeTargetLayerId: positiveInteger(raw.merge_target_layer_id, 'logical_layer.merge_target_layer_id') }),
    };
  }

  if (logicalLayer && logicalLayer.rollbackValue !== layerSeparationCheck.rollbackValue) {
    throw new Error(
      'layer_separation_check.rollback_value must match logical_layer.rollback_value when a logical layer is declared'
    );
  }
  if (
    layerSeparationCheck.requiresIsolation &&
    (!logicalLayer ||
      (logicalLayer.decision !== 'create-new' &&
        logicalLayer.decision !== 'temporary-hypothesis'))
  ) {
    throw new Error(
      'Layer Separation Check requires logical_layer.decision=create-new or temporary-hypothesis before this substantial independent change'
    );
  }
  const problemId = args.problem_id === undefined ? undefined : requireString(args.problem_id, 'problem_id');
  const significanceModeRaw = args.significance_mode === undefined
    ? 'normal'
    : requireString(args.significance_mode, 'significance_mode').toLowerCase();
  if (!VISUAL_MICROPLAN_SIGNIFICANCE_MODES.includes(significanceModeRaw as VisualMicroPlanSignificanceMode)) {
    throw new Error(`significance_mode must be one of ${VISUAL_MICROPLAN_SIGNIFICANCE_MODES.join(', ')}`);
  }
  const significanceMode = significanceModeRaw as VisualMicroPlanSignificanceMode;
  if (significanceMode === 'subtle_local' && !problemId) {
    throw new Error('subtle_local VisualMicroPlan requires problem_id');
  }
  const actionClassRaw = requireString(args.action_class, 'action_class').toUpperCase();
  if (!VISUAL_MICROPLAN_ACTION_CLASSES.includes(actionClassRaw as VisualMicroPlanActionClass)) {
    throw new Error(`action_class must be one of ${VISUAL_MICROPLAN_ACTION_CLASSES.join(', ')}`);
  }
  const expectedVisualResult = requireString(
    args.expected_visual_result,
    'expected_visual_result'
  );
  const failureSignals = parseStringArray(args.failure_signals, 'failure_signals');
  const recognitionFeatures = parseStringArray(args.recognition_features, 'recognition_features');
  const styleRecognitionFeatures = parseStringArray(
    args.style_recognition_features,
    'style_recognition_features'
  );
  const protectedRegions = parseStringArray(args.protected_regions, 'protected_regions');
  const protectedLayerIds = parsePositiveIntegerArray(args.protected_layer_ids, 'protected_layer_ids');
  const replaceProtectedLayerIds = parsePositiveIntegerArray(
    args.replace_protected_layer_ids,
    'replace_protected_layer_ids'
  );
  for (const layerId of replaceProtectedLayerIds) {
    if (!protectedLayerIds.includes(layerId)) {
      throw new Error('replace_protected_layer_ids may contain only ids also declared in protected_layer_ids');
    }
  }
  const previousPreview = parsePreviousPreview(args.previous_preview);

  if (isRecognitionBlockInStage(stage)) {
    if (scale.toLowerCase() !== 'global') {
      throw new Error('recognition block-in must use scale=global because recognizability is a whole-image objective');
    }
    if (recognitionFeatures.length < 3 || recognitionFeatures.length > 7) {
      throw new Error('recognition block-in requires 3-7 recognition_features');
    }
  }

  if (!Array.isArray(args.steps)) throw new Error('steps must be an array');
  if (args.steps.length < 2 || args.steps.length > VISUAL_MICROPLAN_MAX_STEPS) {
    throw new Error(`steps must contain 2-${VISUAL_MICROPLAN_MAX_STEPS} entries`);
  }

  const seenIds = new Set<string>();
  const steps = args.steps.map((value, index): VisualMicroPlanStep => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`steps[${index}] must be an object`);
    }
    const record = value as Record<string, unknown>;
    const id = requireString(record.id, `steps[${index}].id`);
    if (seenIds.has(id)) throw new Error(`duplicate step id "${id}"`);
    seenIds.add(id);
    const tool = requireString(record.tool, `steps[${index}].tool`);
    const allowed =
      VISUAL_MICROPLAN_PREPARE_TOOLS.has(tool) ||
      VISUAL_MICROPLAN_MUTATION_TOOLS.has(tool) ||
      tool === VISUAL_MICROPLAN_CAPTURE_TOOL;
    if (!allowed) {
      throw new Error(`tool "${tool}" is not allowed inside a VisualMicroPlan`);
    }
    return {
      id,
      tool,
      args: parseArgsObject(record.args, `steps[${index}].args`),
      ...(record.region === undefined ? {} : { region: requireString(record.region, `steps[${index}].region`) }),
      ...(record.description === undefined ? {} : { description: requireString(record.description, `steps[${index}].description`) }),
      ...(record.method_class === undefined ? {} : {
        methodClass: parseEnum(record.method_class, `steps[${index}].method_class`, VISUAL_MICROPLAN_METHOD_CLASSES) as VisualMicroPlanMethodClass,
      }),
      ...(record.risk === undefined ? {} : {
        risk: parseEnum(record.risk, `steps[${index}].risk`, VISUAL_MICROPLAN_RISKS) as VisualMicroPlanRisk,
      }),
      ...(record.method_id === undefined ? {} : { methodId: requireString(record.method_id, `steps[${index}].method_id`) }),
      ...(record.edge_boundary_ids === undefined ? {} : {
        edgeBoundaryIds: parseStringArray(record.edge_boundary_ids, `steps[${index}].edge_boundary_ids`),
      }),
    };
  });

  validateBackwardReferences(steps);

  const mutationIndexes = steps
    .map((step, index) => (VISUAL_MICROPLAN_MUTATION_TOOLS.has(step.tool) ? index : -1))
    .filter((index) => index >= 0);
  if (mutationIndexes.length < 1 || mutationIndexes.length > VISUAL_MICROPLAN_MAX_MUTATIONS) {
    throw new Error(`VisualMicroPlan requires 1-${VISUAL_MICROPLAN_MAX_MUTATIONS} visual mutations; found ${mutationIndexes.length}`);
  }
  const mutationIndex = mutationIndexes[0]!;
  const lastMutationIndex = mutationIndexes[mutationIndexes.length - 1]!;
  const captureIndex = steps.length - 1;
  if (steps[captureIndex]!.tool !== VISUAL_MICROPLAN_CAPTURE_TOOL) {
    throw new Error('the final VisualMicroPlan step must be photoshop_get_preview');
  }
  const captureIndexes = steps
    .map((step, index) => (step.tool === VISUAL_MICROPLAN_CAPTURE_TOOL ? index : -1))
    .filter((index) => index >= 0);
  if (captureIndexes.length > 2) throw new Error('VisualMicroPlan allows at most one before preview plus the final preview');
  const beforeCaptureIndex = captureIndexes.length === 2 ? captureIndexes[0] : undefined;
  if (lastMutationIndex !== captureIndex - 1) {
    throw new Error('the final visual mutation must be immediately followed by the final preview');
  }
  if (mutationIndexes.some(index => steps[index]!.tool === 'photoshop_paint_regions') && !isRegionBlockInStage(stage)) {
    throw new Error(
      'photoshop_paint_regions is a temporary block-in scaffold and is allowed only in RECOGNITION_BLOCK_IN, COMPOSITION, SHAPE, or GLOBAL_BLOCK_IN; use brush/form/edge/material methods for later stages'
    );
  }
  if (beforeCaptureIndex !== undefined && beforeCaptureIndex !== mutationIndex - 1) {
    throw new Error('the optional before preview must be immediately before the visual mutation');
  }

  if (logicalLayer) {
    const createSteps = steps
      .slice(0, mutationIndex)
      .filter(step => step.tool === 'photoshop_create_layer');
    const isCreateDecision = logicalLayer.decision === 'create-new' || logicalLayer.decision === 'temporary-hypothesis';
    const isContinueDecision = logicalLayer.decision === 'continue-logical-layer' || logicalLayer.decision === 'adjust';

    if (isCreateDecision) {
      if (!logicalLayer.expectedIndependentRollback) {
        throw new Error('create-new/temporary-hypothesis requires expected_independent_rollback=true');
      }
      if (!logicalLayer.separationReasons.length) {
        throw new Error('create-new/temporary-hypothesis requires at least one separation_reasons entry');
      }
      if (!logicalLayer.layerName) {
        throw new Error('create-new/temporary-hypothesis requires logical_layer.layer_name');
      }
      if (logicalLayer.layerId !== undefined) {
        throw new Error('create-new/temporary-hypothesis must not supply an existing logical_layer.layer_id');
      }
      if (createSteps.length !== 1) {
        throw new Error('anti-layer-explosion: create-new/temporary-hypothesis requires exactly one photoshop_create_layer step');
      }
      const createStep = createSteps[0]!;
      const createName = typeof createStep.args.name === 'string' ? createStep.args.name.trim() : '';
      if (createName !== logicalLayer.layerName) {
        throw new Error('logical_layer.layer_name must match the photoshop_create_layer step name');
      }
      logicalLayer.createStepId = createStep.id;
      const expectedRef = `$steps.${createStep.id}.details.layerId`;
      for (const index of mutationIndexes) {
        for (const ref of rawMutationTargetRefs(steps[index]!)) {
          if (ref !== expectedRef) {
            throw new Error(`new logical layer mutations must target ${expectedRef}; unrelated targets must be split`);
          }
        }
      }
    } else if (isContinueDecision) {
      if (!logicalLayer.layerId) {
        throw new Error('continue-logical-layer/adjust requires logical_layer.layer_id');
      }
      if (createSteps.length) {
        throw new Error('anti-layer-explosion: continuing/adjusting a logical layer must not create another layer');
      }
      for (const index of mutationIndexes) {
        for (const ref of rawMutationTargetRefs(steps[index]!)) {
          if (ref !== logicalLayer.layerId) {
            throw new Error(`continue-logical-layer/adjust mutations must target logical_layer.layer_id=${logicalLayer.layerId}`);
          }
        }
      }
    } else if (logicalLayer.decision === 'keep' || logicalLayer.decision === 'discard' || logicalLayer.decision === 'merge') {
      throw new Error(`logical_layer.decision=${logicalLayer.decision} is a lifecycle decision; use the guarded layer lifecycle tool rather than hiding it inside a paint micro-plan`);
    }
  }

  for (let index = 0; index < mutationIndex; index++) {
    if (index !== beforeCaptureIndex && !VISUAL_MICROPLAN_PREPARE_TOOLS.has(steps[index]!.tool)) {
      throw new Error(`step "${steps[index]!.id}" is not a permitted preparation step`);
    }
  }

  const hasSelectedBrushPreset = steps
    .slice(0, mutationIndex)
    .some(step => step.tool === 'photoshop_select_brush_preset');
  if (methodClass === 'preset-brush') {
    if (!paintStrategy) {
      throw new Error('method_class=preset-brush requires paint_strategy');
    }
    if (!paintStrategy.presetName) {
      throw new Error('method_class=preset-brush requires paint_strategy.preset_name');
    }
    const selectedPreset = [...steps.slice(0, mutationIndex)]
      .reverse()
      .find(step => step.tool === 'photoshop_select_brush_preset');
    if (!selectedPreset || selectedPreset.args.name !== paintStrategy.presetName) {
      throw new Error('paint_strategy.preset_name must match the selected Photoshop brush preset before mutation');
    }
    if (mutationIndexes.some(index => !steps[index]!.methodId)) {
      throw new Error('preset-brush mutation steps must declare method_id');
    }
  }
  for (let index = mutationIndex; index <= lastMutationIndex; index++) {
    const step = steps[index]!;
    if (!VISUAL_MICROPLAN_MUTATION_TOOLS.has(step.tool)) {
      throw new Error('visual mutations must form one contiguous bounded transaction with no preparation/read steps between them');
    }
    if (step.region !== undefined && step.region !== region) {
      throw new Error(`step "${step.id}" region must match micro-plan region "${region}"`);
    }
    const actualMethodClass = methodClassForStep(step);
    const declaredMethodClass = step.methodClass ?? methodClass;
    const presetBrushCompatible =
      methodClass === 'preset-brush' &&
      hasSelectedBrushPreset &&
      step.tool === 'photoshop_paint_strokes' &&
      actualMethodClass === 'paint';
    if (declaredMethodClass !== methodClass || (!presetBrushCompatible && actualMethodClass !== methodClass)) {
      throw new Error(`step "${step.id}" method class is incompatible with micro-plan method_class=${methodClass}`);
    }
    if (step.risk !== undefined && riskRank(step.risk) > riskRank(risk)) {
      throw new Error(`step "${step.id}" risk=${step.risk} cannot be hidden inside micro-plan risk=${risk}`);
    }
  }
  if (edges.length) {
    const edgeIds = new Set(edges.map(edge => edge.boundaryId));
    const referenced = new Set<string>();
    for (const index of mutationIndexes) {
      const step = steps[index]!;
      for (const boundaryId of step.edgeBoundaryIds ?? []) {
        if (!edgeIds.has(boundaryId)) throw new Error(`step "${step.id}" references unknown edge boundary_id ${boundaryId}`);
        referenced.add(boundaryId);
        if (!step.methodId) throw new Error(`step "${step.id}" must declare method_id when edge_boundary_ids are present`);
      }
    }
    const unbound = [...edgeIds].filter(boundaryId => !referenced.has(boundaryId));
    if (unbound.length) throw new Error(`every edge intent must bind to at least one mutation step; missing: ${unbound.join(', ')}`);
  }

  if (paintStrategy && paintStrategy.pressurePolicy.startsWith('simulated-')) {
    const strokes = mutationIndexes
      .flatMap(index => Array.isArray(steps[index]!.args.strokes) ? steps[index]!.args.strokes as unknown[] : [])
      .filter(value => value && typeof value === 'object' && !Array.isArray(value)) as Array<Record<string, unknown>>;
    if (!strokes.length) {
      throw new Error('simulated pressure policy requires photoshop_paint_strokes');
    }
    const hasSize = strokes.some(stroke => {
      const dynamics = stroke.dynamics;
      return stroke.simulate_pressure === true
        || (!!dynamics && typeof dynamics === 'object' && !Array.isArray(dynamics) && Array.isArray((dynamics as Record<string, unknown>).size));
    });
    const hasOpacity = strokes.some(stroke => {
      const dynamics = stroke.dynamics;
      return stroke.simulate_pressure === true
        || (!!dynamics && typeof dynamics === 'object' && !Array.isArray(dynamics) && Array.isArray((dynamics as Record<string, unknown>).opacity));
    });
    if ((paintStrategy.pressurePolicy === 'simulated-size' || paintStrategy.pressurePolicy === 'simulated-size-opacity') && !hasSize) {
      throw new Error('simulated size pressure requires simulate_pressure=true or stroke dynamics.size');
    }
    if ((paintStrategy.pressurePolicy === 'simulated-opacity' || paintStrategy.pressurePolicy === 'simulated-size-opacity') && !hasOpacity) {
      throw new Error('simulated opacity pressure requires simulate_pressure=true or stroke dynamics.opacity');
    }
  }

  const previewArgs = steps[captureIndex]!.args;
  if (previewArgs.include_image === false && typeof previewArgs.materialize_path !== 'string') {
    throw new Error('VisualMicroPlan preview must include the image or materialize it for inspection');
  }
  if (beforeCaptureIndex !== undefined) {
    const beforeArgs = steps[beforeCaptureIndex]!.args;
    if (beforeArgs.include_image === false && typeof beforeArgs.materialize_path !== 'string') {
      throw new Error('VisualMicroPlan before preview must include the image or materialize it for inspection');
    }
  }

  if (requiresLocalInspection(scale, significanceMode)) {
    if (beforeCaptureIndex === undefined) {
      throw new Error('small/local VisualMicroPlan requires an immediately-before preview for visual significance measurement');
    }
    const beforeArgs = steps[beforeCaptureIndex]!.args;
    const beforeFocus = focusRegion(beforeArgs, 'before preview');
    const afterFocus = focusRegion(previewArgs, 'final preview');
    if (!beforeFocus || !afterFocus) {
      throw new Error('small/local VisualMicroPlan requires focus_region on both before and final previews');
    }
    if (!sameFocusRegion(beforeFocus, afterFocus)) {
      throw new Error('small/local VisualMicroPlan requires the same focus_region before and after mutation');
    }
    const beforeMax = Number(beforeArgs.focus_max_dimension_px ?? 1200);
    const afterMax = Number(previewArgs.focus_max_dimension_px ?? 1200);
    if (beforeMax < 800 || afterMax < 800) {
      throw new Error('small/local VisualMicroPlan requires focus_max_dimension_px >= 800 for local inspection');
    }
    if (verificationMode !== 'before_after') {
      throw new Error('small/local VisualMicroPlan requires verification_envelope.mode=before_after');
    }
    if ((minFocusDimensionPx ?? 800) < 800) {
      throw new Error('small/local VisualMicroPlan requires verification_envelope.min_focus_dimension_px >= 800');
    }
  }

  const actionClass = actionClassRaw as VisualMicroPlanActionClass;
  if (replaceProtectedLayerIds.length && actionClass !== 'REPLACE' && actionClass !== 'ERASE') {
    throw new Error('replace_protected_layer_ids requires action_class=REPLACE or ERASE');
  }
  const mutationTool = steps[mutationIndex]!.tool;
  if (actionClass === 'ROLLBACK' && (mutationIndexes.length !== 1 || mutationTool !== 'photoshop_undo')) {
    throw new Error('ROLLBACK micro-plans must use photoshop_undo as their visual mutation');
  }
  if (mutationIndexes.some(index => steps[index]!.tool === 'photoshop_undo') && actionClass !== 'ROLLBACK') {
    throw new Error('photoshop_undo is allowed only for action_class=ROLLBACK');
  }

  return {
    planId,
    summary,
    stage,
    scale,
    region,
    regionBounds,
    intent,
    methodClass,
    risk,
    expectedVisualDelta,
    verificationEnvelope: {
      mode: verificationMode,
      ...(minFocusDimensionPx === undefined ? {} : { minFocusDimensionPx }),
    },
    layerSeparationCheck,
    logicalLayer,
    plannerDirectiveId,
    plannerTaskId,
    painterScope,
    changeDomains,
    affectedRelations,
    affectedQualities,
    preservationFacts,
    independentRegion,
    addressesPrimaryMismatch,
    addressesProblemId,
    paintStrategy,
    edges,
    problemId,
    actionClass,
    expectedVisualResult,
    failureSignals,
    recognitionFeatures,
    styleRecognitionFeatures,
    protectedRegions,
    protectedLayerIds,
    replaceProtectedLayerIds,
    documentId,
    significanceMode,
    previousPreview,
    steps,
    mutationIndex,
    mutationIndexes,
    lastMutationIndex,
    beforeCaptureIndex,
    captureIndex,
  };
}

function getByPath(root: unknown, path: string): unknown {
  let current = root;
  for (const key of path.split('.')) {
    if (current == null || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export function resolveVisualMicroPlanArgs(
  value: unknown,
  results: Record<string, unknown>
): unknown {
  if (typeof value === 'string') {
    const match = PLACEHOLDER_RE.exec(value);
    if (!match) return value;
    const stepId = match[1]!;
    if (!Object.prototype.hasOwnProperty.call(results, stepId)) {
      throw new Error(`step "${stepId}" has no result yet for placeholder "${value}"`);
    }
    const path = match[2];
    const resolved = path ? getByPath(results[stepId], path) : results[stepId];
    if (resolved === undefined) {
      throw new Error(`placeholder path "${path ?? ''}" was not found in step "${stepId}"`);
    }
    return resolved;
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveVisualMicroPlanArgs(item, results));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = resolveVisualMicroPlanArgs(item, results);
    }
    return out;
  }
  return value;
}

/** Extract a compact JSON-like root for later `$steps.*` references. */
export function normalizeToolResultForPlaceholders(result: ToolResult): unknown {
  const texts = result.content
    .filter((item): item is Extract<ToolResult['content'][number], { type: 'text' }> => item.type === 'text')
    .map((item) => item.text);

  for (const text of texts) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Try the next text block; preview results contain image + JSON metadata.
    }
  }

  return { text: texts.join('\n'), is_error: result.isError === true };
}
