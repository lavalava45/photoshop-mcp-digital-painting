# Digital Painting Visual Control Skill

This is the working entry point for Photoshop painting. The MCP prompt
`ps.digital_painting_control` supplies the session guide. Keep this kernel active;
consult the linked detailed section only when its condition applies. Do not read
all policy modules or source files as routine preparation for every pass.
The modules preserve the detailed policy; their applicable rules are mandatory.

## Execute the next valid action

1. Keep the established Photoshop/COS/MCP route across ordinary continuations.
   Use Plugins → `dist/cos-plugin.js` → embedded Guard. Discover/check the actual
   surface before claiming it unavailable. Do not substitute image generation.
2. Read state before the first mutation or after genuine uncertainty. Pin the
   working document; never silently drop an invalid id or switch another tab.
   With no document, use guarded create/open and take the returned
   `confirmed_targets.document_id`. An uncertain bootstrap is recovered by its
   original operation id, never by creating again.
3. Bind one immutable `processes/<subject>-process/<run>/` through
   `photoshop_guard_set_art_run`; keep frames, same-stem commentary sidecars,
   checkpoints, final exports and painting-state there.
4. For non-trivial painting, complete bounded brush preflight and persist its role
   map on the same art run. Do not select `simple_graphic` to bypass painting rules.
   Establish the brief/style, recognition cues and required Art Director directive.
5. Construct one semantic pass through the compact `next_pass` contract. Supply
   one stable `request_key`, pinned `document_id`, one root `goal`, the affected
   region/protected ids when needed, and an ordered `actions` array. Step
   `description` is explanatory prose, not a second intent. Do not repeat
   summary/purpose/problem_id/plan_id/method/risk/report/receipt metadata.
6. Execute through `photoshop_guard_cycle_auto`. The compiler expands
   `next_pass`, derives technical bindings and runs preflight/runtime. The removed
   full operation payload is not part of the public model contract.

## When the user delegates the subject

