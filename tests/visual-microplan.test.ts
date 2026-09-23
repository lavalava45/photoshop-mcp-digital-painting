import { describe, expect, it } from 'vitest';
import {
  parseVisualMicroPlan,
  resolveVisualMicroPlanArgs,
} from '../src/core/visual-microplan.js';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import { createVisualMicroPlanTools } from '../src/tools/visual-microplan-tools.js';

function basePlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    plan_id: 'p1',
    summary: 'Refine one tower plane',
    stage: 'MEDIUM_FORM',
    scale: 'medium',
    region: 'tower-upper',
    intent: 'reinforce planar volume',
    method_class: 'paint',
    risk: 'low',
    expected_visual_delta: 'The upper tower plane becomes more coherent without changing adjacent regions.',
    verification_envelope: { mode: 'after_only' },
    layer_separation_check: {
      change_kind: 'continuation',
      substantial: true,
      rollback_value: 'low',
      independent_adjustment_expected: false,
      reasons: ['Continue refining the same existing tower form; no independent rollback unit is needed.'],
    },
    action_class: 'REFINE',
    expected_visual_result: 'The upper tower reads as a cleaner planar form.',
    protected_regions: ['lantern', 'sky silhouette'],
    document_id: 42,
    steps: [
      {
        id: 'paint',
        tool: 'photoshop_paint_dabs',
        args: { dabs: [{ x: 10, y: 20 }] },
      },
      {
        id: 'preview',
        tool: 'photoshop_get_preview',
        args: { max_dimension_px: 800 },
      },
    ],
    ...overrides,
  };
}

