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

Current implementation returns preset **names** plus total/matched/truncated counts. It does not currently expose preset folder/group, source `.abr`, vendor/origin or a reliable semantic category. Agent workflows must therefore treat names as inventory evidence only and must not infer nonexistent origin/category metadata.

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

It also returns the currently exposed Tool Options pressure-override flags, airbrush/repeat state and smoothing state/amount. These are **not** a complete serialization of Photoshop's Brush Settings / Shape Dynamics engine.

### `photoshop_set_brush`
Changes any subset of those brush settings while preserving unspecified values and the rest of Photoshop's active brush descriptor. In addition to tip geometry, opacity and flow, it supports:

- pressure override for size
- pressure override for opacity
- airbrush/repeat behavior
- smoothing enable/disable
- smoothing amount

### `photoshop_set_foreground_color`
Sets the foreground RGB color used by painting operations.

### `photoshop_sample_color`
Samples the visible composite color from a pinned document. `radius=0` returns a
point sample; `radius>0` returns a local Photoshop Average color from a temporary
merged duplicate, leaving the source document and its Color Sampler markers unchanged.
This is intended for palette pickup from references: skin, hair, lips, local shadow,
background, reflected light, or any other visible color region.

### `photoshop_sample_colors`
Samples up to 1024 visible-composite point colors from one pinned reference document
with automatic short Photoshop batches (currently 48 points per batch). Each batch uses
one temporary merged duplicate, avoiding both the per-point duplicate overhead and the
ExtendScript timeout hit by very large Color Sampler loops. This is intended for dense
reference value maps and palette studies. It is point-sampling only; use
`photoshop_sample_color` with `radius>0` when a local average is required.

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
- one or more Photoshop history steps depending on `batch_mode`; `AUTO` may split expensive calls

The batch-oriented API is intentional: digital painting often needs tens or hundreds of strokes, and sending each stroke as a separate MCP request would be unnecessarily slow and fragile.

### `photoshop_paint_dabs`
Paints up to 5000 independent Brush dabs efficiently. Dabs with the same color, size,
opacity and flow are grouped into one Photoshop path containing many zero-length
subpaths, so a dense tonal/stippling pass does not require one Photoshop path operation
per point. This is particularly useful for photorealistic value buildup, sampled reference
studies, soft skin transitions and texture passes. Use `photoshop_paint_strokes` when the
mark itself needs direction, Bezier curvature, taper or a non-Brush tool.

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
- automatic cost-aware batching for heterogeneous passes — implemented
- interpolated size / opacity / flow dynamics along open strokes — implemented
- richer curve representation
- sampled/eyedropper color helper — implemented (`photoshop_sample_color`)
- Mixer Brush support if scripting behavior is reliable

Live artistic tests confirmed `Square Charcoal` texture, pressure tapering, dabs, per-stroke overrides, automatic heterogeneous batching, and interpolated taper profiles. `photoshop_paint_strokes` now defaults to `batch_mode=AUTO`: expensive passes are split into several short Photoshop scripts before the per-script ExtendScript timeout is reached. Small/simple calls remain a single history step. `batch_mode=SINGLE_HISTORY` is available when one undo step matters more than timeout resilience.

`AUTO` batching protects the per-Photoshop-script execution window, but the complete MCP request can still span several sequential batches. The MCP SDK client itself defaults to 60 seconds per request. Repository direct-stdio painting scripts therefore call tools through `scripts/mcp-request-options.mjs`, using a 180-second default request timeout that can be overridden with `PHOTOSHOP_MCP_REQUEST_TIMEOUT_MS`. This is a client-side setting; external MCP hosts may impose their own timeout.

Dynamic profiles are rendered as multiple short path strokes with changing brush settings. This gives controllable directional tapering that Photoshop's binary `simulatePressure` cannot express, but it is still a segmented approximation rather than native continuous stylus pressure. AUTO segmentation now considers profile magnitude, stroke arc length, and local brush diameter; for size tapers it biases segment density toward the thin end while retaining enough segments in the thick portion, instead of dividing the whole stroke into equal-length capsules. Explicit `steps` remains exact for callers that need deterministic render counts, while omitted `steps` uses a capped 12–40 adaptive count; explicit `steps` may still request up to 64.

