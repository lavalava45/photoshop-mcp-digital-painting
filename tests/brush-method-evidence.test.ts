import { describe, expect, it } from 'vitest';
import {
  BrushMethodEvidenceCache,
  HISTORICAL_ROUND_BLUNT_2026_09_20,
  HISTORICAL_ROUND_BLUNT_2026_09_20_SETTINGS,
  effectiveSettingsFingerprint,
  type BrushMethodEvidence,
} from '../src/core/brush-method-evidence.js';

function currentEvidence(overrides: Partial<BrushMethodEvidence> = {}): BrushMethodEvidence {
  const settings = { size: 80, hardness: 65, spacing: 10, flow: 70 };
  return {
    evidence_id: 'current-dry-brush-v1',
    preset_name: 'Current Dry Brush',
    effective_settings_fingerprint: effectiveSettingsFingerprint(settings),
    backend: 'uxp',
    runtime_revision: 'runtime-42',
    bridge_revision: 'bridge-7',
    sample_image_sha256: 'a'.repeat(64),
    sample_image_path: 'evidence/current-dry-brush-v1.png',
    observed_traits: {
      solid_coverage: 'yes',
      separated_bristles: 'no',
      taper: 'yes',
      soft_falloff: 'no',
    },
    uncertainty: [],
    observed_notes: ['Coverage is continuous at the tested scale and settings.'],
    ...overrides,
  };
}

const currentLookup = {
  preset_name: 'Current Dry Brush',
  effective_settings: { size: 80, hardness: 65, spacing: 10, flow: 70 },
  backend: 'uxp',
  runtime_revision: 'runtime-42',
  bridge_revision: 'bridge-7',
};

describe('brush/method evidence cache', () => {
  it('returns trusted role guidance only on exact provenance match and includes evidence citation', () => {
    const cache = new BrushMethodEvidenceCache([currentEvidence()]);
    const result = cache.recommend(currentLookup);
    expect(result.status).toBe('trusted-evidence');
    expect(result.probe_needed).toBe(false);
    expect(result.evidence?.observed_traits.solid_coverage).toBe('yes');
    expect(result.evidence_citation).toEqual({
      evidence_id: 'current-dry-brush-v1',
      sample_image_sha256: 'a'.repeat(64),
      sample_image_path: 'evidence/current-dry-brush-v1.png',
    });
  });

  it.each([
    ['settings mismatch', { ...currentLookup, effective_settings: { size: 81, hardness: 65, spacing: 10, flow: 70 } }, 'settings_mismatch'],
    ['backend mismatch', { ...currentLookup, backend: 'extendscript' }, 'backend_mismatch'],
    ['runtime revision mismatch', { ...currentLookup, runtime_revision: 'runtime-43' }, 'runtime_revision_mismatch'],
    ['bridge revision mismatch', { ...currentLookup, bridge_revision: 'bridge-8' }, 'bridge_revision_mismatch'],
  ])('invalidates deterministically on %s', (_name, lookup, expectedReason) => {
    const cache = new BrushMethodEvidenceCache([currentEvidence()]);
    const result = cache.recommend(lookup);
    expect(result.status).toBe('probe-needed');
    expect(result.invalidation_reasons).toContain(expectedReason);
  });

  it('invalidates trusted evidence on explicit observed mismatch', () => {
    const cache = new BrushMethodEvidenceCache([currentEvidence()]);
    expect(cache.recommend(currentLookup).status).toBe('trusted-evidence');
    cache.invalidateObservedMismatch('current-dry-brush-v1');
    const result = cache.recommend(currentLookup);
    expect(result.status).toBe('probe-needed');
    expect(result.invalidation_reasons).toContain('explicit_observed_mismatch');
  });

  it('keeps the 2026-09-20 Round Blunt sample diagnostic-only and never silently trusts it', () => {
    const cache = new BrushMethodEvidenceCache([HISTORICAL_ROUND_BLUNT_2026_09_20]);
    const result = cache.recommend({
      preset_name: 'Round Blunt Medium Stiff',
      effective_settings: { ...HISTORICAL_ROUND_BLUNT_2026_09_20_SETTINGS },
      backend: 'uxp',
      runtime_revision: 'current-runtime',
      bridge_revision: 'current-bridge',
    });
    expect(result.status).toBe('diagnostic-only');
    expect(result.probe_needed).toBe(false);
    expect(result.invalidation_reasons).toContain('incomplete_provenance');
    expect(result.evidence?.observed_traits).toMatchObject({
      solid_coverage: 'no',
      separated_bristles: 'yes',
      taper: 'yes',
    });
    expect(result.evidence?.uncertainty.join(' ')).toMatch(/unresolved|incomplete/i);
    expect(result.evidence_citation?.sample_image_sha256).toBe(
      'd065b84e34f9a8f8211cda873e62e0db586c8ed8d8029099b12130124bd4e66a',
    );
  });

  it('preset name alone is insufficient evidence of role suitability', () => {
    const cache = new BrushMethodEvidenceCache([currentEvidence()]);
    const result = cache.recommend({
      preset_name: 'Current Dry Brush',
      effective_settings: { size: 20 },
      backend: 'uxp',
      runtime_revision: 'runtime-42',
      bridge_revision: 'bridge-7',
    });
    expect(result.status).not.toBe('trusted-evidence');
    expect(result.invalidation_reasons).toContain('settings_mismatch');
  });

  it('requests a probe exactly once conceptually for one unknown provenance combination', () => {
    const cache = new BrushMethodEvidenceCache();
    const unknown = {
      preset_name: 'Untested Brush',
      effective_settings: { size: 50, flow: 40 },
      backend: 'uxp',
      runtime_revision: 'runtime-42',
      bridge_revision: 'bridge-7',
    };
    const first = cache.recommend(unknown);
    const second = cache.recommend(unknown);
    const third = cache.recommend(unknown);
    expect(first).toMatchObject({ status: 'probe-needed', probe_needed: true });
    expect(second).toMatchObject({ status: 'probe-pending', probe_needed: false });
    expect(third).toMatchObject({ status: 'probe-pending', probe_needed: false });
  });

  it('a changed unknown combination receives its own single probe request', () => {
    const cache = new BrushMethodEvidenceCache();
    const base = {
      preset_name: 'Untested Brush',
      effective_settings: { size: 50, flow: 40 },
      backend: 'uxp',
      runtime_revision: 'runtime-42',
      bridge_revision: 'bridge-7',
    };
    expect(cache.recommend(base).probe_needed).toBe(true);
    expect(cache.recommend(base).probe_needed).toBe(false);
    expect(cache.recommend({ ...base, effective_settings: { size: 60, flow: 40 } }).probe_needed).toBe(true);
  });
});