Before art-run, compare 4–6 candidates across four families; at most one scenic vista. Never browse
old runs. Reject repeats and atmosphere-only premises; commit to subject + setting + action + spatial
problem. Ease never decides. Not a Guard gate. [Details](painting-policy/foundations.md#open-brief-subject-selection).

## One normal cycle

- Choose one problem, region or tightly coupled region set, stage/scale, action
  class and acceptance question. Keep one stable problem id across attempts.
- Record a brief prediction: expected visible change, what must survive, and
  failure signals. Select an available method for that effect; never invent APIs.
- In artistic or mixed mode, emit the compact root `goal` as the visible
  pre-operation artistic sentence. The compiler reuses that same goal internally
  as `artistic_commentary`; do not duplicate it in the request.
- Execute one bounded pass. A VisualMicroPlan allows 1–4 compatible contiguous
  visual operations, with preparation first and mandatory AFTER preview.
  Do not split a valid batch into a separate host call for each stroke; do not
  combine independent problems to avoid inspection.
- If returned a durable job id, poll that job. A job id is not completion.
- Inspect the returned image. A path/hash alone is not visual inspection: if the
  image has not actually been exposed to vision, open the materialized image once.
  Do not recapture the unchanged canvas merely because the image is a file.
- Classify observed change, target resolution, regressions and uncertainty before
  assigning improvement/neutral/regression and accept/correct/rollback.
  Inspect the whole scene for collateral defects, not just the intended target.
- Give the user the useful artistic/technical observation for the pass; do not
  manufacture a three-field technical report or copy a receipt token. The Guard
  records technical execution from the actual result. No extra
  source/schema/state/status reads between healthy pinned passes.

### Close and continue in one call

After inspection, the next `photoshop_guard_cycle_auto` carries
`previous_operation_id`, one compact `previous_observation`, and the next
`next_pass`. Guard derives the technical report from durable execution and
acknowledges the exact stored operation receipt internally. The observation is the
model's actual visual classification; Guard must not fabricate it.

Use `{"observed":"…","target":"resolved|unresolved|uncertain"}`. `target` judges
the operation goal, not the whole `planner_task_id`; a resolved pass may leave the
Planner task active.

Complete/block the Planner task only after task-level assessment. Then add
`"planner_task_assessment":{"status":"completed|blocked|continue","evidence_scope":"task","evidence":["task-level visible evidence"]}`.
Otherwise omit it; omission keeps the task active.

Add `regression` only when visible and `action=rollback|correct|accept` only to
override the derived disposition. Do not use expanded legacy verdict fields.

For the LAST pass, send `previous_operation_id + previous_observation` and omit
`next_pass`. This is compact finalization: no dummy mutation, copied receipt, or
separate report → ack → verdict chain.

Do not insert standalone report/ack/verdict, status, state, or schema calls between
healthy compact passes. Public standalone closure providers have been retired; closure
remains behind the compact facade.

Minimal shape: `next_pass={request_key,document_id,goal,region,stage,scale,actions}`.

A required art-run bind, brush preflight, checkpoint or recovery step may still
intervene. Do not fuse calls illegally or bypass obligations for lower latency.
For brush paint, the compact compiler can select a durable preflighted brush role by
working scale and insert the preset-selection preparation itself; use optional
`next_pass.brush_role` only when artistic intent requires a different known role.

## Commentary and user control

Default: mixed + normal. Sticky switches: режим техника / режим художник /
режим вместе; коротко / обычно / подробно affect length only; one-step overrides expire.
Commentary is for the user, not Guard bookkeeping. Comment on meaningful artistic
passes, not brush lookup, preparation or polling. Host delivery evidence stays
separate from the durable execution receipt.

Artist voice uses natural Russian and concise practical rationale, not hidden
reasoning or infrastructure jargon. Keep commentary length at the chosen level.
Do not claim no canvas change when execution is actually uncertain.
Keep Photoshop in the background. Never steal focus, switch tabs or activate a
scratch document without the required explicit authorization. Stop means no new
mutation; determine whether the already-started action is still running.

## Artistic decisions that must survive compression

- Recognition first: derive 3–7 discriminative cues plus a large style cue if
  applicable; rough in the whole subject and inspect the overview. Small cues can
  carry high identity. Recognition is not completion.
- Then follow COMPOSITION → SHAPE → VALUE → FORM → EDGE → MATERIAL → DETAIL.
  Return to the largest unresolved must-fix; do not decorate unresolved structure.
- Judge brief + structure + style. For non-trivial free composition compare at
  least two cheap composition hypotheses; references may constrain this choice.
- ADD is not default: choose ADD / REFINE / REPLACE / ERASE / ROLLBACK / LEAVE.
  Change a failed causal strategy rather than adding marks over its artifacts.
- Separate independently correctable objects, support and shadows into logical
  layers. Every microplan declares layer separation. One new-layer plan creates
  one hypothesis layer; target stable ids and protect accepted layers.
  `protected_regions` is descriptive; `protected_layer_ids` is enforceable.
  Intentional replacement needs REPLACE/ERASE and exact replacement ids.
- Art Director owns global structure and delegates bounded Painter tasks.
  Painter binds directive/task/scope/change domains, verifies each local pass and
  returns at the review horizon or serious regression; no global replan per stroke.
- Regions are early block-in scaffolding, not the final photorealistic rendering.
  Match mark/edge/material mechanism to form. Correct vector/collage, stamp,
  scallop, ribbon or mechanical-grid artifacts when the style does not license them.
- Check support/contact, cast shadows, occlusion/depth, tangencies and proportions.
  Local improvement does not excuse an equal-or-worse structural regression.
- For local/small/subtle work use matching BEFORE/AFTER focus and >=800px local
  inspection. Check the repair perimeter as well as the repaired defect.
- Edge plans require executable boundary methods and AFTER edge observations.
  Realistic structural gates require inspected grayscale/value evidence;
  DETAIL needs the applicable value gate or an explicit justified exception.
- DETAIL `refinement_check`: form/edge/material change; residual block-in
  resolved; texture-only cannot close debt; style-N/A→style_contract.
- Pixel change is execution evidence, never an artistic score. Unknown/true no-op
  cannot be improvement. Small real valuable changes need not be exaggerated.
  `trend_signals` contains recurring NEGATIVE defects only; use [] when absent.
  Positive observations belong in observed_change, not trend_signals.
- Keep current and accepted frames distinct. Compare the final image with the
  strongest earlier accepted state for coherence, expression, color, rhythm and
  detail selectivity. More finished is not necessarily better.
- Save layered PSDs for accepted milestones/stage transitions/recovery anchors,
  not every JPEG. Required save failure blocks continuation; recover and retry
  only the save. Keep reference pixels separate; no default paste/underlay/tracing.
- Finish at the requested sketch/study/polished level with no must-fix remaining.
  Soft stroke budgets do not define completion; hard user caps remain binding.

## Recovery: select the observed state

| Observed state | Next action |
| --- | --- |
| Aggregated preflight rejection, execution=not-executed | Correct all reported deterministic errors together. No invented preview/ack/verdict/reconcile debt. Report the practical blocker without manufacturing closure fields. |
| Job still running | Poll the SAME job; do not dispatch another mutation. |
| Completed result lost | Recover exact original result/receipt via status/resume; inspect recovered visual evidence and close original obligations. |
| Uncertain create/open | Call reconcile with original id; use durable bootstrap receipt. Absent/corrupt/claimed is not permission to replay. |
| Uncertain document-bound mutation | Follow prescribed same-document evidence/reconcile requirements before retry/correct/rollback. |
| Required checkpoint failed | Recover persistence; retry only the save, then resume the planned pass. |

Document count=0 does not prove non-execution. Legacy abandonment requires the
runtime's explicit evidence/authorization conditions; never invent an outcome.
Read-only churn is not recovery progress. After a proven systemic failure, use
one compact investigation, then a causal next action or an explicit blocker.
Do not interpret an advisory stall as permission to bypass a gate.

## Read details only when applicable

| Condition | Detailed section |
| --- | --- |
| Brief/style, persistent state, commentary, layers or checkpoints need clarification | [Foundations](painting-policy/foundations.md#core-controller) |
| First non-trivial brush preflight, changed preset/role/scale, or required user brushes | [Brush preflight](painting-policy/methods.md#brush-preflight-inventory-and-role-selection) |
| Directive/review, edge methods, grayscale/value, action/scale or mark decisions | [Methods and control](painting-policy/methods.md) |
| Local repair, recovery anchor or execution-change evidence | [Inspection](painting-policy/inspection.md#visual-checkpoints-and-execution-sanity) |
| Reference, portrait, manufactured geometry or optional helpers | [Conditional modules](painting-policy/inspection.md#conditional-modules) |
| Async/reconnect, stall, reporting/focus, capture, completion or evaluation details | [Operations](painting-policy/operations.md) |
| Development reload/transport migration | [Migration inventory](uxp-migration-inventory.md), repository AGENTS.md |
| Audit of moved rules and measured latency | [Preservation map and smoke audit](painting-policy/optimization-audit.md) |

Consult the relevant section before the operation that depends on it; do not
reread unchanged instructions between healthy passes. The live schema defines
accepted fields and the Guard response defines current obligations. If policy
and runtime disagree, report the exact mismatch rather than guessing a bypass.
