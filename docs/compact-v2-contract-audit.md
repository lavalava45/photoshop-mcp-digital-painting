# Compact v2 contract audit

Date: 2026-09-22
Scope: `PAINTING-ROADMAP.md` task 13b only.
Status: **AUDIT ARTIFACT COMPLETE; 13b BEHAVIOR ACCEPTED.**

This is a migration-era dependency/state-machine audit. It is retained because its ownership,
deletion and regression analysis is still useful, but **current completion/live status is
authoritative in `docs/roadmap-final-acceptance-matrix.md` and
`docs/uxp-migration-inventory.md`**. Rows explicitly marked historical/planned below describe the
state at the audit point and are not a current TODO unless the acceptance matrix still carries
that gap.

This document is the canonical dependency/state-machine audit required before the
13a.2–13a.7 deletion work. It records current owners, current consumers, intended
compact-v2 ownership, exact deletion candidates, unresolved blockers and executable
regression scenarios. It does not authorize deleting a provider merely because that
provider is named here.

The accepted production route remains:

```text
ChatGPT → Chat On Steroids Plugins → dist/cos-plugin.js
        → EmbeddedGuardRuntime → ToolRegistry → PhotoshopBackendRouter → Photoshop
```

The target normal painting loop is:

```text
previous visual observation + next semantic pass
→ photoshop_guard_cycle_auto
→ compact compiler
→ Guard dispatch
→ Photoshop
→ one delivered preview
```

The public compact surface has completed the breaking schema/provider cutover described
below. Remaining legacy references are internal compiled/state paths, retired controller
utilities, historical evidence, or rejection fixtures; unresolved internal consumers are
still **deletion blockers** for total provider/code retirement.

## 1. State-transition table

| State / durable fact | Current owner / writer | Entry condition | Canonical exit / next action | Recovery action | Audit disposition |
| --- | --- | --- | --- | --- | --- |
| No active operation | `EmbeddedGuardRuntime` + `SessionStore` | No active job, uncertain op, closure debt or preview barrier | Compile and dispatch one compact `next_pass` | `photoshop_guard_status` / `photoshop_guard_resume` only after interruption | keep |
| `next_pass` received | `src/core/guard/cycle-compiler.ts` `compileGuardCycleInput()` / compact compiler helpers | Public cycle input includes `next_pass` | Compile to internal `next_operation`, aggregate violations, dispatch only if valid | Return deterministic `preflight_rejection`; caller corrects one compact request | keep behind compact facade |
| Removed public full operation payload received | compact public cycle boundary + `cycle-compiler.ts` rejection path | Caller supplies a removed legacy field | Reject with `legacy_contract_removed` before dispatch and name `next_pass` | Correct the compact request; do not adapt/replay | **public removal complete; retain rejection regression only** |
| Prior visual operation awaiting compact observation | `SessionStore` operation journal + visual barrier | Visual operation completed with registered preview and no verdict | `previous_operation_id + previous_observation` closes it atomically; optional `next_pass` continues | Re-deliver/recover exact registered preview; never repaint | keep |
| Prior operation awaiting internal technical closure | `SessionStore` durable closure state | A prior operation has internal technical/receipt/verdict debt | Compact continuation/finalization derives closure behind the facade | `status/resume` may expose recovery state after interruption | **internal only; no model-authored closure detour** |
| Active async Guard job | `EmbeddedGuardRuntime` + job store | Long operation returns `job_id` | `photoshop_guard_job_poll` until terminal | Poll same job; do not launch replacement work | keep |
| Operation uncertain after possible dispatch | `SessionStore` journal | Dispatch may have occurred but terminal result is unknown | Fresh evidence / exact durable receipt → reconcile | `photoshop_guard_reconcile`; no blind replay | keep |
| UXP command queued | `src/platform/uxp-bridge-server.ts` command receipt journal | Stable command created before UXP claim | exact companion claims once | durable receipt can prove `not-claimed` | keep, version in 13a.2 |
| UXP command claimed, result missing | UXP receipt journal | `/claim` succeeded, `/result` not received | Original result may complete same command id | recover receipt; never redispatch uncertain claimed command | keep |
| UXP command completed/failed | UXP receipt journal | exact terminal result persisted | return exact stored outcome | duplicate result returns terminal receipt | keep |
| UXP revision mismatch | `uxp-bridge-client.ts` readiness + `EmbeddedGuardRuntime` readiness gate | `bridge_revision !== EXPECTED_UXP_BRIDGE_REVISION` or revision missing | fail before migrated dispatch | reload matching companion; refresh readiness | keep; revisionless/stale companion is rejected |
| Visual barrier pending | `SessionStore.setVisualBarrier()` / `synchronizeVisualBarrier()` | Visual mutation completed and needs image classification | exact registered preview verdict/compact observation releases it | recover exact preview identity; stale preview rejected | keep |
| Planner directive active | `SessionStore.setArtDirectorState()` | `photoshop_guard_art_director` installs directive/tasks | Painter executes only current active task within scope | review when `review_due` / interrupted | keep capability; normal-path round-trip policy still pending |
| Planner task `active` | `SessionStore` art-director state | first task or previous task completion | explicit task-scoped `planner_task_assessment.status=completed|blocked` advances state | missing task evidence leaves task active | keep |
| Planner task `completed` | `SessionStore.advanceArtDirectorAfterVerdict()` | task-scoped assessment says completed with evidence | activate next pending task or mark review due | Art Director review at boundary | keep |
| Planner task `blocked` | same | task-scoped assessment says blocked with evidence | set review due; do not pretend completion | Art Director chooses new task/strategy | keep |
| Local operation `target_resolved=yes` | verdict / compact observation | current operation goal visually resolved | closes local goal only | broader task remains unchanged unless task-scoped assessment exists | keep; regression required |
| Workflow lifecycle `active` | `SessionStore.setWorkflowLifecycle()` | visual workflow starts/continues | bounded continuation, finalization or stop | resume derives same active state | keep |
| Workflow lifecycle `stopped` | same | close-only finalization / explicit terminalization | no implied artistic success | restart only by a new valid operation/task | keep |
| `workflow_stall` | `SessionStore.workflowMetrics()` | repeated unresolved work without structural strategy change | executable strategy change required | new method/scale/region/brush-role/mutation structure | keep; finite-stop v2 outcome still missing |
| `painting_profile=simple_graphic` | `SessionStore.setArtRunState()` | art run bound as simple graphic | monotonic in-place upgrade to `nontrivial_painting` when stronger obligations and transition reason are supplied | preserve same run/document; no downgrade | implemented; retain regression |
| `painting_profile=nontrivial_painting` | same | default or explicitly bound profile | requires brush preflight for relevant painting | complete durable `brush_preflight` | keep |
| Comparison metric unavailable | canonical comparison specification / outcome projection | same-document comparable intent exists but machine metric is unavailable | preserve authorized artistic judgment where allowed and record `comparison_metric=unavailable` | recapture only semantically equivalent evidence when genuinely needed | implemented; retain regression |
| `execution_outcome` / `artistic_outcome` / `global_brief_outcome` | canonical Guard artistic contract/runtime state | compact execution/artistic/global evaluation boundaries | keep the three outcomes independent; shadow critic cannot promote global completion | recover from durable current contract/frame evidence | implemented; retain truthful-claim regressions |

