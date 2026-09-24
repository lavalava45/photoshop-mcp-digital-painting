# Compact-v2 live acceptance plan

Updated 2026-09-23 for the final post-P1/P2/P3 catalog migration acceptance run.

This plan covers roadmap **13c** plus remaining live-only acceptance for **15b, 15d, 16, 17, 19 and 21**. All Photoshop mutations stay on the current public compact Guard route. The catalog backend policy is now **UXP-first with ExtendScript/COM permitted only as a pre-dispatch fallback**; after UXP dispatch/claim/uncertainty/failure, cross-backend replay is forbidden.

## 1. Hard constraints

- Canonical mutation route: `photoshop_guard_cycle_auto` with compact `next_pass`; continuation uses `previous_operation_id + previous_observation + next_pass`; finalization omits `next_pass`.
- Setup may use current public Guard setup/capability surfaces (`photoshop_guard_capabilities`, `photoshop_guard_set_art_run`, and, only in the final-anchor phase, the current Art Director surface). Do not use legacy controller/daemon, standalone report/ack/verdict, full operation payloads, or raw mutation bypass.
- Backend selection must occur before dispatch. For the final acceptance trace, prefer and verify UXP for every ordinary migrated operation. If routing selects ExtendScript/COM before any UXP dispatch, record that as a pre-dispatch fallback event; it is architecturally valid but does not count as UXP-path evidence for that step.
- Once a UXP command has been dispatched, claimed, becomes uncertain, or reports failure, **never** retry/replay that mutation through ExtendScript/COM. Use the existing Guard exact-outcome/reconcile path.
- `photoshop_save_document` and `photoshop_neural_filter` are intentionally UXP-only/fail-closed. Raw `photoshop_execute_script` is retired and must never appear in the run.
- P1/P2/P3 catalog source migration is implemented. The current rebuilt child/current companion load-and-revision preflight has now passed; this document still does **not** treat that as final live acceptance until the representative runtime behavior run is completed.
- Preferred UXP mutations for this acceptance trace:
  - `photoshop_create_document`
  - `photoshop_open_image` if a disposable seed image is used instead of create
  - `photoshop_create_layer`, `photoshop_delete_layer`, `photoshop_duplicate_layer`, `photoshop_rename_layer`
  - `photoshop_fill_layer`
  - `photoshop_paint_regions`, `photoshop_paint_strokes`, `photoshop_paint_dabs`
  - `photoshop_select_brush_preset`, `photoshop_set_brush`, `photoshop_set_foreground_color`
  - `photoshop_select_rectangle`, `photoshop_select_ellipse`, `photoshop_select_subject`, `photoshop_feather_selection`
  - `photoshop_create_layer_mask`, `photoshop_apply_gradient_mask`
  - `photoshop_set_layer_opacity`, `photoshop_set_layer_blend_mode`, `photoshop_set_layer_visibility`, `photoshop_set_layer_locked`
  - `photoshop_move_layer_to_position`, `photoshop_move_layer_to_top`, `photoshop_move_layer_to_bottom`, `photoshop_move_layer_up`, `photoshop_move_layer_down`
  - `photoshop_undo`
- `photoshop_get_preview`, state/layer/document reads used as UXP-path evidence must be confirmed UXP for this run. A pre-dispatch legacy fallback may be operationally valid, but it cannot be counted as proof of the UXP path; prefer the returned Guard preview when route evidence is ambiguous.
- Do not read repository source/schema during the Painter loop. All request shapes must be prepared before starting the timed live trace.

## 2. Disposable run layout

Use one immutable process root for the main acceptance and one for the cache A/B:

```text
processes/compact-v2-live-acceptance-process/run-01/
  evidence/
  frames/
  final/
  live-acceptance-ledger.json
  call-ledger.ndjson
  operator-preflight.json

processes/compact-v2-cache-ab-process/run-01/
  evidence/
  frames/
  cache-ab-ledger.json
  call-ledger.ndjson
```

