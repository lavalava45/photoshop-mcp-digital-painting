import { describe, expect, it } from 'vitest';
import {
  resolveVisualReviewProfile,
  reviewLevelForFinding,
} from '../src/core/guard/visual-review-profile.js';

describe('visual review profile resolver', () => {
  it.each([
    [{ scale: 'global' }, 'composition'],
    [{ scale: 'medium', has_region_bounds: true }, 'object'],
    [{ scale: 'small', has_region_bounds: true }, 'object'],
    [{ scale: 'local', has_region_bounds: true }, 'object'],
    [{ scale: 'detail', has_region_bounds: true }, 'micro'],
    [{ scale: 'micro', has_region_bounds: true }, 'micro'],
  ] as const)('maps %o to %s review', (input, expected) => {
    const profile = resolveVisualReviewProfile(input);
    expect(profile.level).toBe(expected);
    if (expected === 'micro') expect(profile.require_before_after).toBe(true);
  });

  it('raises subtle_local to at least object and preserves BEFORE/AFTER', () => {
    expect(resolveVisualReviewProfile({
      scale: 'global',
      significance_mode: 'subtle_local',
      has_region_bounds: true,
    })).toMatchObject({
      level: 'object',
      require_region: true,
      require_before_after: true,
      focus_max_dimension_px: 1200,
    });
  });

  it.each(['REPLACE', 'ERASE'] as const)('%s with a bounded region requires object BEFORE/AFTER', action => {
    expect(resolveVisualReviewProfile({
      scale: 'global',
      action_class: action,
      has_region_bounds: true,
    })).toMatchObject({ level: 'object', require_before_after: true });
  });

  it('raises detail edge/transition cleanup to micro', () => {
    for (const impact_class of ['edge', 'transition', 'cleanup'] as const) {
      expect(resolveVisualReviewProfile({
        scale: 'detail',
        impact_class,
        has_region_bounds: true,
      })).toMatchObject({
        level: 'micro',
        require_before_after: true,
        focus_max_dimension_px: 1600,
      });
    }
  });

  it.each(['transform', 'isolate', 'composite', 'cleanup'] as const)(
    '%s impact with an exact bounded region requires at least object review',
    impact_class => {
      expect(resolveVisualReviewProfile({
        scale: 'global',
        impact_class,
        has_region_bounds: true,
      }).level).toBe('object');
    }
  );

  it('allows an open finer-scale visual problem to raise the minimum review level', () => {
    expect(resolveVisualReviewProfile({
      scale: 'global',
      open_problem_scale: 'local',
      has_region_bounds: true,
    }).level).toBe('object');
    expect(resolveVisualReviewProfile({
      scale: 'global',
      open_problem_scale: 'detail',
      has_region_bounds: true,
    }).level).toBe('micro');
    expect(resolveVisualReviewProfile({
      scale: 'global',
      open_problem_scale: 'detail',
      has_region_bounds: false,
    }).level).toBe('composition');
  });

  it('structured micro finding upgrades an object pass to micro', () => {
    const profile = resolveVisualReviewProfile({
      scale: 'medium',
      has_region_bounds: true,
      finding_kind: 'seam_halo',
    });
    expect(profile.level).toBe('micro');
    expect(profile.reasons).toContain('seam_halo finding requires micro review');
  });

  it('unresolved overview uncertainty raises only to object until a tighter exact region exists', () => {
    expect(resolveVisualReviewProfile({
      scale: 'global',
      unresolved_after_overview: true,
    }).level).toBe('object');
    expect(resolveVisualReviewProfile({
      scale: 'medium',
      has_region_bounds: true,
      unresolved_after_object: true,
      has_tighter_region: false,
    }).level).toBe('object');
    expect(resolveVisualReviewProfile({
      scale: 'medium',
      has_region_bounds: true,
      unresolved_after_object: true,
      has_tighter_region: true,
    }).level).toBe('micro');
  });

  it('does not upgrade unrelated ordinary global passes to micro', () => {
    expect(resolveVisualReviewProfile({
      scale: 'global',
      action_class: 'ADD',
      impact_class: 'tone',
      has_region_bounds: false,
    })).toEqual(expect.objectContaining({
      level: 'composition',
      require_region: false,
      require_before_after: false,
      focus_max_dimension_px: null,
      whole_max_dimension_px: 1600,
    }));
  });

  it('keeps finding taxonomy deterministic and subject-agnostic', () => {
    expect(reviewLevelForFinding('composition_balance')).toBe('composition');
    expect(reviewLevelForFinding('silhouette')).toBe('object');
    expect(reviewLevelForFinding('edge_transition')).toBe('micro');
  });
});