### Transition findings

1. `target_resolved` is already locally scoped by `planner_task_assessment`; that is a
   useful foundation, but it is not the v2 `artistic_outcome` model.
2. Durable technical closure facts remain internal, but model-authored standalone
   report/ack/verdict detours and public legacy closure fields have been removed.
3. `simple_graphic → nontrivial_painting` is a monotonic in-place transition with stronger
   obligations and no downgrade path.
4. `workflow_stall` enforces structural change, but the explicit bounded two-strategy
   stop / capability-blocker result required by 13a.1A is not implemented.

## 2. Round-trip ledger

`Host/model call` means a model-visible MCP invocation. Internal compiler/runtime/
backend work does not count as another host/model round trip.

| Scenario | Target compact-v2 calls | Current required/possible calls | Extra current detours | Disposition |
| --- | ---: | --- | --- | --- |
| First visual pass | 1 | `photoshop_guard_cycle_auto(next_pass)`; art-run/preflight setup may precede it | schema/source discovery should be zero; Art Director setup may be required by current planner state | keep one dispatch; audit setup separately |
| Healthy continuation | 1 | `photoshop_guard_cycle_auto(previous_operation_id, previous_observation, next_pass)` | none on the public compact path | keep compact-only closure |
| Healthy finalization | 1 | `photoshop_guard_cycle_auto(previous_operation_id, previous_observation)` | none on the public compact path | keep compact-only closure |
| Async operation | 1 start + N polls | cycle may return `job_id`; `photoshop_guard_job_poll` until terminal | no replacement mutation allowed | keep |
| Interrupted host, known durable state | 1 recovery read | `photoshop_guard_resume` or status as needed | general status probing is still taught in recovery contexts | keep recovery read only when interrupted |
| Uncertain mutation | recovery read(s) + 1 reconcile | exact receipt / fresh same-document evidence, then `photoshop_guard_reconcile` | no blind replay | keep |
| Checkpoint due | 1 save operation when actually due | guarded save/checkpoint path | must not become unconditional per-pass call | keep conditional |
| Planner review due | 1 Art Director state call | `photoshop_guard_art_director` | current state machine may require this after cadence/task boundary | keep at bounded boundary; no per-pass review |
| Value check due | 1 analysis/read + Art Director consumption when required | value analysis is separate evidence | should not run on irrelevant pass | keep applicability-gated |
| Brush/config setter | 1 guarded setter + read-only exact-outcome recovery/readback when needed | stable UXP command id is durable; claimed lost response is awaited under the same command id, then authoritative brush readback is used if the receipt remains claimed | no second setter dispatch; no generic visual reconcile/preview debt | implemented for brush preset/settings setters; retain focused regressions |
| Profile upgrade | 1 state transition | monotonic `simple_graphic → nontrivial_painting` in place | no downgrade/new-run workaround | implemented; retain regression |
| Degraded comparison closure | same 1 compact continuation/finalization call | canonical `comparison_metric=unavailable` flow preserves bounded artistic outcome semantics | no public legacy verdict path | implemented; retain regression |

