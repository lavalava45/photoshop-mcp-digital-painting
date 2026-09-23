#### Tool/method palette and method selection

Do not converge automatically to `round brush`, `soft brush`, `eraser` and opacity changes. Method choice is part of the artistic plan and follows this executable decision chain:

```text
visual intent → impact class → method → registered runtime tool → fallback
```

Use `photoshop_get_painting_method_capabilities` when the available method surface is uncertain or after runtime/schema changes. Use `photoshop_select_painting_method` to choose from that actual surface before committing to a method when several mechanisms could solve the same visual problem.

The capability map must distinguish **available**, **conditional**, and **unavailable** methods. Never infer an API merely because Photoshop has a UI feature. In the current runtime, for example, Pencil and Smudge are verified execution modes of `photoshop_paint_strokes`; installed textured/dry/scatter/bristle-like brushes are conditional on brush-preset discovery; the exposed gradient primitive is a linear layer-mask gradient; Clone Stamp, Mixer Brush and arbitrary radial paint/fill are not exposed as dedicated verified primitives and therefore require an explicit fallback.

Prefer a method because its causal effect matches the visual problem:

- line / crisp construction → Pencil or hard-line method;
- broad silhouette/value mass → region block-in rather than hundreds of round-brush dabs;
- transition / lost edge → gradient mask, Smudge, controlled soft buildup or blur according to whether the target is compositing, paint-form or raster smoothing;
- texture → discovered textured preset or procedural noise/detail method rather than default round-brush stippling;
- smoothing → Smudge / Smart Blur / Gaussian Blur according to whether shape must be pushed or merely filtered;
- sharpening → Unsharp Mask or High Pass according to the intended detail mechanism;
- light sculpting → dodge/burn-equivalent layer, Curves or controlled painting according to rollback/locality needs;
- isolation/compositing → selections, masks, gradient masks and blend modes;
- proportion/placement → transform rather than repainting a correct object in the wrong place;
- distraction removal → selection + Content-Aware Fill when that registered method matches the problem.

A fallback is not permission to use a generic brush automatically. It must be the next **available method that preserves the original visual intent and impact class**. Record unavailable preferred methods explicitly when that fact changes the plan.

#### Two-level Art Director / Painter loop

Separate **global direction** from **local execution** in controller state. The Art Director owns composition, focal hierarchy, large value masses, lighting, silhouette, depth, likeness/main shape, overall detail level and the next priority. A review writes a compact directive with a bounded task queue and an explicit review horizon. The normal horizon is roughly **5–10 completed Painter micro-plans**, but this is an adaptive planning choice, not a hard-coded magic constant.

Painter keeps a local preview/verdict and **does not perform a fresh whole-image re-plan after every stroke**. Every Painter VisualMicroPlan binds to the active `planner_directive_id` and `planner_task_id`, declares `painter_scope=local|medium` and its causal `change_domains`, then executes one bounded task under the ordinary local preview/verdict barrier. Local verification therefore remains per micro-plan while full Art Director critique occurs only when the directive horizon is reached, the task queue is completed, or an early interrupt fires.

Return to Art Director before cadence when any of these occurs:

- serious visual error;
- a local correction unexpectedly shifts global composition or value structure;
- likeness/main shape visibly degrades;
- Painter cannot execute the directive safely without violating protected/global structure.

Painter may not independently change `composition`, `large-value`, `lighting-structure`, `silhouette`, `depth-structure`, `likeness-main-shape`, or `background-scope`. These are Planner-owned by default. An Art Director task may explicitly delegate a narrow `allowed_global_changes` exception; otherwise the Guard rejects the mutation **before Photoshop dispatch** and requires review.

Canonical orchestration:

```text
photoshop_guard_art_director(action=review)
→ directive + bounded tasks + review horizon
→ Painter VisualMicroPlan → local preview/verdict
→ ... N bounded Painter plans ...
→ cadence | task completion | early interrupt
→ Art Director review/replan
```

`photoshop_guard_status` / `photoshop_guard_resume` expose the active directive, revision, current task, completed micro-plan count, review horizon, review reason and interrupt state. Once `review_due` or `interrupted` is set, Painter visual work remains fail-closed until Art Director reviews again. `action=interrupt` also lets Painter return without mutating Photoshop when the directive itself is unsafe.

#### Edge Control

Edge character is an explicit boundary-level decision, not a global brush-hardness preference. Declare edge intent for a concrete **region pair / boundary**:

```text
region: left_cheek

edges:
  cheek/background: lost
  cheek/nose: soft
  jaw/collar: firm
  beard/background: broken
```

Supported edge classes are `hard`, `firm`, `soft`, `lost`, and `broken`. `hard` should read crisp and clearly separated; `firm` remains readable without a cut-out feel; `soft` transitions gradually; `lost` intentionally dissolves into the neighbor; `broken` varies/discontinues the contour and is especially useful for hair, beard, net, fabric, water and rough surfaces.

Edge intent must alter method selection. The runtime compiler selects only from methods that actually exist in the capability map. Typical preferences are:

- `hard` → Pencil / hard brush / region boundary / selection-mask style strategy;
- `firm` → hard brush / Pencil / region boundary with less severe separation;
- `soft` → Smudge / soft buildup / gradient mask / controlled blur;
- `lost` → Smudge / soft buildup / blur / gradient-mask or eraser strategy where appropriate;
- `broken` → installed textured preset when available, otherwise hard-line/noise/Pencil fallback rather than a uniformly traced contour.

VisualMicroPlan `edges[]` carries `boundary_id`, `region_a`, `region_b`, `class`, optional `preferred_method_id`, and qualitative `expected_behavior`. Every declared boundary must bind to at least one mutation through `edge_boundary_ids`; that mutation declares the actual executable `method_id`. Before dispatch, the executor verifies that method against the live capability map and edge class. If a preferred method is unavailable, fallback is explicit and visible; it is never silently invented.

AFTER verification remains qualitative rather than pretending to measure edge softness numerically. For every declared boundary, the Guard verdict requires one `edge_observations[]` entry with `boundary_id`, concrete `observed_behavior`, and `target_met=yes|no|uncertain`. A plan with edge intent cannot be accepted without looking at those boundaries individually.

#### Grayscale / Value Check

For representational/realistic workflows, use `photoshop_analyze_value_structure` at structural gates rather than after every stroke. The tool produces a non-destructive grayscale preview plus descriptive luminance evidence. Inspect that image as Art Director and record `directive.value_check`; **unobserved visual analysis is never PASS**.

The value check covers five qualitative criteria: `large_value_grouping`, `focal_hierarchy`, `silhouette_separation`, `local_contrast_budget`, and `detail_before_form`. Each criterion records `pass|fail|uncertain|not-applicable` plus a concrete note. Overall status is `pass|fail|override|style-not-applicable`.

Use the structural sequence:

```text
composition → large masses → VALUE CHECK → form modelling → VALUE CHECK → detail
```

When an active Art Director workflow reaches a DETAIL/MICRO_DETAIL stage, Guard fails closed if the value check is missing/unobserved or `fail`. `override` is permitted only with an explicit justification. `style-not-applicable` is permitted only with an explicit applicability reason for styles where luminance hierarchy is genuinely not the governing representation constraint. Do not convert luminance summaries into fake artistic scores; they are evidence for qualitative visual judgment.

#### Progressive refinement / de-block-in gate

The Value Gate does not prove that a readable block-in has become modelled form. Before
`DETAIL` / `MICRO_DETAIL`, the same durable Art Director directive therefore carries a
second subject-agnostic `refinement_check`. This is an observed stage-exit contract, not
an aesthetic score and not a second controller.

The check records the exact current-frame preview/operation plus:

- `major_form_modelling` — value/plane changes describe volume rather than a flat mass;
- `secondary_forms` — meaningful subordinate planes/sub-volumes/divisions are present;
- `edge_hierarchy` — boundaries are intentionally differentiated;
- `material_light_response` — surface response follows form/light rather than texture noise;
- `selective_detail` — any detail is structurally useful and non-uniform;
- `residual_block_in` — temporary scaffold geometry no longer dominates the representation.

Each criterion is `resolved|debt|uncertain|not-applicable`. The representation transition
is separately classified `meaningful|insufficient|texture-only|not-assessed`.
`refinement_check.status=pass` requires `representation_change=meaningful`, resolved
lower-frequency form/edge/material/residual-block-in criteria, and no unresolved selective
detail criterion. More brush calls, layers, pixels, noise or texture do not close form debt.
Thus a flat block-in plus grain remains blocked even if the local operation itself succeeded.

