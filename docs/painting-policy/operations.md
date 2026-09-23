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

#### User communication and durable bookkeeping are separate

User-visible commentary is communication about meaningful artistic progress, not
the controller journal. Give a concise ordinary assistant update around a
meaningful visual pass or practical blocker at the configured commentary level.
Do not force a separate three-field report after brush lookup, layer preparation,
polling, state reads or other administrative substeps.

The controller still owns a durable `photoshop.guard.operation_receipt.v1`,
idempotency/recovery state and technical execution record. On the compact cycle
the model does **not** echo the receipt token and does not author synthetic
`did/why/result` fields. When `previous_observation` closes the prior pass, Guard
uses the exact stored receipt internally and derives the technical record from
what actually executed.

Host/user delivery evidence remains a different event. A host-delivery receipt
such as a COS message id/text hash may be attached only when the host actually
provides that evidence. Never infer UI delivery from dispatch, the durable
execution receipt, generated commentary text, or a tool card.

During long Photoshop work, the compatibility `cycle-auto` and native
`photoshop_guard_cycle_auto` paths may return a durable `job_id`. Poll the same
job; a job id is not completion. Semantic host progress is transient and does not
replace the final preview inspection or the model's actual artistic observation.

If the native async poll result is lost after completion, recover rather than replay:
`photoshop_guard_status` / `photoshop_guard_resume` return the exact pending receipt
token and, when applicable, the pending preview SHA/path from durable state. Close the
original report/ack/verdict obligations with that exact evidence; recovery does not
mint a replacement receipt or authorize a second mutation.

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
- During genuinely long Photoshop work, use the durable async job + poll path and semantic host progress; it does not replace final preview inspection or artistic observation.
- If the user says stop/wait, launch no new mutation; first determine whether an already-started call is still running.
- Full action contracts stay in planner/state; chat updates are execution telemetry, not essays.
- When the user explicitly requests stricter capture such as one-stroke→one-preview, obey it even if slower.

During skill development/testing, **high-frequency process capture is ON by default** unless disabled by the user:

- save monotonic JPEGs after every visual mutation or deliberately tiny atomic
  bundle under the bound project's `frames/`; every frame gets a same-stem `.txt`
  commentary sidecar, and the final PSD/image versions go under `final/`;
- do not duplicate frames after read-only calls;
- **MUST split** any visually large, multi-region, multi-role or multi-stage change into separately completed, captured and inspected mutations/bundles;
- measure evaluation progress by resolved visual problems, result quality and execution/time budget rather than a target frame count; process capture remains mandatory at the mutation/bundle cadence even when a good solution needs far fewer frames;
- reasoning-preview cadence and process-capture cadence are separate.

Batching, style grouping, transport quantization or other execution optimization may reduce calls **only inside one already-approved atomic visual bundle**. They must never combine independent semantic passes, cross a stage/scale decision, or postpone a required preview/inspection barrier.

`photoshop_execute_visual_microplan` is the preferred transport optimization when several preparation/read/configuration calls and **1–4 tightly related visual operations** belong to one approved semantic correction. The internal contract keeps one authoritative root `intent`, one semantic `region`/optional bounds, one compatible `method_class`, one declared `risk`, one `expected_visual_delta`, and one `verification_envelope`. Optional BEFORE preview and mandatory AFTER preview bracket the whole transaction; there is no preview tax between its internal operations. Step-level `description` is explanatory prose. Legacy step-level `intent` is normalized to description rather than compared by literal text; structural region/method/risk mismatches and hidden higher risk still fail closed. `subtle_local` requires matching BEFORE/AFTER focus evidence at >=800 px. The Guard and server use **one shared durable per-document visual barrier** for the whole transaction: it closes before the first mutation and releases only after the final preview is classified. A mutation error stops the remaining bundle, is never blindly retried, and still forces the reconciliation preview. Independent regions/goals/high-risk changes remain separate micro-plans.

Within the mutation subset executable by VisualMicroPlan, `method_class` is also fail-closed against the actual mechanism: `line` requires all Pencil strokes, `smudge` all Smudge strokes, `erase` all Eraser strokes, `region` requires `photoshop_paint_regions`, ordinary Brush/dabs use `paint`, `fill` uses `photoshop_fill_layer`, and `rollback` uses Undo. The compiled plan still contains a concrete `photoshop_select_brush_preset` preparation step when a preset is used, but on compact `next_pass` Guard may derive and insert that step from the durable brush-role map rather than making the model repeat the preset name. Mixed stroke mechanisms do not qualify as one method transaction.

At the host/Guard boundary, use `photoshop_guard_cycle_auto` on the native route rather
than separate raw mutation/report/preview/verdict invocations. The canonical model contract is
`next_pass={request_key,document_id,goal,region/protection,actions}`. The compiler
expands that request into the same internal VisualMicroPlan/Guard contract and
derives technical metadata from the real actions. After the returned frame is
inspected, one following cycle supplies `previous_operation_id +
previous_observation` and, when continuing, the next `next_pass`. Guard derives
the technical report and exact durable receipt acknowledgement internally. For
final closure omit `next_pass`; no dummy mutation is needed. Removed full-operation
and explicit closure payloads are rejected rather than adapted; they are not a public
fallback or recovery path. Verified host-delivery evidence remains
separate from the durable Guard receipt.