Do not reuse an old art-run directory. Do not overwrite historical evidence.

Recommended disposable canvas: **800 × 600 px**, RGB, white or neutral background. Use simple flat geometry so technical placement can be measured exactly and artistic judgments remain bounded.

## 3. Operator preflight before any Photoshop mutation

These checks are operator evidence, not Painter orchestration calls, and must be completed once before the live trace.

Current 2026-09-23 cutover evidence:

- pre-cutover child PID: `4808`;
- live child PID: `10772`, started `2026-09-23T07:15:39.5184010Z`;
- repository HEAD: `67c0c00a94e071520532692fdbe95b3b535ddb80`;
- loaded `dist/cos-plugin.js` SHA-256: `9023114D837A4307EBBE81D280226E1A6AD8F02DFAB35E4EC12208C0F8118801`, mtime `2026-09-22T23:20:10.3060645Z`;
- Guard protocol: `photoshop.guard.compact.v2`; runtime state: `photoshop.guard.runtime-state.v2`; mode: `required`; raw mutation bypass blocked;
- live Photoshop route: `connected=true`, `ready=true`, selected transport `uxp`, bridge transport `long-poll`;
- expected bridge revision = actual bridge revision = `compact-v2-20260924-targeting`;
- Guard status at preflight: no pending reports, operation acknowledgements, report-delivery acknowledgements, uncertain operations, visual verdicts, or active jobs.

Therefore the loaded-build/revision portion of preflight is complete. The no-COM/foreground monitored behavioral trace and representative P1/P2/P3 acceptance steps below remain to be executed.

### 3.1 Child PID/build

Record in `operator-preflight.json`:

```json
{
  "pre_cutover_child_pid": null,
  "live_child_pid": 0,
  "child_started_at": "ISO-8601",
  "repository_commit": "git HEAD",
  "dist_entry_sha256": "sha256 of the loaded built entry",
  "dist_entry_mtime": "ISO-8601",
  "runtime_state_version": null,
  "compact_guard_protocol_version": null,
  "expected_uxp_bridge_revision": null,
  "actual_uxp_bridge_revision": null,
  "uxp_revision_match": false
}
```

Acceptance:

1. `live_child_pid` is the newly loaded Photoshop MCP child, not the pre-cutover PID.
2. Commit/build/hash are the intended current build.
3. Call `photoshop_guard_capabilities` once before the timed Painter loop and record:
   - `compact_guard_protocol_version`
   - `expected_uxp_bridge_revision` (current source target: `compact-v2-20260924-targeting`)
   - `runtime_state_version`
   - Guard mode
   - `raw_mutation_bypass_blocked`
4. Record the companion's actual `/health` `bridge_revision` operator-side and require exact equality with the expected revision. This health read is not a Photoshop mutation and is not part of the Painter call budget.
5. If revision is missing/mismatched, stop. Do not let the first painting mutation become the readiness probe.

### 3.2 No-COM baseline

Before the trace, record a process snapshot for obvious legacy helpers (`powershell.exe` children used for Photoshop COM, `cscript.exe`, `wscript.exe`, `osascript` where relevant) and start process-creation logging for the duration of the run.

Primary backend evidence is still **route evidence**, not absence-of-process alone:

- every mutation used as UXP acceptance evidence must show UXP selected before dispatch;
- an ordinary tool may use ExtendScript/COM only if the router selects it before UXP dispatch; record the primitive and reason explicitly;
- after any UXP dispatch/claim/uncertain outcome, no legacy helper/process may appear as a replay of that operation;
- `save_document` and `neural_filter` must fail closed if UXP is unavailable;
- raw `photoshop_execute_script` is prohibited;
- for the final accepted UXP trace, no legacy helper process should appear in the bounded monitored window.

## 4. Common evidence schema

For every guarded operation append one row to `call-ledger.ndjson` with at least:

