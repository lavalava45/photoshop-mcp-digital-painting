import { createHash } from 'node:crypto';

export interface BrushCoverageTraits {
  solid_coverage: 'yes' | 'no' | 'uncertain';
  separated_bristles: 'yes' | 'no' | 'uncertain';
  taper: 'yes' | 'no' | 'uncertain';
  soft_falloff: 'yes' | 'no' | 'uncertain';
}

export interface BrushMethodEvidence {
  evidence_id: string;
  preset_name: string;
  effective_settings_fingerprint: string;
  backend?: string;
  runtime_revision?: string;
  bridge_revision?: string;
  sample_image_sha256: string;
  sample_image_path: string;
  observed_traits: BrushCoverageTraits;
  uncertainty: string[];
  observed_notes: string[];
  diagnostic_only?: boolean;
}

export interface BrushEvidenceLookup {
  preset_name: string;
  effective_settings: Record<string, unknown>;
  backend?: string;
  runtime_revision?: string;
  bridge_revision?: string;
}

export type BrushEvidenceInvalidationReason =
  | 'preset_mismatch'
  | 'settings_mismatch'
  | 'backend_mismatch'
  | 'runtime_revision_mismatch'
  | 'bridge_revision_mismatch'
  | 'explicit_observed_mismatch'
  | 'incomplete_provenance';

export interface BrushRoleRecommendation {
  status: 'trusted-evidence' | 'diagnostic-only' | 'probe-needed' | 'probe-pending';
  evidence?: BrushMethodEvidence;
  evidence_citation?: {
    evidence_id: string;
    sample_image_sha256: string;
    sample_image_path: string;
  };
  invalidation_reasons: BrushEvidenceInvalidationReason[];
  probe_needed: boolean;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => JSON.stringify(key) + ':' + stableJson(item))
      .join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

export function effectiveSettingsFingerprint(settings: Record<string, unknown>): string {
  return createHash('sha256').update(stableJson(settings)).digest('hex');
}

function lookupKey(lookup: BrushEvidenceLookup): string {
  return [
    lookup.preset_name.trim(),
    effectiveSettingsFingerprint(lookup.effective_settings),
    lookup.backend ?? '<unknown-backend>',
    lookup.runtime_revision ?? '<unknown-runtime>',
    lookup.bridge_revision ?? '<unknown-bridge>',
  ].join('|');
}

function provenanceMismatchReasons(
  evidence: BrushMethodEvidence,
  lookup: BrushEvidenceLookup,
): BrushEvidenceInvalidationReason[] {
  const reasons: BrushEvidenceInvalidationReason[] = [];
  if (evidence.preset_name !== lookup.preset_name.trim()) reasons.push('preset_mismatch');
  if (evidence.effective_settings_fingerprint !== effectiveSettingsFingerprint(lookup.effective_settings)) {
    reasons.push('settings_mismatch');
  }
  if (!evidence.backend || !evidence.runtime_revision) {
    reasons.push('incomplete_provenance');
    return reasons;
  }
  if (!lookup.backend || evidence.backend !== lookup.backend) reasons.push('backend_mismatch');
  if (!lookup.runtime_revision || evidence.runtime_revision !== lookup.runtime_revision) {
    reasons.push('runtime_revision_mismatch');
  }
  if (evidence.bridge_revision !== undefined) {
    if (!lookup.bridge_revision || evidence.bridge_revision !== lookup.bridge_revision) {
      reasons.push('bridge_revision_mismatch');
    }
  }
  return reasons;
}

export class BrushMethodEvidenceCache {
  private readonly evidence = new Map<string, BrushMethodEvidence>();
  private readonly invalidated = new Map<string, BrushEvidenceInvalidationReason>();
  private readonly requestedProbes = new Set<string>();

  constructor(initialEvidence: BrushMethodEvidence[] = []) {
    for (const record of initialEvidence) this.add(record);
  }

  add(record: BrushMethodEvidence): void {
    this.evidence.set(record.evidence_id, structuredClone(record));
    this.invalidated.delete(record.evidence_id);
  }

  invalidateObservedMismatch(evidenceId: string): void {
    if (this.evidence.has(evidenceId)) {
      this.invalidated.set(evidenceId, 'explicit_observed_mismatch');
    }
  }

