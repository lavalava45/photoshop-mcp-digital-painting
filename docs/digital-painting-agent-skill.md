# Digital Painting Visual Control Skill

This skill defines how an AI painting agent should use the fork's Photoshop brush tools. It is deliberately separate from the low-level painting API: the API answers **how to make a stroke**, while this skill answers **when, where, and whether that stroke should be made**.

The executable MCP guide prompt is:

```text
ps.digital_painting_control
```

Use it for drawings, paintings, sketches, brush-based illustration, line art and similar work where the result depends on relationships between many strokes.

## HARD TOOL-ROUTING INVARIANT — Photoshop mode

Once a task has entered Photoshop/COS/MCP mode, that execution mode is **sticky**. It remains active across subsequent turns until the user explicitly exits it.

While Photoshop mode is active:

1. Short continuation messages such as `да`, `давай`, `продолжай`, `сделай`, `рисуй`, `дальше`, `есть доступ`, `ок`, or `попробуй еще` **inherit the current Photoshop execution path**. They must not trigger a fresh tool-family decision.
2. In Chat On Steroids, the first execution surface for a Photoshop continuation must be `Chat_On_Steroids_Core` for MCP/terminal work, or `Chat_On_Steroids_Desktop` only for read-only UI inspection when needed.
3. `image_gen` or any other external image-generation path must **not** be called while Photoshop mode is active, even if the request contains words such as *draw*, *paint*, *image*, *portrait*, *render*, *create*, *edit*, or *repaint*.
4. A short or ambiguous follow-up can never switch execution mode.
5. Photoshop mode may be exited only by an explicit user instruction that clearly changes the execution path, for example: `используй ImageGen`, `сгенерируй через ImageGen`, `не в Photoshop`, or an equivalent explicit request.
6. If routing logic would choose `image_gen` while Photoshop mode is active, treat that as a routing violation: stop that route and use the existing Photoshop/COS/MCP path instead.

Operational latch:

```text
CURRENT_EXECUTION_MODE = PHOTOSHOP_MCP
Do not reconsider the tool family unless the user explicitly changes mode.
```

Regression examples:

```text
Context: editing a portrait in Photoshop via MCP
User: "давай"
Correct: continue through Chat_On_Steroids_Core → direct stdio Photoshop MCP
Wrong: image_gen

User: "есть доступ"
Correct: resume/check the Photoshop MCP path
Wrong: image_gen

User: "продолжай рисовать"
Correct: continue the current Photoshop painting workflow
Wrong: image_gen
```

This invariant is stronger than a preference. It is a tool-routing guard intended to prevent a short continuation turn from escaping an already-established Photoshop workflow.

## HARD DOCUMENT-TARGETING INVARIANT

When a workflow is attached to an existing Photoshop document, capture its numeric `document.id` from `photoshop_get_state` or `photoshop_list_documents` and treat that id as the document latch for the workflow.

Rules:

1. If more than one document is open, or another user/agent/UI action could change the active tab, pass the latched `document_id` on every document-bound read and mutation that accepts it.
2. Do not trust the visually active Photoshop tab as targeting state. Another MCP client, agent, action, Smart Object workflow, or user click may change it between calls.
3. A supplied `document_id` must be a positive integer. Invalid values fail closed; never remove the id and retry against the active document as a fallback.
4. Unknown/closed ids must be recovered by calling `photoshop_list_documents` and deliberately choosing the current target again.
5. Successful pinned calls report `document_target: { id, pinned: true }`. Check this metadata when deterministic cross-document execution matters.
6. Global/pure operations such as brush configuration, opening/creating a document, or pure landmark transforms do not need a document latch.

The intended invariant is:

```text
capture document.id once
→ pass document_id on document-bound operations
→ verify returned document_target when needed
→ never silently fall back to whichever tab happens to be active
```

## Why this skill exists

A technically valid stroke can still be visually wrong. Common failures include:

- drawing a long line through a foreground object;
- adding detail before fixing silhouette/proportion;
- creating accidental tangencies or doubled contours;
- continuing to accumulate strokes without inspecting the image;
- treating a requested stroke count as the definition of completion.

The skill changes the workflow from:

```text
plan once → paint many strokes → inspect at the end
```

to:

```text
perceive → plan → paint a semantic pass → inspect → correct → continue
```

