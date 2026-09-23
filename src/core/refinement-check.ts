export const REFINEMENT_CHECK_STATUSES = [
  'pending',
  'pass',
  'fail',
  'style-not-applicable',
] as const;
export type RefinementCheckStatus = (typeof REFINEMENT_CHECK_STATUSES)[number];

export const REFINEMENT_CRITERIA = [
  'major_form_modelling',
  'secondary_forms',
  'edge_hierarchy',
  'material_light_response',
  'selective_detail',
  'residual_block_in',
] as const;
export type RefinementCriterion = (typeof REFINEMENT_CRITERIA)[number];

export const REFINEMENT_CRITERION_STATUSES = [
  'resolved',
  'debt',
  'uncertain',
  'not-applicable',
] as const;
export type RefinementCriterionStatus = (typeof REFINEMENT_CRITERION_STATUSES)[number];

export const REPRESENTATION_CHANGE_STATUSES = [
  'meaningful',
  'insufficient',
  'texture-only',
  'not-assessed',
] as const;
export type RepresentationChangeStatus = (typeof REPRESENTATION_CHANGE_STATUSES)[number];

export const REFINEMENT_STYLE_BASIS_FIELDS = [
  'realism_level',
  'shape_language',
  'edge_policy',
  'material_treatment',
  'detail_density',
  'texture_policy',
  'primitive_footprint_tolerance',
  'finish_criteria',
] as const;

export interface RefinementCriterionEvidence {
  status: RefinementCriterionStatus;
  note: string;
}

export interface RefinementStyleBasis {
  field: string;
  criterion: string;
}

export interface RefinementCheck {
  status: RefinementCheckStatus;
  observed: boolean;
  preview_sha256: string | null;
  evidence_operation_id: string | null;
  representation_change: RepresentationChangeStatus;
  criteria: Partial<Record<RefinementCriterion, RefinementCriterionEvidence>>;
  confidence: number | null;
  limitations: string[];
  applicability_reason: string | null;
  style_contract_basis: RefinementStyleBasis | null;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function parseLimitations(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('directive.refinement_check.limitations must be an array');
  return value.map((item, index) => {
    const parsed = text(item);
    if (!parsed) throw new Error(`directive.refinement_check.limitations[${index}] must be non-empty`);
    return parsed;
  });
}

function parseConfidence(value: unknown): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error('directive.refinement_check.confidence must be between 0 and 1');
  }
  return parsed;
}

function parseCriteria(value: unknown): Record<RefinementCriterion, RefinementCriterionEvidence> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('directive.refinement_check.criteria is required for pass/fail');
  }
  const raw = value as Record<string, unknown>;
  const parsed = {} as Record<RefinementCriterion, RefinementCriterionEvidence>;
  for (const key of REFINEMENT_CRITERIA) {
    const row = raw[key];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error(`directive.refinement_check.criteria.${key} is required`);
    }
    const record = row as Record<string, unknown>;
    const status = text(record.status)?.toLowerCase() as RefinementCriterionStatus | undefined;
    const note = text(record.note);
    if (!status || !REFINEMENT_CRITERION_STATUSES.includes(status)) {
      throw new Error(
        `directive.refinement_check.criteria.${key}.status must be one of ${REFINEMENT_CRITERION_STATUSES.join(', ')}`
      );
    }
    if (!note) throw new Error(`directive.refinement_check.criteria.${key}.note is required`);
    parsed[key] = { status, note };
  }
  return parsed;
}

/**
 * Durable, subject-agnostic stage-exit evidence for progressive de-block-in.
 *
 * This deliberately validates evidence structure rather than attempting to score
 * artistic quality. The perceptual judgement remains an observed Art Director
 * claim tied to an exact current frame; human acceptance remains a separate gate.
 */