The REFINEMENT GATE fails closed: `DETAIL` is blocked while `refinement_check` is
`pending` or `fail`. `style-not-applicable` is permitted only for intentional
stylization and must cite an exact relevant `style_contract` field/value. This prevents
the generic de-block-in rule from silently forcing flat/graphic work toward photorealism.
The check is persisted in the existing painting state and is reconstructed unchanged after
restart/resume.

#### Cumulative visual trend guard

A locally plausible pass can still be part of a globally harmful trend. Every visual verdict must therefore record three whole-frame critic fields in addition to the local verdict:

```text
global_readability = improved | stable | degraded
primitive_footprint = none | acceptable | suspect
trend_signals = [] | [stable short **negative** labels such as edge-softening, contrast-collapse, soft-round-footprint]
```

Judge these against the current frame, the previous accepted frame, an earlier useful anchor when available, and the reference/brief. `trend_signals` describe repeated causal **defects**, not successes, stable features or one-off subject details. Leave the array empty when no repeated negative symptom is present. Reuse the same stable label when the same defect recurs.

The controller inspects the latest three classified visual operations. If the same negative signal appears in at least two of them, it automatically promotes `cumulative-trend-<signal>` to a **global / must-fix** problem. `global_readability=degraded` and `primitive_footprint=suspect` also contribute canonical trend signals. The ordinary stage priority gate then blocks medium/small work until that cumulative global problem is resolved or deliberately reclassified.

This guard exists specifically to catch sequences such as repeated soft glazing, edge loss, contrast collapse, append-only texture, or a recurring brush footprint that may look harmless frame-to-frame but progressively damages the image. Recovery requires a real causal strategy change (primitive/method, coverage/region, scale, brush role, edge policy, value structure, action class or mutation structure), not different explanatory prose or a cosmetic parameter tweak.

The controller enforces this with a persistent **stage/scale priority gate**. Keep `current_stage` plus open visual problems with `problem_id`, `scale` (`global|medium|small`) and `severity` (`must-fix|should-fix|optional`). Before every visual mutation, the Guard finds the largest unresolved `must-fix`; a finer-scale mutation is rejected until that problem is resolved/reclassified. Free-text `replan`, including words such as “override”, “probe” or “diagnostic”, does not bypass this ordering. Use `photoshop_guard_set_priorities` on the native route to seed/update this non-Photoshop planning state. Native `photoshop_guard_status` / `photoshop_guard_resume` expose the current gate. Any duplicate legacy priority/replan field is subject to the 13b audit and 13a removal; do not author a second workflow around it.

### Action contract and classes

Before each semantic micro-pass formulate:

```text
Current problem
Stable problem id when repeated attempts are possible
Scale
Protected areas
Region priority
Action class
Relevant style constraints
Primitive/tool
Expected visual result
Failure signals / falsifiers
```

Keep the full contract in planner/session state; chat telemetry should normally compress it to one short line or a few clauses.

Treat `Expected visual result` as a **testable prediction**, not a motivational description. Before the mutation, state what should visibly change, what must remain intact, and which artifacts would count as failure. After capture, perform the first critic pass from the rendered evidence rather than from the claim that the pass “improved” something. Record separately:

```text
Observed change
Target resolved: yes | no | uncertain
New/worsened regressions
Remaining uncertainty
```

Only then assign `improvement | neutral | regression` and `accept | correct | rollback`. Pixel delta may support `Observed change`, but it cannot determine the artistic verdict. Keep the target-specific critic and the independent scene-relationship audit conceptually separate so the agent cannot satisfy the latter by merely restating that its intended edit succeeded.

The critic must not be limited to the mutation's declared target. For every global/shape/form pass, and at stage transitions/final review, perform a separate whole-frame **scene grounding audit** at normal or thumbnail scale:

- does every supported object actually contact or convincingly relate to its support surface, with no unintended background-colored gap or floating;
- are cast shadows spatially compatible with the object/support relationship and light direction, including contact where appropriate;
- are occlusion and depth order coherent;
- did the pass create accidental tangencies, intersections or disconnected parts;
- do the major silhouette/proportion relationships still read.

For small/detail passes, use a quick version of the same audit as a regression scan. A locally improved target is still `correct` or `rollback`, not `accept`, when a same-or-higher-severity scene-relationship defect is visible.

Choose the action class before the primitive:

- `ADD` — introduce genuinely missing information;
- `REFINE` — improve an already-correct representation;
- `REPLACE` — repaint a bad representation;
- `ERASE` — remove an unwanted mark/edge/occlusion;
- `ROLLBACK` — revert a failed pass;
- `LEAVE` — intentionally do nothing.

