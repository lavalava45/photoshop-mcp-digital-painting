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
- In Chat On Steroids, the canonical route is `Chat_On_Steroids_Plugins → dist/cos-plugin.js → embedded Guard → internal ToolRegistry → Photoshop`. The older `Chat_On_Steroids_Core → photoshop-session.mjs → persistent daemon → dist/index.js` route is pending audited removal under `PAINTING-ROADMAP.md` tasks 13a–13c. Do not select it for new work. Use Desktop only for read-only UI inspection when needed.
- `dist/cos-plugin.js` enables `PHOTOSHOP_GUARD_MODE=required`: known read-only tools remain directly callable; public raw mutating tools fail closed with `guard_required` and normal visual mutations must be submitted as compact `next_pass` requests through `photoshop_guard_cycle_auto`. Removed legacy full-operation/closure payloads are not public authoring options.
- A previous native-route live acceptance passed for the pre-v2 surface. Do not interpret a stale legacy Plugins snapshot as a server limitation; the current compact-only source surface is 145 tools / 11 public Guard tools, and its own v2 live acceptance is required before final completion.
- The current controller also uses a real two-level Art Director / Painter contract. Art Director owns whole-image assessment and directive/review cadence; Painter owns bounded local/medium VisualMicroPlans and keeps the ordinary local preview/verdict barrier.
- From the repository root (`<repo-root>`), after `npm run build:server` the canonical CoS route targets `<repo-root>/dist/cos-plugin.js`. The legacy Core route still targets `<repo-root>/dist/index.js` until its audited removal, but must not receive new workflow dependencies. Keep machine-specific checkout paths out of this canonical skill.
- The `uxp-plugin/` bridge is a separate Photoshop-side runtime and must not be confused with the Chat On Steroids Plugins UI. Production Photoshop dispatch is UXP-first. Ordinary migrated primitives may select retained ExtendScript/COM only when UXP unavailability is resolved before dispatch; once UXP may have dispatched, cross-backend replay is forbidden. `photoshop_save_document` and `photoshop_neural_filter` remain UXP-only/fail-closed, and the raw-script mutation bypass remains retired. See `docs/uxp-migration-inventory.md` for current per-tool status.
- After rebuilding `dist/cos-plugin.js` in the current CoS development setup, restart only the custom Photoshop MCP plugin from **Chat On Steroids app → Plugins → Photoshop MCP Digital Painting Fork → … → Restart**. ChatGPT-side Plugins **Refresh** updates schema/connection metadata but does not guarantee process replacement. Do not restart all of CoS or use obsolete restart-helper scripts. After editing `uxp-plugin/main.js`, use **Reload** in Adobe UXP Developer Tool; for `manifest.json` changes use **Unload → Load**.
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

### Open-brief subject selection

When the user explicitly delegates **what** to paint, subject selection happens once before the art
run and before composition hypotheses. It is not repeated by the Painter and creates no Guard debt.

Generate 4–6 candidates with real semantic distance, covering at least four of these families:
character/action, object/still life, interior, vehicle/mechanism, organic/natural form and
architectural/spatial situation. At most one candidate may be a scenic landscape or an
architecture-led vista. Different weather, palette or time of day does not make the same basic
subject into a different candidate.

Use recent motifs only as negative evidence. If `processes/subject-selection-memory.json` is
available, read that compact file only; never inspect previous process folders, images, plans or
commentary to obtain ideas. Reject a candidate whose feature signature substantially repeats a
recent entry unless the user requests a variation. Missing or unwritable memory is advisory and
must not block the first visual action.

Each surviving candidate must specify a concrete subject, setting, action/relationship and spatial
problem. Test whether the premise remains interesting without a dramatic celestial body, sunset,
fog, glowing window, water reflection or similar atmospheric shortcut. These motifs are not banned,
but their presence cannot be the candidate's only idea. Compare specificity, structural interest,
fit to the requested medium/finish and executable feasibility; never choose solely because a scene
is easy to decompose into background bands and a simple silhouette.