### Round-trip conclusion

The compact cycle supports the desired one-call healthy continuation shape and no longer
exposes alternate public legacy closure routes. The maintained embedded-Guard regression now
demonstrates the exact
`background fill → same planner task → 14-region block-in → preview` sequence without
status/report/ack/verdict/Art Director detours, while keeping the broader Planner task active.

## 3. Schema ownership matrix

| Contract / field | Public schema owner | Compiler / normalization | Runtime / enforcement | Persisted state | Instruction owner | v2 disposition |
| --- | --- | --- | --- | --- | --- | --- |
| `next_pass` | `src/tools/guard-tools.ts` `compactPassSchema()` via `cycleTool()` | `src/core/guard/cycle-compiler.ts` compact-pass compiler | `EmbeddedGuardRuntime.cycle/cycleAuto` after compilation | compiled operation journal | `AGENTS.md`, `docs/digital-painting-agent-skill.md`, prompt templates | canonical public request |
| `previous_observation` | `compactObservationSchema()` | `compactObservationToVerdict()`; compact closure defaults synthesize technical closure | `SessionStore` validates/release barrier | internal verdict + operation closure | same | canonical public visual closure |
| `previous_operation_id` | `cycleTool()` | cycle compiler | runtime/session store selects prior record | operation journal id | same | keep |
| `request_key` | compact pass schema | compiler maps to durable operation id/fingerprint | duplicate/idempotency checks | operation record | compact docs | keep |
| `document_id` | compact pass/actions + tool schemas | compiler normalization | document-target and Guard preflight | operation args / project state | compact docs | keep |
| `goal`, `region`, `protected_regions`, `actions` | compact pass schema | compiler creates technical operation / VisualMicroPlan | Guard/tool validators enforce scope/targets | operation request/context | Artist contract docs | keep |
| `planner_task_assessment` | compact observation schema / verdict schema | observation expansion | `SessionStore.plannerTaskAssessment()` and `advanceArtDirectorAfterVerdict()` | verdict + Art Director task status | painting policy | keep; task-scope only |
| `next_operation` | **removed from public `cycle/cycle_auto` schema**; retained only as an internal compiled/state representation | raw public compile rejects with `legacy_contract_removed`; internal state-only revalidation may consume compiled shape | runtime dispatch uses compiler-produced operation; never model-facing | operation journal | historical/internal audit text only | **public removal complete; controller/daemon consumers still block total internal retirement** |
| `previous_report` | **removed from public `cycle/cycle_auto` schema** | raw compiler rejects with `legacy_contract_removed`; compact defaults still synthesize internal technical report | `SessionStore` internal closure | report record | cutover docs | **public removal complete; internal durable report retained** |
| `previous_operation_ack` | **removed from public `cycle/cycle_auto` schema** | raw compiler rejects with `legacy_contract_removed`; compact defaults synthesize exact token internally | receipt ack validation | operation ack | cutover docs | **public removal complete** |
| `previous_visual_verdict` | **removed from public `cycle/cycle_auto` schema** | raw compiler rejects with `legacy_contract_removed`; `previous_observation` expands internally | preview identity + verdict validation | verdict | cutover docs | **public removal complete** |
| standalone `photoshop_guard_report` | **no longer registered by `createGuardTools()`** | internal `runtime.report()` remains | internal recovery/closure implementation only | report | catalog/inventory now omit it from public surface | **public provider removed** |
| standalone `photoshop_guard_ack_operation` | **no longer registered by `createGuardTools()`** | internal `runtime.ackOperation()` remains | internal recovery/closure implementation only | operation ack | same | **public provider removed** |
| standalone `photoshop_guard_verdict` | **no longer registered by `createGuardTools()`** | internal `runtime.verdict()` remains | internal recovery/closure implementation only | verdict/barrier release | same | **public provider removed** |
| `painting_profile` | `photoshop_guard_set_art_run` schema | none | `SessionStore.setArtRunState()` | painting-state document | painting policy | keep field; replace immutable transition rule |
| `brush_preflight` | set-art-run schema | parsing/role normalization in session store | painting preflight gates | painting-state document | methods/foundations | keep capability; include in capability snapshot |
| `current_stage`, visual problems | `photoshop_guard_set_priorities` | none | stage-priority gate | painting-state document | policy | keep; applicability audit required |
| Art Director directive/tasks | `photoshop_guard_art_director` | none | planner gate / advancement | painting-state document | methods | keep capability; boundary use only |
| `execution_outcome` | **absent** | absent | absent | absent | roadmap only | **add in 13a.1A; deletion blocker** |
| `artistic_outcome` | **absent** | absent | absent | absent | roadmap only | **add in 13a.1A; deletion blocker** |
| `global_brief_outcome` | **absent** | absent | absent | absent | roadmap only | **add in 13a.1C; deletion blocker** |
| `strategy_signature` | **absent as canonical field** | structural `strategyChanged()` exists, but no durable v2 signature contract | current workflow-stall gate compares structure | no canonical signature | roadmap only | **add/define before claiming finite causal retry acceptance** |
| `comparison_metric` / comparison specification | **absent canonical v2 shape** | absent | current preview identity/delta mechanisms are separate | no unified spec | roadmap only | **add in 13a.1B** |
| compact Guard protocol version | `src/core/guard/protocol-version.ts` `COMPACT_GUARD_PROTOCOL_VERSION`; public cycle schema exposes optional/default `protocol_version`; `photoshop_guard_capabilities` publishes `compact_guard_protocol_version` | `createGuardTools()` validates explicit caller version and supplies current protocol without model repetition | old explicit versions fail before runtime dispatch | separate from runtime-state schema and UXP revision | compact-v2 audit + public capability output | **strict public protocol boundary implemented** |
| runtime-state schema version | `src/core/guard/protocol-version.ts` `RUNTIME_STATE_VERSION`; `SessionStore` requires `runtime-state.json` + v2 `painting-state.json`, stamps every operation record, and `EmbeddedGuardRuntime.capabilities()` publishes `runtime_state_version` | no inference or in-place upgrade; missing/stale manifest, painting schema or journal record version throws `runtime_state_schema_mismatch` | clean empty directory initializes v2; non-empty versionless/old active state fails before projection/mutation | controller manifest, painting-state and every operation journal record carry the same version | `tests/runtime-state-versioning.test.ts`; embedded Guard capability test | **13a.2 runtime-state boundary implemented** |
| runtime-state archive/cutover | `src/core/guard/runtime-state.ts` `createRuntimeStateArchive()` inventories SHA-256/bytes/lines and verifies copied runtime + selected run-local state; `cutoverRuntimeStateV2()` archives, preserves the retired active tree, then creates a clean v2 runtime | archive must be outside active runtime, destination must not exist, verification failure aborts before clean-state creation | production `SessionStore` has no archive lookup path; clean cutover has no operations, barriers, execution lock, planner/closure/reconciliation debt | diagnostic archive manifest records verified inventory and source schema version; old active tree is preserved, never deleted | `tests/runtime-state-versioning.test.ts` | **13a.3 repository acceptance implemented; real pre-cutover archive still must be executed deliberately** |
| UXP bridge revision | `src/core/guard/protocol-version.ts` `UXP_BRIDGE_REVISION`; `/health` publishes actual + expected revision; Guard capabilities publish expected revision | `uxp-bridge-client.ts` exact comparison only | `/poll` rejects missing/stale revision before companion registration | UXP receipt journal remains separate exact-outcome protocol | development/inventory | **strict revision gate implemented** |