## Universal painting hierarchy

The core discipline is subject-agnostic:

```text
SHAPE → VALUE → FORM → EDGE → MATERIAL → DETAIL
```

This hierarchy applies whether the subject is an apple, building, machine, landscape, animal, figure, prop, or invented form. It is not a portrait recipe.

- **Shape** — composition, silhouette, negative space and large masses.
- **Value** — the major light/shadow families and value-group design.
- **Form** — plane turns and transitions that make flat masses read as volume.
- **Edge** — deliberate hard/firm/soft/lost edge hierarchy.
- **Material** — surface response to light: roughness, gloss, reflection, translucency, texture and highlight behavior.
- **Detail** — selected small information and accents after the larger painting problems are solved.

A stage is not considered solved merely because pixels exist. The image should visually read at that level before advancing. If a later checkpoint exposes an earlier-stage failure, return to the earlier stage and correct it.

### Brush-scale discipline

Brush size is relational, not a fixed habit. Use a brush appropriate to the size of the form being described:

- broad brushes for initial masses and coverage;
- medium brushes for planes, value transitions and form modeling;
- smaller brushes for selected edges, texture and focal detail.

Large opaque primitive-like strokes are normal during block-in. They should not remain the dominant descriptive language throughout the whole painting unless the requested style explicitly calls for flat/vector/cel-like construction. After the large masses are established, reduce brush scale and increase control.

### Painterly transitions and blending

Blending does not mean indiscriminate blur. Prefer:

- overlapping lower-opacity/lower-flow strokes;
- intermediate values and temperatures;
- strokes following the turning form;
- scumbling, hatching or textured brushes where appropriate;
- selective Smudge only when it improves a specific transition.

Preserve useful edge structure. A convincing transition may contain both a soft gradient and a crisp accent; globally smoothing everything usually weakens form and material.

### Anti-vector check

Unless a flat graphic style is requested, watch for these failure modes:

- final forms still built mostly from oversized opaque blobs;
- every contour equally hard and equally dark;
- identical-width curves used as a substitute for observed edges;
- color regions separated like cut paper with little value transition;
- no directional brushwork or surface texture;
- highlights/shadows added as symbols rather than consequences of form and material.

Correct them by returning to value/form/edge/material stages rather than merely adding more detail.

## Semantic passes

Prefer passes with clear visual purpose, following the hierarchy above:

1. **Shape / block-in** — silhouette, negative space and large masses.
2. **Value** — broad light/shadow families and value-group organization.
3. **Form** — plane changes, halftones, shadow structure and volume cues.
4. **Edge** — hard/firm/soft/lost edge decisions.
5. **Material / color** — surface response, palette refinement, temperature, reflection and texture.
6. **Detail / accents** — selected focal marks and small information.
7. **Cleanup** — repainting/erasing accidental crossings, primitive artifacts, muddy transitions and inconsistent edges.

Not every style exposes each pass separately, but the visual logic still applies. Complex work should not be executed as one blind batch, and detail should not be used to compensate for unsolved shape/value/form problems.

## Reference color sampling

For reference-driven painting, prefer measured palette pickup over guessing RGB values.
Use `photoshop_sample_color` on the pinned reference document:

- `radius=0` for a precise local pixel;
- a small `radius` for skin, hair, fabric, shadow, or other noisy/textured areas where a representative local average is more useful than one pixel.

The sampler reads the visible composite through a temporary merged duplicate and does not
leave Color Sampler markers in the reference. Keep the reference `document_id` pinned so
another open PSD cannot silently become the sampling source. Use sampled colors as evidence,
not as a requirement to copy every local pixel literally; preserve the painting's intended
value/color hierarchy.

## Occlusion and protected regions

Before a stroke is added, ask what existing form should appear in front of it.

Protected regions should normally be **inferred dynamically from the current preview**, not hard-coded in advance for a specific subject. The agent may begin with a rough semantic depth hypothesis, but actual protected geometry should be updated after block-in/construction checkpoints from what is visibly present in the rendered image.

Do not pre-program subject-specific coordinates such as “wheel circles”, “eye boxes”, or “hand polygons” merely to make a benchmark pass. That turns visual control into hidden task-specific scripting rather than a general painting skill. Predefined regions are appropriate only when the user explicitly supplies masks, selections, coordinates, or other geometry.