Commit to one candidate, summarize it as the brief, append one abstract feature signature to the
memory (newest 12 only), and continue to composition. Do not show all candidates unless requested.
Do not reopen the choice during painting unless the user changes the brief or execution proves the
selected premise impossible rather than merely difficult.

### Why this skill exists

It prevents three recurring classes of failure:

- technically successful edits that are visually wrong;
- detail/texture added over unresolved composition, shape, value or form;
- habitual primitives or append-only painting replacing image-specific correction.

The core loop is therefore:

```text
perceive → plan → mutate a short semantic pass → inspect → accept/correct/rollback → replan
```

### Recognition Block-In — before ordinary refinement

For a new subject, do **not** spend multiple passes perfecting one large silhouette while the image still lacks the cues that make the subject identifiable. Until the first recognizable whole-frame preview exists, enter **Recognition Block-In** before ordinary hierarchy refinement.

1. Derive **3–7 recognition features** from the brief/reference: the smallest useful set of visual cues that distinguishes the requested subject from plausible lookalikes. Feature size does not determine priority; a small eye, beak, wheel, handle or opening may carry more identity than a large contour correction.
2. If style is part of the request, include at least **one large, unmistakable style cue** in the same early hypothesis. Do not postpone all style evidence until finish/detail.
3. Build the **whole rough image**, not one perfected part: major silhouette/masses plus all selected recognition features in approximate placement/value/color. Prefer `photoshop_paint_regions` for broad closed color/value masses when it can express the block-in cheaply; use strokes/dabs only where their topology is actually useful.
4. Judge the whole preview at normal/thumbnail scale. The exit question is not “is the contour clean?” but “does the subject read without relying on the prompt, and is the requested style direction visibly present when applicable?”
5. While recognizability is still absent, defer contour polishing, texture, material microstructure and other cleanup unless they directly block recognition. Fix the largest **recognition barrier** instead.
6. Once the image is recognizable, leave Recognition Block-In and resume the normal `COMPOSITION → SHAPE → VALUE → FORM → EDGE → MATERIAL → DETAIL` hierarchy. Recognition is an early milestone, not Definition of Done.

Persist `recognition_features`, their current visible status, and any feature destroyed by a later pass when useful. A pass that erases or obscures an already-established recognition feature is a regression unless the replan intentionally replaces that feature with a stronger equivalent.

For every `RECOGNITION_BLOCK_IN` verdict, record a compact recognition classification:

```text
recognition = {
  subject: yes | no | uncertain,
  style: yes | no | uncertain | not_applicable,
  evaluator: producer | blinded | human | external,
  visible_features: [...],
  lost_features: [...]
}
```

Later stages need not repeat this object unless a previously established recognition cue is lost or recognition itself changes. The controller derives recognition timing from the durable journal: first detected visual change, first subject-recognizable frame, first subject+style-recognizable frame, inter-operation gap time, reported tool execution time where available, and passes that destroyed established recognition features. Prefer a blinded/human/external recognition evaluator for benchmark claims; `producer` is useful online control evidence but not an independent benchmark.

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

For representational/high-detail targets, stage advancement is a change in representation,
not merely a change of tool. The intended progression is:

```text
broad block-in
→ modelled major form
→ informative secondary forms
→ intentional edge hierarchy
→ material/light response
→ selective detail
```

Texture, noise or a larger mark count applied to an otherwise unchanged flat mass is not
progression. Before DETAIL the durable refinement gate in
[`methods.md`](methods.md) must either pass on the exact current frame or be explicitly
inapplicable because the declared style contract intentionally retains a flat/graphic representation.

### Operating modes

Choose the mode before painting:

1. **Reference reproduction** — reconstruct from a visible reference. The reference supplies visual/measurement evidence; it is not pasted, blended as an underlay or mechanically traced by default.
2. **Free composition** — derive a visual hypothesis from the brief: focal point, placement, perspective, large masses, negative space, depth order, light, atmosphere, palette and scale.
3. **Stylized painting** — use the same hierarchy/control loop while adapting shape, edge, mark, material and finish criteria to the requested style.