### Authoritative-definition blockers

- `cycle` / `cycle_auto` expose one compact public shape: `previous_operation_id`,
  `previous_observation`, `next_pass`. Internal compiled operation objects remain an
  implementation detail and are never a model-facing provider/schema.
- Technical closure is derived internally; removed raw legacy fields are rejected at
  the compiler boundary with `legacy_contract_removed` before compact expansion.
- The roadmap's three independent outcome dimensions are not represented in runtime
  state yet; existing `execution`, `target_resolved`, planner task status and workflow
  lifecycle are not interchangeable substitutes.

## 4. Exact deletion / migration manifest

No row marked **BLOCKED** may be deleted until its named replacement/regression is
green. `REMOVE` means removal is the intended end state, not authorization to remove it
in this audit slice.

| Item | Exact current location / symbol | Current consumer(s) / capability | Target action | Gate before action | Status |
| --- | --- | --- | --- | --- | --- |
| Public `next_operation` on `cycle/cycle_auto` | removed from `src/tools/guard-tools.ts` `cycleTool()`; raw compiler rejects it with `legacy_contract_removed`; internal state-only compiled revalidation remains | legacy/full callers/tests outside the public normal path | keep removed; migrate remaining controller/daemon consumers | focused reject tests green; full consumer migration still required | DONE FOR PUBLIC NORMAL PATH / broader retirement BLOCKED |
| Public `previous_report` | removed from `cycleTool()`; raw compiler rejects | explicit legacy closure callers | keep removed | compact closure focused regression green | DONE FOR PUBLIC NORMAL PATH |
| Public `previous_operation_ack` | removed from `cycleTool()`; raw compiler rejects | explicit legacy receipt callers | keep removed | compact closure focused regression green | DONE FOR PUBLIC NORMAL PATH |
| Public `previous_visual_verdict` | removed from `cycleTool()`; raw compiler rejects | expanded legacy verdict callers | keep removed | compact observation focused regression green | DONE FOR PUBLIC NORMAL PATH |
| `photoshop_guard_report` public tool | registration removed from `createGuardTools()`; `runtime.report()` retained internally | internal recovery/closure only | keep public registration absent | catalog/docs verifier + rejection tests | DONE |
| `photoshop_guard_ack_operation` public tool | registration removed; `runtime.ackOperation()` retained internally | internal recovery/closure only | keep public registration absent | catalog/docs verifier + rejection tests | DONE |
| `photoshop_guard_verdict` public tool | registration removed; `runtime.verdict()` retained internally | internal recovery/closure only | keep public registration absent | catalog/docs verifier + rejection tests | DONE |
| Legacy cycle wording | maintained prompts/docs/catalog/inventory | model-facing surfaces must describe compact-only public contract | keep legacy names only in explicit retirement/internal/historical context | maintained-doc verifier | DONE |
| Controller CLI | `scripts/photoshop-session.mjs` | historical/manual archaeology only; no maintained package test command invokes it | DELETE after provider-removal gate | native embedded Guard now owns required test/recovery acceptance | CONSUMERS RETIRED; PROVIDER FILE RETAINED PENDING DELETION GATE |
| Controller session store copy | `scripts/lib/photoshop-session-store.mjs` | historical controller fixtures only | DELETE with legacy provider | required regression coverage is maintained in native `SessionStore` Vitest suites | CONSUMERS RETIRED |
| Controller cycle helper | `scripts/lib/photoshop-cycle.mjs` | CLI/controller | DELETE | same | BLOCKED |
| Persistent daemon client | `scripts/lib/mcp-daemon-client.mjs` `PersistentMcpClient` | historical/manual legacy fixtures plus `photoshop-session.mjs`; absent from maintained package test commands | DELETE with legacy provider | daemon PID reuse/latency is intentionally not a compact-native invariant; exact-outcome/recovery semantics are covered natively | CONSUMERS RETIRED; PROVIDER FILE RETAINED PENDING DELETION GATE |
| Acceptance scripts using controller path | `scripts/test-session-controller.mjs`, `test-controller-cycle.mjs`, `test-stage-a-e2e.mjs`, `test-stage-c-ux.mjs`, `test-stage-d-acceptance.mjs`, `test-mcp-daemon.mjs` | explicitly historical-only; no package command invokes them | retain only as archaeology until provider deletion | equivalent journal/recovery/job/closure acceptance runs through native Vitest suites in `npm run test:acceptance` | DONE |
| `package.json` `test:acceptance` legacy composition | compact-native Vitest suite; no controller/daemon provider invocation remains | CI/local acceptance | keep native suite and retirement regressions | `npm run test:acceptance` | DONE |
| Revisionless UXP readiness fallback | removed from `src/platform/uxp-bridge-client.ts`; `isUxpBridgeReachable()` now requires exact announced revision | old revisionless companions | keep removed | bridge suite proves missing/stale `/poll` rejected and readiness false | DONE |
| Queued-result auto-claim compatibility | removed from `src/platform/uxp-bridge-server.ts` `/result`; queued result now returns `409 command_not_claimed` | old result-posting callers | keep removed | bridge regression proves explicit `/claim` is required and claimed delayed-result recovery still works | DONE |
| Compatibility Guard mode | `src/core/guard/runtime.ts` `EMBEDDED_GUARD_MODE` default `compatible`; `src/index.ts` ordinary compatibility entry | non-CoS/old route | classify: production compact route must not re-enable legacy contract | prove required non-CoS uses or retire compatible public mutation path | BLOCKED / ownership unresolved |
| ExtendScript backend/source implementation | retained `ExtendScriptPhotoshopBackend`, platform executor files and `src/api/extendscript.ts` provide the bounded legacy backend for ordinary migrated primitives | production consumer exists only through `PhotoshopBackendRouter` when UXP unavailability is resolved before dispatch | KEEP as bounded fallback; do not expose raw script execution or post-dispatch replay | backend/router + connection + no-focus-steal regressions prove pre-dispatch-only reachability | RETAINED / BOUNDED |
| Pre-dispatch ExtendScript selection for ordinary migrated primitives | `PhotoshopBackendRouter.backendFor()` prefers UXP and may select the retained legacy backend only before any UXP dispatch | ordinary migrated tools; excludes intentional UXP-only `save_document` and `neural_filter` | keep bounded pre-dispatch fallback; after UXP dispatch/claim/uncertainty/failure use exact-outcome recovery, never replay | generated inventory + backend routing + retirement-policy tests | DONE / INTENTIONAL |
| Legacy orchestration docs | `docs/reliable-core-workflow.md` and explicit history/audit sections | retired/historical evidence only | keep clearly retired/historical; maintained production docs use compact-only contract | maintained-doc verifier distinguishes explicit retirement text from recommendations | DONE FOR PUBLIC DOCS |
| UXP migration inventory public Guard rows | `docs/uxp-migration-inventory.md` | current generated/static inventory | keep removed closure providers absent and current 145-tool count synchronized | inventory/docs verifier | DONE |