Do not run a stroke through a foreground form unless the overlap is intentional. When a path crosses protected geometry, prefer one of these solutions:

- split the stroke into visible segments;
- place it on a lower layer;
- mask it;
- paint then erase the hidden segment;
- redesign the stroke.

Examples of protected regions can include the main silhouette, face/eyes, hands, foreground props or any already-resolved focal feature.

## Long strokes

Long strokes are not forbidden. They are allowed when their complete path is visually verified to be clear.

If a long path crosses complex geometry, split it into shorter intentional strokes. The goal is not a particular stroke count; the goal is controlled visual relationships.

## Visual checkpoints

Use a preview after every major semantic pass. A useful cycle is:

```text
shape/block-in → preview
value → preview
form → preview
edge + material/color → preview
detail/accents → preview
cleanup → final preview
```

At each checkpoint classify problems as:

- **must-fix** — structural/readability/occlusion error that should be corrected before continuing;
- **should-fix** — noticeable quality issue that matters at the requested finish level;
- **optional refinement** — improvement that is not required for completion.

Do not add more detail while a must-fix problem remains underneath it.

### Measurement checkpoints for proportion-sensitive work

For portraits, architecture, perspective-heavy scenes, repeated motifs, or
other work where proportion drift matters, a checkpoint may include explicit
geometry measurement before structural repainting.

Preferred loop:

```text
preview/reference inspection
→ choose semantic landmarks
→ optional photoshop_add_guides
→ photoshop_measure_points
→ for cross-document reuse: photoshop_transform_landmarks
→ compare current/reference sets with photoshop_compare_landmarks when useful
→ structural correction
→ preview again
```

The measurement tools do not detect semantic landmarks. The agent must choose
the points from the visible reference/current preview (or use points supplied by
the user). Do not present visually estimated landmark coordinates as if they
were automatically detected by Photoshop.

For reusable landmark sets, define a semantic frame as axis-aligned bounds
`{left, top, right, bottom}` around the region whose internal proportions matter
(for example a face bounds box, product silhouette box, window opening, or card
frame). `photoshop_transform_landmarks` converts each point to local `u/v`
coordinates in the source frame and reconstructs it in the target frame.
`photoshop_compare_landmarks` compares same-named points in their respective
frames and reports normalized per-point error plus mean/RMSE/max error. This
keeps the workflow general: the tools know geometry and names, not anatomy.

## Execution pacing and user-visible progress

Painting should proceed as a sequence of **short, observable semantic passes**, not as a long background chain of Photoshop mutations.

Use this execution contract for every non-trivial painting session:

```text
short semantic pass
→ wait for the MCP/terminal call to finish completely
→ obtain a preview
→ tell the user what changed and what the preview shows
→ only then start the next pass
```

Important rules:

- Do **not** start another Photoshop mutation while the previous MCP/terminal call is still running. A returned session/process id is not completion; wait for the final terminal result/exit.
- Do **not** queue several semantic passes into one long background command merely to save chat turns. Long hidden chains make interruption and recovery ambiguous.
- If Photoshop may appear visually unchanged while an ExtendScript/MCP call is still executing, explicitly tell the user that the pass is still running and what operation is in progress.
- Before starting a semantic pass, briefly state what will be changed. After it completes, report that it completed before moving to preview/inspection.
- After each preview, summarize the visible result and classify the next issue as must-fix, should-fix, or optional refinement before issuing more paint commands.
- During a long-running operation, keep the user informed in chat instead of remaining silent long enough that the session may look stalled. Prefer concise status updates over speculative claims that Photoshop is frozen.
- If the chat/UI reloads, reconnects, or reports an interrupted response, treat the state as uncertain until the outstanding terminal/MCP job is checked. Do not assume that a previously launched Photoshop operation stopped merely because the chat response was interrupted.
- If the user says to stop or wait, do not launch any new Photoshop mutation. First determine whether an already-started call is still running and report its status.

This pacing rule is part of visual control, not merely UX. It keeps the image state, the agent's reasoning state, and the user's understanding synchronized at every checkpoint.

## Fresh-composition rule for skill evaluation

When the purpose of a drawing is to evaluate the painting skill itself, start from a genuinely fresh composition unless the user explicitly asks for a variation of an existing image.

