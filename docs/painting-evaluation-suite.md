# Digital Painting Evaluation Suite

This suite compares controller, prompt and tool revisions without training model weights.
It measures whether generic workflow changes transfer across different visual problems.

## Invariants

- Compare revisions with the same brief, canvas size, finish target and execution budget.
- Do not reuse scene-specific coordinates, stroke lists, masks, landmarks or geometry from an earlier run.
- Reuse only generic capability knowledge such as a brush-role characterization at a comparable scale.
- Keep the hard preview barrier, durable operation journal and checkpoint rules enabled.
- Do not optimize for a frame count. A shorter run is better only when it reaches the same or better accepted visual state.

## Core exercises

### 1. Sphere — value and transition control

Goal: render one simple sphere with readable light/shadow families, turning form and contact/cast-shadow relation.

Success evidence:

- clean silhouette;
- light/shadow grouping reads at thumbnail scale;
- continuous turning form without airbrush haze or stamp scallops;
- highlight/reflected-light accents do not flatten the hierarchy.

### 2. Cube / simple building — planes, perspective and edges

Goal: render a box-like object or small building with three readable planes and intentional edge hierarchy.

Success evidence:

- plane values separate coherently;
- major axes/perspective are internally consistent for the chosen view;
- directional strokes or patches support the planes rather than reading as ribbons/grids;
- local detail does not compensate for a broken silhouette or plane relationship.

### 3. Small still life — overlap and negative space

Goal: arrange 2–4 simple objects with at least one overlap and one meaningful negative-space shape.

Success evidence:

- front/back ordering is unambiguous;
- protected silhouettes survive local corrections;
- negative spaces remain intentional;
- no patch seam/correction footprint becomes a new equal-or-worse defect.

### 4. Small portrait study — proportion and selective detail

Goal: produce a compact head study with stable major proportions, value grouping and selective feature detail.

Success evidence:

- head/feature landmarks are coherent before micro-detail;
- face volume is not built from visible blob/tube primitives;
- focal features are selective rather than uniformly sharpened;
- local correction is judged both zoomed-in and at normal/thumbnail scale.

## Holdout transfer task

After tuning on the four exercises, run at least one new composition whose subject and geometry were not used during pipeline design. Do not choose a cosmetic variation of an earlier task. The holdout detects benchmark-specific rules and memorized execution plans.

The ordered development and validation plan lives in
[`PAINTING-ROADMAP.md`](PAINTING-ROADMAP.md). Use its current acceptance criteria to
choose a holdout or live validation; do not rerun completed architecture work from
old chat context.

## Fixed budget

Record the same budget for baseline and candidate revisions. Depending on the experiment, use one or more of:

- wall-clock execution time;
- external MCP actions;
- visual atomic bundles;
- total internal Photoshop batches/history steps;
- maximum correction/rollback attempts for one `problem_id`.

The budget is a comparison constraint, not a completion rule. A run that reaches the limit with unresolved must-fix structure is recorded as incomplete rather than force-finished.

## Required metrics

For each run record:

- time from request to first visible canvas change;
- time and visual-bundle count to the first preview where the **subject is recognizable without giving the evaluator the subject name**;
- when style is requested, time and bundle count to the first preview where both subject and requested style direction are recognizable;
- wall-clock split into Photoshop/tool execution, explicit waiting/job time when measurable, and between-call/model-review gaps; do not infer an unavailable split from aggregate timestamps;
- recognition-feature destruction count: later passes that erase/obscure an already-established recognition cue without intentionally replacing it with a stronger equivalent;
- accepted final frame + layered PSD checkpoint;
- total visual bundles;
- `improvement / neutral / regression` counts;
- `accept / correct / rollback` counts;
- problem-scoped replans;
- total internal dab/stroke batches and measured execution duration when available;
- timeouts/uncertain operations and recovery count;
- primitive-footprint or correction-seam failures;
- whether Definition of Done was reached within budget.

Keep visual quality evidence separate from execution efficiency. Fewer calls/batches do not make an image better; they only make an equally good accepted result cheaper or more reliable.

### World-consistency shadow evaluation

Task 6's World Consistency Critic is evaluated as an advisory shadow pass over structured visual
observations. The first evaluator step records only observable relations using the shared vocabulary:
support, contact, attachment, containment, connectivity, articulation, count/topology, gravity,
occlusion, depth/order, scale and intersection. The second step may flag a possible conflict only
after considering the user prompt and style intent, and records the ordinary-world expectation,
an alternative explanation, and certainty/uncertainty.