### Explicit non-deletion items

The following contain the word "legacy" or compatibility behavior but are not removal
targets merely by name: output-shape precision compatibility, Background-layer behavior,
method-selection fallbacks that do not create an alternate mutation replay path, UI
compatibility, historical documentation, and fixtures used only to prove that removed
formats are rejected. Each must be classified by capability before deletion.

## 5. Artist/Planner → Compiler → Guard → Critic ownership matrix

| Component | Must receive | Owns / may decide | Must not receive or decide | Current implementation gap |
| --- | --- | --- | --- | --- |
| Artist / Planner | user brief, current visual observation, active task/stage, bounded editable scope, protected relationships, capability snapshot | visual problem, semantic goal, region/scope, expected visible change, failure signals, causal strategy | receipt tokens, report/ack plumbing, internal risk enums, barrier transitions, compiler schema discovery | durable `strategy_signature` contract remains missing; capability snapshot is now generated by Guard/runtime |
| Compiler | compact pass + current durable runtime context/capabilities | exact tool/action schema, method/layer binding, technical defaults, conservative risk/action classification, aggregated deterministic violations, internal closure defaults | artistic success, global brief satisfaction | public legacy full-operation input is rejected; internal compiled operation remains implementation-only |
| Guard | fully compiled technical request, pinned target/version, durable journal/receipt state | admission, idempotency, exact-outcome recovery, transactional state writes, preview identity, no-blind-replay, rollback/reconcile gates | deciding that pixel delta/tool success solved an artistic problem | execution/artistic outcome dimensions not yet explicit |
| Critic | original brief/evaluation contract when applicable, current stage/pass criteria, exact delivered BEFORE/AFTER registered image evidence, protected constraints | observed artistic result: resolved/unresolved/regression/uncertain at its authorized scope | Painter justification, tool-success narrative, receipt acceptance as artistic evidence | isolated calibrated critic/global brief outcome remains pending; no canonical v2 outcome fields |

