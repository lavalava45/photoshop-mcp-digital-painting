# Digital Painting Visual Control Skill

This skill defines the visual-control policy for AI painting through the Photoshop MCP fork. The low-level API answers **how to make a mark**; this skill answers **when, where, with what visual intent, and whether the result should be kept**.

Executable guide prompt:

```text
ps.digital_painting_control
```

Use it for drawings, paintings, brush-based illustration, line art, studies and similar work whose quality depends on relationships between many edits.

## Hard execution invariants

### Photoshop tool-routing latch

Once a task enters Photoshop/COS/MCP mode, that execution mode is sticky until the user explicitly exits it.

- Short continuations such as `да`, `давай`, `продолжай`, `рисуй`, `дальше`, `ок` inherit the current Photoshop path.
- In Chat On Steroids, use `Chat_On_Steroids_Core` for Photoshop MCP/terminal execution; use Desktop only for read-only UI inspection when needed.
- The canonical COS transport is **Core → direct stdio → this fork's built `dist/index.js` → Photoshop**. The Chat On Steroids `Plugins` section / shared MCP connector is **not** the Photoshop transport for this workflow.
- Do not search for, require, or fall back to a Photoshop connector under `Chat_On_Steroids_Plugins`. Absence of such a connector is not evidence that Photoshop MCP is unavailable; verify the Core/direct-stdio route instead.
- On the current Windows workspace, the fork source is `E:\Downloads\devspace-test\experiments\photoshop-mcp-digital-painting`; after `npm run build:server`, direct stdio must target this repository's `dist/index.js`.
- The optional `uxp-plugin/` bridge is Photoshop-side infrastructure for Neural Filters only and must not be confused with the Chat On Steroids Plugins UI.
- Do not switch to `image_gen` or another image-generation path merely because a follow-up says draw/paint/render/edit.
- Switch execution family only on an explicit user instruction such as “используй ImageGen” or “не в Photoshop”.

```text
CURRENT_EXECUTION_MODE = PHOTOSHOP_MCP
```

### Document targeting latch

Capture the working `document.id` from `photoshop_get_state` or `photoshop_list_documents` and keep it as the workflow latch.

- Pass `document_id` on document-bound reads/mutations whenever multiple documents or outside UI/agent activity could retarget the active tab.
- Invalid or closed ids fail closed. Never drop the id and silently retry against the active tab.
- Recover a missing target by listing documents and deliberately re-establishing the latch.
- Check returned `document_target: { id, pinned: true }` when deterministic targeting matters.
- Global operations such as brush configuration or pure landmark transforms do not require a document latch.

## Core controller

### Why this skill exists

It prevents three recurring classes of failure:

- technically successful edits that are visually wrong;
- detail/texture added over unresolved composition, shape, value or form;
- habitual primitives or append-only painting replacing image-specific correction.

The core loop is therefore:

```text
perceive → plan → mutate a short semantic pass → inspect → accept/correct/rollback → replan
```

### Universal painting hierarchy

```text
COMPOSITION → SHAPE → VALUE → FORM → EDGE → MATERIAL → DETAIL
```

- **Composition** — focal hierarchy, placement, negative space, perspective/horizon, depth order and light direction.
- **Shape** — silhouette and large masses.
- **Value** — major light/shadow families and value grouping.
- **Form** — plane turns and transitions that make masses read as volume.
- **Edge** — deliberate hard/firm/soft/lost hierarchy.
- **Material** — surface response to light, roughness/gloss, reflection, translucency and texture.
- **Detail** — selected small information after larger problems are solved.

Advance only when the current level visually reads. If a later checkpoint exposes an earlier failure, return to that level.

### Operating modes

Choose the mode before painting:

1. **Reference reproduction** — reconstruct from a visible reference. The reference supplies visual/measurement evidence; it is not pasted, blended as an underlay or mechanically traced by default.
2. **Free composition** — derive a visual hypothesis from the brief: focal point, placement, perspective, large masses, negative space, depth order, light, atmosphere, palette and scale.
3. **Stylized painting** — use the same hierarchy/control loop while adapting shape, edge, mark, material and finish criteria to the requested style.

Photorealistic portrait work is a specialization of reference reproduction, not the universal painter.

### Style contract

Translate style into operational properties rather than `style name → preset`:

```text
style_contract = {
  realism_level,
  shape_language,
  composition_bias,
  edge_policy,
  contour_role,
  mark_visibility,
  value_policy,
  color_policy,
  spatial_treatment,
  material_treatment,
  detail_density,
  texture_policy,
  primitive_footprint_tolerance,
  layer_or_mask_bias,
  finish_criteria
}
```