```json
{
  "sequence": 1,
  "phase": "13c-foundation",
  "request_key": "live13c-foundation-01",
  "document_id": 0,
  "guard_tool": "photoshop_guard_cycle_auto",
  "operation_id": "returned durable operation id",
  "planner_task_id": null,
  "stage": "GLOBAL_BLOCK_IN",
  "scale": "global",
  "actions": ["photoshop_fill_layer"],
  "cycle_started_at": "ISO-8601",
  "cycle_finished_at": "ISO-8601",
  "wall_ms": 0,
  "guard_preflight_ms": null,
  "photoshop_dispatch_ms": null,
  "closure_ms": null,
  "preview_sha256": "returned SHA",
  "preview_path": "returned materialized path",
  "previous_operation_id": null,
  "previous_observation": null,
  "target_result": "resolved|unresolved|uncertain",
  "human_visual_judgment_required": false,
  "human_visual_judgment": null,
  "unexpected_extra_calls_since_previous": [],
  "selected_backend": "uxp",
  "predispatch_fallback": false,
  "cross_backend_replay": false
}
```

Also record, when present in the returned operation/job telemetry:

- exact UXP command/receipt identity;
- bridge revision associated with dispatch;
- request JSON bytes;
- whether preparation cache reported hit/miss/invalidation;
- whether a job poll was required;
- comparison metric state (`available|unavailable`) and why;
- execution outcome, artistic outcome and global brief outcome where exposed.

## 5. Phase A — roadmap 13c bounded compact-only trace

This phase must stay free of general status, Art Director and value-analysis detours.

### A0. Disposable document bootstrap

Submit a guarded compact bootstrap with `photoshop_create_document`, require UXP to be the selected backend for this acceptance step, and capture the returned pinned `document_id`.

Evidence:

- stable operation/request id;
- returned `confirmed_targets.document_id`;
- UXP receipt/command identity if exposed;
- no duplicate create if the response is interrupted;
- if bootstrap response is lost, recover the **same** operation identity; never create again.

Maps to 13c: document pinning, idempotency, exact-outcome recovery.

### A1. Foundation pass

First normal compact pass:

```text
photoshop_guard_cycle_auto(
  next_pass={
    request_key: "live13c-foundation-01",
    document_id: <pinned>,
    goal: "Establish a neutral foundation covering the disposable canvas.",
    region: "whole canvas",
    stage: "GLOBAL_BLOCK_IN",
    scale: "global",
    actions: [fill/create-layer actions with UXP selected for this acceptance step]
  }
)
```

Prefer `photoshop_create_layer` + `photoshop_fill_layer` with UXP selected for the acceptance trace. The returned authoritative AFTER preview is the baseline frame.

Acceptance evidence:

- one primary Guard cycle;
- one durable operation id;
- one final preview SHA/path;
- no status/schema/source read;
- no standalone closure call;
- no COM helper/process.

### A2. Observation + next pass in one compact continuation

Actually inspect A1's returned image, then submit exactly one continuation call:

```text
previous_operation_id = <A1 operation>
previous_observation = {
  observed: "Foundation is visible and covers the intended canvas.",
  target: "resolved"
}
next_pass = {
  request_key: "live13c-blockin-02",
  document_id: <same pinned id>,
  goal: "Add three clearly separated geometric masses in the declared locations.",
  region: "whole canvas",
  stage: "GLOBAL_BLOCK_IN",
  scale: "global",
  actions: [one semantic multi-shape paint_regions bundle with UXP selected]
}
```

Use `photoshop_paint_regions` to create at least three solid shapes with non-overlapping known bounds, for example:

- red rectangle/polygon in upper-left;
- blue rectangle/polygon in upper-right;
- dark base mass across lower third.

Acceptance:

- A1 closure and A2 dispatch occur in this one compact call;
- A2 is actually dispatched, not merely compiled;
- A2 returns one authoritative preview;
- no deterministic schema retry;
- no extra Guard/status/Art Director/value-analysis call between A1 and A2.

Maps directly to the 13c sequence:

```text
foundation → observation+next pass → multi-shape block-in dispatched → preview delivered
```

### A3. Technically completed but artistically unresolved fixture

On the A2 preview, require a human visual classification **[HUMAN VISUAL JUDGMENT REQUIRED]** that one bounded artistic goal remains unresolved while execution clearly succeeded. Example: the three shapes exist exactly where requested, but the composition intentionally lacks a clear focal hierarchy.

Submit the next continuation with:

```json
{
  "observed": "All requested shapes are present, but the intended focal hierarchy is still weak.",
  "target": "unresolved"
}
```

Do not infer unresolved/resolved from tool success or pixel delta.

Maps to 13c: technically completed but artistically unresolved fixture.

### A4. Genuinely resolved fixture

Use one semantic correction on the UXP-selected path, e.g. create/fill one accent layer or add a bounded highlight mass with `photoshop_paint_regions`, designed so the same human can judge whether the explicit local goal is now met.

After preview: **[HUMAN VISUAL JUDGMENT REQUIRED]**. Record `target=resolved` only if the requested bounded visual relation is actually visible.

Maps to 13c: genuinely resolved fixture not inferred from execution success.

## 6. Phase B — former document-5071 trap, compact v2 only

Use the same disposable document or a fresh second disposable document inside the same process root.

### B1. Configuration setter with authoritative readback

Start/bind this document as `simple_graphic` with `photoshop_guard_set_art_run`, then execute one guarded compact setter using `photoshop_set_brush` or `photoshop_select_brush_preset` with UXP selected for the acceptance step.

Required result evidence:

- exactly one setter dispatch;
- authoritative effective settings returned/current;
- terminal setter outcome `applied` or `not-applied` if exposed;
- no generic visual reconcile for a proven setter result;
- no preview/artistic verdict debt created solely by the configuration setter.

### B2. In-place profile upgrade

Re-call `photoshop_guard_set_art_run` with the **same immutable process_dir**, `painting_profile=nontrivial_painting`, concrete `profile_transition_reason`, and the required live brush-role/preflight facts from the current installed presets.

Acceptance:

- same art run and same document id;
- no new chat/run/document workaround;
- profile transition is monotonic and in place.

### B3. Comparable visual pass

Execute one bounded brush or region pass with UXP selected and canonical comparable BEFORE/AFTER evidence. Prefer a local `paint_regions` or a brush method whose preparation has already been established.

Record:

- before SHA/path;
- after SHA/path;
- exact document id and focus region;
- semantic goal;
- human observation of local change **[HUMAN VISUAL JUDGMENT REQUIRED for artistic direction, not for execution]**.

### B4. Deliberately unavailable comparison metric

Exercise the current compact outcome path where the machine comparison metric is deliberately unavailable, while the same visual evidence still permits a bounded model-owned artistic observation.

Then compact-finalize with:

```text
photoshop_guard_cycle_auto(
  previous_operation_id=<B3 operation>,
  previous_observation=<actual inspected observation>,
  no next_pass
)
```

Acceptance:

- closure is terminal and debt-free;
- metric unavailability is explicitly recorded rather than converted to a fabricated numeric/directional metric;
- no standalone report/ack/verdict;
- no dummy mutation;
- no general status detour.

## 7. Phase C — Task 15b exact live placement

Use a fresh blank 800×600 document or a dedicated layer on the main disposable document.

### C1. Known geometry

With UXP-selected `photoshop_paint_regions`, paint two high-contrast solid rectangles/polygons at known canvas bounds. Example:

```text
R1 expected canvas bounds: left=80, top=90, right=240, bottom=210
R2 expected canvas bounds: left=520, top=330, right=700, bottom=500
```

Return a full preview at a known output size, e.g. 400×300, so the expected mapping is exactly 0.5×.

### C2. Independent raster measurement

Measure the materialized preview pixels offline; do **not** use echoed command coordinates as observed placement. Detect the solid-color connected components and record:

```json
{
  "document_id": 0,
  "canvas_size": [800, 600],
  "preview_size": [400, 300],
  "expected_preview_bounds": {
    "R1": [40, 45, 120, 105],
    "R2": [260, 165, 350, 250]
  },
  "measured_preview_bounds": {},
  "tolerance_px": 1,
  "source_preview_sha256": "..."
}
```

Acceptance:

- transform/crop mapping agrees within declared tolerance;
- the measurement is derived from raster pixels plus preview SHA, not action args;
- if anti-aliasing expands a boundary, record the measured edge/tolerance rather than moving expected coordinates after the fact.

No human artistic judgment is required for this technical placement check.

## 8. Phase D — Task 15d bounded compositing/mask acceptance

Use editable layer/mask operations with UXP selected for the acceptance steps; no photo import is needed.

### D1. Before frame

Create a simple two-depth scene: cool background mass + darker foreground shape + warm focal shape. Capture whole-frame and local-focus BEFORE preview.

### D2. Editable atmospheric layer

In one bounded semantic pass:

1. `photoshop_create_layer` for `Atmosphere`;
2. `photoshop_fill_layer` with a light/cool atmospheric tone;
3. `photoshop_set_layer_blend_mode` to an explicitly chosen supported mode;
4. `photoshop_set_layer_opacity` to a bounded value;
5. `photoshop_create_layer_mask`;
6. `photoshop_apply_gradient_mask` so atmosphere is stronger in the intended depth region.

If current VisualMicroPlan compatibility rules require splitting preparation/property mutations from the mask mutation, use the smallest number of semantic passes that preserves one review question per pass. Do not merge merely to lower call count.

### D3. Acceptance

Technical evidence:

- atmosphere remains on its own named editable layer;
- layer opacity/blend mode/mask are observable in state where current UXP readback can prove them;
- whole-frame and local AFTER preview SHAs/paths are recorded;
- no base structure was overwritten destructively.

Artistic evidence: **[HUMAN VISUAL JUDGMENT REQUIRED]**

- does depth/material/atmosphere actually improve rather than merely add texture/tint?
- is focal structure preserved?
- are seams/halos/distribution regressions absent?

Record both whole-frame and local answers. A technical pass with no visible artistic improvement does not satisfy Task 15d.

## 9. Phase E — Tasks 16 and 17 semantic-cycle/cadence acceptance

Use call-ledger counts from Phases A–D; do not add instrumentation calls inside the Painter loop.

### E1. One semantic pass / one primary cycle

Choose one local correction expressible as 2–4 tightly related visual operations with UXP selected in one VisualMicroPlan, e.g. several adjacent `paint_regions`/`paint_dabs` operations that answer one acceptance question.

Acceptance ledger must show:

- one `photoshop_guard_cycle_auto` request for the semantic pass;
- one final authoritative AFTER preview;
- no per-stroke Guard negotiation;
- no unrelated region/action bundled into the same pass;
- rollback/reconciliation remains possible for the whole semantic unit.

### E2. Per-pass versus global cadence

Run three ordinary local passes after the current global directive/state is already established.

Expected call pattern:

```text
cycle_auto(pass 1)
cycle_auto(observation 1 + pass 2)
cycle_auto(observation 2 + pass 3)
cycle_auto(observation 3 + finalization or boundary action)
```

Between these local passes there must be **zero** fresh whole-image Art Director, value-analysis, general status, schema or repository-source calls unless an actual boundary/failure requires one.

Then deliberately cross one legitimate global boundary (stage transition, risky/global pass, or final review) and perform the required global review there.

Acceptance:

- local continuation did not multiply host/tool calls merely because artistic state existed;
- global review still occurs at the declared boundary;
- any additional call is explained by a real boundary or recovery condition, not habit.

Human global assessment at the boundary is **[HUMAN VISUAL JUDGMENT REQUIRED]**.

## 10. Phase F — Task 19 cache cold/warm latency A/B