For a fresh-composition evaluation, do **not** reuse:

- coordinate sets from an earlier artistic demo;
- previous stroke lists or Bezier paths;
- object proportions copied from an earlier demo script;
- precomputed object-specific occlusion geometry;
- a prior composition with only cosmetic changes.

Reusing low-level helpers such as `line()`, `curve()`, `dab()`, batching utilities, brush presets, palette helpers, or generic layer setup is allowed. The restriction is about reusing the **composition and scene geometry**, not about reusing infrastructure.

If the user asks to refine, continue, clean up, or create a deliberate variation of an existing painting, reuse is expected and this rule does not apply.

This rule exists so a successful evaluation demonstrates that the agent can plan and inspect a new image rather than merely replay known geometry with better cleanup.

## Cleanup checklist

During the dedicated cleanup pass, explicitly search for:

- accidental line/object intersections;
- awkward tangencies;
- duplicated contours;
- floating or meaningless line endings;
- broken silhouettes;
- inconsistent line weight or edge hierarchy;
- detail that obscures rather than clarifies the focal form;
- obvious value/color marks that flatten the intended depth.

Use Eraser strokes, repainting, opacity changes or replacement strokes as needed. Painting is iterative editing, not append-only drawing.

## Completion criterion: Definition of Done

Do **not** define completion by a fixed number of strokes unless the user explicitly requests a hard cap.

The painting is done when all required gates pass:

1. The subject reads clearly at the intended viewing scale.
2. Major forms, proportions and silhouette are coherent for the requested finish level.
3. Depth and occlusion relationships are intentional; no obvious accidental cross-object stroke remains.
4. Focal features are resolved enough for the requested style and finish level.
5. Value/color hierarchy and line/edge hierarchy support readability.
6. A cleanup pass has been completed.
7. Final inspection reveals no **must-fix** structural, overlap, tangent or readability defect.
8. Additional strokes would be optional refinement rather than necessary correction.
9. All explicit user constraints are satisfied.

This creates a state-based stop condition:

```text
unfinished = at least one required quality gate fails
finished   = all required quality gates pass and only optional refinement remains
```

## Stroke budgets

A requested number of strokes is normally a **soft budget**, useful for:

- estimating scope;
- choosing batch sizes;
- preventing uncontrolled overworking;
- making a technical demo reproducible.

It is not automatically the finish line.

If the soft budget is reached but a must-fix issue remains, perform the corrective pass. If the Definition of Done is already satisfied before the budget is exhausted, stop.

Only treat a stroke count as a **hard cap** when the user explicitly says that the count itself is a constraint, for example: "use no more than 40 strokes".

## Finish levels

### Sketch

Completion emphasizes silhouette, proportion, gesture and the main value/color statement. Nonessential micro-detail may remain unresolved.

### Study

Resolve major forms, depth, focal details, values/colors and obvious cleanup problems, without chasing polish that does not materially improve readability.

### Polished

Require resolved focal details, deliberate edge/line hierarchy, accents and a thorough cleanup pass.

## Using the MCP prompt

Call `prompts/get` for `ps.digital_painting_control` with arguments such as:

```text
subject: cat portrait
style: anime cel-shaded
finish_level: study
constraints: white background; three layers maximum
stroke_budget: 80
budget_mode: soft
```

The returned guide should be treated as the execution contract for that painting session.

## Current implementation note

`photoshop_paint_strokes` now defaults to cost-aware `AUTO` batching. Large heterogeneous passes are proactively split into multiple short Photoshop scripts instead of relying on the agent to manually keep batches near the old 6–8-stroke limit. The tool reports `batch_count`, `history_steps`, and `auto_chunked`; when AUTO creates multiple batches, each batch is a separate Photoshop history step. Use `SINGLE_HISTORY` only when preserving one undo step is worth the higher timeout risk.

For directional tapering, a stroke may use `dynamics` ranges for size, opacity, and flow. These profiles are rendered as multiple short path strokes, so they are an approximation rather than true continuous pen-pressure data. Strong tapers with hard brushes may retain slight segment texture; prefer the automatic segment count or increase `steps` when visual smoothness matters.

AUTO batching improves transport reliability but does **not** change the semantic-pacing rule: still paint one meaningful pass, wait for completion, preview it, report what changed, and only then start the next pass.
