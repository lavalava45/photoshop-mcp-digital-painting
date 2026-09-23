### Visual checkpoints and execution sanity

Reasoning previews are required after major semantic passes and risky local corrections.

Use before/after image-delta only as **execution sanity**, not as an artistic score:

- identical preview/hash when a visible mutation was expected is strong no-op evidence;
- near-zero delta should trigger targeting/visibility/tool-state checks rather than being accepted as merely `neutral`;
- large delta raises inspection priority;
- non-zero delta proves only that something changed.

Artistic acceptance remains `BRIEF + STRUCTURE + STYLE CONTRACT`.

#### Execution-change evidence vs artistic value

A changed JPEG SHA proves only that the encoded bytes differ. The controller compares decoded before/after preview pixels and classifies the technical execution effect as:

```text
meaningful | insufficient | unknown
```

This is the **hard visual execution-evidence gate**. The classification is **execution evidence, not an artistic score**. `meaningful|insufficient` describes pixel-change magnitude only. A small but clearly visible, decisive artistic correction may still be `improvement + accept` when decoded comparison proves that the image actually changed. `unknown` or a true no-op cannot be accepted as improvement.

Two significance modes exist and must be chosen **before** the mutation:

- `normal` — default. The whole-frame or matching local-focus delta must clear the normal significance floor.
- `subtle_local` — only for deliberately small refinements whose correctness is visible mainly at local scale. It requires a stable `problem_id` plus the same materialized focus crop immediately before and immediately after the mutation. It uses a lower local floor, but it is not an after-the-fact override for a weak pass.

If a pass is `insufficient` **and is not artistically accepted as an improvement**, it does not count as progress. Another visual attempt on the same `problem_id` must make a structurally different executable strategy: change coverage/region, scale, primitive/method, brush role, action class or mutation structure. A different prose `replan` with the same executable strategy does not count. Do not amplify a successful subtle correction merely to clear a pixel threshold.

#### Hard local-inspection gate

Small/local VisualMicroPlans (`small`, `micro`, `detail`, `local`, or `significance_mode=subtle_local`) must contain:

```text
matching focus preview BEFORE
→ 1–4 tightly-related mutations in one semantic transaction
→ matching focus preview AFTER
```

Both previews must use the same `focus_region`; `focus_max_dimension_px` and the declared
verification envelope must preserve at least 800 px local inspection. Every mutation in
the transaction must share one region, artistic intent, compatible method class and risk
envelope. Do not batch unrelated local fixes merely to save previews.

At checkpoints classify unresolved issues as `must-fix`, `should-fix` or `optional refinement`. Do not detail over a must-fix.

#### Correction acceptance gate

Do not accept a local `REPLACE`, `ERASE`, silhouette/background reconstruction, mask correction or other patch-like repair merely because the original defect became smaller. Before `ACCEPT`, inspect both the intended fix **and the correction footprint**:

1. verify that the targeted defect actually improved at the intended viewing scale;
2. inspect the full perimeter/transition zone of the edited region for seams, rectangular or straight-edged patch boundaries, hard corners, halos, value/color discontinuities, repeated dabs/scallops and other new primitive footprints;
3. inspect once locally and once at normal/thumbnail scale, because a repair can look plausible up close while introducing a larger compositional artifact;
4. compare new-error severity against the gain from the correction. A new same-or-higher-severity defect means `CORRECT` or `ROLLBACK`, not `ACCEPT`;
5. when the repair is isolated on its own layer, toggle/compare it before acceptance when that provides a clearer judgment.

At resume or before advancing stages, if recent work involved broad dabs, local background reconstruction, silhouette carving or rollback/recovery, perform a quick whole-image artifact scan before adding detail. Look specifically for residual primitive footprints, patch seams and abrupt geometric leftovers that may have escaped a local inspection.

### Recovery, layers and execution cost

Painting is editable state, not append-only output.

- Latest bad action: Undo when safe.
- Bad semantic pass: rollback to the last accepted visual state.
- Isolated failed layer: toggle/compare, then delete/disable or locally repaint it.
- Partly successful layer: preserve useful regions and erase/mask/repaint only the regression.
- Restart the target only when recovery is unreliable or more expensive than restarting.

Before a risky/destructive pass, establish a rollback anchor with `photoshop_get_history` or isolate the correction on a dedicated layer. Do not assume one MCP call equals one history step: `AUTO` batching may create several. Use `SINGLE_HISTORY` only when one undo step matters more than timeout resilience.

Prefer semantic layers that earn their recovery/control cost (background, masses, subject base, form, detail/accents, temporary correction). Do not create one layer per stroke or one mask per tiny feature.

Use masks/semantic isolation when they provide concrete depth, boundary, material, opacity or rollback control. Avoid segmentation that adds management cost without improving protection or recovery.

Plan **visual cost** and **execution cost** together. Too many unique dab styles can expand one semantic pass into many scripts/history steps.

For dense dab passes, inspect the executor's `style_run_count`, `unique_style_count`, `planned_batch_count`, affected bounds and measured batch durations. Prefer smaller/cheaper bundles when the planned internal work is large relative to the visual question being tested. Do not invent a precise ETA before there is enough empirical timing history; collect measured durations first, then tune chunk size from evidence while preserving mark order and timeout safety.