There is no public "disable preparation cache" switch. Therefore define **cache-off** operationally as a cold in-process cache immediately after restarting only the Photoshop MCP child, and **cache-on** as the immediately repeated equivalent pass with identical preparation provenance in the same child.

Do not reload UXP between A and B. The bridge revision must remain identical.

### F1. Pair design

For each pair `i = 1..3`:

1. Restart **only** the Photoshop MCP child; keep Photoshop/UXP/document open.
2. Verify the new child PID/build and same exact UXP bridge revision.
3. Submit cold pass `Ai` using one known brush preset/effective settings and a local region not used by `Bi`.
4. Submit warm pass `Bi` immediately afterward with:
   - same document;
   - same explicit layer provenance;
   - same preset/effective settings;
   - same method/stage/scale;
   - equivalent geometry/stroke count in a mirrored/adjacent region;
   - no reconciliation, uncertainty, preset/settings mutation, or target/layer change between A and B.

Use equivalent visual work rather than repainting the exact same pixels so B remains a real semantic operation.

### F2. Required A/B fields

For every A/B pass record:

```json
{
  "pair": 1,
  "condition": "cold|warm",
  "child_pid": 0,
  "uxp_bridge_revision": "...",
  "document_id": 0,
  "layer_id": 0,
  "preset": "...",
  "effective_settings_fingerprint": "...",
  "preparation_cache_events": [],
  "preparation_host_calls": 0,
  "guard_preflight_ms": 0,
  "photoshop_dispatch_ms": 0,
  "semantic_cycle_wall_ms": 0,
  "preview_sha256": "..."
}
```

Expected:

- cold A includes preparation miss/execution;
- warm B reports exact cache hits and zero repeated preparation host calls;
- preview is still captured for every pass; visual evidence is **not** reused;
- stale provenance must invalidate rather than hit.

Report medians over the three cold and three warm passes for:

- preparation host-call count;
- Guard preflight time;
- Photoshop dispatch time;
- semantic-cycle wall time.

Task 19 live acceptance requires a measured improvement in at least the preparation-call dimension and reports wall-time honestly. If wall time is noisy or not lower, record that result; do not claim latency improvement from the 2→0 unit-test proxy alone.

## 11. Phase G — Task 21 final-anchor restore/reconcile

This is a separate bounded final-selection scenario, because 13c's normal path must not contain an Art Director detour.

### G1. Establish a primary anchor

Create a visually coherent simple composition with UXP-selected paint/fill primitives and perform the current whole-image review required to promote the resulting frame as primary artistic anchor.

Record anchor identity:

```json
{
  "anchor_operation_id": "...",
  "anchor_preview_sha256": "...",
  "anchor_preview_path": "...",
  "document_id": 0
}
```

**[HUMAN VISUAL JUDGMENT REQUIRED]** to justify promotion as the stronger artistic state.

### G2. Create a deliberately weaker current state

Execute exactly one reversible visual pass with UXP selected after the anchor. The pass should be technically valid but visually weaker in an explicit way, e.g. an over-large accent or over-dense secondary marks that compete with the focal area.

Capture current SHA/path.

Whole-image comparison: **[HUMAN VISUAL JUDGMENT REQUIRED]**. Record that the primary anchor is stronger, including concrete criteria; do not complete while `preferred=previous`.

### G3. Actual restore

Because the weaker state is exactly one reversible pass after the anchor, restore with guarded `photoshop_undo` on the UXP-selected path inside a compact semantic pass.

The restore is not accepted merely because Undo returned success. Require:

- authoritative AFTER preview;
- same document id;
- restored preview SHA equals the anchor SHA **when deterministic preview encoding makes exact equality available**; otherwise independent visual/raster comparison must establish equivalence within a declared tolerance;
- no intervening mutation between anchor, weaker pass and restore.

If the restore operation result is uncertain/interrupted, do **not** undo again. Use the current public `photoshop_guard_reconcile` with fresh same-document evidence for that exact operation id. This is the only point in this design where reconcile is expected, and only when the operation is genuinely uncertain.