export function normalizeRefinementCheck(raw: unknown): RefinementCheck {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('directive.refinement_check is required');
  }
  const record = raw as Record<string, unknown>;
  const status = text(record.status)?.toLowerCase() as RefinementCheckStatus | undefined;
  if (!status || !REFINEMENT_CHECK_STATUSES.includes(status)) {
    throw new Error(
      `directive.refinement_check.status must be one of ${REFINEMENT_CHECK_STATUSES.join(', ')}`
    );
  }
  const observed = record.observed === true;
  const limitations = parseLimitations(record.limitations);
  const confidence = parseConfidence(record.confidence);

  if (status === 'pending') {
    if (observed) throw new Error('refinement_check.status=pending requires observed=false');
    return {
      status,
      observed: false,
      preview_sha256: null,
      evidence_operation_id: null,
      representation_change: 'not-assessed',
      criteria: {},
      confidence,
      limitations,
      applicability_reason: null,
      style_contract_basis: null,
    };
  }

  if (status === 'style-not-applicable') {
    const applicabilityReason = text(record.applicability_reason);
    if (!applicabilityReason || applicabilityReason.length < 12) {
      throw new Error('refinement_check.status=style-not-applicable requires a concrete applicability_reason');
    }
    const rawBasis = record.style_contract_basis;
    if (!rawBasis || typeof rawBasis !== 'object' || Array.isArray(rawBasis)) {
      throw new Error('refinement_check.status=style-not-applicable requires style_contract_basis');
    }
    const basis = rawBasis as Record<string, unknown>;
    const field = text(basis.field);
    const criterion = text(basis.criterion);
    if (!field || !criterion) {
      throw new Error('refinement_check.style_contract_basis requires field and criterion');
    }
    if (!REFINEMENT_STYLE_BASIS_FIELDS.includes(field as (typeof REFINEMENT_STYLE_BASIS_FIELDS)[number])) {
      throw new Error(
        `refinement_check.style_contract_basis.field must be one of ${REFINEMENT_STYLE_BASIS_FIELDS.join(', ')}`
      );
    }
    return {
      status,
      observed,
      preview_sha256: null,
      evidence_operation_id: null,
      representation_change: 'not-assessed',
      criteria: {},
      confidence,
      limitations,
      applicability_reason: applicabilityReason,
      style_contract_basis: { field, criterion },
    };
  }

  if (!observed) {
    throw new Error(`refinement_check.status=${status} requires observed=true`);
  }
  const previewSha = text(record.preview_sha256)?.toLowerCase();
  const evidenceOperationId = text(record.evidence_operation_id);
  if (!previewSha || !/^[0-9a-f]{64}$/.test(previewSha) || !evidenceOperationId) {
    throw new Error(
      `refinement_check.status=${status} requires a 64-hex preview_sha256 and evidence_operation_id tied to the observed current frame`
    );
  }
  const representationChange = text(record.representation_change)?.toLowerCase() as RepresentationChangeStatus | undefined;
  if (!representationChange || !REPRESENTATION_CHANGE_STATUSES.includes(representationChange)) {
    throw new Error(
      `directive.refinement_check.representation_change must be one of ${REPRESENTATION_CHANGE_STATUSES.join(', ')}`
    );
  }
  if (representationChange === 'not-assessed') {
    throw new Error(`refinement_check.status=${status} cannot use representation_change=not-assessed`);
  }

  const criteria = parseCriteria(record.criteria);
  const unresolved = REFINEMENT_CRITERIA.filter(key => {
    const criterion = criteria[key];
    return criterion.status === 'debt' || criterion.status === 'uncertain';
  });

  if (status === 'pass') {
    if (representationChange !== 'meaningful') {
      throw new Error('refinement_check.status=pass requires representation_change=meaningful');
    }
    const lowerFrequencyRequired: RefinementCriterion[] = [
      'major_form_modelling',
      'secondary_forms',
      'edge_hierarchy',
      'material_light_response',
      'residual_block_in',
    ];
    const unresolvedLowerFrequency = lowerFrequencyRequired.filter(
      key => criteria[key].status !== 'resolved'
    );
    if (unresolvedLowerFrequency.length) {
      throw new Error(
        `refinement_check.status=pass cannot leave lower-frequency refinement debt: ${unresolvedLowerFrequency.join(', ')}`
      );
    }
    if (criteria.selective_detail.status === 'debt' || criteria.selective_detail.status === 'uncertain') {
      throw new Error('refinement_check.status=pass cannot leave selective_detail unresolved');
    }
  }

  if (status === 'fail' && representationChange === 'meaningful' && unresolved.length === 0) {
    throw new Error('refinement_check.status=fail requires unresolved refinement debt or a non-meaningful representation change');
  }

  return {
    status,
    observed,
    preview_sha256: previewSha,
    evidence_operation_id: evidenceOperationId,
    representation_change: representationChange,
    criteria,
    confidence,
    limitations,
    applicability_reason: null,
    style_contract_basis: null,
  };
}

export function isRefinementGatedStage(stage: unknown): boolean {
  const normalized = String(stage ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return ['DETAIL', 'MICRO_DETAIL'].includes(normalized);
}