### Information-flow invariants

- Artist/Planner should not read `guard-tools.ts`, validators or repository schemas during
  a healthy run.
- Compiler rejection must aggregate known violations and return one canonical compact
  correction; it must not force iterative schema discovery.
- Guard execution success is technical evidence only.
- A local Critic verdict may close the local operation target but may not complete a
  broader Planner task without `planner_task_assessment` task-scope evidence.
- The Critic must be bound to the exact preview identity delivered to model vision; a
  materialized file existing on disk is not proof that the model inspected it.

## 6. Capability-snapshot contract

The canonical implementation now exists as an ephemeral runtime-generated snapshot.
It is returned by public art-run setup and status without being persisted as live runtime
state. Cache reuse is dependency-bound and is not artistic evidence.

### Required shape

```text
capability_snapshot
  protocol                     photoshop.guard.capability_snapshot.v1
  snapshot_revision            deterministic dependency fingerprint
  compact_guard_protocol_version
  runtime_state_version
  uxp_bridge
    ready
    revision_match
    actual_revision
    expected_revision
    reason
  generated_at                 diagnostic timestamp; not an invalidation trigger itself
  pinned_targets
    document_id
    active_document_id
    document_matches
    active_layer_id
    active_layer_name
    layer_target_status
    layer_target_reason
  supported_semantic_methods[] methods compiler may choose now
  unavailable_methods[]        method + concrete reason
  brush_roles[]                durable preflighted role + effective settings
  preparation_facts            only facts whose validity can be proven
  cache
    reused
    dependency_key
```

### Ownership and generation

- Generated by Compiler/Guard from registered tools, durable art-run state and exact
  UXP readiness/state readback; the Artist does not assemble it.
- `brush_roles` comes from the durable `brush_preflight` role map after authoritative
  Photoshop readback.
