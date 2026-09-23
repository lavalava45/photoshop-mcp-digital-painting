# VisualMicroPlan contract fixtures

This file contains machine-tested protocol examples. It is **not an artistic recipe**, a preferred
painting workflow, or a catalogue of recommended Photoshop methods. It must not be used as an
allowlist. The absence of a method here does not prohibit it.

The fixtures have two deliberately separate purposes:

- `region` and `paint` prove that structurally different VisualMicroPlan payloads compile and parse;
- `mask-composite` and `adjustment` prove that the runtime method selector can choose capabilities
  outside the VisualMicroPlan mutation subset.

The artistic goal, current stage, canvas evidence and revision-bound runtime capability map choose
the method. A caller must not copy the first fixture merely because it is the first fixture. In
particular, `photoshop_paint_regions` is the broad early block-in scaffold. Outside the early
block-in stages it is admitted only for a bounded explicit `REPLACE`/`ERASE` correction with an
exact target layer and `clip_bounds`; ordinary late-stage `ADD` region block-in remains invalid.

## Executable VisualMicroPlan fixture: early region block-in

<!-- fixture:region -->

```json
{
  "plan_id": "contract-region-plan",
  "summary": "Exercise one early closed-region transaction",
  "stage": "RECOGNITION_BLOCK_IN",
  "scale": "global",
  "region": "whole-canvas-primary-field",
  "region_bounds": { "left": 0, "top": 0, "right": 100, "bottom": 100 },
  "intent": "Establish one broad primary field without local detail",
  "method_class": "region",
  "risk": "low",
  "expected_visual_delta": "A broad primary field becomes visible across the composition.",
  "verification_envelope": { "mode": "after_only", "min_focus_dimension_px": 900 },
  "layer_separation_check": {
    "change_kind": "new-plane",
    "substantial": true,
    "rollback_value": "high",
    "independent_adjustment_expected": true,
    "reasons": ["The field is an independent plane that may need later adjustment or rollback."]
  },
  "logical_layer": {
    "decision": "create-new",
    "hypothesis_id": "primary-plane",
    "hypothesis": "A separate layer keeps the primary field independently adjustable.",
    "rollback_value": "high",
    "expected_independent_rollback": true,
    "separation_reasons": ["Keep the primary field independent from later forms."],
    "layer_name": "Primary Plane"
  },
  "problem_id": "recognition-primary-field",
  "action_class": "ADD",
  "expected_visual_result": "The primary plane reads as one coherent field.",
  "failure_signals": ["white canvas remains", "unexpected hard local detail"],
  "recognition_features": ["large primary field", "clear secondary boundary", "open tertiary interval"],
  "style_recognition_features": ["coherent value grouping"],
  "protected_regions": [],
  "protected_layer_ids": [],
  "replace_protected_layer_ids": [],
  "document_id": 42,
  "steps": [
    { "id": "layer", "tool": "photoshop_create_layer", "args": { "name": "Primary Plane" } },
    {
      "id": "paint",
      "tool": "photoshop_paint_regions",
      "args": {
        "regions": [
          {
            "id": "primary-field",
            "layer_id": "$steps.layer.details.layerId",
            "color": { "red": 25, "green": 50, "blue": 70 },
            "opacity": 100,
            "contours": [
              {
                "operation": "ADD",
                "points": [
                  { "x": 10, "y": 10 },
                  { "x": 90, "y": 10 },
                  { "x": 90, "y": 90 },
                  { "x": 10, "y": 90 }
                ]
              }
            ]
          }
        ]
      }
    },
    { "id": "preview", "tool": "photoshop_get_preview", "args": { "max_dimension_px": 1000, "quality": 8 } }
  ]
}
```

## Executable VisualMicroPlan fixture: brush continuation

<!-- fixture:paint -->

```json
{
  "plan_id": "contract-paint-plan",
  "summary": "Exercise a brush-based continuation on an existing logical layer",
  "stage": "FORM",
  "scale": "medium",
  "region": "form-a",
  "intent": "Model one broad transition on form A with directional brushwork",
  "method_class": "paint",
  "risk": "low",
  "expected_visual_delta": "The existing form gains a readable broad transition.",
  "verification_envelope": { "mode": "after_only" },
  "layer_separation_check": {
    "change_kind": "continuation",
    "substantial": false,
    "rollback_value": "low",
    "independent_adjustment_expected": false,
    "reasons": ["The brushwork continues form A and does not create an independent unit."]
  },
  "logical_layer": {
    "decision": "continue-logical-layer",
    "hypothesis_id": "form-a-layer",
    "hypothesis": "The transition belongs to the existing form-A layer.",
    "rollback_value": "low",
    "expected_independent_rollback": false,
    "separation_reasons": [],
    "layer_id": 77
  },
  "problem_id": "form-a-transition",
  "action_class": "REFINE",
  "expected_visual_result": "The form turns clearly without fragmenting into a polygonal patch.",
  "failure_signals": ["the new mark reads as an isolated stripe", "the silhouette is unintentionally changed"],
  "recognition_features": [],
  "style_recognition_features": ["directional brush continuity"],
  "protected_regions": [],
  "protected_layer_ids": [],
  "replace_protected_layer_ids": [],
  "document_id": 42,
  "steps": [
    {
      "id": "paint",
      "tool": "photoshop_paint_strokes",
      "args": {
        "layer_id": 77,
        "strokes": [
          {
            "tool": "BRUSH",
            "points": [{ "x": 20, "y": 30 }, { "x": 45, "y": 40 }, { "x": 70, "y": 55 }]
          }
        ]
      }
    },
    { "id": "preview", "tool": "photoshop_get_preview", "args": { "max_dimension_px": 1000, "quality": 8 } }
  ]
}
```

## Method-selection fixture: mask/composite

This is intentionally not embedded into VisualMicroPlan: the current microplan transaction supports
a bounded paint-mutation subset. The method compiler must route this semantic request through the
registered mask/compositing capability instead of translating it into brush marks or region fills.

<!-- fixture:mask-composite -->

```json
{
  "fixture_kind": "method-selection",
  "visual_intent": "mask-fade",
  "impact_class": "transition",
  "expected_method_class": "mask-gradient",
  "expected_primary_tool": "photoshop_apply_gradient_mask"
}
```

## Method-selection fixture: tonal adjustment

This is also outside the VisualMicroPlan paint-mutation subset. The method compiler must preserve
the non-destructive adjustment mechanism rather than approximating it with painted light or a fill.

<!-- fixture:adjustment -->

```json
{
  "fixture_kind": "method-selection",
  "visual_intent": "tonal-contrast",
  "impact_class": "tone",
  "expected_method_class": "adjustment",
  "expected_primary_tool": "photoshop_adjust_curves"
}
```

## State-dependent Guard admission

Passing these fixture tests proves only contract/compiler validity and capability routing. Live Guard
admission still depends on the pinned document, art-run binding, prior closure, barrier ownership,
rollback state, planner priority and checkpoint debt. Static validity never proves artistic success.

For raster plans, coordinates must be inside the actual canvas. For example, a 2000 x 1000 canvas
ends at raster coordinates x=1999 and y=999. A pre-dispatch rejection is `not-executed` only when the
runtime has durable evidence that no mutation was dispatched.
