import type { ToolResult } from './tool-registry.js';

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

export const VISUAL_MICROPLAN_DISPOSITIONS = ['accept', 'correct', 'rollback'] as const;
export type VisualMicroPlanDisposition = (typeof VISUAL_MICROPLAN_DISPOSITIONS)[number];

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

/** One micro-plan may contain exactly one of these visible mutations. */
export const VISUAL_MICROPLAN_MUTATION_TOOLS = new Set([
  'photoshop_paint_strokes',
  'photoshop_paint_dabs',
  'photoshop_fill_layer',
  'photoshop_undo',
]);

export const VISUAL_MICROPLAN_CAPTURE_TOOL = 'photoshop_get_preview';
export const VISUAL_MICROPLAN_MAX_STEPS = 12;

export interface VisualMicroPlanStep {
  id: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface PreviousPreviewVerdict {
  sha256: string;
  verdict: VisualMicroPlanVerdict;
  disposition: VisualMicroPlanDisposition;
}

export interface VisualMicroPlan {
  planId: string;
  summary: string;
  stage: string;
  scale: string;
  region: string;
  actionClass: VisualMicroPlanActionClass;
  expectedVisualResult: string;
  protectedRegions: string[];
  documentId: number;
  previousPreview?: PreviousPreviewVerdict;
  steps: VisualMicroPlanStep[];
  mutationIndex: number;
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

function parseArgsObject(value: unknown, name: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function parsePreviousPreview(value: unknown): PreviousPreviewVerdict | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('previous_preview must be an object');
  }
  const record = value as Record<string, unknown>;
  const sha256 = requireString(record.sha256, 'previous_preview.sha256');
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
  const actionClassRaw = requireString(args.action_class, 'action_class').toUpperCase();
  if (!VISUAL_MICROPLAN_ACTION_CLASSES.includes(actionClassRaw as VisualMicroPlanActionClass)) {
    throw new Error(`action_class must be one of ${VISUAL_MICROPLAN_ACTION_CLASSES.join(', ')}`);
  }
  const expectedVisualResult = requireString(
    args.expected_visual_result,
    'expected_visual_result'
  );
  const protectedRegions = parseStringArray(args.protected_regions, 'protected_regions');
  const previousPreview = parsePreviousPreview(args.previous_preview);

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
    };
  });

  validateBackwardReferences(steps);

  const mutationIndexes = steps
    .map((step, index) => (VISUAL_MICROPLAN_MUTATION_TOOLS.has(step.tool) ? index : -1))
    .filter((index) => index >= 0);
  if (mutationIndexes.length !== 1) {
    throw new Error(`VisualMicroPlan requires exactly one visual mutation; found ${mutationIndexes.length}`);
  }
  const mutationIndex = mutationIndexes[0]!;
  const captureIndex = steps.length - 1;
  if (steps[captureIndex]!.tool !== VISUAL_MICROPLAN_CAPTURE_TOOL) {
    throw new Error('the final VisualMicroPlan step must be photoshop_get_preview');
  }
  if (steps.some((step, index) => index !== captureIndex && step.tool === VISUAL_MICROPLAN_CAPTURE_TOOL)) {
    throw new Error('photoshop_get_preview may appear only once and must be the final step');
  }
  if (mutationIndex !== captureIndex - 1) {
    throw new Error('the visual mutation must be immediately followed by the final preview');
  }

  for (let index = 0; index < mutationIndex; index++) {
    if (!VISUAL_MICROPLAN_PREPARE_TOOLS.has(steps[index]!.tool)) {
      throw new Error(`step "${steps[index]!.id}" is not a permitted preparation step`);
    }
  }

  const previewArgs = steps[captureIndex]!.args;
  if (previewArgs.include_image === false) {
    throw new Error('VisualMicroPlan preview must include the image so the caller can inspect it');
  }

  let lastBrushSelection = -1;
  let lastBrushSettingsRead = -1;
  for (let index = 0; index < mutationIndex; index++) {
    if (steps[index]!.tool === 'photoshop_select_brush_preset') lastBrushSelection = index;
    if (steps[index]!.tool === 'photoshop_get_brush_settings') lastBrushSettingsRead = index;
  }
  if (lastBrushSelection >= 0 && lastBrushSettingsRead < lastBrushSelection) {
    throw new Error(
      'photoshop_get_brush_settings is required after the last brush preset selection and before painting'
    );
  }

  const actionClass = actionClassRaw as VisualMicroPlanActionClass;
  const mutationTool = steps[mutationIndex]!.tool;
  if (actionClass === 'ROLLBACK' && mutationTool !== 'photoshop_undo') {
    throw new Error('ROLLBACK micro-plans must use photoshop_undo as their visual mutation');
  }
  if (mutationTool === 'photoshop_undo' && actionClass !== 'ROLLBACK') {
    throw new Error('photoshop_undo is allowed only for action_class=ROLLBACK');
  }

  return {
    planId,
    summary,
    stage,
    scale,
    region,
    actionClass,
    expectedVisualResult,
    protectedRegions,
    documentId,
    previousPreview,
    steps,
    mutationIndex,
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