  recommend(lookup: BrushEvidenceLookup): BrushRoleRecommendation {
    const exactFingerprint = effectiveSettingsFingerprint(lookup.effective_settings);
    const candidates = [...this.evidence.values()]
      .filter(record => record.preset_name === lookup.preset_name.trim())
      .sort((a, b) => a.evidence_id.localeCompare(b.evidence_id));

    let diagnostic: BrushMethodEvidence | undefined;
    const invalidationReasons = new Set<BrushEvidenceInvalidationReason>();
    for (const record of candidates) {
      const explicitInvalidation = this.invalidated.get(record.evidence_id);
      if (explicitInvalidation) {
        invalidationReasons.add(explicitInvalidation);
        continue;
      }
      const reasons = provenanceMismatchReasons(record, lookup);
      if (reasons.length === 0 && !record.diagnostic_only) {
        return {
          status: 'trusted-evidence',
          evidence: structuredClone(record),
          evidence_citation: {
            evidence_id: record.evidence_id,
            sample_image_sha256: record.sample_image_sha256,
            sample_image_path: record.sample_image_path,
          },
          invalidation_reasons: [],
          probe_needed: false,
        };
      }
      reasons.forEach(reason => invalidationReasons.add(reason));
      if (
        record.effective_settings_fingerprint === exactFingerprint
        && (record.diagnostic_only || reasons.includes('incomplete_provenance'))
      ) {
        diagnostic ??= record;
      }
    }

    if (diagnostic) {
      return {
        status: 'diagnostic-only',
        evidence: structuredClone(diagnostic),
        evidence_citation: {
          evidence_id: diagnostic.evidence_id,
          sample_image_sha256: diagnostic.sample_image_sha256,
          sample_image_path: diagnostic.sample_image_path,
        },
        invalidation_reasons: [...invalidationReasons],
        probe_needed: false,
      };
    }

    const key = lookupKey(lookup);
    if (!this.requestedProbes.has(key)) {
      this.requestedProbes.add(key);
      return {
        status: 'probe-needed',
        invalidation_reasons: [...invalidationReasons],
        probe_needed: true,
      };
    }
    return {
      status: 'probe-pending',
      invalidation_reasons: [...invalidationReasons],
      probe_needed: false,
    };
  }
}

export const HISTORICAL_ROUND_BLUNT_2026_09_20_SETTINGS = {
  size: 215,
  hardness: 100,
  angle: 0,
  roundness: 100,
  spacing: 2,
  opacity: 13,
  flow: 27,
  flip_x: false,
  flip_y: false,
  use_pressure_size: true,
  use_pressure_opacity: false,
  airbrush: false,
  smoothing_enabled: true,
  smoothing: 33,
} as const;

/**
 * Historical diagnostic sample only. The image proves visible separated bristles/gaps
 * and taper in the pressure variant, but the 2026-09-20 artifact does not carry enough
 * backend/runtime revision provenance to trust it as current role evidence.
 */
export const HISTORICAL_ROUND_BLUNT_2026_09_20: BrushMethodEvidence = {
  evidence_id: 'round-blunt-medium-stiff-2026-09-20-diagnostic',
  preset_name: 'Round Blunt Medium Stiff',
  effective_settings_fingerprint: effectiveSettingsFingerprint(HISTORICAL_ROUND_BLUNT_2026_09_20_SETTINGS),
  sample_image_sha256: 'd065b84e34f9a8f8211cda873e62e0db586c8ed8d8029099b12130124bd4e66a',
  sample_image_path: 'processes/brush-trace-diagnostic-process/run-01/final/brush-trace-contact-sheet.png',
  observed_traits: {
    solid_coverage: 'no',
    separated_bristles: 'yes',
    taper: 'yes',
    soft_falloff: 'no',
  },
  uncertainty: [
    'Cause of the separated/gapped footprint is unresolved: preset behavior versus stroke-path execution defect was not established.',
    'Backend/runtime revision provenance is incomplete.',
  ],
  observed_notes: [
    'Upper Round Blunt traces contain distinct longitudinal bristles and white/sparse gaps rather than a continuous filled band.',
    'The simulated-pressure variant narrows toward the ends.',
  ],
  diagnostic_only: true,
};
