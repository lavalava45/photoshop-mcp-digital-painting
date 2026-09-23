export interface OpenStyleContract {
  edge_policy?: string;
  mark_visibility?: string;
  detail_density?: string;
  color_policy?: string;
  layer_or_mask_bias?: string;
  finish_criteria?: string;
  [key: string]: string | undefined;
}

export interface StylePassContext {
  stage: string;
  changeDomains?: string[];
  methodClass?: string;
  wholeImageReview?: boolean;
}

export interface StyleTaskProjection {
  task_scale_hint?: string;
  stopping_hint?: string;
}

export interface StyleMethodProjection {
  edge_expectation?: string;
  mark_treatment?: string;
  preferred_method_traits?: string[];
}

export type StyleMethodTrait =
  | 'visible-marks'
  | 'low-mark-visibility'
  | 'directional-marks'
  | 'solid-coverage'
  | 'hard-edge'
  | 'soft-edge'
  | 'editable-mask-or-layer'
  | 'texture-capable'
  | 'detail-restraint';

export interface StyleMethodTraitEvidence {
  trait: StyleMethodTrait;
  preference: 'prefer' | 'avoid';
  source_field: 'edge_policy' | 'mark_visibility' | 'detail_density' | 'layer_or_mask_bias';
  criterion: string;
}

export interface StyleCriticProjection {
  color_preservation_criterion?: string;
  whole_image_finish_criterion?: string;
}

export interface StyleContractProjection {
  relevant_fields: Partial<OpenStyleContract>;
  task: StyleTaskProjection;
  method: StyleMethodProjection;
  critic: StyleCriticProjection;
}

export interface StyleDriftObservation {
  field: string;
  observed: string;
  matchesDeclaredPolicy: 'yes' | 'no' | 'uncertain';
  alternativeExplanation?: string;
}

export interface StyleDriftFinding {
  field: string;
  declaredPolicy: string;
  observed: string;
  alternativeExplanation: string;
  certainty: 'high' | 'low';
  advisoryOnly: true;
}

