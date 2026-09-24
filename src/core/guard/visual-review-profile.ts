import type {
  VisualMicroPlanActionClass,
  VisualMicroPlanSignificanceMode,
} from '../visual-microplan.js';

export const VISUAL_REVIEW_LEVELS = ['composition', 'object', 'micro'] as const;
export type VisualReviewLevel = (typeof VISUAL_REVIEW_LEVELS)[number];

export const VISUAL_REVIEW_FINDING_LEVEL = {
  composition_balance: 'composition',
  focal_hierarchy: 'composition',
  global_value_structure: 'composition',
  global_color_balance: 'composition',
  global_depth_read: 'composition',
  subject_recognition: 'composition',
  object_readability: 'object',
  silhouette: 'object',
  proportion: 'object',
  contact_support: 'object',
  occlusion_depth: 'object',
  spatial_relation: 'object',
  transform_placement: 'object',
  local_value_color: 'object',
  edge_transition: 'micro',
  seam_halo: 'micro',
  patch_boundary: 'micro',
  hard_corner: 'micro',
  small_artifact: 'micro',
  feature_detail: 'micro',
  text_legibility: 'micro',
  signature_legibility: 'micro',
  repeated_dab_pattern: 'micro',
  mechanical_patterning: 'object',
  texture_detail: 'micro',
  local_discontinuity: 'micro',
} as const satisfies Record<string, VisualReviewLevel>;

export type VisualReviewFindingKind = keyof typeof VISUAL_REVIEW_FINDING_LEVEL;
export const VISUAL_REVIEW_FINDING_KINDS = Object.keys(
  VISUAL_REVIEW_FINDING_LEVEL
) as VisualReviewFindingKind[];
export type VisualReviewScale = 'global' | 'medium' | 'small' | 'detail' | 'local' | 'micro';
export type VisualReviewImpactClass =
  | 'construct'
  | 'subtract'
  | 'edge'
  | 'tone'
  | 'texture'
  | 'transition'
  | 'transform'
  | 'isolate'
  | 'composite'
  | 'cleanup';

export interface VisualReviewProfileInput {
  scale?: VisualReviewScale | string;
  significance_mode?: VisualMicroPlanSignificanceMode | string;
  action_class?: VisualMicroPlanActionClass | string;
  impact_class?: VisualReviewImpactClass | string;
  has_region_bounds?: boolean;
  open_problem_scale?: VisualReviewScale | string;
  final_comparison?: boolean;
  finding_kind?: VisualReviewFindingKind;
  unresolved_after_overview?: boolean;
  unresolved_after_object?: boolean;
  has_tighter_region?: boolean;
}

export interface VisualReviewProfile {
  level: VisualReviewLevel;
  whole_max_dimension_px: number;
  require_region: boolean;
  require_before_after: boolean;
  focus_max_dimension_px: number | null;
  reasons: string[];
}

const LEVEL_RANK: Record<VisualReviewLevel, number> = {
  composition: 0,
  object: 1,
  micro: 2,
};

function normalized(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toLowerCase();
  return trimmed || undefined;
}

function actionClass(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().toUpperCase();
  return trimmed || undefined;
}

function raise(
  current: VisualReviewLevel,
  candidate: VisualReviewLevel,
  reasons: string[],
  reason: string
): VisualReviewLevel {
  if (LEVEL_RANK[candidate] > LEVEL_RANK[current]) {
    reasons.push(reason);
    return candidate;
  }
  if (!reasons.includes(reason)) reasons.push(reason);
  return current;
}

export function reviewLevelForFinding(kind: VisualReviewFindingKind): VisualReviewLevel {
  return VISUAL_REVIEW_FINDING_LEVEL[kind];
}

export function resolveVisualReviewProfile(input: VisualReviewProfileInput): VisualReviewProfile {
  const reasons: string[] = [];
  const scale = normalized(input.scale);
  const problemScale = normalized(input.open_problem_scale);
  const significanceMode = normalized(input.significance_mode);
  const impactClass = normalized(input.impact_class);
  const action = actionClass(input.action_class);
  const hasRegion = input.has_region_bounds === true;

  let level: VisualReviewLevel = 'composition';

  if (input.final_comparison) {
    reasons.push('final comparison requires whole-frame composition review');
  }

  if (scale === 'medium' && hasRegion) {
    level = raise(level, 'object', reasons, 'medium scale with exact region requires object review');
  } else if (scale === 'small' || scale === 'local') {
    level = raise(level, 'object', reasons, `${scale} scale requires object review`);
  } else if (scale === 'detail' || scale === 'micro') {
    level = raise(level, 'micro', reasons, `${scale} scale requires micro review`);
  } else if (scale === 'global') {
    reasons.push('global scale uses composition review');
  }

  if (hasRegion && (problemScale === 'medium' || problemScale === 'small' || problemScale === 'local')) {
    level = raise(level, 'object', reasons, `open ${problemScale} problem requires object review`);
  } else if (hasRegion && (problemScale === 'detail' || problemScale === 'micro')) {
    level = raise(level, 'micro', reasons, `open ${problemScale} problem requires micro review`);
  }

  if (significanceMode === 'subtle_local') {
    level = raise(level, 'object', reasons, 'subtle_local significance requires at least object review');
  }

  if ((action === 'REPLACE' || action === 'ERASE') && hasRegion) {
    level = raise(level, 'object', reasons, `${action} with exact region requires object review`);
  }

  if (
    hasRegion
    && ['transform', 'isolate', 'composite', 'edge', 'transition', 'cleanup'].includes(impactClass ?? '')
  ) {
    level = raise(level, 'object', reasons, `${impactClass} impact with exact region requires object review`);
  }

  if (
    hasRegion
    && (scale === 'detail' || scale === 'micro')
    && (impactClass === 'edge' || impactClass === 'transition' || impactClass === 'cleanup')
  ) {
    level = raise(level, 'micro', reasons, `${impactClass} impact at detail scale requires micro review`);
  }

  if (input.finding_kind) {
    const findingLevel = reviewLevelForFinding(input.finding_kind);
    level = raise(level, findingLevel, reasons, `${input.finding_kind} finding requires ${findingLevel} review`);
  }

  if (input.unresolved_after_overview) {
    level = raise(level, 'object', reasons, 'unresolved local uncertainty after overview requires object review');
  }

  if (input.unresolved_after_object && input.has_tighter_region) {
    level = raise(level, 'micro', reasons, 'unresolved object uncertainty with exact tighter region requires micro review');
  }

  if (reasons.length === 0) reasons.push('no local evidence requirement; composition review is sufficient');

  const localScale = scale === 'small' || scale === 'local' || scale === 'detail' || scale === 'micro';
  const destructiveLocal = (action === 'REPLACE' || action === 'ERASE') && hasRegion;
  const edgeDependentCorrection = level === 'micro'
    && (impactClass === 'edge' || impactClass === 'transition' || impactClass === 'cleanup');
  const requireBeforeAfter = significanceMode === 'subtle_local'
    || localScale
    || destructiveLocal
    || edgeDependentCorrection;

  return {
    level,
    whole_max_dimension_px: 1600,
    require_region: level !== 'composition',
    require_before_after: requireBeforeAfter,
    focus_max_dimension_px: level === 'object' ? 1200 : level === 'micro' ? 1600 : null,
    reasons,
  };
}