Record only relevant fields. The contract is upstream of region/action/primitive choice and modifies the critic as well as the painter. Judge previews against:

```text
USER BRIEF + STRUCTURAL READABILITY + STYLE CONTRACT
```

If no style is specified, derive only a minimal contract from brief/medium/finish level. Style may license visible marks or simplified geometry, but not accidental tangencies, broken occlusion or unintended crossings.

### Painting state and persistence

For non-trivial work maintain explicit state; for long/development sessions persist it to `process-dir/painting-state.json`:

```text
{
  session_id,
  working_document_id,
  reference_document_id?,
  process_dir,
  frame_counter,
  accepted_frame,
  current_frame,
  last_psd_checkpoint?,
  mode,
  reference_or_brief,
  style_contract,
  stage,
  active_scale,
  unresolved_errors,
  candidate_regions,
  selected_region,
  selected_action_class,
  protected_regions,
  rollback_anchor,
  brush_state?: {
    inventory_snapshot?,
    preferred_brushes?,
    required_brushes?,
    required_usage?,
    role_map?,
    active_preset?,
    effective_settings?,
    last_probe?
  },
  last_action,
  last_action_result
}
```

Persist after an accepted checkpoint, rollback, stage transition, meaningful replan or document/session recovery. Do not rewrite it after every read-only call.

`accepted_frame` and `current_frame` are distinct: an uninspected frame is not accepted merely because it exists.

#### Paired PSD checkpoint persistence

Whenever a preview/export is promoted to an **accepted intermediate checkpoint**, **stage transition**, or **recovery anchor**, also save a layered PSD checkpoint in the same process directory before continuing. Use the same serial/stem when practical so the visual preview and editable recovery file form an obvious pair, for example:

```text
frame_0042_tower_form.jpg
frame_0042_tower_form.psd
```

This PSD checkpoint is mandatory persistence, not an optional convenience. Save it with the latched `document_id`; do not silently continue if the PSD write failed. Record the successful path in `last_psd_checkpoint` / painting state.

Do **not** create a PSD for every high-frequency diagnostic/process JPEG. High-frequency image capture and editable PSD checkpoints have different cadence: ordinary mutation frames may remain JPEG-only, while accepted milestones/stage transitions/recovery anchors receive the paired PSD. If the user explicitly asks for denser PSD checkpointing, obey that stricter cadence.

The current `photoshop_save_document(..., format="PSD")` path writes the checkpoint as a copy, preserving the working document association; use it rather than retargeting the live document to each checkpoint filename.

Resume with:

```text
load state → verify Photoshop/document latch → inspect actual current/accepted frame → reconcile → continue
```

A successful `ROLLBACK` is not an end-of-turn condition: inspect the restored canvas, reconcile/persist it, then replan unless the user said stop/wait or Definition of Done already passes.

### Compact hot loop

Keep this active throughout long sessions:

```text
BRIEF + STYLE CONTRACT
→ largest unresolved problem at current scale
→ protected areas + region priority
→ ACTION CLASS (ADD is not default)
→ stage-appropriate primitive/tool
→ one short mutation / atomic visual bundle
→ process capture
→ inspect real Photoshop result
→ execution sanity
→ improvement | neutral | regression
→ accept | correct | rollback
→ persist accepted/recovered state
→ replan
```

Must-not-forget guards:

- structure before texture;
- primitive footprint is must-fix unless style explicitly licenses it;
- never bury a known regression;
- do not advance while a lower-frequency must-fix remains;
- Photoshop output, not MCP success, is visual ground truth.

### Action contract and classes

Before each semantic micro-pass formulate:

```text
Current problem
Scale
Protected areas
Region priority
Action class
Relevant style constraints
Primitive/tool
Expected visual result
```

Keep the full contract in planner/session state; chat telemetry should normally compress it to one short line or a few clauses.

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

After every `photoshop_select_brush_preset`, call `photoshop_get_brush_settings` **before the first visual mutation with that newly selected preset**.

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

#### Area vs line

- Use **2D area patches** for continuous surfaces and broad tonal/form transitions. A valid patch is 2D coverage, not a regular grid, one-dimensional chain or mechanical sweep; vary placement/density/boundary falloff while keeping a compact quantized style family.
- Use **line-oriented strokes** only for genuinely linear structures: seams, cables, railings, selected hard edges, lashes/hairs or narrow accents.
- Do not use a line primitive to model a broad area.
- The same region may legitimately progress `mass patch → planar/facet marks → small texture → edge correction`.

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