Use the same relation vocabulary for people, props, architecture and arbitrary objects. Do not add
category-specific detectors or mandatory depth/pose/segmentation preprocessing for this evaluation.
Explicit surreal, anti-gravity or impossible-architecture intent is a negative-control case: the
critic must not convert the intended departure into a realism correction.

For the initial local harness, compare the current no-dedicated-critic baseline with the shadow pass
using labelled relation fixtures. Record added true detections, false positives, explicit-surreal
false positives, and ambiguous cases that remain uncertain. This metric demonstrates incremental
detection only; the critic has no blocking authority and does not itself decide whether an edit is
accepted, corrected or rolled back.

For recognition measurements, prefer a blinded evaluator that receives the preview without the target noun in its prompt. Record the evaluator setup and confidence/answer rather than silently treating the producing agent's own intent as proof of recognizability. Final quality remains a separate evaluation after the first-recognition milestone.

## Task 23 — progressive-refinement human evaluation pack

Task 23's machine contract can prove that the Guard persists and enforces declared
refinement evidence; it cannot prove that an artwork is in fact more modelled. The
perceptual acceptance pack therefore uses five controlled cases and a blinded human
judgement. Do not substitute Painter/Critic self-verdicts, pixel delta, stroke count,
layer count or tool success for these labels.

Required cases:

| Case | BEFORE → AFTER construction | Expected gate behaviour |
| --- | --- | --- |
| positive-modelled-form | broad coherent block-in → genuinely modelled major/secondary form, edge hierarchy and material/light response | eligible to pass |
| negative-texture-only | same broad flat form → grain/noise/small marks with no meaningful lower-frequency form change | reject |
| negative-residual-geometry | readable composition → detail added while conspicuous temporary block-in primitives still dominate | reject |
| negative-overdetail | more small marks → weaker structural/form readability | reject / preserve stronger earlier state |
| stylized-flat-control | intentionally flat/graphic treatment declared in the style contract | do not force toward realism |

For each case save an exact BEFORE frame, exact AFTER frame, and the original visual
target/style contract. Give the human evaluator those three items plus only these
predeclared questions:

1. major form more modelled? YES / NO / UNCERTAIN
2. secondary forms more informative? YES / NO / UNCERTAIN
3. edge hierarchy improved? YES / NO / UNCERTAIN / N-A
4. material/light response more specific? YES / NO / UNCERTAIN / N-A
5. residual block-in reduced? YES / NO / UNCERTAIN
6. extra detail structurally useful rather than noise? YES / NO / UNCERTAIN
7. important structure preserved? YES / NO / UNCERTAIN
8. requested realism/detail target materially closer? YES / NO / UNCERTAIN

Blind the evaluator to tool logs, operation/layer/stroke counts, Painter/Critic verdicts,
the intended expected answer, and any statement that the candidate was designed to improve
realism. A Task 23 perceptual acceptance claim requires the positive case to pass, the
three negative controls to be rejected, and the stylized control not to be incorrectly
forced toward realism. Until those human labels exist, record Task 23 as
`machine-complete / live-pass / human-gate-pending`. The canonical disposable Photoshop live run
already proves the machine stage gate itself: DETAIL was blocked before dispatch on the flat
BLOCK-IN frame, then admitted and executed only after exact-current-frame Value PASS + Refinement
PASS. That producer-run evidence must not be substituted for the blinded perceptual labels defined
above.

The controller exposes the corresponding journal-derived fields under per-document
`recognition_metrics` in `status` / `status-compact`, including
`seconds_to_first_detected_visual_change`, `seconds_to_subject_recognizable`,
`seconds_to_subject_and_style_recognizable`, `between_operation_gap_ms`,
`reported_tool_execution_ms`, and recognition-feature destruction counts. These are
controller-observable timings, not a claim that every millisecond can be uniquely
attributed to model reasoning, preview inspection, host transport or Photoshop.

## Learning that may transfer

Persist generic observations such as:

- a preset/settings/scale signature produces periodic scallops;
- a brush is reliable for broad planar strokes but poor for silhouette repair;
- a batch size repeatedly approaches timeout on this Photoshop/runtime setup;
- a critic view at a particular local scale exposes seams missed in the overview.

Do not persist scene-specific facts such as coordinates of a successful tower edge, portrait feature or object silhouette as reusable painting knowledge.