describe('parseVisualMicroPlan', () => {
  it('accepts preparation + one mutation + final preview', () => {
    const parsed = parseVisualMicroPlan(
      basePlan({
        steps: [
          { id: 'select', tool: 'photoshop_select_brush_preset', args: { name: 'Hard Round' } },
          { id: 'settings', tool: 'photoshop_get_brush_settings', args: {} },
          { id: 'paint', tool: 'photoshop_paint_strokes', args: { strokes: [{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] } },
          { id: 'preview', tool: 'photoshop_get_preview', args: {} },
        ],
      })
    );
    expect(parsed.mutationIndex).toBe(2);
    expect(parsed.captureIndex).toBe(3);
  });

  it('preserves relation-aware Planner/Painter context through the executable micro-plan', () => {
    const parsed = parseVisualMicroPlan(basePlan({
      planner_directive_id: 'directive-1',
      planner_task_id: 'task-1',
      painter_scope: 'local',
      change_domains: ['local-shape'],
      affected_relations: ['green mass remains left of the focal accent'],
      affected_qualities: ['clean white negative space'],
      preservation_facts: ['the focal accent layer is excluded from this pass'],
      independent_region: true,
      addresses_primary_mismatch: false,
      addresses_problem_id: 'problem-green-mass',
    }));

    expect(parsed.affectedRelations).toEqual(['green mass remains left of the focal accent']);
    expect(parsed.affectedQualities).toEqual(['clean white negative space']);
    expect(parsed.preservationFacts).toEqual(['the focal accent layer is excluded from this pass']);
    expect(parsed.independentRegion).toBe(true);
    expect(parsed.addressesPrimaryMismatch).toBe(false);
    expect(parsed.addressesProblemId).toBe('problem-green-mass');
  });

  it('accepts paint_regions as the single visual mutation', () => {
    const parsed = parseVisualMicroPlan(
      basePlan({
        stage: 'RECOGNITION_BLOCK_IN',
        scale: 'global',
        method_class: 'region',
        recognition_features: ['outer silhouette', 'light face mass', 'beak/feature wedge'],
        steps: [
          {
            id: 'masses',
            tool: 'photoshop_paint_regions',
            args: {
              regions: [
                {
                  color: { red: 20, green: 20, blue: 20 },
                  contours: [{ points: [{ x: 1, y: 1 }, { x: 20, y: 1 }, { x: 10, y: 20 }] }],
                },
              ],
            },
          },
          { id: 'preview', tool: 'photoshop_get_preview', args: {} },
        ],
      })
    );
    expect(parsed.mutationIndex).toBe(0);
    expect(parsed.recognitionFeatures).toHaveLength(3);
  });

  it('requires recognition block-in to be global and declare 3-7 recognition features', () => {
    expect(() =>
      parseVisualMicroPlan(basePlan({ stage: 'RECOGNITION_BLOCK_IN', scale: 'medium' }))
    ).toThrow(/scale=global/);

    expect(() =>
      parseVisualMicroPlan(basePlan({
        stage: 'RECOGNITION_BLOCK_IN',
        scale: 'global',
        recognition_features: ['silhouette', 'face'],
      }))
    ).toThrow(/3-7 recognition_features/);
  });

  it('validates protected layer ids and explicit replacement exceptions', () => {
    const parsed = parseVisualMicroPlan(basePlan({
      action_class: 'REPLACE',
      protected_layer_ids: [11, 22],
      replace_protected_layer_ids: [22],
    }));
    expect(parsed.protectedLayerIds).toEqual([11, 22]);
    expect(parsed.replaceProtectedLayerIds).toEqual([22]);

    expect(() => parseVisualMicroPlan(basePlan({ protected_layer_ids: [11, 11] }))).toThrow(/duplicate/);
    expect(() => parseVisualMicroPlan(basePlan({
      action_class: 'REPLACE',
      protected_layer_ids: [11],
      replace_protected_layer_ids: [22],
    }))).toThrow(/also declared/);
    expect(() => parseVisualMicroPlan(basePlan({
      protected_layer_ids: [11],
      replace_protected_layer_ids: [11],
    }))).toThrow(/REPLACE or ERASE/);
  });

  it('binds a new logical layer to exactly one reversible artistic hypothesis', () => {
    const parsed = parseVisualMicroPlan(basePlan({
      layer_separation_check: {
        change_kind: 'new-material',
        substantial: true,
        rollback_value: 'high',
        independent_adjustment_expected: true,
        reasons: ['The cheek-volume pass may need independent weakening or rollback.'],
      },
      logical_layer: {
        decision: 'create-new',
        hypothesis_id: 'cheek-volume',
        hypothesis: 'A separate cheek-volume pass should improve form without changing the eye socket.',
        rollback_value: 'high',
        expected_independent_rollback: true,
        separation_reasons: ['semantically separate correction', 'high rollback value'],
        layer_name: 'Cheek volume',
      },
      steps: [
        { id: 'layer', tool: 'photoshop_create_layer', args: { name: 'Cheek volume' } },
        {
          id: 'paint',
          tool: 'photoshop_paint_dabs',
          args: { layer_id: '$steps.layer.details.layerId', dabs: [{ x: 10, y: 20 }] },
        },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }));
    expect(parsed.logicalLayer?.decision).toBe('create-new');
    expect(parsed.logicalLayer?.createStepId).toBe('layer');
    expect(parsed.logicalLayer?.hypothesisId).toBe('cheek-volume');
  });

  it('requires Layer Separation Check isolation for substantial independent new concerns', () => {
    for (const changeKind of ['new-object', 'new-material', 'new-light', 'new-plane']) {
      expect(() => parseVisualMicroPlan(basePlan({
        layer_separation_check: {
          change_kind: changeKind,
          substantial: true,
          rollback_value: 'moderate',
          independent_adjustment_expected: true,
          reasons: ['This new concern may need independent correction later.'],
        },
      }))).toThrow(/Layer Separation Check.*create-new or temporary-hypothesis/);
    }
  });

  it('accepts a Layer Separation Check when the required independent concern is isolated', () => {
    const parsed = parseVisualMicroPlan(basePlan({
      layer_separation_check: {
        change_kind: 'new-object',
        substantial: true,
        rollback_value: 'moderate',
        independent_adjustment_expected: true,
        reasons: ['The object silhouette may need independent transform and rollback.'],
      },
      logical_layer: {
        decision: 'create-new',
        hypothesis_id: 'new-object',
        hypothesis: 'Keep the new object independently editable.',
        rollback_value: 'moderate',
        expected_independent_rollback: true,
        separation_reasons: ['independent silhouette and transform'],
        layer_name: 'New object',
      },
      steps: [
        { id: 'layer', tool: 'photoshop_create_layer', args: { name: 'New object' } },
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { layer_id: '$steps.layer.details.layerId', dabs: [{ x: 10, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }));
    expect(parsed.layerSeparationCheck.requiresIsolation).toBe(true);
    expect(parsed.logicalLayer?.decision).toBe('create-new');
  });

  it('does not force a new layer for low-value continuation or a tiny accent', () => {
    const continuation = parseVisualMicroPlan(basePlan());
    expect(continuation.layerSeparationCheck.requiresIsolation).toBe(false);
    expect(continuation.logicalLayer).toBeUndefined();

    const tinyAccent = parseVisualMicroPlan(basePlan({
      scale: 'micro',
      significance_mode: 'subtle_local',
      problem_id: 'tiny-accent',
      verification_envelope: { mode: 'before_after', min_focus_dimension_px: 800 },
      layer_separation_check: {
        change_kind: 'other',
        substantial: false,
        rollback_value: 'low',
        independent_adjustment_expected: false,
        reasons: ['A tiny accent belongs to the existing surface and has negligible rollback value.'],
      },
      steps: [
        { id: 'before', tool: 'photoshop_get_preview', args: { focus_region: { left: 0, top: 0, right: 900, bottom: 900 } } },
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 10, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: { focus_region: { left: 0, top: 0, right: 900, bottom: 900 } } },
      ],
    }));
    expect(tinyAccent.layerSeparationCheck.requiresIsolation).toBe(false);
  });

  it('rejects a required isolation that merely continues an existing layer', () => {
    expect(() => parseVisualMicroPlan(basePlan({
      layer_separation_check: {
        change_kind: 'new-light',
        substantial: true,
        rollback_value: 'high',
        independent_adjustment_expected: true,
        reasons: ['The new light effect must remain independently adjustable.'],
      },
      logical_layer: {
        decision: 'continue-logical-layer',
        hypothesis_id: 'old-light',
        hypothesis: 'Continue an existing light layer.',
        rollback_value: 'high',
        expected_independent_rollback: true,
        separation_reasons: [],
        layer_id: 77,
      },
      steps: [
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { layer_id: 77, dabs: [{ x: 10, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/Layer Separation Check.*create-new or temporary-hypothesis/);
  });

  it('keeps Layer Separation Check rollback value consistent with logical layer metadata', () => {
    expect(() => parseVisualMicroPlan(basePlan({
      layer_separation_check: {
        change_kind: 'new-object',
        substantial: true,
        rollback_value: 'moderate',
        independent_adjustment_expected: true,
        reasons: ['The object should be independently correctable.'],
      },
      logical_layer: {
        decision: 'create-new',
        hypothesis_id: 'mismatch',
        hypothesis: 'Mismatched rollback metadata should fail.',
        rollback_value: 'high',
        expected_independent_rollback: true,
        separation_reasons: ['independent object'],
        layer_name: 'Mismatch',
      },
      steps: [
        { id: 'layer', tool: 'photoshop_create_layer', args: { name: 'Mismatch' } },
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { layer_id: '$steps.layer.details.layerId', dabs: [{ x: 10, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/rollback_value must match/);
  });

  it('continues an existing logical layer without creating another layer', () => {
    const parsed = parseVisualMicroPlan(basePlan({
      layer_separation_check: {
        change_kind: 'continuation',
        substantial: true,
        rollback_value: 'high',
        independent_adjustment_expected: true,
        reasons: ['Continue the existing independently reversible cheek-volume layer.'],
      },
      logical_layer: {
        decision: 'continue-logical-layer',
        hypothesis_id: 'cheek-volume',
        hypothesis: 'Continue the already accepted cheek-volume rollback unit.',
        rollback_value: 'high',
        expected_independent_rollback: true,
        separation_reasons: [],
        layer_id: 77,
      },
      steps: [
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { layer_id: 77, dabs: [{ x: 10, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }));
    expect(parsed.logicalLayer?.layerId).toBe(77);

    expect(() => parseVisualMicroPlan(basePlan({
      layer_separation_check: {
        change_kind: 'continuation',
        substantial: true,
        rollback_value: 'high',
        independent_adjustment_expected: true,
        reasons: ['Continue the existing independently reversible cheek-volume layer.'],
      },
      logical_layer: {
        decision: 'continue-logical-layer',
        hypothesis_id: 'cheek-volume',
        hypothesis: 'Continue cheek volume.',
        rollback_value: 'high',
        expected_independent_rollback: true,
        separation_reasons: [],
        layer_id: 77,
      },
      steps: [
        { id: 'extra', tool: 'photoshop_create_layer', args: { name: 'Unnecessary' } },
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { layer_id: 77, dabs: [{ x: 10, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/anti-layer-explosion/);
  });

  it('rejects layer-per-stroke explosion and cross-layer mutations inside one hypothesis', () => {
    expect(() => parseVisualMicroPlan(basePlan({
      layer_separation_check: {
        change_kind: 'new-material',
        substantial: true,
        rollback_value: 'moderate',
        independent_adjustment_expected: true,
        reasons: ['Texture is independently reversible but should remain one logical layer.'],
      },
      logical_layer: {
        decision: 'create-new',
        hypothesis_id: 'skin-texture',
        hypothesis: 'Texture should be independently reversible.',
        rollback_value: 'moderate',
        expected_independent_rollback: true,
        separation_reasons: ['temporary texture hypothesis'],
        layer_name: 'Skin texture',
      },
      steps: [
        { id: 'l1', tool: 'photoshop_create_layer', args: { name: 'Skin texture' } },
        { id: 'l2', tool: 'photoshop_create_layer', args: { name: 'Stroke 2' } },
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { layer_id: '$steps.l1.details.layerId', dabs: [{ x: 10, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/exactly one photoshop_create_layer/);

    expect(() => parseVisualMicroPlan(basePlan({
      layer_separation_check: {
        change_kind: 'new-material',
        substantial: true,
        rollback_value: 'moderate',
        independent_adjustment_expected: true,
        reasons: ['Texture is independently reversible but should remain one logical layer.'],
      },
      logical_layer: {
        decision: 'create-new',
        hypothesis_id: 'skin-texture',
        hypothesis: 'Texture should be independently reversible.',
        rollback_value: 'moderate',
        expected_independent_rollback: true,
        separation_reasons: ['temporary texture hypothesis'],
        layer_name: 'Skin texture',
      },
      steps: [
        { id: 'layer', tool: 'photoshop_create_layer', args: { name: 'Skin texture' } },
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { layer_id: 99, dabs: [{ x: 10, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/must target \$steps\.layer\.details\.layerId/);
  });

  it('keeps keep/discard/merge as explicit layer lifecycle decisions outside paint microplans', () => {
    for (const decision of ['keep', 'discard', 'merge']) {
      expect(() => parseVisualMicroPlan(basePlan({
        layer_separation_check: {
          change_kind: 'continuation',
          substantial: true,
          rollback_value: 'high',
          independent_adjustment_expected: true,
          reasons: ['Lifecycle operation refers to the existing high-value cheek-volume layer.'],
        },
        logical_layer: {
          decision,
          hypothesis_id: 'cheek-volume',
          hypothesis: 'Cheek volume lifecycle decision.',
          rollback_value: 'high',
          expected_independent_rollback: true,
          separation_reasons: [],
          layer_id: 77,
          ...(decision === 'merge' ? { merge_target_layer_id: 55 } : {}),
        },
      }))).toThrow(/lifecycle decision/);
    }
  });

  it('rejects zero visual mutations but accepts a bounded related mutation bundle', () => {
    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          steps: [
            { id: 'state', tool: 'photoshop_get_state', args: {} },
            { id: 'preview', tool: 'photoshop_get_preview', args: {} },
          ],
        })
      )
    ).toThrow(/requires 1-4 visual mutations/);

    const parsed = parseVisualMicroPlan(
      basePlan({
        steps: [
          { id: 'p1', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
          { id: 'p2', tool: 'photoshop_paint_strokes', args: { strokes: [{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] } },
          { id: 'preview', tool: 'photoshop_get_preview', args: {} },
        ],
      })
    );
    expect(parsed.mutationIndexes).toEqual([0, 1]);
    expect(parsed.lastMutationIndex).toBe(1);
  });

  it('forbids batching across region, method class, or hidden higher risk while step prose stays explanatory', () => {
    expect(() => parseVisualMicroPlan(basePlan({
      steps: [
        { id: 'p1', tool: 'photoshop_paint_dabs', region: 'other-region', args: { dabs: [{ x: 1, y: 1 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/region must match/);

    const withDifferentStepDescription = parseVisualMicroPlan(basePlan({
      steps: [
        { id: 'p1', tool: 'photoshop_paint_dabs', description: 'Use a broader gesture here', args: { dabs: [{ x: 1, y: 1 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }));
    expect(withDifferentStepDescription.steps[0]!.description).toBe('Use a broader gesture here');

    expect(() => parseVisualMicroPlan(basePlan({
      steps: [
        { id: 'fill', tool: 'photoshop_fill_layer', args: {} },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/method class is incompatible/);

    expect(() => parseVisualMicroPlan(basePlan({
      risk: 'low',
      steps: [
        { id: 'p1', tool: 'photoshop_paint_dabs', risk: 'high', args: { dabs: [{ x: 1, y: 1 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/cannot be hidden/);
  });

  it('supports executable Pencil, Smudge, Eraser and region method classes', () => {
    for (const [methodClass, strokeTool] of [
      ['line', 'PENCIL'],
      ['smudge', 'SMUDGE'],
      ['erase', 'ERASER'],
    ] as const) {
      const parsed = parseVisualMicroPlan(basePlan({
        method_class: methodClass,
        steps: [
          {
            id: 'stroke',
            tool: 'photoshop_paint_strokes',
            args: { strokes: [{ tool: strokeTool, points: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }] },
          },
          { id: 'preview', tool: 'photoshop_get_preview', args: {} },
        ],
      }));
      expect(parsed.methodClass).toBe(methodClass);
    }

    const region = parseVisualMicroPlan(basePlan({
      stage: 'SHAPE',
      method_class: 'region',
      steps: [
        {
          id: 'mass',
          tool: 'photoshop_paint_regions',
          args: {
            regions: [{
              color: { red: 1, green: 2, blue: 3 },
              contours: [{ points: [{ x: 1, y: 1 }, { x: 20, y: 1 }, { x: 10, y: 20 }] }],
            }],
          },
        },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }));
    expect(region.methodClass).toBe('region');
  });

  it('rejects method classes that do not match the actual stroke mechanism', () => {
    expect(() => parseVisualMicroPlan(basePlan({
      method_class: 'line',
      steps: [
        { id: 'stroke', tool: 'photoshop_paint_strokes', args: { strokes: [{ tool: 'BRUSH', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/method class is incompatible/);

    expect(() => parseVisualMicroPlan(basePlan({
      method_class: 'line',
      steps: [
        {
          id: 'mixed',
          tool: 'photoshop_paint_strokes',
          args: { strokes: [
            { tool: 'PENCIL', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
            { tool: 'SMUDGE', points: [{ x: 3, y: 3 }, { x: 4, y: 4 }] },
          ] },
        },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/method class is incompatible/);
  });

  it('allows preset-brush only after explicit preset selection', () => {
    expect(() => parseVisualMicroPlan(basePlan({
      method_class: 'preset-brush',
      steps: [
        { id: 'preset', tool: 'photoshop_select_brush_preset', args: { name: 'Dry Media Test' } },
        { id: 'stroke', tool: 'photoshop_paint_strokes', method_id: 'installed-brush-preset', args: { strokes: [{ tool: 'BRUSH', points: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/requires paint_strategy/);

    const parsed = parseVisualMicroPlan(basePlan({
      method_class: 'preset-brush',
      paint_strategy: {
        material_role: 'terrain',
        visual_intent: 'broken-mass',
        brush_role: 'broken-terrain',
        preset_name: 'Dry Media Test',
        pressure_policy: 'native-preset',
      },
      steps: [
        { id: 'preset', tool: 'photoshop_select_brush_preset', args: { name: 'Dry Media Test' } },
        { id: 'stroke', tool: 'photoshop_paint_strokes', method_id: 'installed-brush-preset', args: { strokes: [{ tool: 'BRUSH', points: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }));
    expect(parsed.methodClass).toBe('preset-brush');

    expect(() => parseVisualMicroPlan(basePlan({
      method_class: 'preset-brush',
      paint_strategy: {
        material_role: 'terrain',
        visual_intent: 'broken-mass',
        brush_role: 'broken-terrain',
        preset_name: 'Dry Media Test',
        pressure_policy: 'native-preset',
      },
      steps: [
        { id: 'stroke', tool: 'photoshop_paint_strokes', method_id: 'installed-brush-preset', args: { strokes: [{ tool: 'BRUSH', points: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/preset_name must match/);

    expect(() => parseVisualMicroPlan(basePlan({
      method_class: 'preset-brush',
      paint_strategy: {
        material_role: 'terrain',
        visual_intent: 'broken-mass',
        brush_role: 'broken-terrain',
        preset_name: 'Dry Media Test',
        pressure_policy: 'native-preset',
      },
      steps: [
        { id: 'preset', tool: 'photoshop_select_brush_preset', args: { name: 'Dry Media Test' } },
        { id: 'stroke', tool: 'photoshop_paint_strokes', args: { strokes: [{ tool: 'BRUSH', points: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/must declare method_id/);
  });

  it('rejects paint_regions after block-in stages instead of allowing polygon refinement', () => {
    expect(() => parseVisualMicroPlan(basePlan({
      stage: 'MEDIUM_FORM',
      method_class: 'region',
      steps: [
        {
          id: 'mass',
          tool: 'photoshop_paint_regions',
          args: {
            regions: [{
              color: { red: 1, green: 2, blue: 3 },
              contours: [{ points: [{ x: 1, y: 1 }, { x: 20, y: 1 }, { x: 10, y: 20 }] }],
            }],
          },
        },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/temporary block-in scaffold/);
  });

  it('requires declared simulated pressure to be present in the actual brush strokes', () => {
    const strategy = {
      material_role: 'water',
      visual_intent: 'surface-flow',
      brush_role: 'water-flow',
      preset_name: 'Water Brush',
      pressure_policy: 'simulated-size-opacity',
    };
    expect(() => parseVisualMicroPlan(basePlan({
      method_class: 'preset-brush',
      paint_strategy: strategy,
      steps: [
        { id: 'preset', tool: 'photoshop_select_brush_preset', args: { name: 'Water Brush' } },
        {
          id: 'stroke',
          tool: 'photoshop_paint_strokes',
          method_id: 'installed-brush-preset',
          args: { strokes: [{ tool: 'BRUSH', points: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }] },
        },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/simulated size pressure/);

    const parsed = parseVisualMicroPlan(basePlan({
      method_class: 'preset-brush',
      paint_strategy: strategy,
      steps: [
        { id: 'preset', tool: 'photoshop_select_brush_preset', args: { name: 'Water Brush' } },
        {
          id: 'stroke',
          tool: 'photoshop_paint_strokes',
          method_id: 'installed-brush-preset',
          args: {
            strokes: [{
              tool: 'BRUSH',
              points: [{ x: 1, y: 1 }, { x: 20, y: 20 }],
              dynamics: { size: [80, 25], opacity: [70, 25] },
            }],
          },
        },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }));
    expect(parsed.paintStrategy?.pressurePolicy).toBe('simulated-size-opacity');

    expect(() => parseVisualMicroPlan(basePlan({
      method_class: 'preset-brush',
      paint_strategy: {
        ...strategy,
        pressure_policy: 'simulated-opacity',
      },
      steps: [
        { id: 'preset', tool: 'photoshop_select_brush_preset', args: { name: 'Water Brush' } },
        {
          id: 'stroke',
          tool: 'photoshop_paint_strokes',
          method_id: 'installed-brush-preset',
          args: {
            strokes: [{
              tool: 'BRUSH',
              points: [{ x: 1, y: 1 }, { x: 20, y: 20 }],
              dynamics: { size: [80, 25] },
            }],
          },
        },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/simulated opacity pressure/);
  });

  it('forbids non-mutation steps inside the mutation transaction', () => {
    expect(() => parseVisualMicroPlan(basePlan({
      steps: [
        { id: 'p1', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
        { id: 'state', tool: 'photoshop_get_state', args: {} },
        { id: 'p2', tool: 'photoshop_paint_strokes', args: { strokes: [{ points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/contiguous bounded transaction/);
  });

  it('requires the preview immediately after the mutation', () => {
    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          steps: [
            { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
            { id: 'state', tool: 'photoshop_get_state', args: {} },
            { id: 'preview', tool: 'photoshop_get_preview', args: {} },
          ],
        })
      )
    ).toThrow(/immediately followed/);
  });

  it('allows one before preview immediately before the mutation', () => {
    const parsed = parseVisualMicroPlan(
      basePlan({
        steps: [
          { id: 'state', tool: 'photoshop_get_state', args: {} },
          {
            id: 'before',
            tool: 'photoshop_get_preview',
            args: { focus_region: { left: 10, top: 10, right: 80, bottom: 80 } },
          },
          { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
          {
            id: 'after',
            tool: 'photoshop_get_preview',
            args: { focus_region: { left: 10, top: 10, right: 80, bottom: 80 } },
          },
        ],
      })
    );
    expect(parsed.beforeCaptureIndex).toBe(1);
    expect(parsed.mutationIndex).toBe(2);
    expect(parsed.captureIndex).toBe(3);
  });

  it('requires matching before/after focus previews for small local work', () => {
    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          scale: 'small',
          problem_id: 'eye-shape',
          steps: [
            { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 20, y: 20 }] } },
            { id: 'after', tool: 'photoshop_get_preview', args: { focus_region: { left: 10, top: 10, right: 80, bottom: 80 } } },
          ],
        })
      )
    ).toThrow(/requires an immediately-before preview/);

    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          scale: 'small',
          problem_id: 'eye-shape',
          steps: [
            { id: 'before', tool: 'photoshop_get_preview', args: { focus_region: { left: 10, top: 10, right: 80, bottom: 80 } } },
            { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 20, y: 20 }] } },
            { id: 'after', tool: 'photoshop_get_preview', args: { focus_region: { left: 11, top: 10, right: 80, bottom: 80 } } },
          ],
        })
      )
    ).toThrow(/same focus_region/);

    const parsed = parseVisualMicroPlan(
      basePlan({
        scale: 'small',
        problem_id: 'eye-shape',
        significance_mode: 'subtle_local',
        verification_envelope: { mode: 'before_after', min_focus_dimension_px: 800 },
        steps: [
          {
            id: 'before',
            tool: 'photoshop_get_preview',
            args: {
              focus_region: { left: 10, top: 10, right: 80, bottom: 80 },
              focus_max_dimension_px: 1200,
            },
          },
          { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 20, y: 20 }] } },
          {
            id: 'after',
            tool: 'photoshop_get_preview',
            args: {
              focus_region: { left: 10, top: 10, right: 80, bottom: 80 },
              focus_max_dimension_px: 1200,
            },
          },
        ],
      })
    );
    expect(parsed.significanceMode).toBe('subtle_local');
    expect(parsed.beforeCaptureIndex).toBe(0);
  });

  it('rejects subtle_local without a stable problem_id', () => {
    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          significance_mode: 'subtle_local',
          verification_envelope: { mode: 'before_after', min_focus_dimension_px: 800 },
          steps: [
            { id: 'before', tool: 'photoshop_get_preview', args: { focus_region: { left: 10, top: 10, right: 80, bottom: 80 } } },
            { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 20, y: 20 }] } },
            { id: 'after', tool: 'photoshop_get_preview', args: { focus_region: { left: 10, top: 10, right: 80, bottom: 80 } } },
          ],
        })
      )
    ).toThrow(/requires problem_id/);
  });

  it('requires subtle_local verification envelope to preserve >=800px before/after inspection', () => {
    expect(() => parseVisualMicroPlan(basePlan({
      problem_id: 'eye-shape',
      significance_mode: 'subtle_local',
      verification_envelope: { mode: 'after_only', min_focus_dimension_px: 800 },
      steps: [
        { id: 'before', tool: 'photoshop_get_preview', args: { focus_region: { left: 10, top: 10, right: 80, bottom: 80 }, focus_max_dimension_px: 800 } },
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 20, y: 20 }] } },
        { id: 'after', tool: 'photoshop_get_preview', args: { focus_region: { left: 10, top: 10, right: 80, bottom: 80 }, focus_max_dimension_px: 800 } },
      ],
    }))).toThrow(/mode=before_after/);

    expect(() => parseVisualMicroPlan(basePlan({
      problem_id: 'eye-shape',
      significance_mode: 'subtle_local',
      verification_envelope: { mode: 'before_after', min_focus_dimension_px: 799 },
      steps: [
        { id: 'before', tool: 'photoshop_get_preview', args: { focus_region: { left: 10, top: 10, right: 80, bottom: 80 }, focus_max_dimension_px: 800 } },
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 20, y: 20 }] } },
        { id: 'after', tool: 'photoshop_get_preview', args: { focus_region: { left: 10, top: 10, right: 80, bottom: 80 }, focus_max_dimension_px: 800 } },
      ],
    }))).toThrow(/min_focus_dimension_px >= 800/);
  });

  it('rejects a before preview that is not adjacent to the mutation', () => {
    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          steps: [
            { id: 'before', tool: 'photoshop_get_preview', args: {} },
            { id: 'state', tool: 'photoshop_get_state', args: {} },
            { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
            { id: 'after', tool: 'photoshop_get_preview', args: {} },
          ],
        })
      )
    ).toThrow(/before preview must be immediately before/);
  });

  it('accepts preset selection without a redundant settings read', () => {
    const parsed = parseVisualMicroPlan(
      basePlan({
        steps: [
          { id: 'select', tool: 'photoshop_select_brush_preset', args: { name: 'Charcoal' } },
          { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
          { id: 'preview', tool: 'photoshop_get_preview', args: {} },
        ],
      })
    );
    expect(parsed.mutationIndex).toBe(1);
  });

  it('rejects forward and unknown step references', () => {
    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          steps: [
            { id: 'state', tool: 'photoshop_get_state', args: { x: '$steps.paint.details.x' } },
            { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
            { id: 'preview', tool: 'photoshop_get_preview', args: {} },
          ],
        })
      )
    ).toThrow(/earlier step/);
  });

  it('resolves normalized earlier-step placeholders', () => {
    const resolved = resolveVisualMicroPlanArgs(
      { document_id: '$steps.state.document.id', value: '$steps.sample.rgb.red' },
      {
        state: { document: { id: 77 } },
        sample: { rgb: { red: 123 } },
      }
    );
    expect(resolved).toEqual({ document_id: 77, value: 123 });
  });
});

function definition(
  name: string,
  handler: ToolDefinition['handler'],
  documentBound = false
): ToolDefinition {
  return {
    tool: {
      name,
      description: 'test',
      inputSchema: {
        type: 'object',
        properties: documentBound ? { document_id: { type: 'number' } } : {},
      },
    },
    handler,
  };
}

function knownGoodCreateNewRegionPlan(): Record<string, unknown> {
  return {
    plan_id: 'known-good-region-plan',
    summary: 'Block in one broad atmospheric plane',
    stage: 'RECOGNITION_BLOCK_IN',
    scale: 'global',
    region: 'whole-canvas-atmosphere',
    region_bounds: { left: 0, top: 0, right: 100, bottom: 100 },
    intent: 'Establish the broad atmospheric field without local detail',
    method_class: 'region',
    risk: 'low',
    expected_visual_delta: 'A broad cool atmospheric field becomes visible across the composition.',
    verification_envelope: { mode: 'after_only', min_focus_dimension_px: 900 },
    layer_separation_check: {
      change_kind: 'new-plane',
      substantial: true,
      rollback_value: 'high',
      independent_adjustment_expected: true,
      reasons: ['The atmosphere is an independent plane that may need later recoloring or rollback.'],
    },
    logical_layer: {
      decision: 'create-new',
      hypothesis_id: 'atmosphere-plane',
      hypothesis: 'A separate atmospheric layer keeps the global field independently adjustable.',
      rollback_value: 'high',
      expected_independent_rollback: true,
      separation_reasons: ['Keep the broad atmosphere independent from later landscape forms.'],
      layer_name: 'Atmosphere',
    },
    problem_id: 'recognition-atmosphere',
    action_class: 'ADD',
    expected_visual_result: 'The whole-image atmosphere reads as one coherent cool field.',
    failure_signals: ['white canvas remains', 'unexpected hard local detail'],
    recognition_features: ['broad sky field', 'clear horizon band', 'open foreground corridor'],
    style_recognition_features: ['soft book-illustration value grouping'],
    protected_regions: [],
    protected_layer_ids: [],
    replace_protected_layer_ids: [],
    document_id: 42,
    steps: [
      {
        id: 'layer',
        tool: 'photoshop_create_layer',
        args: { name: 'Atmosphere' },
      },
      {
        id: 'paint',
        tool: 'photoshop_paint_regions',
        args: {
          regions: [{
            id: 'atmosphere-field',
            layer_id: '$steps.layer.details.layerId',
            color: { red: 25, green: 50, blue: 70 },
            opacity: 100,
            contours: [{
              operation: 'ADD',
              points: [
                { x: 10, y: 10 },
                { x: 90, y: 10 },
                { x: 90, y: 90 },
                { x: 10, y: 90 },
              ],
            }],
          }],
        },
      },
      {
        id: 'preview',
        tool: 'photoshop_get_preview',
        args: { max_dimension_px: 1000, quality: 8 },
      },
    ],
  };
}

describe('photoshop_execute_visual_microplan', () => {
  it('keeps a known-good create-new region template valid across schema, parser and handler preflight without Photoshop', async () => {
    const registry = new ToolRegistry();
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    registry.register(
      'photoshop_create_layer',
      definition('photoshop_create_layer', async (args) => {
        calls.push({ tool: 'photoshop_create_layer', args });
        return {
          content: [{ type: 'text', text: JSON.stringify({ ok: true, details: { layerId: 77, layerName: 'Atmosphere' } }) }],
        };
      }, true)
    );
    registry.register(
      'photoshop_paint_regions',
      definition('photoshop_paint_regions', async (args) => {
        calls.push({ tool: 'photoshop_paint_regions', args });
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, details: { painted_regions: [{ layer_id: 77 }] } }) }] };
      }, true)
    );
    registry.register(
      'photoshop_get_preview',
      definition('photoshop_get_preview', async (args) => {
        calls.push({ tool: 'photoshop_get_preview', args });
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, sha256: 'known-good-frame' }) }] };
      }, true)
    );

    const plan = knownGoodCreateNewRegionPlan();
    const tool = createVisualMicroPlanTools(registry)[0]!;
    const schema = tool.tool.inputSchema as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    for (const key of schema.required ?? []) expect(plan).toHaveProperty(key);
    for (const key of Object.keys(plan)) expect(schema.properties).toHaveProperty(key);

    const parsed = parseVisualMicroPlan(plan);
    expect(parsed.logicalLayer?.createStepId).toBe('layer');
    expect(parsed.mutationIndexes).toEqual([1]);
    expect(parsed.captureIndex).toBe(2);

    const result = await tool.handler(plan);
    expect(result.isError).not.toBe(true);
    expect(calls.map(call => call.tool)).toEqual([
      'photoshop_create_layer',
      'photoshop_paint_regions',
      'photoshop_get_preview',
    ]);
    const paint = calls.find(call => call.tool === 'photoshop_paint_regions')!;
    const regions = paint.args.regions as Array<Record<string, unknown>>;
    expect(regions[0]!.layer_id).toBe(77);
    expect(paint.args.document_id).toBe(42);
  });

  it('marks schema validation failures as guaranteed not-executed', async () => {
    const registry = new ToolRegistry();
    const result = await createVisualMicroPlanTools(registry)[0]!.handler({
      ...basePlan(),
      steps: [
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 10, y: 20 }] } },
      ],
    });

    expect(result.isError).toBe(true);
    const text = result.content.find((item) => item.type === 'text');
    const body = JSON.parse(text && 'text' in text ? text.text : '{}');
    expect(body.code).toBe('invalid_visual_microplan');
    expect(body.execution).toBe('not-executed');
    expect(body.visual_mutation_started).toBe(false);
  });

  it('validates nested mutation arguments before any preparation step executes', async () => {
    const registry = new ToolRegistry();
    let createLayerCalls = 0;
    let paintCalls = 0;
    let previewCalls = 0;
    registry.register('photoshop_create_layer', {
      tool: {
        name: 'photoshop_create_layer',
        description: 'test create layer',
        inputSchema: {
          type: 'object',
          properties: { document_id: { type: 'number' }, name: { type: 'string' } },
        },
      },
      handler: async () => {
        createLayerCalls++;
        return { content: [{ type: 'text', text: '{"ok":true,"details":{"layerId":77}}' }] };
      },
    });
    registry.register('photoshop_paint_regions', {
      tool: {
        name: 'photoshop_paint_regions',
        description: 'test region paint',
        inputSchema: {
          type: 'object',
          properties: {
            document_id: { type: 'number' },
            regions: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  layer_id: { type: 'number', minimum: 1 },
                  color: {
                    type: 'object',
                    properties: {
                      red: { type: 'number' }, green: { type: 'number' }, blue: { type: 'number' },
                    },
                    required: ['red', 'green', 'blue'],
                  },
                  contours: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      properties: {
                        points: { type: 'array', minItems: 3, items: { type: 'object' } },
                      },
                      required: ['points'],
                    },
                  },
                },
                required: ['color', 'contours'],
              },
            },
          },
          required: ['regions'],
        },
      },
      handler: async () => {
        paintCalls++;
        return { content: [{ type: 'text', text: '{"ok":true}' }] };
      },
    });
    registry.register('photoshop_get_preview', {
      tool: {
        name: 'photoshop_get_preview',
        description: 'test preview',
        inputSchema: {
          type: 'object',
          properties: { document_id: { type: 'number' }, max_dimension_px: { type: 'number' }, quality: { type: 'number' } },
        },
      },
      handler: async () => {
        previewCalls++;
        return { content: [{ type: 'text', text: '{"ok":true,"sha256":"never"}' }] };
      },
    });

    const plan = structuredClone(knownGoodCreateNewRegionPlan()) as any;
    plan.steps[1].args.regions[0].contours = [];
    const result = await createVisualMicroPlanTools(registry)[0]!.handler(plan);

    expect(result.isError).toBe(true);
    const text = result.content.find((item) => item.type === 'text');
    const body = JSON.parse(text && 'text' in text ? text.text : '{}');
    expect(body).toMatchObject({
      code: 'invalid_visual_microplan',
      execution: 'not-executed',
      visual_mutation_started: false,
    });
    expect(body.message).toMatch(/contours.*at least 1 item/i);
    expect(createLayerCalls).toBe(0);
    expect(paintCalls).toBe(0);
    expect(previewCalls).toBe(0);
  });

  it('fails closed before dispatch when protected layers are declared but the mutation target is not pinned', async () => {
    const registry = new ToolRegistry();
    let paintCalls = 0;
    let previewCalls = 0;
    registry.register(
      'photoshop_paint_dabs',
      definition(
        'photoshop_paint_dabs',
        async () => {
          paintCalls++;
          return { content: [{ type: 'text', text: '{"ok":true}' }] };
        },
        true
      )
    );
    registry.register(
      'photoshop_get_preview',
      definition(
        'photoshop_get_preview',
        async () => {
          previewCalls++;
          return { content: [{ type: 'text', text: '{"ok":true,"sha256":"never"}' }] };
        },
        true
      )
    );

    const result = await createVisualMicroPlanTools(registry)[0]!.handler(basePlan({
      protected_layer_ids: [77],
    }));
    expect(result.isError).toBe(true);
    expect(paintCalls).toBe(0);
    expect(previewCalls).toBe(0);
    const text = result.content.find((item) => item.type === 'text');
    expect(text && 'text' in text ? text.text : '').toContain('protected_layer_violation');
    expect(text && 'text' in text ? text.text : '').toContain('requires explicit photoshop_paint_dabs.layer_id');
  });

  it('blocks a protected target and permits only an explicit REPLACE exception', async () => {
    const registry = new ToolRegistry();
    const paintArgs: Record<string, unknown>[] = [];
    registry.register(
      'photoshop_paint_dabs',
      definition(
        'photoshop_paint_dabs',
        async (args) => {
          paintArgs.push(args);
          return { content: [{ type: 'text', text: '{"ok":true}' }] };
        },
        true
      )
    );
    registry.register(
      'photoshop_get_preview',
      definition(
        'photoshop_get_preview',
        async () => ({
          content: [
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' },
            { type: 'text', text: '{"ok":true,"sha256":"sha-protected"}' },
          ],
        }),
        true
      )
    );
    const tool = createVisualMicroPlanTools(registry)[0]!;
    const blocked = await tool.handler(basePlan({
      protected_layer_ids: [77],
      steps: [
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { layer_id: 77, dabs: [{ x: 10, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: { max_dimension_px: 800 } },
      ],
    }));
    expect(blocked.isError).toBe(true);
    expect(paintArgs).toHaveLength(0);

    const allowed = await tool.handler(basePlan({
      plan_id: 'replace-protected',
      action_class: 'REPLACE',
      protected_layer_ids: [77],
      replace_protected_layer_ids: [77],
      steps: [
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { layer_id: 77, dabs: [{ x: 10, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: { max_dimension_px: 800 } },
      ],
    }));
    expect(allowed.isError).not.toBe(true);
    expect(paintArgs).toHaveLength(1);
    expect(paintArgs[0]!.layer_id).toBe(77);
  });

  it('requires every paint_regions target to be explicit when protected layers are active', async () => {
    const registry = new ToolRegistry();
    let regionCalls = 0;
    registry.register(
      'photoshop_paint_regions',
      definition(
        'photoshop_paint_regions',
        async () => {
          regionCalls++;
          return { content: [{ type: 'text', text: '{"ok":true}' }] };
        },
        true
      )
    );
    registry.register(
      'photoshop_get_preview',
      definition(
        'photoshop_get_preview',
        async () => ({ content: [{ type: 'text', text: '{"ok":true,"sha256":"never"}' }] }),
        true
      )
    );
    const result = await createVisualMicroPlanTools(registry)[0]!.handler(basePlan({
      stage: 'SHAPE',
      method_class: 'region',
      protected_layer_ids: [77],
      steps: [
        {
          id: 'paint',
          tool: 'photoshop_paint_regions',
          args: { regions: [{ color: { red: 1, green: 2, blue: 3 }, contours: [{ points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }] }] }] },
        },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }));
    expect(result.isError).toBe(true);
    expect(regionCalls).toBe(0);
    const text = result.content.find((item) => item.type === 'text');
    expect(text && 'text' in text ? text.text : '').toContain('protected_layer_violation');
  });

  it('returns compact continuation metadata for layers created during preparation', async () => {
    const registry = new ToolRegistry();
    registry.register(
      'photoshop_create_layer',
      definition(
        'photoshop_create_layer',
        async () => ({
          content: [{ type: 'text', text: '{"ok":true,"details":{"layerId":77,"layerName":"Feature Layer"}}' }],
        }),
        true
      )
    );
    registry.register(
      'photoshop_paint_dabs',
      definition(
        'photoshop_paint_dabs',
        async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }),
        true
      )
    );
    registry.register(
      'photoshop_get_preview',
      definition(
        'photoshop_get_preview',
        async () => ({ content: [{ type: 'text', text: '{"ok":true,"sha256":"sha-continuation"}' }] }),
        true
      )
    );

    const result = await createVisualMicroPlanTools(registry)[0]!.handler(basePlan({
      steps: [
        { id: 'feature', tool: 'photoshop_create_layer', args: { name: 'Feature Layer' } },
        { id: 'paint', tool: 'photoshop_paint_dabs', args: { layer_id: 77, dabs: [{ x: 10, y: 20 }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }));
    expect(result.isError).not.toBe(true);
    const text = result.content.find((item) => item.type === 'text');
    const body = JSON.parse(text && 'text' in text ? text.text : '{}');
    expect(body.continuation_layers).toEqual([
      { step_id: 'feature', layer_id: 77, layer_name: 'Feature Layer' },
    ]);
  });

  it('packs one mutation + preview into one call and blocks the next call until verdict', async () => {
    const registry = new ToolRegistry();
    const paintArgs: Record<string, unknown>[] = [];
    registry.register(
      'photoshop_paint_dabs',
      definition(
        'photoshop_paint_dabs',
        async (args) => {
          paintArgs.push(args);
          return { content: [{ type: 'text', text: '{"ok":true,"details":{"dab_count":1}}' }] };
        },
        true
      )
    );
    registry.register(
      'photoshop_get_preview',
      definition(
        'photoshop_get_preview',
        async () => ({
          content: [
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' },
            { type: 'text', text: '{"ok":true,"sha256":"sha-one","width":100,"height":100}' },
          ],
        }),
        true
      )
    );

    const tool = createVisualMicroPlanTools(registry)[0]!;
    const first = await tool.handler(basePlan());
    expect(first.isError).not.toBe(true);
    expect(first.content.some((item) => item.type === 'image')).toBe(true);
    expect(paintArgs).toHaveLength(1);
    expect(paintArgs[0]!.document_id).toBe(42);

    const blocked = await tool.handler(basePlan({ plan_id: 'p2' }));
    expect(blocked.isError).toBe(true);
    expect(paintArgs).toHaveLength(1);
    const blockedText = blocked.content.find((item) => item.type === 'text');
    expect(blockedText && 'text' in blockedText ? blockedText.text : '').toContain(
      'preview_verdict_required'
    );

    const second = await tool.handler(
      basePlan({
        plan_id: 'p2',
        previous_preview: {
          sha256: 'sha-one',
          observed_change: 'The upper tower plane is visibly lighter and cleaner.',
          target_resolved: 'yes',
          regressions: [],
          uncertainty: 'none observed',
          verdict: 'improvement',
          disposition: 'accept',
        },
      })
    );
    expect(second.isError).not.toBe(true);
    expect(paintArgs).toHaveLength(2);
  });

  it('executes multiple related mutations as one semantic transaction with one final barrier', async () => {
    const registry = new ToolRegistry();
    const paintIds: string[] = [];
    let previewCalls = 0;
    registry.register(
      'photoshop_paint_dabs',
      definition(
        'photoshop_paint_dabs',
        async (args) => {
          paintIds.push(String(args.tag));
          return { content: [{ type: 'text', text: JSON.stringify({ ok: true, tag: args.tag }) }] };
        },
        true
      )
    );
    registry.register(
      'photoshop_get_preview',
      definition(
        'photoshop_get_preview',
        async () => {
          previewCalls++;
          return {
            content: [
              { type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' },
              { type: 'text', text: JSON.stringify({ ok: true, sha256: `sha-bundle-${previewCalls}` }) },
            ],
          };
        },
        true
      )
    );

    const tool = createVisualMicroPlanTools(registry)[0]!;
    const result = await tool.handler(basePlan({
      plan_id: 'bundle-1',
      problem_id: 'cheek-volume',
      scale: 'small',
      significance_mode: 'subtle_local',
      region: 'left-cheek',
      intent: 'reinforce cheek volume',
      verification_envelope: { mode: 'before_after', min_focus_dimension_px: 800 },
      steps: [
        {
          id: 'before',
          tool: 'photoshop_get_preview',
          args: { focus_region: { left: 10, top: 10, right: 90, bottom: 90 }, focus_max_dimension_px: 800 },
        },
        { id: 'light', tool: 'photoshop_paint_dabs', region: 'left-cheek', intent: 'reinforce cheek volume', risk: 'low', args: { tag: 'light', dabs: [{ x: 30, y: 30 }] } },
        { id: 'turn', tool: 'photoshop_paint_dabs', region: 'left-cheek', intent: 'reinforce cheek volume', risk: 'low', args: { tag: 'turn', dabs: [{ x: 45, y: 45 }] } },
        {
          id: 'after',
          tool: 'photoshop_get_preview',
          args: { focus_region: { left: 10, top: 10, right: 90, bottom: 90 }, focus_max_dimension_px: 800 },
        },
      ],
    }));

    expect(result.isError).not.toBe(true);
    expect(paintIds).toEqual(['light', 'turn']);
    expect(previewCalls).toBe(2);
    const text = result.content.find((item) => item.type === 'text');
    const body = JSON.parse(text && 'text' in text ? text.text : '{}');
    expect(body.mutation_count).toBe(2);
    expect(Object.keys(body.mutation_results)).toEqual(['light', 'turn']);
    expect(body.barrier.next_visual_mutation_allowed).toBe(false);

    const blocked = await tool.handler(basePlan({ plan_id: 'bundle-2' }));
    expect(blocked.isError).toBe(true);
    const blockedText = blocked.content.find((item) => item.type === 'text');
    expect(blockedText && 'text' in blockedText ? blockedText.text : '').toContain('preview_verdict_required');
  });

  it('requires factual structured critique before releasing a preview barrier', async () => {
    const registry = new ToolRegistry();
    registry.register(
      'photoshop_paint_dabs',
      definition(
        'photoshop_paint_dabs',
        async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }),
        true
      )
    );
    registry.register(
      'photoshop_get_preview',
      definition(
        'photoshop_get_preview',
        async () => ({
          content: [
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' },
            { type: 'text', text: '{"ok":true,"sha256":"sha-critic"}' },
          ],
        }),
        true
      )
    );
    const tool = createVisualMicroPlanTools(registry)[0]!;
    expect((await tool.handler(basePlan())).isError).not.toBe(true);
    const legacy = await tool.handler(
      basePlan({
        plan_id: 'p2',
        previous_preview: {
          sha256: 'sha-critic',
          verdict: 'improvement',
          disposition: 'accept',
        },
      })
    );
    expect(legacy.isError).toBe(true);
    const text = legacy.content.find((item) => item.type === 'text');
    expect(text && 'text' in text ? text.text : '').toContain('observed_change');
  });

  it('still captures a preview after a mutation error instead of retrying', async () => {
    const registry = new ToolRegistry();
    let paintCalls = 0;
    let previewCalls = 0;
    registry.register(
      'photoshop_paint_dabs',
      definition(
        'photoshop_paint_dabs',
        async () => {
          paintCalls++;
          return {
            content: [{ type: 'text', text: '{"ok":false,"code":"unknown","message":"partial"}' }],
            isError: true,
          };
        },
        true
      )
    );
    registry.register(
      'photoshop_get_preview',
      definition(
        'photoshop_get_preview',
        async () => {
          previewCalls++;
          return {
            content: [
              { type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' },
              { type: 'text', text: '{"ok":true,"sha256":"sha-partial"}' },
            ],
          };
        },
        true
      )
    );

    const result = await createVisualMicroPlanTools(registry)[0]!.handler(basePlan());
    expect(result.isError).toBe(true);
    expect(paintCalls).toBe(1);
    expect(previewCalls).toBe(1);
    expect(result.content.some((item) => item.type === 'image')).toBe(true);
  });
});