Photorealistic portrait work is a specialization of reference reproduction, not the universal painter.

For a non-trivial **free composition**, do not commit to the first workable arrangement. Record at least two cheap composition hypotheses before expensive rendering. Compare them by large-mass organization, negative space, focal placement and light pattern, then explicitly select one and record why it is stronger. Reference reproduction may skip this branch-comparison gate because the reference already constrains composition.

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
  commentary_mode?: technical | artistic | mixed,
  commentary_detail?: short | normal | detailed,
  stage,
  active_scale,
  unresolved_errors,
  candidate_regions,
  selected_region,
  selected_action_class,
  protected_regions,
  protected_layer_ids,
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

Before the first paint mutation of an art project, bind the working document to one
immutable repository-relative `processes/<subject>-process/<run-name>/` with
`photoshop_guard_set_art_run`. The run owns `frames/`, `checkpoints/`, `final/`
and its local `painting-state.json`; artwork artifacts must not fall back to the
repository root. Persist after an accepted checkpoint, rollback, stage transition,
meaningful replan or document/session recovery. Do not rewrite it after every
read-only call.

`accepted_frame` and `current_frame` are distinct: an uninspected frame is not accepted merely because it exists.

### Commentary modes

Commentary is a presentation layer over the same painting decisions; changing it
must never change tool safety, preview cadence, verdict rules or the actual visual
plan. Keep two sticky settings for the current art run:

```text
commentary_mode = technical | artistic | mixed
commentary_detail = short | normal | detailed
```

Natural-language switches are deliberately short:

- `режим техника` → `technical`;
- `режим художник` → `artistic`;
- `режим вместе` → `mixed`;
- `коротко` / `обычно` / `подробно` change only detail;
- `режим кратко` is an alias for short detail while preserving the content mode;
- `следующий шаг — художник|техника|вместе` is a one-action override and does not
  alter the sticky setting. A detail word may be added to the same phrase.

Default to `mixed + normal` when the user has not selected a mode. Persist both
sticky values in `painting-state.json` for long/resumable work and restore them on
resume.

#### Artistic mode is a tutorial voice, not hidden reasoning

`artistic` commentary must use natural, good Russian for an artist who does not
care about infrastructure. Do not reveal or imitate private chain-of-thought.
Expose only concise artistic rationale that could usefully be said aloud while
painting:

1. what visually feels wrong or unresolved;
2. what visual effect is sought now;
3. what the hand will do in Photoshop, where, and with which artist-relevant
   settings when useful;
4. what relationship must be preserved;
5. what the inspected result actually changed.

Allowed vocabulary includes ordinary Photoshop/artist concepts in Russian: слой,
маска, кисть, ластик, выделение, перемещение, трансформация, размер кисти,
жёсткость, мягкость, непрозрачность, нажим, цвет, край, пятно, силуэт, свет, тень,
полутон, форма, объём, ритм, глубина, пространство and режим наложения.

Artistic commentary has a hard ban on infrastructure vocabulary and English jargon:
do not mention MCP, Guard, API, JSON, tool/function names, ids, hashes, async/poll,
receipt, protocol, runtime, daemon, server, transport, schema, job ids, controller
state or similar implementation details. If a technical problem blocks painting,
state only its practical consequence in plain Russian, for example: “изменение не
применилось, рисунок не тронут; сначала проверяю, что осталось на холсте”.

Detail levels control only length:

- `short` — one compact artistic sentence or one compact technical report;
- `normal` — 2–3 sentences around intent/action/result;
- `detailed` — a small tutorial, normally 4–7 sentences, including why this mark,
  edge, value, layer or brush choice serves the form.

For `artistic` or `mixed` at every detail level, before a meaningful visual pass
emit the compact root goal in the selected voice as an **ordinary user-visible
assistant message**. The compact compiler reuses that same goal internally as the
guarded operation's `artistic_commentary`; do not duplicate it in JSON. The Guard
archives the resulting process frame under `frames/` and writes a same-stem `.txt`
containing that pre-operation text plus the durable technical execution record and
later artistic observation when available. In `mixed`, put the artistic explanation
first and a compact technical note second. In `technical`, keep the existing
execution-oriented style. A one-action override expires after that meaningful pass.