### G4. Final canonicalization

After visually inspecting the restored frame, submit compact closure/final review referencing the durable anchor/restored state. Completion is allowed only after the state actually reflects the chosen stronger frame.

Record final artistic frame identity:

- selected operation/restored operation id;
- final preview SHA/path;
- source primary anchor id;
- whether restore required reconcile;
- final comparison reason.

Acceptance:

- "previous was stronger" caused actual restoration rather than being ignored;
- selected final is hash/path-backed;
- the more detailed/weaker intermediate frame never becomes canonical final;
- uncertain restore never triggers blind replay.

## 12. Call-budget and failure rules

During the normal 13c trace, fail acceptance if any of the following occurs:

- legacy full-cycle payload or standalone closure call;
- deterministic schema correction/retry after the first submitted live request;
- repository source/schema lookup by the Painter;
- general `status`/Art Director/value-analysis detour between healthy passes;
- any cross-backend replay after UXP dispatch/claim/uncertainty;
- unrecorded pre-dispatch COM/ExtendScript fallback;
- any COM/ExtendScript fallback for intentional UXP-only `save_document` or `neural_filter`;
- any raw `photoshop_execute_script` call;
- hidden COM/ExtendScript helper process during a step claimed as UXP-path evidence;
- bridge revision mismatch tolerated as ready;
- second document create/open after uncertain bootstrap;
- visual success inferred only from tool success/pixel delta;
- missing authoritative preview after a visual pass.

Outside the normal path, bounded recovery tools are permitted only for a real interruption/uncertainty and must be recorded as such.

## 13. Roadmap mapping summary

| Live step | Roadmap acceptance |
|---|---|
| A0–A4 | 13c compact-only route, pinning/idempotency, multi-shape dispatch, preview identity, resolved vs unresolved not inferred from execution |
| B1–B4 | 13c former document-5071 setter/profile/comparison-metric trap |
| C1–C2 | 15b exact measured live placement independent of command metadata |
| D1–D3 | 15d editable compositing/mask separation + whole/local artistic comparison |
| E1 | 16 one semantic artistic pass per primary Guard cycle; preview/rollback boundary retained |
| E2 | 17 no fresh global critique on ordinary local continuation; global review still occurs at real boundary |
| F1–F2 | 19 real cold/warm preparation-cache latency A/B and call-count measurement |
| G1–G4 | 21 durable artistic anchor, stronger-previous cannot be ignored, actual restore/reconcile, hash/path-backed canonical final |

## 14. Final acceptance report shape

Prime should finish with a short factual report containing:

```text
child PID/build/hash: PASS|FAIL
Guard protocol/runtime version: PASS|FAIL
UXP companion revision exact match: PASS|FAIL
UXP-first routing + pre-dispatch fallback policy: PASS|FAIL
zero cross-backend replay after UXP dispatch/uncertainty: PASS|FAIL
save_document/neural_filter remain UXP-only: PASS|FAIL
raw photoshop_execute_script retired: PASS|FAIL
P1/P2/P3 source migration loaded: PASS|FAIL
post-migration final live acceptance: PASS|FAIL
13c compact-only bounded trace: PASS|FAIL
document-5071 trap: PASS|FAIL
15b exact raster placement: PASS|FAIL
15d editable compositing + human visual gain: PASS|FAIL|HUMAN-UNRESOLVED
16 one-semantic-cycle: PASS|FAIL
17 cadence/no-extra-host-calls: PASS|FAIL
19 cache cold/warm A/B: PASS|FAIL|NOISY (include medians)
21 anchor restore/reconcile: PASS|FAIL|HUMAN-UNRESOLVED
unexpected calls: <count + exact list>
remaining live blockers: <exact list>
```

Do not convert `HUMAN-UNRESOLVED`, noisy latency, unavailable comparison metrics, or uncertain recovery into PASS. Repository tests remain supporting evidence; this document defines the additional live evidence needed to close the remaining roadmap claims.