Not every style exposes these as separate layers/passes, but do not use later-stage detail to compensate for an earlier-stage failure.

### Visual checkpoints and execution sanity

Reasoning previews are required after major semantic passes and risky local corrections.

Use before/after image-delta only as **execution sanity**, not as an artistic score:

- identical preview/hash when a visible mutation was expected is strong no-op evidence;
- near-zero delta should trigger targeting/visibility/tool-state checks rather than being accepted as merely `neutral`;
- large delta raises inspection priority;
- non-zero delta proves only that something changed.

Artistic acceptance remains `BRIEF + STRUCTURE + STYLE CONTRACT`.

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

## Development, evaluation and operational recovery

### Pacing & telemetry

For non-trivial painting:

```text
announce the semantic problem briefly
→ execute one short mutation / atomic visual bundle
→ wait for actual MCP/terminal completion
→ capture/preview
→ inspect and classify outcome
→ report concise result
→ replan
```

#### Hard user-visible report barrier

Every completed **external tool action** must be reported to the user before the controller starts any later external tool action.

An external tool action is any completed COS / Photoshop MCP / terminal / repository tool call, including read-only calls such as document/state/history/layer/preview inspection. The only exception is polling or `write_stdin` for the **same still-running process**: those polls are continuation of that one unfinished action, not new actions.

The mandatory completion report is:

```text
Что сделал: ...
Зачем: ...
Результат: ...
```

This is a **hard execution barrier**, not optional narration:

- once a tool call returns a terminal/completed result, do not invoke another external tool until the report above has been emitted to the user;
- if the action produced no visible change, say that explicitly in `Результат` rather than silently continuing;
- if an action failed, stalled, timed out, or was classified `not-executed` / `partial` / `uncertain`, report that state before any recovery action starts;
- a heartbeat during a long-running call does **not** count as the completion report and does not release this barrier;
- do not evade the barrier by redefining a chain of tool calls as one “workflow step”, “preflight”, “recovery”, “checkpoint”, “preparation block” or other semantic group;
- one valid `photoshop_execute_visual_microplan` call is one external tool action even though it contains internal server-side substeps; when that call completes, the user-visible report is mandatory before any later external tool call.

During a long-running external action, send a concise heartbeat roughly every 30–60 seconds. The heartbeat must state what is still pending and whether any visual mutation has been confirmed. Silence while waiting for MCP/terminal completion is not allowed.

#### Hard UI focus barrier

Operate Photoshop in the background by default. Never take window focus or alter the user's visible Photoshop context on your own initiative.

Without explicit user permission for that specific focus/context change:

- do **not** bring Photoshop to the foreground, raise/activate its window, or otherwise steal keyboard/window focus;
- do **not** automatically switch the active Photoshop document/tab, even if the Photoshop window remains in the background;
- do **not** open or activate scratch/probe documents when doing so changes the active document visible to the user;
- do **not** use `photoshop_set_active_document` merely to make execution convenient; prefer pinned `document_id` operations that leave the user's active document untouched;
- if a workflow genuinely requires changing the active document or foreground window, stop after the preceding report and ask for explicit permission before that action.

If the user wants to inspect Photoshop, the user can bring it forward or switch documents themselves. Background-safe execution and pinned document targeting are the default.

An **atomic visual bundle** is narrow by definition. All included marks must:

- address **one visual problem**;
- affect **one semantic region** or one tightly coupled region set that cannot be judged meaningfully in isolation;
- use **one action class** (`ADD`, `REFINE`, `REPLACE`, `ERASE`, `ROLLBACK` or `LEAVE`);
- belong to the same stage/scale decision;
- support one clear before/after acceptance question.

If any of those conditions is false, split the work and preview between parts. Independent sky, land/water, foliage, architecture, subject-detail or other separately judgeable passes are **never one bundle** merely because they can be encoded in one MCP/script call.

- Never launch another Photoshop mutation while the previous call is outstanding. A session/process id is not completion.
- No next visual mutation may begin until the previous mutation/atomic bundle has **completed → been captured → been visually inspected → been classified** as improvement, neutral or regression. This is a hard barrier, not a suggestion.
- Do not queue several semantic passes into a hidden background chain.
- During genuinely long calls, send concise heartbeat updates roughly every 30–60 seconds; these do not replace the mandatory completion report.
- If the user says stop/wait, launch no new mutation; first determine whether an already-started call is still running.
- Full action contracts stay in planner/state; chat updates are execution telemetry, not essays.
- When the user explicitly requests stricter capture such as one-stroke→one-preview, obey it even if slower.