### Semantic layer architecture

Use layers as part of the correction/recovery design, not only as storage. Before broad painting in a non-trivial scene, identify which visual entities may plausibly need to move, be repainted, masked, protected or rolled back independently.

Every VisualMicroPlan must perform a **Layer Separation Check**. Before the first
substantial change to a new independent object, material, light effect or plane,
record whether the change is substantial, its rollback value, whether independent
adjustment is expected, and the artistic reasons. If that concern is likely to need
independent adjustment, masking, weakening, recoloring, protection, transform or
rollback, use `create-new` or `temporary-hypothesis` before painting it. Ordinary
continuation and tiny low-value accents remain on the existing logical layer. The
check exists to preserve editability, not to create one layer per feature or stroke.

Layer separation and layer protection are consecutive responsibilities, not unrelated
features. Once a substantial visual feature on its own stable layer has been inspected
and **accepted**, carry that exact stable layer id forward in `protected_layer_ids` for
subsequent VisualMicroPlans whenever the current task is not intended to alter it.
`protected_regions` remains descriptive semantic context only; it is not executable
pixel/layer protection. `protected_layer_ids` is the enforceable contract: when it is
non-empty, supported painting mutations must pin their target layer id and fail closed
before dispatch if the target is unknown or protected. For ordinary ADD/REFINE/CORRECT
work, do not mutate a protected layer. If the artistic intent really is to remove or
replace an accepted protected feature, use `action_class=REPLACE` or `ERASE` and declare
that exact id in both `protected_layer_ids` and `replace_protected_layer_ids`. Do not use
the replacement exception merely to bypass a targeting mistake or convenience conflict.

Default separation is by **expected independent correction**, not by every visible feature. Typical useful boundaries are:

- background / distant environment;
- support plane or foreground surface;
- cast shadow(s);
- each major subject/object that may need its own transform or silhouette correction;
- optional form/light and finishing/accent layers when they materially simplify revision.

Do not put a major object, its support surface and its cast shadow on one raster layer merely because one `paint_regions` call can paint them together. Conversely, do not explode a simple object into dozens of layers when no independent correction is expected. Prefer the smallest layer structure that preserves likely transforms, silhouette repairs, occlusion edits, rollback and protected-region workflows.

The executable layer-decision contract is based on rollback semantics:

- `create-new` — start one new logical rollback unit for one artistic hypothesis;
- `continue-logical-layer` — keep working on the same hypothesis/layer id;
- `temporary-hypothesis` — isolate uncertain/A-B/destructive work so it can be discarded cleanly;
- `keep` — accept the isolated hypothesis as an independent layer;
- `adjust` — continue refining that same rollback unit rather than creating another layer;
- `discard` — delete the exact stable logical-layer id, not whichever layer happens to be active;
- `merge` — collapse an accepted logical layer only into an explicitly named adjacent target after independent rollback is no longer needed.

For `create-new` / `temporary-hypothesis`, record a stable `hypothesis_id`, the artistic hypothesis, `rollback_value`, `expected_independent_rollback=true`, and at least one concrete `separation_reason`. One micro-plan may create **exactly one** logical layer and all mutations in that plan must target that new layer. This is the anti-layer-explosion gate: never create a layer per stroke merely because creation is cheap. For `continue-logical-layer` / `adjust`, reuse one stable `layer_id` and do not create another layer.

Merge is not a cleanup default. Keep layers separate while independent correction/A-B/rollback value remains. Merge only after acceptance when the two layers are intended to survive/fail together and the source is the explicit immediately-above sibling of the explicit merge target.

#### Progress is visual-problem resolution, not protocol throughput

The primary progress metric for a painting run is **resolved visual problems**, not MCP calls, completed protocol states, frames, reports, verdicts or checkpoints.