If transport normalization is available, it may reduce a dense dab bundle to a compact set of reusable style tuples within the same semantic pass. Preserve meaningful mark role, scale, value/chroma, opacity and flow; prefer deterministic/discrete or perceptually sensible buckets over blind K-means on raw `[R,G,B,size]`. Group-count reduction is execution evidence, not artistic authority.

## Conditional modules

Use these only when the task requires them.

### Manufactured / geometric form integrity

For architecture, machinery, furniture, vehicles and other intentionally constructed forms, add a geometry-integrity checkpoint before detail and again when structural corrections are made. Check only relationships that are actually implied by the object/reference/style:

- primary axes and intended straightness or taper;
- parallelism/perpendicularity where applicable;
- symmetry where applicable;
- perspective consistency and convergence;
- repeated spacing/alignment where applicable;
- continuity of silhouettes and constructed edges;
- whether line weight/edge hardness supports form/material instead of turning structural details into uniform vector symbols.

Use measurement/landmark/guide helpers when precision matters. Do not impose perfect verticals, symmetry, parallelism or a mathematically ideal cylinder when the reference, perspective, construction or requested style does not support them. For rounded/cylindrical forms, establish believable light/shadow planes and turning form; no universal analytic gradient formula is required.

### Reference reproduction

#### Color/value sampling

Keep the reference read-only and separately pinned.

- `photoshop_sample_color(radius=0)` for a precise point.
- small `radius` for a representative local average.
- `photoshop_sample_colors` for dense point sampling/value maps.

Samples are evidence; preserve the intended value/color hierarchy. Do not paste/place/duplicate reference pixels into the target, use the reference as an underlay, or trace it by default. Target-side masks and blend modes remain valid painting controls.

#### Discrepancy diagnostics

Optional discrepancy evidence may help region priority. Prefer registered/aligned multiscale signals:

- low-frequency/mass;
- edge/contour;
- value;
- optional late-stage color/detail.

When available, show the critic a separate diagnostic composite such as `reference + current + discrepancy views`. Keep diagnostic heatmaps outside the working target by default. A bright region means **inspect here**, not **automatically repaint these pixels**. Raw RGB difference is not ground truth and does not apply to free composition.

#### Measurement and spatial anchors

For proportion-sensitive work (portrait, architecture, repeated geometry, perspective), use explicit measurement when useful:

```text
inspect → choose semantic landmarks → optional guides → measure_points
→ transform_landmarks for cross-frame reuse → compare_landmarks → correct → preview
```

The tools do not detect semantic landmarks automatically. `photoshop_compare_landmarks` reports normalized per-point plus mean/RMSE/max error; treat these as evidence, not an absolute loss. If landmark evidence was established and proportion remains completion-relevant, re-check it at the final structural gate.

For coordinate-sensitive local work, define semantic bounds `{left, top, right, bottom}`, plan points in local normalized `u/v`, convert to document coordinates at execution time, and update anchors after structural changes.

### Photorealistic reference portrait

Keep the reference read-only and the target separate. Apply these stricter rules:

- establish/compare facial landmarks before detailed rendering; likeness errors are structural must-fix;
- measure brush scale against visible **face width**, not canvas width: value masses about 8–12%, form modeling 2–6%, feature edges/hair groups 0.5–2%, micro-accents below ~0.5%;
- broad facial planes use 2D patches; elongated structures may use dab chains; reserve path strokes for deliberately linear edges/details;
- do not use `PathItem.strokePath()` / broad `photoshop_paint_strokes` as the default primitive for facial volume;
- use soft/firmer marks according to plane/edge needs; avoid global blur;
- completion requires likeness plus believable continuous form, not merely recognizability or tube/blob construction.

If the same systemic failure repeats, diagnose whether the cause is visual planning, missing Photoshop control or inadequate agent guidance before retrying the same strategy.

### Optional algorithmic helpers

Helpers may provide evidence, proposals or constraints, never automatic artistic authority:

- curve/contour fitting for genuinely exact geometric subproblems;
- discrepancy-map generation for reference diagnostics;
- segmentation-backed mask proposals for repeated boundary protection;
- transport quantization for dense dabs;
- lightweight raster/surrogate preflight for geometry/coverage.

Evidence helpers may inform analysis/region priority; execution helpers normally sit after problem/action selection and before Photoshop execution.

Preserve the no-tracing default: fitted Canny/potrace/Bezier contours may be diagnostic/landmark/proposal evidence, but do not mechanically transfer a reference-derived path unless the user explicitly requested tracing/exact contour reproduction or the workflow inherently requires exact geometry transfer.

If segmentation is available, use it only when repeated boundary protection has concrete value. Inspect/correct/feather the proposed mask and do not freeze an early incorrect silhouette.

A surrogate preflight may cheaply reject bad bounds, coverage, protected-region overlap, silhouette crossings, scalloping or excessive density, but Photoshop remains the ground-truth renderer:

```text
PLAN → SIMULATE CHEAPLY → reject/adjust → EXECUTE IN PHOTOSHOP → INSPECT REAL RESULT
```

Constructive sketching/gesture may eventually use a dedicated subskill rather than forcing the general painter to optimize line topology and gesture simultaneously.
