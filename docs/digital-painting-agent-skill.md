# Digital Painting Visual Control Skill

This skill defines how an AI painting agent should use the fork's Photoshop brush tools. It is deliberately separate from the low-level painting API: the API answers **how to make a stroke**, while this skill answers **when, where, and whether that stroke should be made**.

The executable MCP guide prompt is:

```text
ps.digital_painting_control
```

Use it for drawings, paintings, sketches, brush-based illustration, line art and similar work where the result depends on relationships between many strokes.

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

## Semantic passes

Prefer passes with clear visual purpose:

1. **Block-in** — silhouette and large masses.
2. **Construction** — major internal forms and depth relationships.
3. **Values / color masses** — broad light, shadow and palette organization.
4. **Line / detail** — contours and focal features.
5. **Accents** — highlights, texture, expressive marks.
6. **Cleanup** — erasing/repainting accidental crossings, tangencies and inconsistent edges.

Not every style needs every pass, but complex work should not be executed as one blind batch.

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
block-in → preview
construction → preview
values/color → preview
line/detail → preview
cleanup → final preview
```

At each checkpoint classify problems as:

- **must-fix** — structural/readability/occlusion error that should be corrected before continuing;
- **should-fix** — noticeable quality issue that matters at the requested finish level;
- **optional refinement** — improvement that is not required for completion.

Do not add more detail while a must-fix problem remains underneath it.

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

Large batches with frequent per-stroke brush/color changes can exceed the current ExtendScript timeout. Until batching is optimized, heterogeneous passes should be chunked into small groups; live tests found roughly 6–8 mixed strokes reliable.