Track a stable `problem_id` for every visual mutation. A problem counts as resolved only when all of the following are true:

- the decoded before/after change is `meaningful` under the visual-significance gate;
- the artistic verdict is `improvement`;
- the disposition is `accept`;
- `target_resolved = yes`.

Read-only inspection, reports, recovery bookkeeping, verdict files and PSD checkpoints are necessary control work, but they are **not artistic progress**. The controller exposes `resolved_visual_problems`, open/resolved problem ids, meaningful/insufficient pass counts and `external_actions_since_last_meaningful_visual_change`. Optimize the workflow for visual problems closed per unit of execution/recovery cost, not calls completed.

#### Hard visual-cadence rule

Once a visual preview has been inspected and its verdict recorded, the next
canonical cycle must contain the next meaningful visual pass when there is no
uncertain operation, active async job, pending report/Guard acknowledgement,
preview/verdict barrier, controller-required checkpoint/recovery step, or user task
change. Do not insert routine `status`, `photoshop_get_state`, document listing,
schema/source inspection, grep, extra preview or infrastructure investigation
between healthy passes.

`photoshop_get_state` is required before the first mutation of a new run and when
state is genuinely uncertain: interrupted/uncertain execution, recovery,
suspected document/layer retargeting, an external event that may have changed
Photoshop state, or a concrete tool/controller error that requires fresh evidence.
It is not required between normal pinned visual passes when the materialized
preview, verdict, closed barrier and `document_id` already establish continuation.

After a demonstrated systemic failure, allow one compact diagnostic investigation,
then produce a causal replan and return to a visual pass. A second diagnostic
investigation is allowed only when the first produced no actionable cause. Ordinary
visual verdicts must never expand into open-ended source/schema/state/status chains.

#### Paired PSD checkpoint persistence

Whenever a preview/export is promoted to an **accepted intermediate checkpoint**,
**stage transition**, or **recovery anchor**, save a layered PSD under the bound
project's `checkpoints/` before continuing. Ordinary process images remain under
`frames/`, and final PSD/image exports belong under `final/`. Guarded art-run saves
and exports may not escape the bound project directory. Use the same serial/stem
when practical so the visual preview and editable recovery file form an obvious pair, for example:

```text
frames/frame_0042_tower_form.jpg
frames/frame_0042_tower_form.txt
checkpoints/frame_0042_tower_form.psd
```

This PSD checkpoint is mandatory persistence, not an optional convenience. Save it with the latched `document_id`; do not silently continue if the PSD write failed. Record the successful path in `last_psd_checkpoint` / painting state.

`photoshop_save_document` is intentionally UXP-only. If a mandatory checkpoint fails
with `uxp_bridge_unavailable`, do **not** fall back to COM/ExtendScript and do not clear
the checkpoint barrier. Follow the structured recovery hint once with
`photoshop_get_capabilities`. If `uxp_bridge_reachable=false`, treat painting progression
as blocked by persistence: do not launch another visual mutation. Use the supported UXP
bridge recovery/reload path when the host can do so; otherwise tell the user plainly that
the canvas remains open but the required editable checkpoint was not created, and stop.
After the bridge is restored, retry only the save, verify that the PSD
exists/non-empty, record `last_psd_checkpoint`, then resume the already-planned visual
cycle. Never replay the preceding painting mutation merely because its checkpoint failed.

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
→ visual intent
→ impact class
→ method from the actual runtime capability map
→ registered Photoshop/runtime tool → explicit fallback if needed
→ testable hypothesis: expected change + must-preserve + failure signals
→ one short mutation / atomic visual bundle
→ process capture
→ inspect real Photoshop result
→ execution sanity
→ factual critic: what changed? target resolved? regressions? uncertainty?
→ independent scene-relationship audit: support/contact, gaps/floating, occlusion/depth, cast-shadow relation, tangencies/intersections, silhouette/proportion
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
- do not let a target-specific review hide a broken support/contact, occlusion, shadow or depth relationship elsewhere in the frame;
- Photoshop output, not MCP success, is visual ground truth.