### Native per-point stylus pressure investigation (2026-09-14)

We investigated whether the fork could replace segmented dynamics with one native Photoshop brush stroke carrying caller-supplied pressure samples per point.

What was tested in Photoshop 2026 (27.8):

- the current ExtendScript `PathItem.strokePath()` route: Photoshop exposes only the binary `simulatePressure` switch, not caller-supplied pressure values along the path;
- an Action Manager `Stroke Path` descriptor with a numeric `StrokePressure` / `StrP` key: Photoshop accepted the descriptor, but strokes using substantially different numeric values rendered like the no-pressure control, while `simulatePressure=true` produced the expected automatic taper;
- a UXP companion loaded through Adobe UXP Developer Tool, with `action.addNotificationListener(['all'])`, while making a real freehand Brush Tool stroke: notifications exposed `toolModalStateChanged` (`kind=paint`) and `historyStateChanged`, but no coordinates, pressure, tilt, rotation, timestamps, or tablet sample payload;
- the older `photoshop.app.eventNotifier` diagnostic hook: no useful freehand stroke events were returned in this Photoshop build;
- Photoshop's own **Plugins > Development > Record Action Commands...** recorder while making a real freehand Brush Tool stroke: the resulting Action JSON again contained only paint modal-state/history notifications, with no stroke geometry or stylus samples.

Conclusion: the public ExtendScript / Action Manager / UXP automation layers tested here do not expose a way to inject or replay arbitrary per-point stylus pressure for a native freehand Brush Tool stroke. This does **not** prove that Photoshop cannot receive synthetic pressure below its scripting layer.

Deferred research idea: prototype synthetic pen input through Windows Pointer / Windows Ink (or, if necessary, a virtual tablet/device layer) so Photoshop receives the generated stroke as normal stylus input. A minimal feasibility test should attempt one continuous synthetic stroke with a pressure envelope such as `10% -> 90% -> 10%` and verify that a pressure-sensitive Photoshop brush changes size/opacity continuously. If successful, this could become a separate native helper behind the MCP; it should not be mixed into the existing scripting transport until feasibility and reliability are established.

For now this route is intentionally deferred. The practical painting priority remains improving segmented dynamics, edge control, blending, and painting workflow rather than building a virtual pen-input subsystem.

Mixer Brush remains experimental. A direct Action Manager path-stroke attempt using `wetBrushTool` failed with invalid parameters, so Mixer Brush is intentionally not exposed yet.

## Agent visual-control layer

The fork has two deliberately separate layers:

1. **Painting API** — brush presets/settings, strokes, dabs, sampling, measurements and Photoshop execution primitives.
2. **Painting agent policy** — the canonical visual-control specification in `digital-painting-agent-skill.md`, exposed at runtime through `ps.digital_painting_control`.

Do not duplicate normative painting policy in this implementation document. Changes to action classes, style/critic behavior, pacing, rollback, reference diagnostics, session persistence or Definition of Done belong in the skill first; this file records implementation facts and experiment results that explain the available primitives.

Current implementation findings that materially affect the API:

- `PathItem.strokePath()` is useful for genuinely linear marks but can produce mechanical ribbons when used for broad tonal form.
- `photoshop_paint_dabs` groups identical-style dabs and internally chunks large groups into smaller Photoshop scripts; multiple chunks may therefore create multiple history states.
- Dense area modeling benefits from compact reusable style classes because exact-style grouping affects transport/runtime cost.
- Layer blend modes are exposed through `photoshop_set_layer_blend_mode`; the controller, not the tool, decides when a mode is visually appropriate.
- Preview materialization, document pinning, measurement/landmark tools and history/layer isolation provide the observability and recovery substrate used by the agent skill.
- Brush preset selection can change several effective Brush Tool values at once. The controller therefore re-reads `photoshop_get_brush_settings` after each newly selected preset before painting with it; preset names are not treated as configuration truth.
- The brush-settings API exposes tip geometry, spacing, opacity/flow, Tool Options pressure overrides, airbrush/repeat and smoothing, but not every Photoshop brush-engine dynamic. In a live 2026-09-15 preflight, `Hard Round Pressure Size` visually produced the expected simulated-pressure taper while `use_pressure_size` still read `false`; therefore that flag must not be interpreted as a complete statement about preset Shape Dynamics. A selective visual footprint probe remains necessary for unknown/high-impact candidates.
- The same live preflight showed why numeric settings alone are insufficient for textured tips: `Square Charcoal` read as hardness 100, roundness 100 and spacing 2%, yet its actual rendered mark remained visibly granular/textured. Role assignment must therefore use the Photoshop preview, not only settings metadata.
- `photoshop_save_document(..., format="PSD")` currently calls Photoshop `saveAs(..., asCopy=true)`. This makes it suitable for paired editable process checkpoints: a checkpoint PSD can be written beside an accepted preview without changing the live document's working-file association.

For the current controller architecture, invariants and empirical lessons (including primitive footprint, structure-before-texture, semantic region priority, action classes, persistent state, discrepancy diagnostics, segmentation proposals and operational recovery), see `digital-painting-agent-skill.md`.

### Future experiments, not core policy

- **Curated artist brush-pack benchmark.** The controller now has core bounded inventory/preflight, required/preferred brush semantics, effective-settings verification, selective probes and role-map caching. A separate future benchmark should exercise those rules on a user-specified custom pack (for example an artist's own Photoshop/ported Procreate brushes) plus a small Photoshop baseline across several real image-making studies: soft organic/portrait-like modeling, architecture/hard surface, broken rock/material and atmosphere/sky/water. Record chosen brush per role, effective settings, justified probe, useful scale range, result and failure modes. Do not reduce this to a synthetic brush-sheet test; real painting is required because an attractive sample stroke can still fail in composition/form work.
- **Differentiable vector/path proposal.** DiffVG-like or other differentiable geometry optimization could be explored as an external proposal generator for genuinely geometric subproblems such as line art, logos, architectural edges or precise curves, with Photoshop remaining the execution/ground-truth renderer.
- **Exact-geometry fitting without default tracing.** Simpler Canny/potrace/Bezier fitting can be explored before differentiable optimization for exact contour subproblems. In ordinary reference painting, fitted paths remain diagnostic/proposal evidence; direct mechanical transfer into the target requires an explicitly requested tracing/exact-geometry workflow.
- **Feed-forward stroke proposal models.** Paint-Transformer-like models could eventually propose compact stroke bundles for a semantic region, but this would be a separate learned component. It should not replace the current preview-driven control loop or reintroduce rigid fixed-grid painting as the default.
- **Surrogate / Mental Canvas preflight.** Explore a lightweight local simulator between planning and Photoshop execution: `PLAN → SIMULATE CHEAPLY → EXECUTE FOR REAL → INSPECT REAL RESULT`. The surrogate should focus on geometry, approximate coverage/value mass, protected-region overlap, silhouette crossings and primitive-pattern diagnostics rather than attempting to clone Photoshop's full brush engine. Photoshop remains ground truth.
- **Specialized sketching policy.** A future line/gesture-oriented subskill could handle constructive sketching, topology, contour order and gesture separately from the general painting controller, while sharing the same higher-level planner and feedback loop.

### v0.4 — artist workflows

- painting-oriented recipes (sketch, ink, values, glazing, hatching)
- palette helpers
- layer setup recipes for sketch / line / value / color workflows
- non-destructive reference-image workflows

## Scope decision

The goal is not "all Photoshop tools". That would duplicate the upstream project and greatly increase merge conflicts. The goal is a compact painting API that composes with the existing Photoshop MCP. New tools should be added when they provide a meaningful painting primitive that cannot be expressed cleanly through the existing upstream tool set.

## Validation

`node scripts/test-painting-tools.mjs` performs a live Photoshop smoke test. It creates a temporary document, configures color and brush settings, reads them back, and paints straight, pressure-simulated, and Bezier strokes.
