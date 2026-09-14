# Digital Painting Extension

Agent painting discipline / visual-control skill: [`digital-painting-agent-skill.md`](digital-painting-agent-skill.md). The same workflow is exposed as MCP guide prompt `ps.digital_painting_control`.

This fork adds a focused digital-painting layer on top of the upstream Photoshop MCP. It intentionally does not attempt to duplicate every Photoshop command: upstream remains responsible for documents, layers, selections, masks, transforms, filters, history, export, and other general editing operations.

## Architecture

Painting support is isolated in `src/tools/painting-tools.ts`, with reference/proportion helpers isolated in `src/tools/measurement-tools.ts`. Upstream integration is deliberately limited to:

1. one import in `src/core/server.ts`;
2. one `registerToolDefinitions(createPaintingTools(connection))` call;
3. one `registerToolDefinitions(createMeasurementTools(connection))` call.

This keeps future upstream merges low-conflict.

## Current tools

### `photoshop_list_brush_presets`
Lists installed Photoshop brush presets, with optional case-insensitive filtering and a result limit.

### `photoshop_select_brush_preset`
Selects an installed brush preset by exact name and returns the resulting brush settings.

### `photoshop_get_brush_settings`
Reads the current Brush Tool settings:

- size
- hardness
- opacity
- flow
- spacing
- angle
- roundness
- horizontal/vertical brush-tip flips

### `photoshop_set_brush`
Changes any subset of those brush settings while preserving unspecified values and the rest of Photoshop's active brush descriptor. In addition to tip geometry, opacity and flow, it supports:

- pressure override for size
- pressure override for opacity
- airbrush/repeat behavior
- smoothing enable/disable
- smoothing amount

### `photoshop_set_foreground_color`
Sets the foreground RGB color used by painting operations.

### `photoshop_paint_strokes`
Paints one or many raster strokes on the active layer in a single MCP call. Supports:

- Brush
- Pencil
- Eraser
- Smudge
- straight/polyline paths
- Bezier handles per point
- closed paths
- Photoshop `simulatePressure`
- optional per-stroke RGB color override
- optional per-stroke size / opacity / flow overrides
- one-point strokes as brush dabs/stamps
- up to 250 strokes per call
- one grouped Photoshop history step per call

The batch-oriented API is intentional: digital painting often needs tens or hundreds of strokes, and sending each stroke as a separate MCP request would be unnecessarily slow and fragile.

## Measurement and reference tools

The fork also exposes six general-purpose geometry tools that are useful for
portrait likeness, perspective, architecture, alignment, and reference-image
work:

- `photoshop_measure_points` — caller-supplied named landmarks → pixel and normalized distances/ratios;
- `photoshop_add_guides` — add exact horizontal/vertical pixel guides;
- `photoshop_list_guides` — inspect guide positions and normalized coordinates;
- `photoshop_clear_guides` — remove selected guides or clear all guides;
- `photoshop_transform_landmarks` — transfer caller-supplied named points from one semantic frame to another while preserving local `u/v` coordinates;
- `photoshop_compare_landmarks` — compare same-named point sets in their own semantic frames and report normalized point errors plus mean/RMSE/max error.

These tools deliberately separate **visual interpretation** from **measurement**.
The agent/user decides where a landmark is; Photoshop then provides exact
document-space geometry. No automatic anatomical/face landmark detector is
claimed or implied.

The landmark transform/compare tools are pure geometry helpers. A semantic
frame is an axis-aligned `{left, top, right, bottom}` box chosen by the caller
around the region whose internal proportions matter. This avoids document-size
normalization when the useful comparison is local to a face, object, opening,
card, or other bounded region.

## Planned development

### v0.2 — brush presets and dynamics — implemented

- list/filter installed brush presets
- select a preset by exact name
- pressure overrides for size and opacity
- airbrush/repeat behavior
- smoothing enable/amount
- preserve the complete current Brush Tool descriptor while changing only requested fields

### v0.3 — painting ergonomics — partially implemented

- per-stroke color / size / opacity / flow overrides — implemented
- brush dabs/stamps via one-point strokes — implemented
- richer curve representation
- sampled/eyedropper color helpers
- Mixer Brush support if scripting behavior is reliable

Live artistic tests confirmed `Square Charcoal` texture, pressure tapering, dabs, and per-stroke overrides. One practical limitation emerged: large heterogeneous batches with many brush-setting overrides can exceed the 30-second ExtendScript timeout, so painting clients should currently chunk such passes into smaller batches.

Mixer Brush remains experimental. A direct Action Manager path-stroke attempt using `wetBrushTool` failed with invalid parameters, so Mixer Brush is intentionally not exposed yet.

## Agent visual-control layer

The painting fork now develops two complementary layers in parallel:

1. **Painting API** — brush presets, settings, strokes, dabs and future painting primitives.
2. **Painting agent skill** — semantic passes, visual checkpoints, occlusion/protected-region reasoning, cleanup and Definition of Done.

The skill intentionally treats stroke count as a soft planning budget unless the user explicitly requests a hard cap. Completion is state-based: stop when the requested finish level is visually satisfied, cleanup is complete, no must-fix issue remains, and additional strokes would only be optional refinement.

### v0.4 — artist workflows

- painting-oriented recipes (sketch, ink, values, glazing, hatching)
- palette helpers
- layer setup recipes for sketch / line / value / color workflows
- non-destructive reference-image workflows

## Scope decision

The goal is not "all Photoshop tools". That would duplicate the upstream project and greatly increase merge conflicts. The goal is a compact painting API that composes with the existing Photoshop MCP. New tools should be added when they provide a meaningful painting primitive that cannot be expressed cleanly through the existing upstream tool set.

## Validation

`node scripts/test-painting-tools.mjs` performs a live Photoshop smoke test. It creates a temporary document, configures color and brush settings, reads them back, and paints straight, pressure-simulated, and Bezier strokes.