export interface StyleDriftEvaluation {
  findings: StyleDriftFinding[];
  advisoryOnly: true;
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizedStage(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function hasDomain(context: StylePassContext, pattern: RegExp): boolean {
  return (context.changeDomains ?? []).some(domain => pattern.test(domain));
}

function isDetailContext(context: StylePassContext): boolean {
  return /DETAIL/.test(normalizedStage(context.stage)) || hasDomain(context, /texture|detail/i);
}

function isEdgeContext(context: StylePassContext): boolean {
  return normalizedStage(context.stage) === 'EDGE' || hasDomain(context, /edge|silhouette/i);
}

function isPaintContext(context: StylePassContext): boolean {
  return ['paint', 'preset-brush', 'line', 'smudge'].includes((context.methodClass ?? '').toLowerCase())
    || hasDomain(context, /texture|tone|shape|silhouette/i);
}

function isColorContext(context: StylePassContext): boolean {
  return hasDomain(context, /color|tone|lighting/i)
    || ['VALUE', 'FORM', 'FORM_AND_LIGHT', 'MATERIAL', 'DETAIL', 'MICRO_DETAIL']
      .includes(normalizedStage(context.stage));
}

function isLayerMethodContext(context: StylePassContext): boolean {
  return hasDomain(context, /background|depth|composition|shape|tone|texture/i)
    || ['COMPOSITION', 'FORM', 'FORM_AND_LIGHT', 'MATERIAL', 'DETAIL'].includes(normalizedStage(context.stage));
}

function isFinalContext(context: StylePassContext): boolean {
  return context.wholeImageReview === true
    || ['FINAL', 'FINISH', 'FINAL_SELECTION'].includes(normalizedStage(context.stage));
}

function addTraitEvidence(
  rows: StyleMethodTraitEvidence[],
  sourceField: StyleMethodTraitEvidence['source_field'],
  criterion: string | undefined,
  tests: Array<{ pattern: RegExp; trait: StyleMethodTrait; preference?: 'prefer' | 'avoid' }>,
): void {
  if (!criterion) return;
  for (const test of tests) {
    if (!test.pattern.test(criterion)) continue;
    const row: StyleMethodTraitEvidence = {
      trait: test.trait,
      preference: test.preference ?? 'prefer',
      source_field: sourceField,
      criterion,
    };
    if (!rows.some(existing => existing.trait === row.trait
      && existing.preference === row.preference
      && existing.source_field === row.source_field)) {
      rows.push(row);
    }
  }
}

/**
 * Converts only observable execution language from relevant open-ended style fields
 * into a small method-selection trait vocabulary. These are mechanism traits, not
 * named styles; unknown wording/fields simply contributes no selection evidence.
 */
export function projectStyleMethodTraitEvidence(
  contract: OpenStyleContract,
  context: StylePassContext,
): StyleMethodTraitEvidence[] {
  const rows: StyleMethodTraitEvidence[] = [];
  const edgePolicy = isEdgeContext(context) ? text(contract.edge_policy) : undefined;
  const markVisibility = isPaintContext(context) ? text(contract.mark_visibility) : undefined;
  const detailDensity = isDetailContext(context) ? text(contract.detail_density) : undefined;
  const layerBias = isLayerMethodContext(context) ? text(contract.layer_or_mask_bias) : undefined;

  addTraitEvidence(rows, 'edge_policy', edgePolicy, [
    { pattern: /\b(?:crisp|hard|sharp|clean)\b/i, trait: 'hard-edge' },
    { pattern: /\b(?:soft|lost|diffuse|feathered)\b/i, trait: 'soft-edge' },
  ]);
  addTraitEvidence(rows, 'mark_visibility', markVisibility, [
    { pattern: /\b(?:visible|legible|broken|bristle|brush\s*marks?|stroke\s*marks?)\b/i, trait: 'visible-marks' },
    { pattern: /\b(?:directional|direction|flowing|flow)\b/i, trait: 'directional-marks' },
    { pattern: /\b(?:smooth|hidden|invisible|seamless|polished)\b/i, trait: 'low-mark-visibility' },
    { pattern: /\b(?:solid|continuous|filled|flat\s*coverage)\b/i, trait: 'solid-coverage' },
  ]);
  addTraitEvidence(rows, 'detail_density', detailDensity, [
    { pattern: /\b(?:sparse|minimal|restrained|selective|limited)\b/i, trait: 'detail-restraint' },
    { pattern: /\b(?:texture|textured|micro-detail|dense detail)\b/i, trait: 'texture-capable' },
  ]);
  addTraitEvidence(rows, 'layer_or_mask_bias', layerBias, [
    { pattern: /\b(?:mask|masked|layer|layers|editable|reversible|non[- ]?destructive)\b/i, trait: 'editable-mask-or-layer' },
  ]);
  return rows;
}

/**
 * Produces only the style facts relevant to this bounded pass.
 * Style values remain open-ended strings: no named-style or closed-value taxonomy is introduced.
 */
export function projectStyleContractForPass(
  contract: OpenStyleContract,
  context: StylePassContext,
): StyleContractProjection {
  const relevant: Partial<OpenStyleContract> = {};
  const task: StyleTaskProjection = {};
  const method: StyleMethodProjection = {};
  const critic: StyleCriticProjection = {};

  const edgePolicy = text(contract.edge_policy);
  if (edgePolicy && isEdgeContext(context)) {
    relevant.edge_policy = edgePolicy;
    method.edge_expectation = edgePolicy;
  }

  const markVisibility = text(contract.mark_visibility);
  if (markVisibility && isPaintContext(context)) {
    relevant.mark_visibility = markVisibility;
    method.mark_treatment = markVisibility;
  }

  const detailDensity = text(contract.detail_density);
  if (detailDensity && isDetailContext(context)) {
    relevant.detail_density = detailDensity;
    task.task_scale_hint = detailDensity;
    task.stopping_hint = `Stop adding detail when further marks would exceed: ${detailDensity}`;
  }

  const colorPolicy = text(contract.color_policy);
  if (colorPolicy && isColorContext(context)) {
    relevant.color_policy = colorPolicy;
    critic.color_preservation_criterion = colorPolicy;
  }

  const layerBias = text(contract.layer_or_mask_bias);
  if (layerBias && isLayerMethodContext(context)) {
    relevant.layer_or_mask_bias = layerBias;
    method.preferred_method_traits = [layerBias];
  }

  const finishCriteria = text(contract.finish_criteria);
  if (finishCriteria && isFinalContext(context)) {
    relevant.finish_criteria = finishCriteria;
    critic.whole_image_finish_criterion = finishCriteria;
  }

  return { relevant_fields: relevant, task, method, critic };
}

/**
 * Advisory whole-image style-drift check. It does not score or block execution.
 * Only explicit observations against explicitly declared observable policy can produce findings.
 */
export function evaluateWholeImageStyleDrift(
  contract: OpenStyleContract,
  observations: StyleDriftObservation[],
): StyleDriftEvaluation {
  const findings: StyleDriftFinding[] = [];
  for (const observation of observations) {
    const declared = text(contract[observation.field]);
    if (!declared || observation.matchesDeclaredPolicy !== 'no') continue;
    const alternative = text(observation.alternativeExplanation);
    findings.push({
      field: observation.field,
      declaredPolicy: declared,
      observed: observation.observed.trim(),
      alternativeExplanation: alternative ?? 'No alternative explanation was supplied.',
      certainty: alternative ? 'low' : 'high',
      advisoryOnly: true,
    });
  }
  return { findings, advisoryOnly: true };
}