`ADD` is not the default. A wrong representation should usually be replaced, erased or rolled back rather than buried.

### Planning, scale and region priority

Use short-horizon planning: operationally commit only the next small semantic bundle, then replan from the actual canvas.

Work from low to high frequency:

- **global** — composition, horizon, large value fields and dominant silhouette;
- **medium** — planes, volume, secondary structures and material transitions;
- **small** — selected edges, texture and focal accents.

After block-in choose semantic/adaptive regions, not a uniform fixed grid. Temporary grids may be diagnostic aids only.

When regions compete, consider:

```text
priority ≈ (severity × perceptual_importance × structural_dependency × expected_gain)
           / execution_or_recovery_cost
```

This is a heuristic, not a numeric requirement.

### Brush preflight, inventory and role selection

Brush choice is part of visual planning. Do not begin a non-trivial painting by accepting whichever preset happens to be active, and do not brute-force every installed brush.

Before the first paint mutation, perform a **bounded inventory/preflight**:

```text
ROLE NEED
→ BOUNDED INVENTORY / CANDIDATE SHORTLIST
→ SELECT PRESET
→ READ EFFECTIVE SETTINGS
→ OPTIONAL FOOTPRINT PROBE
→ ASSIGN / UPDATE ROLE MAP
→ PAINT
→ INSPECT REAL RESULT
```

For a normal non-trivial art run, this is now an executable Guard contract rather
than advice. `painting_profile=nontrivial_painting` is the default. Bind the art
run, inspect the live installed preset library, select the small set actually
assigned to image/material roles, use the authoritative post-selection effective
settings, make only necessary footprint probes, then call
`photoshop_guard_set_art_run` again with the **same** `process_dir` and a completed
`brush_preflight`. Brush painting remains fail-closed until that durable role map
exists. `simple_graphic` is only for deliberately flat/simple graphic work.

In a non-trivial run, direct `photoshop_paint_strokes`, `photoshop_paint_dabs`
and `photoshop_paint_regions` are not an escape hatch: route them through
`photoshop_execute_visual_microplan`. Brush passes declare `paint_strategy`
(`material_role → visual_intent → brush_role → preset_name when applicable →
pressure_policy`), and Guard verifies that this strategy matches the persisted
preflight role. Declared simulated pressure must be present in the actual stroke
through `simulate_pressure` and/or the corresponding `dynamics`.

The initial inventory is deliberately cheap. Call `photoshop_list_brush_presets` to establish what is installed and the approximate library size, but do not enumerate/test thousands of presets merely because they exist. The current preset-list API exposes names plus counts/filtering; it does not provide trustworthy folder/ABR-origin/category metadata, so do not invent those classifications.

Derive only the brush roles needed by the current image or near-term pass. Typical roles include:

- atmosphere / smooth low-frequency mass;
- soft form modeling;
- hard opaque structural mass;
- planar / blocky architectural mark;
- broken rock/material/texture mark;
- fine line / detail;
- glaze / light;
- subject-specific roles such as hair/foliage only when actually needed.

Use **progressive widening** rather than exhaustive search:

1. **Trusted baseline** — a small already-characterized set of installed Photoshop/default archetypes, roughly 6–12 at most: smooth mass, hard round, pressure-sensitive round, planar/block, broken/textured and fine linear/detail where available.
2. **User-selected pack / preferred brushes** — when the user supplies a pack or names brushes as preferred, treat that source as the primary candidate pool and use the trusted baseline mainly as comparison/fallback.
3. **Broader installed-library discovery** — only when the needed role is still unfilled.

A normal painting should usually evaluate only a small handful of candidates, often around 5–12 total and frequently fewer. One brush may fill several roles.

#### Required user brushes are a hard constraint

The user may name exact presets that are **required to be used**, not merely preferred.

- Confirm every required preset is installed before relying on it.
- Do not silently substitute a similarly named or default brush when a required preset is missing; report the missing preset as a constraint conflict.
- Use each available required brush **meaningfully** in a role suited to its actual footprint/settings, and record the role/use in `brush_state.required_usage`.
- Do not force a required brush into a destructive or structurally unsuitable pass merely to satisfy usage. Choose a safe meaningful role; if none exists, surface the conflict rather than degrading the painting.
- A user-selected pack may be preferred without every brush in the pack becoming mandatory. `preferred` and `required` are separate concepts.