- Tool/method capability is derived from the registered/current runtime surface, not a
  hand-maintained model prompt list.
- Public API: `photoshop_guard_set_art_run` returns top-level `capability_snapshot`;
  `photoshop_guard_status` returns `capability_snapshots` keyed by document id.

### Cache rule

The snapshot cache is process-local only. Its dependency fingerprint includes compact
protocol revision, runtime-state revision, expected/actual UXP bridge revision and
readiness, document identity, active-layer identity, painting profile, durable brush
preflight and profile-transition facts. Healthy visual passes alone do not invalidate it.

### Mandatory invalidation

Invalidate or regenerate after:

1. compact contract revision change;
2. runtime-state schema revision change;
3. UXP bridge revision/readiness mismatch or reconnect where state cannot be proven;
4. document identity or active-layer identity change for pinned target facts;
5. brush/preparation mutation for affected effective-state facts;
6. art-profile transition that changes required capabilities.

### Forbidden behavior

- no per-pass repository-source/schema reading to rediscover capability;
- no trusting stale Photoshop/preparation facts merely because they are cached;
- no claiming unavailable capability is usable through hidden COM/ExtendScript fallback
  on the canonical painting lane;
- no using the snapshot as artistic-quality evidence.

## 7. Top blockers ordered by first/next meaningful-paint impact

Historical heading retained for the audit verifier. The list below now marks prerequisites that
have since been resolved and identifies only the gaps that remain current.

1. **Retired public contract must stay retired.** The public catalog/schema is compact-only;
   maintained prompts/docs/examples must not re-advertise removed full-operation or explicit
   closure payloads, and rejection tests must remain green.
2. **Legacy controller/daemon internal consumers.** Retired development utilities still carry
   internal compiled operation/closure shapes and block total code deletion, but are not public
   model-facing paths.
3. **Non-visual setter coverage beyond brush setters.** Brush preset/settings now have
   durable same-command lost-response recovery plus authoritative readback and
   `applied|not-applied|uncertain` reporting. Any other configuration setters still need
   equivalent acceptance before claiming the rule generically across the catalog.
4. **Capability snapshot — resolved.** Guard now generates and reuses a revision-bound compact
   capability snapshot and invalidates it on dependency/revision change; current acceptance is
   tracked in the final matrix.
5. **Runtime-state cutover — resolved.** The real workspace was archived/cut over to
   `photoshop.guard.runtime-state.v2`; the final matrix records the verified archive and clean
   v2 runtime evidence.
6. **Backend source cleanup is not a migration goal.** Production dispatch is UXP-first with a
   bounded ExtendScript/COM fallback for ordinary migrated primitives, selected only before any UXP
   dispatch. `photoshop_save_document` and `photoshop_neural_filter` remain UXP-only/fail-closed,
   report `uxp_bridge_unavailable` when that companion path is unavailable, raw
   `photoshop_execute_script` remains retired, and no dispatched/claimed/uncertain UXP command may
   be replayed through the legacy backend.
7. **Representative latency — resolved; final post-migration behavior gate remains.** Task 13/19
   measurement evidence is recorded. The remaining live gate is the representative
   post-P1/P2/P3 UXP-path/no-focus-steal/no-post-dispatch-replay acceptance tracked in the final
   matrix.

## 8. Executable regression scenarios

Statuses: **existing-pass** = current test already covers the stated invariant;
**planned** = required test does not yet exist; **migration-needed** = useful existing
coverage is tied to a provider scheduled for removal and must be ported first.