The preferred `previous_observation` model payload is only the factual visible
`observed` text plus `target=resolved|unresolved|uncertain`. Optional `regression`
and `action` cover exceptional correction/rollback cases. Guard expands those
facts into the internal durable verdict envelope; the model does not repeat
derived fields such as global-readability defaults, primitive-footprint defaults,
technical report text or receipt identity.

For `small`/`micro`/`detail`/`local` work, that before-preview is no longer optional: the local-inspection gate requires it with the same focus crop as the final preview. Use `significance_mode=subtle_local` only when the desired effect is intentionally fine-grained and should be judged at that local scale.

#### Workflow-stall gate

Protocol activity cannot substitute for visual progress. The controller tracks external Photoshop actions after significance tracking begins. A visual workflow enters `workflow_stall` when either:

- at least 8 external actions have occurred since the last `meaningful` visual change; or
- 2 visually `insufficient` passes occur consecutively.

Recovery reads and required checkpoints remain allowed, but another visual mutation must make a structural executable strategy change: method, scale, region, brush role or mutation structure must differ from the ineffective strategy. Legacy `replan` prose is compatibility metadata only and does not unlock the gate. The purpose is not to punish careful inspection; it is to stop endless `state → preview → report → verdict → checkpoint` loops that fail to resolve a visual problem.

`decision_loop_stall` is separate from `workflow_stall`. In an active visual
workflow, when roughly 90 seconds have elapsed since the last classified visual
pass and there is no active async job, report/ack obligation, uncertainty/recovery,
pending preview/verdict barrier, workflow-stall strategy-change gate, or checkpoint barrier, the
controller reports a cadence stall. It does **not** block the next visual mutation.
Its `next_required_action` is prescriptive: dispatch the next meaningful visual
pass, or enter the single explicit diagnostic exception above.

`silent_stall` covers the complementary failure mode: the continuation state is
already known, but the agent simply stops advancing it. It is raised after roughly
90 seconds without semantic advancement while an active visual run still has a
non-`ready` `next_required_action` and no durable async job is actually running.
Unlike `decision_loop_stall`, pending report/ack/verdict/reconcile/strategy-change/checkpoint
requirements do **not** suppress `silent_stall`; they identify its phase, for example
`awaiting_report`, `awaiting_visual_verdict` or `awaiting_checkpoint`. Starting or
completing a meaningful/preparation mutation, recording its required report/ack/
verdict, successful reconcile, required checkpoint, or attached live-barrier preview
counts as advancement. Routine read-only status/state/schema/extra-preview churn does
not reset the clock. `status`, `status-compact` and `resume` expose the durable watch
state and its exact prescribed next action. Detection is retrospective/on-interaction:
the Guard cannot independently push a ChatGPT message while the host makes no call.

When one of those frames is also an accepted checkpoint/stage transition/recovery anchor, save its paired PSD beside it before launching the next painting mutation.
If the controller itself reports checkpoint-due, save and verify the pinned layered
PSD, then immediately continue the next planned visual cycle. Do not restart a
whole-image analysis merely because the checkpoint was written.
Checkpoint-due is accumulated from mutation risk/exposure rather than a fixed
number of visual passes or wall-clock age. Age remains diagnostic telemetry only.

### Fresh-composition evaluation invariant

When evaluating the skill on a fresh composition, do not reuse scene-specific geometry or execution plans from earlier artwork (coordinates, paths, stroke lists, proportions, precomputed occlusion regions or the same composition with cosmetic changes). Reuse only generic infrastructure such as batching helpers, brush presets, palette utilities and generic layer setup unless the user explicitly requests continuation/refinement/variation.

### Operational failure / reconnect

Visual regression and uncertain tool execution are different failure classes.
First use the runtime outcome and prescribed next action. An aggregated preflight
`execution=not-executed` rejection requires correcting the errors, not fresh
preview/state or reconciliation debt. A completed result lost in transit is
recovered with its original receipt and obligations, never by repainting.
For uncertain create/open bootstrap, reconcile the original operation id against
its durable UXP receipt: absent/corrupt/claimed does not authorize replay and an
empty document list is not proof of non-execution. Legacy abandonment requires
the runtime's explicit evidence conditions, including the original process being
proven dead. The following evidence sequence applies to uncertain document-bound
mutations when the runtime requires that evidence, not to every rejected request:

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
9. for representational/high-detail targets, temporary block-in geometry is no longer
   masquerading as finished form and material; texture/detail has not substituted for
   unresolved major/secondary form debt;
10. explicit user constraints are satisfied.

Before declaring the final Art Director directive complete, compare the current accepted state with the strongest earlier accepted state when one exists. Judge at least **coherence, expressiveness, color relationships, rhythm, and detail selectivity**. More finished is not automatically better. If the earlier state is stronger overall, restore/reconcile it or deliberately recover its stronger qualities before completion.

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

Treat the returned guide as the executable session contract. Start with
[the working kernel](../digital-painting-agent-skill.md); these modules retain the
canonical detailed policy and rationale for the relevant condition.
