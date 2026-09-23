import { describe, expect, it } from 'vitest';
import { resolvePassChecks } from '../src/core/pass-check-applicability.js';

describe('resolvePassChecks', () => {
  it('replays a representative local pass with only applicable technical and prerequisite checks', () => {
    const result = resolvePassChecks({
      scope: 'local',
      mutates_pixels: true,
      requires_layer_target: true,
      uses_coordinates: true,
      touches_protected_content: false,
      changes_mask_clipping_order_blend: false,
      value_prerequisite: 'satisfied',
      recognition_prerequisite: 'not_applicable',
      stage_prerequisite: 'satisfied',
    });

    expect(result.applicable_checks).toEqual([
      'document_target',
      'layer_target',
      'coordinates',
      'actual_composite_effect',
      'value_prerequisite',
      'stage_prerequisite',
    ]);
    expect(result.applicable_checks).not.toContain('protected_content');
    expect(result.applicable_checks).not.toContain('recognition_prerequisite');
    expect(result.host_round_trips_added).toBe(0);
    expect(result.goal_achieved).toBe(false);
  });

  it('preserves genuine protection and relationship checks for risky global work', () => {
    const result = resolvePassChecks({
      scope: 'global',
      mutates_pixels: true,
      touches_protected_content: true,
      changes_mask_clipping_order_blend: true,
      requires_layer_target: true,
      value_prerequisite: 'satisfied',
      recognition_prerequisite: 'satisfied',
      stage_prerequisite: 'satisfied',
    });

    expect(result.applicable_checks).toContain('protected_content');
    expect(result.applicable_checks).toContain('mask_clipping_order_blend');
    expect(result.applicable_checks).toContain('actual_composite_effect');
    expect(result.blocked_by_prerequisites).toEqual([]);
  });

  it('omits actual composite-effect checking for invisible preparation', () => {
    const result = resolvePassChecks({
      scope: 'preparation',
      mutates_pixels: false,
      preparation_visible_effect_expected: false,
      requires_layer_target: true,
      changes_mask_clipping_order_blend: true,
    });
    expect(result.applicable_checks).toEqual([
      'document_target',
      'layer_target',
      'mask_clipping_order_blend',
    ]);
    expect(result.host_round_trips_added).toBe(0);
  });

  it('keeps unresolved prerequisite honest but allows explicitly independent work', () => {
    const blocked = resolvePassChecks({
      scope: 'local',
      mutates_pixels: true,
      recognition_prerequisite: 'unresolved',
      stage_prerequisite: 'satisfied',
    });
    expect(blocked.blocked_by_prerequisites).toEqual(['recognition_prerequisite']);
    expect(blocked.goal_achieved).toBe(false);

    const independent = resolvePassChecks({
      scope: 'local',
      mutates_pixels: true,
      recognition_prerequisite: 'unresolved',
      stage_prerequisite: 'satisfied',
      independent_region: true,
    });
    expect(independent.unresolved_prerequisites).toEqual(['recognition_prerequisite']);
    expect(independent.blocked_by_prerequisites).toEqual([]);
    expect(independent.independent_work_allowed).toBe(true);
    expect(independent.goal_achieved).toBe(false);
  });
});