During skill development/testing, **high-frequency process capture is ON by default** unless disabled by the user:

- save monotonic JPEGs (`frame_0001.jpg`, …) after every visual mutation or deliberately tiny atomic bundle;
- do not duplicate frames after read-only calls;
- **MUST split** any visually large, multi-region, multi-role or multi-stage change into separately completed, captured and inspected mutations/bundles;
- for a medium-complexity evaluation target roughly **100+ meaningful frames** when practical;
- reasoning-preview cadence and process-capture cadence are separate.

Batching, style grouping, transport quantization or other execution optimization may reduce calls **only inside one already-approved atomic visual bundle**. They must never combine independent semantic passes, cross a stage/scale decision, or postpone a required preview/inspection barrier.

`photoshop_execute_visual_microplan` is the preferred transport optimization when several preparation/read/configuration calls are already known to belong to the same approved bundle. It may collapse those calls plus **exactly one** visual mutation and its immediately following `photoshop_get_preview` into one MCP round-trip. The micro-plan must keep one stage, scale, semantic region and action class; it is not permission to hide several passes in one request. The server returns the preview image plus SHA-256 and blocks the next VisualMicroPlan for that document until the caller supplies that exact SHA with a visual verdict (`improvement|neutral|regression`) and disposition (`accept|correct|rollback`). A mutation error is not auto-retried: the executor still attempts the preview because partial AUTO batches may already have altered the canvas. `$steps.<id>.<path>` may reuse earlier normalized preparation results inside the same micro-plan, and the top-level pinned `document_id` remains authoritative for all document-bound internal steps.

When one of those frames is also an accepted checkpoint/stage transition/recovery anchor, save its paired PSD beside it before launching the next painting mutation.

### Fresh-composition evaluation invariant

When evaluating the skill on a fresh composition, do not reuse scene-specific geometry or execution plans from earlier artwork (coordinates, paths, stroke lists, proportions, precomputed occlusion regions or the same composition with cosmetic changes). Reuse only generic infrastructure such as batching helpers, brush presets, palette utilities and generic layer setup unless the user explicitly requests continuation/refinement/variation.

### Operational failure / reconnect

Visual regression and uncertain tool execution are different failure classes. For timeout, disconnect, Photoshop restart/closure, interrupted UI or another uncertain mutation state:

```text
stop new mutations
→ check/poll the original process if it may still be running
→ reconnect only if needed
→ get/list Photoshop state and verify the latched document
→ inspect history/layers if partial completion is possible
→ obtain a current preview
→ compare with last accepted/current frame and expected delta
→ classify completed | not-executed | partial/uncertain
→ reconcile Photoshop + painting-state.json
→ only then retry/correct/rollback/replan
```

Never blindly repeat a timed-out mutation; it may already have executed.

## Completion

### Cleanup

Before finishing, inspect for accidental intersections/tangencies, duplicated contours, meaningless line endings, broken silhouettes, inconsistent edge hierarchy and value/color marks that flatten depth. Correct with erase/repaint/mask/opacity/replacement as appropriate.

### Definition of Done

Do not stop because a stroke counter was reached. The painting is complete when:

1. composition/focal hierarchy and subject read at the intended scale;
2. major forms, proportions and silhouette are coherent for the requested finish;
3. established landmark/measurement evidence, when applicable, has been reconciled;
4. depth/occlusion and focal features are intentional/resolved;
5. value/color and edge hierarchy support readability;
6. the result is coherent with the style contract;
7. cleanup is complete and no must-fix structural/overlap/tangent/readability error remains;
8. additional marks would be optional refinement rather than necessary correction;
9. explicit user constraints are satisfied.

### Stroke budgets and finish levels

Stroke count is a soft planning budget unless the user explicitly makes it a hard cap. If a soft budget is reached with a must-fix remaining, correct it; if Definition of Done passes early, stop.

- **Sketch** — readable silhouette/proportion/gesture and main value/color statement; micro-detail may remain unresolved.
- **Study** — resolve major forms/depth/focal detail/value/color and obvious cleanup without unnecessary polish.
- **Polished** — resolved focal detail, deliberate edge hierarchy, accents and thorough cleanup.

## Using the MCP prompt

Call `prompts/get` for `ps.digital_painting_control`, for example:

```text
subject: cat portrait
style: anime cel-shaded
finish_level: study
constraints: white background; three layers maximum
preferred_brushes: My Inking Pack; Square Charcoal
required_brushes: My Dry Brush 04
stroke_budget: 80
budget_mode: soft
```

Treat the returned guide as the executable session contract; this markdown file is the canonical detailed policy and rationale.