The executable prompt exposes these as `preferred_brushes` and `required_brushes`.

#### Effective-settings verification is mandatory after preset selection

After every `photoshop_select_brush_preset`, obtain a **fresh authoritative effective-settings readback** before the first visual mutation with that newly selected preset. The current `photoshop_select_brush_preset` result already includes the post-selection settings read from Photoshop, so do **not** immediately issue a redundant `photoshop_get_brush_settings` when nothing has changed brush state since that result. Use `photoshop_get_brush_settings` when the selection result is unavailable/stale, another operation may have changed brush state, or an explicit re-check is diagnostically useful.

Verify at least:

- size;
- hardness;
- roundness;
- spacing;
- opacity;
- flow;
- exposed pressure-size override flag;
- exposed pressure-opacity override flag;
- airbrush/repeat;
- smoothing enable/amount.

Do not trust the preset name. Selecting a preset can silently change several effective settings. The exposed pressure flags are **not a complete readout of Photoshop Shape Dynamics**: a pressure-named preset may still render pressure-sensitive behavior even when these override flags are false. Treat unexposed preset dynamics as another reason to use a selective footprint probe when they matter.

Useful diagnostic:

```text
approx stamp interval px ≈ brush size × spacing% / 100
```

For example, a 200 px brush at 25% spacing places brush tips roughly 50 px apart. That is an obvious warning for a supposedly continuous atmospheric stroke, but it is not a universal failure threshold. Spacing is **role-dependent**: dense/low spacing usually suits continuous low-frequency mass, while larger spacing may be desirable for charcoal, broken rock, foliage or other textured marks.

If the controller changes brush settings after selection, the role map must record the **effective settings actually used**, not just the preset defaults.

#### Selective footprint probes

Settings introspection is necessary but does not fully describe brush-tip texture, scatter and other dynamics. Use a short footprint probe only when it adds information.

Probe when one or more applies:

- the preset is unknown/uncharacterized;
- it is being assigned to a new visual role;
- working scale changed substantially;
- the brush will cover a large/expensive region;
- settings look suspicious for the intended role;
- mark language is visually important to the requested style.

Do not probe every known brush on every image, hundreds of irrelevant presets, or an unchanged preset+settings+role+scale combination that already has a valid characterization.

Keep probes semantically isolated. Prefer a small **disposable scratch document** for uncertain or expensive testing; a dedicated temporary layer in the target document is acceptable for a tiny local probe when the history cost is understood. Remove/close the probe artifact and deliberately restore the latched painting document before real work.

Judge the probe for visible periodic circles/scallops, excessive gaps, repeated texture frequency, chains/grids, undesirable edge character and mismatch with the intended role. A cheap diagnostic may flag these patterns, but the visual critic remains final authority.

#### Brush role map and cache

Maintain a compact capability map rather than a giant preset catalog:

| Role | Preferred candidate | Alternative | Effective settings / scale | Probe | Caveat |
|---|---|---|---|---|---|
| Atmosphere / smooth mass | Brush A | Soft Round | ... | pass | fails if spacing rises |
| Hard architecture | Brush B | Hard Round | ... | pass | excessive smoothing weakens corners |
| Broken rock form | Brush C | textured brush | ... | pass | too noisy for silhouette |
| Fine detail | Brush D | Hard Round | ... | cached | reduce size/spacing |
| Glaze / light | Brush E | Soft Round | ... | cached | low opacity only |

Cache a useful mapping by a signature such as:

```text
preset identity + relevant effective settings + role + working-scale band
```

Reuse the mapping while that signature remains valid. Invalidate or re-probe when the preset/effective settings change materially, the scale moves to another band, or the real painting reveals a footprint mismatch despite an earlier probe. The real Photoshop result always overrides the cache.

### Structure, marks and primitives

If a defect survives thumbnail/blur inspection, treat it as composition/shape/value/form before texture or micro-detail.

Brush scale is relational:

- broad for initial masses;
- medium for planes/form transitions;
- small for selected edges, texture and focal detail.

Block-in is temporary scaffolding. If a circle/blob/capsule/stripe still reads as the primitive during medium form, structurally repaint it; mark language may change between stages.