| Scenario / acceptance invariant | Existing/planned test | Status | Required assertion before deletion |
| --- | --- | --- | --- |
| Compact request compiles and model omits copied technical report/receipt | `tests/embedded-guard.test.ts` — `accepts the compact model path with one root goal, stable request_key, and no copied report or receipt token` | existing-pass | retain on v2 schema |
| Compact close-only finalization is one call and records current finalization timing | `tests/embedded-guard.test.ts` — `compactly finalizes the last visual pass in one cycle_auto call and records latency components` | existing-pass | retain |
| Closure prevalidation does not partially write report/ack before invalid next request | `tests/embedded-guard.test.ts` late closure rollback/prevalidation tests | existing-pass | retain |
| Local `target_resolved=yes` cannot complete broader Planner task | current `planner_task_assessment` semantics in `SessionStore`; add focused native regression proving task remains active without task-scoped evidence | planned | explicit before/after task state |
| Every deterministic compact rejection aggregates known violations and names canonical correction | existing aggregated preflight coverage in `tests/embedded-guard.test.ts`; extend for v2-only schema | partial / planned | no source/schema discovery required |
| Legacy `next_operation` rejected with stable `legacy_contract_removed` | focused embedded Guard rejection coverage | existing-pass | public `cycle/cycle_auto` fail before dispatch and name `next_pass` replacement |
| Legacy closure fields rejected rather than adapted | focused embedded Guard rejection coverage | existing-pass | removed closure fields fail with stable removal error |
| Standalone report/ack/verdict absent from production public catalog | embedded Guard catalog assertion | existing-pass | keep providers absent from public tools/list |
| Repeated unresolved work requires causal strategy change | `tests/session-store-regressions.test.ts` — `requires a structural executable strategy change after an insufficient pass` | existing-pass, but session-store-coupled | port/retain equivalent native facade assertion before retiring legacy store coverage |
| Finite stop after two causally distinct failed strategies | none | planned | explicit blocker result; no infinite retry |
| Exact completed bootstrap recovers same document id without second creation | `tests/session-store-regressions.test.ts` + `tests/embedded-guard.test.ts` exact bootstrap receipt recovery | existing-pass | retain embedded-Guard version; migrate any unique session-store-only assertion |
| Claimed UXP command with lost result is never redispatched | `src/platform/uxp-bridge-server.test.ts` — `never redispatches a claimed stable command while a result is uncertain` | existing-pass | retain |
| Old/revisionless UXP companion cannot be ready | bridge revision regressions | existing-pass | missing/stale revision remains rejected |
| Unclaimed `/result` old shape is rejected | bridge result-shape regression | existing-pass | queued unclaimed result remains `command_not_claimed` |
| Migrated painting mutation never falls back to legacy backend | `src/platform/photoshop-backend.test.ts` — `requires UXP for already migrated painting mutations and never falls back to legacy execution` | existing-pass | retain |
| All retained non-UXP catalog capabilities classified | `docs/uxp-migration-inventory.md` current inventory | migration-needed | generated inventory contains UXP or explicit unavailable/P1 disposition for every retained capability |
| `simple_graphic → nontrivial_painting` succeeds in place with obligations | none; current code rejects profile change | planned | same document/run id; accepted pixels preserved; obligations activated |
| Brush setter closes with exact readback and zero visual debt | `src/tools/painting-uxp-routing.test.ts` authoritative setter outcome coverage | existing-pass | retain `applied|not-applied` readback assertions |
| Lost brush setter response recovers original exact outcome | `src/platform/uxp-bridge-server.test.ts` same-command preset recovery + claimed settings readback recovery | existing-pass | exactly one setter delivery; same durable command id; readback only after claimed timeout |
| Mismatched comparison geometry produces `comparison_metric=unavailable` without overwriting artistic outcome | none | planned | independent artistic outcome persists |
| Capability snapshot stable over healthy pass; invalidates on revision mismatch | none | planned | exact revision/cache assertions |
| Technical completion can coexist with artistic unresolved | none under canonical v2 outcomes | planned | `execution_outcome=completed`, `artistic_outcome=unresolved` |
| "best so far" cannot imply global brief satisfaction | none under canonical v2 global outcome | planned | `global_brief_outcome=unsatisfied|uncertain` blocks completion |
| Rainy-street compact path has zero status/report/ack/verdict/Art Director detour | no dedicated executable regression found | planned | one fill pass then compact observation+14-region pass then preview |
| Controller/daemon removal preserves required job/recovery/closure behavior | current `test:acceptance` exercises old provider | migration-needed | native replacement suite passes before deleting provider |

## 9. Stale instruction audit

Maintained production instruction/catalog/inventory surfaces now describe the compact-only
public contract. Removed full-operation and explicit closure names may remain only in this
retirement audit, rejection tests, internal implementation notes, or clearly retired/historical
controller documents. Historical/controller documents that name `photoshop-session.mjs` must
stay explicitly retired/historical until deleted or archived.

The repository should keep historical evidence, but no maintained production instruction
may recommend the removed contract after 13a.4/13a.5.

## 10. 13b acceptance status

The **required audit artifacts and behavior gates are now accepted** on current
repository/live evidence:

- the rainy-street no-detour compact regression executes the exact 14-region continuation;
- local operation resolution cannot silently complete the broader Planner task;
- finite causal retry/stop behavior is covered by maintained recovery tests;
- brush preset/settings lost-response recovery proves one setter dispatch maximum with
  authoritative readback when needed;
- public legacy schema/tools and old UXP compatibility remain removed;
- maintained controller/daemon acceptance consumers are retired from package test commands;
- required recovery behavior is covered on the compact native route;
- the production backend no longer has reachable ExtendScript/COM dispatch, while unmigrated
  public catalog names fail closed;
- final compact-v2 live evidence binds the rebuilt child and current UXP revision to a
  no-COM/no-foreground acceptance window.

Human artistic/calibration gates tracked separately in `roadmap-final-acceptance-matrix.md`
do not reopen task 13b's transport/state-machine acceptance. Unknown future ownership or
reachability must still fail closed rather than being guessed into a compatibility path.\n