`photoshop_paint_regions` is specifically an early closed-mass scaffold. The
VisualMicroPlan parser permits it only in `RECOGNITION_BLOCK_IN`, `COMPOSITION`,
`SHAPE`, or `GLOBAL_BLOCK_IN`. FORM/EDGE/MATERIAL/DETAIL must use another
representation mechanism rather than adding decoration over polygon fills.

#### Mark topology and surface coverage

- Use **2D area patches** when they best express continuous coverage, broad tonal/form transitions or irregular mass construction. A valid patch is 2D coverage, not a regular grid or mechanical stamp field; vary placement/density/boundary falloff while keeping a compact quantized style family.
- **Directional strokes are valid for surfaces and volume** when their footprint supports the depicted plane, turning form, gesture or material direction. Broad wall planes, folds, light bands, hair masses, terrain flow and other non-linear regions may legitimately use wide directional strokes.
- Use narrow line-oriented strokes for genuinely linear structures such as seams, cables, railings, selected hard edges, lashes/hairs or narrow accents.
- Reject the **wrong visible footprint**, not the primitive category itself. A ribbon, sausage, scallop chain, circular stamp field or mechanical sweep that reads before the depicted form is a failure unless the style explicitly licenses it.
- The same region may legitimately progress `mass patch / broad stroke → planar/facet marks → small texture → edge correction`.

For dense dabs, prefer a small reusable set of size/value/opacity/flow classes; create natural variation primarily through placement, density, overlap and clustering.

Directional stroke dynamics are a segmented approximation rather than true continuous stylus pressure; strong hard-brush tapers may need more segments.

#### Blending and layer blend modes

Blend form with overlapping lower-opacity marks, intermediate values/temperatures, scumbling/hatching where appropriate, and selective Smudge only when it improves a specific transition. Do not globally blur away edge structure.

Layer blend modes are optional downstream tools, not mandatory phases. `NORMAL` is the structural baseline. On isolated layers, when justified by the current problem:

- `MULTIPLY` — controlled shadow/glaze;
- `COLOR` — hue/chroma adjustment;
- `SOFTLIGHT` / `OVERLAY` — restrained integration/contrast;
- `SCREEN` / `LINEARDODGE` — selected emissive/specular accents.

Do not impose a grayscale→glaze→highlight recipe or use blend modes to hide unresolved structure. Toggle/inspect risky blend-mode passes and rollback them if worse.

#### Primitive-footprint check

For realistic/photorealistic work, treat visible stamp circles/scallops, ribbon/sausage strokes, regular bands or mechanically repeated spacing as must-fix when the primitive reads before the depicted form/material.

Correct the cause: rollback/delete an isolated failed pass, erase/repaint a local failure, or repaint with substantially smaller/denser marks and a changed directional pattern. If the artifact survives blur/thumbnail view, change silhouette/planar organization rather than adding texture.

Also watch for a broader **vector/collage failure** when the requested style does not call for it: uniformly hard/dark contours, cut-paper color regions with weak value transition, identical-width curves, or symbolic highlights/shadows instead of form/material response. Correct the earlier value/form/edge/material stage rather than decorating the artifact.

#### Occlusion and silhouette

Protected regions are inferred from the current rendered state, user geometry, or validated measurement/segmentation helpers; do not hard-code benchmark-specific coordinates in advance.

Do not run a stroke through a foreground form unless intentional. Split the path, change layer depth, mask, erase the hidden segment or redesign the mark. Long strokes are allowed only when the complete path is visually clear.

Silhouette errors are structural. Correct the actual boundary with erase/mask/repaint or a genuine local background patch. Do not fake negative space with one sampled flat color. Keep risky silhouette corrections rollback-friendly and inspect them before continuing.

### Semantic stages

1. **Analyze / compose** — choose mode/style; establish composition hypothesis.
2. **Global block-in** — background/ground, dominant silhouette and major value masses; must read at thumbnail scale.
3. **Medium form** — planes, tonal patches, shadow transitions, volume and secondary structures.
4. **Adaptive local refinement** — select the next semantic region by largest unresolved problem.
5. **Edges / features / linear detail** — selected hard edges and genuinely linear information.
6. **Finish / cleanup** — small value/color fixes, highlights, texture, atmosphere and local erase/repaint.

Treat these as **priority bands, not a rigid one-way staircase**. A small diagnostic focal accent or edge test may be introduced early when it is needed to evaluate the whole composition, but it does not authorize broad later-stage detailing while lower-frequency must-fix structure remains unresolved. Not every style exposes the stages as separate layers/passes.
