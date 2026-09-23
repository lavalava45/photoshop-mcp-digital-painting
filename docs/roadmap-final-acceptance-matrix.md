# Roadmap final acceptance matrix

Date: 2026-09-23. Scope: current working tree plus preserved compact-v2 live evidence under `.photoshop-runtime/` and `processes/compact-v2-live-acceptance-process/`. The P1/P2/P3 catalog source migration is included in the current tree. The rebuilt child and current UXP companion revision are now loaded and verified; representative post-migration behavioral live acceptance is still pending.

This matrix re-checks the literal **Acceptance** bullets in `PAINTING-ROADMAP.md` for Tasks 6–23 and every 13a subpart. It supersedes status conclusions in `task14-21-evidence-audit.md`; that earlier audit remains useful only as historical evidence of what was missing at the time.

Status vocabulary:

- **repo-pass** — current production source plus reproducible repository tests/docs directly establish the bullet.
- **live-pass** — current real Photoshop/UXP evidence establishes the live-only behavior in addition to repository support.
- **live-pending** — source/repository implementation is present, but the current post-migration build still needs the designated final real-Photoshop acceptance run.
- **human-required** — the remaining claim is perceptual/artistic/calibration evidence that must not be inferred from mocks, tool success or synthetic fixtures.
- **exploratory-non-gate** — intentionally optional experiment; its absence does not block the canonical painting lane.
- **still-code-gap** — a concrete machine-actionable implementation, migration, test or live-measurement gap remains.

## Verification baseline

Current-tree verification performed for this audit, including Task 23:

- `npm run test:unit`: **577/577 PASS** across 65 files.
- `npm run test:acceptance`: **158/158 PASS** across the maintained Guard/recovery/UXP acceptance files.
- Task-23 targeted refinement/stage/value/Planner suites: **140/140 PASS** in the initial focused run;
  the final dedicated `tests/refinement-check.test.ts` contains **10/10 PASS**.
- `npm run verify:painting-policy`: **PASS** (`kernel=12999`, `prompt=17995`).
- `npm run verify:photoshop-prompts`: **PASS**.
- `npx tsc --noEmit`: **PASS**.
- `npm run build:server`: **PASS**.

Current backend architecture after the 2026-09-23 catalog migration:

- ordinary migrated catalog tools are **UXP-first** and may use ExtendScript/COM only when `PhotoshopBackendRouter` selects that backend before any UXP dispatch;
- after a UXP dispatch/claim/uncertain outcome/failure, there is **zero cross-backend replay**;
- `photoshop_save_document` and `photoshop_neural_filter` are intentional UXP-only/fail-closed exceptions;
- raw `photoshop_execute_script` is retired from the production surface;
- P1/P2/P3 catalog source migration is implemented; the exact rebuilt child/current companion revision preflight is now **live-pass**, while the final representative behavioral run remains **live-pending**.

Current live evidence verified on disk:

- verified pre-v2 archive at `processes/runtime-v2-cutover-process/2026-09-22/archive-before-v2/archive-manifest.json`, with per-file byte counts, line counts and SHA-256 values;
- active runtime is `photoshop.guard.runtime-state.v2`;
- run-01 contains the exact-placement live acceptance evidence supplied for this run;
- run-02 records `setter_outcome=not-applied`, a later `setter_outcome=applied`, in-place `simple_graphic -> nontrivial_painting`, and a real nontrivial paint pass;
- Task 21 live chain: primary anchor op06 (`SHA=4b8a2bdd0b4c8df8d76833ee0cf73f23be8acae53f16d515ebadaa83d2488ca7`) -> deliberate weaker op07b (`SHA=140ca417a3b8dbbba700d60c60a44e729e0fa5372c915b0e613533cdca6aec80`) -> real guarded UXP `photoshop_undo` op08 restoring the exact anchor SHA. Current repository tests also cover canonical completion only after the restored state is real and unfinished work cannot be bypassed by hash equality alone.
- Current post-migration runtime cutover preflight: child PID `10772` (started `2026-09-23T07:15:39.5184010Z`) is running the rebuilt `dist/cos-plugin.js` SHA-256 `9023114D837A4307EBBE81D280226E1A6AD8F02DFAB35E4EC12208C0F8118801` at repository HEAD `67c0c00a94e071520532692fdbe95b3b535ddb80`; `photoshop_ping` reports UXP/long-poll ready with actual/expected bridge revision `compact-v2-20260923-full`; Guard capabilities report `photoshop.guard.compact.v2`, runtime state `photoshop.guard.runtime-state.v2`, required Guard mode and raw mutation bypass blocked; Guard status is clear of pending reports/acks, uncertain operations, visual verdicts and active jobs.

## Tasks 6–13

| ID | Literal acceptance requirement | Status | Current evidence / remaining gate |
|---|---|---|---|
| 6.1 | One critic covers people, props, architecture and arbitrary objects through the same relation vocabulary. | **repo-pass** | `world-consistency-critic.test.ts` uses one `WORLD_RELATIONS` vocabulary across all four domains. |
| 6.2 | No category-specific runtime branch is required for the first version. | **repo-pass** | One object-agnostic critic implementation; invented category relation names fail closed. |
| 6.3 | Known floating/support/connectivity failures are detected more reliably than the current baseline. | **human-required** | The machine gap is closed: `buildWorldConsistencyCriticRequest` binds the isolated two-step critic to an exact registered preview SHA and supplies no expected conflict ids/producer verdict; `evaluateRegisteredWorldConsistency` consumes relation observations with per-observation `conflict|consistent|uncertain` judgments and rejects stale-frame responses. Repository fixtures cover support/connectivity/intersection detections. The remaining “more reliably” claim requires the held-out human reference labels. |
| 6.4 | Explicit stylization/surreal intent does not create systematic false positives. | **human-required** | The registered-preview critic path suppresses explicit ordinary-world departures even when the isolated critic labels the relation as conflict, and tests cover anti-gravity/impossible-architecture controls. “Systematic false positives” is still a held-out human calibration claim, not something repository fixtures can prove alone. |
| 6.5 | The critic reports uncertainty instead of inventing hidden supports/geometry. | **repo-pass** | Hidden-support ambiguity remains low-certainty with the alternative explanation preserved. |
| 6.6 | No ControlNet-like mandatory preprocessing stack is added to the normal loop. | **repo-pass** | Critic operates on observation input; no mandatory specialist preprocessing dependency exists. |
| 7.1 | A local repair may be kept without claiming global artistic improvement. | **repo-pass** | Independent execution/local/global outcomes plus anchor tests preserve a kept frame without global promotion. |
| 7.2 | Resolving a local `problem_id` does not automatically promote an artistic anchor. | **repo-pass** | Anchor promotion is an explicit Art Director decision; local classification does not overwrite it. |
| 7.3 | A globally weaker pass may preserve a useful local achievement while triggering correction/attenuation/restore. | **repo-pass** | Kept-but-weaker anchor regression coverage plus bounded recovery/restore state. |
| 7.4 | Progress/stall metrics do not force maintenance work to masquerade as whole-image improvement. | **repo-pass** | Execution/local artistic/global brief outcomes remain independent; relative-best cannot imply global satisfaction. |
| 8.1 | Adopt relational memory only if it measurably improves wrong keep/rollback/global-promotion decisions or detects losses over baseline. | **human-required** | Evaluation/review-pack harness exists, but the roadmap explicitly requires human adjudication on disputed cases. No human calibration is claimed. |
| 8a.1 | Grant narrow critic authority only where held-out evidence shows useful reliability at acceptable overhead. | **human-required** | Held-out/calibration machinery is tested; authority remains shadow/advisory until human-labelled held-out evidence supports it. |
| 8a.2 | Otherwise retain advisory/limited use or do not integrate. | **repo-pass** | Current claim semantics keep uncalibrated critic output non-authoritative. |
| 8a.3 | No mandatory second-model call per layer/stroke; agreement is not truth; small failures are not universal VLM claims; mocks do not replace evaluation. | **repo-pass** | Current policy/harness encodes these limits; no per-stroke second critic was introduced. |
| 9.1 | Restart/resume preserves anchor identity. | **repo-pass** | `planner-painter.test.ts` reconstructs primary/alternative anchors after restart and exposes them on resume. |
| 9.2 | A later kept-but-weaker pass leaves the relevant anchor intact. | **repo-pass** | Dedicated anchor regression test. |
| 9.3 | Art Director can promote current, retain the prior anchor or preserve a bounded alternative. | **repo-pass** | Promote-primary and preserve-alternative paths are covered. |
| 9.4 | Status/resume exposes anchor identities compactly. | **repo-pass** | Compact status/resume assertions cover operation id/SHA/path identity. |
| 10.1 | State remains compact enough for normal continuation. | **human-required** | Task 10 explicitly says “Implement only if the validation experiment shows a real decision-quality gain.” No full relation-memory schema is promoted before the Task-8 human gate; implementing it now would violate the roadmap. |
| 10.2 | Every stored relation points to observed image evidence/anchor context. | **human-required** | Same Task-8 adoption gate. Existing relation evidence is bounded/advisory, while the optional durable Task-10 store remains intentionally unadopted until human validation justifies it. |
| 10.3 | Relations can become `questioned` or `retired` on contradictory evidence. | **human-required** | Spatial-support relations already preserve uncertainty/questioning; the broader optional Task-10 memory is intentionally withheld pending Task-8 human validation. |
| 10.4 | User constraints, chosen hypotheses and emergent strengths are not conflated. | **human-required** | This acceptance becomes implementation-relevant only if Task-8 validation justifies adopting Task 10; no premature mandatory schema is introduced. |
| 10.5 | No universal artistic rule such as “background must be quiet” is hard-coded as truth. | **repo-pass** | Open-ended style/evaluation contracts and policy tests avoid a closed universal aesthetic taxonomy. |
| 11.1 | No endless Art Director self-critique loop. | **repo-pass** | Bounded artistic-recovery policy stops repeated same-cause attempts. |
| 11.2 | Incomplete hypotheses have bounded endpoints and real rollback evidence. | **repo-pass** | Planner test requires finite review horizon and anchor rollback evidence. |
| 11.3 | Known artistic losses survive in state until resolved/accepted/reversed. | **repo-pass** | Incomplete-hypothesis and mismatch state persist rather than being erased by execution success. |
| 11.4 | Ordinary local passes only reevaluate potentially affected relations. | **repo-pass** | Declared relation/quality scope is stored only when explicitly relevant. |
| 11.5 | A remaining material mismatch causally constrains the next dependent pass. | **repo-pass** | `primary_mismatch_unresolved` gate requires addressing the mismatch/problem or a proven independent region. |
| 11.6 | An independent whole-image glance can surface an unforeseen regression. | **human-required** | Boundary scheduling is repo-tested; whether a real critic/human actually detects an unforeseen visual regression is perceptual evidence and remains part of the critic calibration gate. |
| 12.1 | No recovery state recommends an action rejected by its own gates. | **repo-pass** | Recovery-state-machine coverage plus current compact guidance. |
| 12.2 | No successful lifecycle operation becomes false uncertainty. | **repo-pass** | Exact-outcome/bootstrap/recovery regressions. |
| 12.3 | Reconciliation never requires evidence that cannot exist after the event. | **repo-pass** | Closed/missing-document and unavailable-preview cases have reachable bounded actions. |
| 12.4 | Compact status, resume and cycle envelope agree on the same next action. | **repo-pass** | Current session-store/recovery regressions exercise the canonical compact guidance. |
| 12.5 | Failed post-closure revalidation restores every durable state mirror. | **repo-pass** | Exact controller + run-local mirror byte restoration test. |
| 12.6 | Recovery tests terminate instead of oscillating between guards. | **repo-pass** | Recovery suite includes stale/missing evidence and bounded terminal paths. |
| 13.1 | Benchmark output compares median/p95 across representative painting passes. | **repo-pass** | `painting-cycle-latency-benchmark.md`: 53 completed visual cycles / 42 VisualMicroPlan cycles with grouped median/p95. |
| 13.2 | Roadmap optimization decisions cite measured bottlenecks. | **repo-pass** | Benchmark identifies the unattributed host/model/visual-evaluation interval as dominant and explicitly conditions optimization priorities on it. |

## Task 13a compact-v2 migration

| ID | Literal acceptance requirement | Status | Current evidence / remaining gate |
|---|---|---|---|
| 13a.1.1 | One public schema and one prompt example describe the normal cycle. | **repo-pass** | Compact `next_pass` schema and policy verification are current; standalone closure providers are absent from public registration. |
| 13a.1.2 | Continuation closes the preceding pass and dispatches the next in one host/model call. | **live-pass** | Compact run-01/run-02 continuation plus embedded-Guard regression coverage. |
| 13a.1.3 | Model does not copy receipt tokens or generate technical `did/why/result` on normal path. | **repo-pass** | Compact compiler/runtime owns technical closure; public schema omits those normal-path fields. |
| 13a.1.4 | Old and new contracts cannot both be supplied or silently selected. | **repo-pass** | Legacy public fields deterministically reject with `legacy_contract_removed`; mixed input is rejected. |
| 13a.1A.1 | Normal art run reaches first/next meaningful paint without source/schema/Guard-file discovery. | **live-pass** | Current compact live runs proceed through the prepared public contract; no source/schema recovery detour is represented in the run evidence. |
| 13a.1A.2 | One compact semantic request deterministically compiles to the complete technical request. | **repo-pass** | Compact compiler/embedded Guard regressions. |
| 13a.1A.3 | Compiler rejection aggregates known schema/policy violations and names one resubmission. | **repo-pass** | Aggregated deterministic preflight tests. |
| 13a.1A.4 | Tool success/layer creation/pixel delta alone cannot produce `artistic_outcome=resolved`. | **repo-pass** | `completed + unresolved` explicitly covered. |
| 13a.1A.5 | Isolated Critic rejects an admissible but visibly inadequate primitive without Painter explanation. | **human-required** | Isolation/provenance contract exists, but a visual-judgment claim cannot be promoted from synthetic/mocked verdicts before Task 8a held-out calibration. |
| 13a.1A.6 | Local artistic verdict cannot complete a broader Planner task without task-scoped evidence. | **repo-pass** | Planner task remains active until explicit task-level assessment. |
| 13a.1A.7 | Retry tests prove causal strategy change and finite stop after repeated unresolved results. | **repo-pass** | `artistic-recovery-policy.test.ts` covers same-strategy retry, causal change and exhausted dependency. |
| 13a.1A.8 | Capability snapshot is stable across healthy passes and invalidates on revision mismatch. | **repo-pass** | Current embedded-Guard tests cover generation/reuse and UXP readiness/revision invalidation. |
| 13a.1B.1 | Already-active/unavailable brush configuration resolves `applied|not-applied` with effective-state readback and zero visual debt. | **live-pass** | run-02 op03 is real `not-applied` with authoritative mismatch readback; op05 is real `applied`. Setter operations are nonvisual. |
| 13a.1B.2 | Lost setter response recovers the original command outcome without a second setter dispatch. | **repo-pass** | `uxp-bridge-server.test.ts` now proves delayed brush-preset recovery and claimed brush-settings authoritative-readback recovery under the same durable command id with literal one-setter-delivery maximum; no second setter is queued/dispatched. |
| 13a.1B.3 | `simple_graphic -> nontrivial_painting` succeeds in place when obligations are met. | **live-pass** | run-02 durable state records the monotonic transition and subsequent real nontrivial pass. |
| 13a.1B.4 | Invalid profile transition returns every unmet obligation and one valid transition action. | **repo-pass** | `artistic-contract.test.ts` verifies aggregated obligations and allowed transition. |
| 13a.1B.5 | Every visual op stores one BEFORE/AFTER comparison specification and matching normal-path geometry. | **repo-pass** | Artistic-contract + embedded-Guard comparison-spec behavior; live run-02 visual records contain bound before/after evidence. |
| 13a.1B.6 | Forced comparison mismatch gives `comparison_metric=unavailable` while artistic outcome remains independent. | **repo-pass** | Dedicated artistic-contract and embedded-Guard regressions. |
| 13a.1B.7 | Compact closure succeeds with degraded comparison evidence without standalone verdict/report/ack. | **repo-pass** | Current compact closure and unavailable-metric regression path. |
| 13a.1B.8 | Reproduced setter-failure/recovery/profile-upgrade/paint/closure sequence uses at most one setter dispatch, no generic visual reconcile for proven `not-applied`, one real paint mutation and one compact closure. | **repo-pass** | Integrated embedded-Guard regression `reproduces the 13a.1B setter recovery -> profile upgrade -> one paint -> compact close-only sequence` consumes the exact recovered `not-applied` setter contract, asserts setter delivery count = 1 and reconcile count = 0, performs the in-place `simple_graphic -> nontrivial_painting` transition on the same process_dir, executes exactly one `photoshop_paint_regions` mutation, then closes it through compact close-only finalization. The focused UXP receipt tests independently prove the recovery contract is same-command/no-redispatch. |
| 13a.1B.9 | No rejection in that sequence requires source/schema reading or a new chat/art run. | **live-pass** | Current run stays in the same art run/document workflow without schema/source recovery. |
| 13a.1C.1 | Production has no closed style enum/per-style Guard branch/predefined style vocabulary requirement. | **repo-pass** | Open-ended criteria/revision contract; unseen fields remain legal. |
| 13a.1C.2 | Previously unseen style request initializes/evaluates a compact contract without code/schema change. | **repo-pass** | `ferrofluid-lithograph` open-ended fixture. |
| 13a.1C.3 | Same visual property can be accepted under one brief and rejected under another. | **repo-pass** | Same-frame contrasting brief contract test. |
| 13a.1C.4 | Technical success/local improvement/stage cannot be reported as global style/brief satisfaction. | **repo-pass** | Independent global outcome and completion gate. |
| 13a.1C.5 | Status/final expose execution, local artistic and global brief outcomes independently. | **repo-pass** | Session-store/embedded status projection covers all three scopes. |
| 13a.1C.6 | “Best so far” can coexist with unsatisfied global brief and cannot complete. | **repo-pass** | Relative-best unsatisfied regression. |
| 13a.1C.7 | Global claim requires active contract revision + exact frame + authorized critic; otherwise reject/rewrite. | **repo-pass** | Missing/shadow authority rewrites to `not-independently-validated`. |
| 13a.1C.8 | Shadow critic cannot block or promote completion before Task 8a calibration. | **repo-pass** | Shadow authority is explicitly non-authoritative. |
| 13a.1C.9 | Calibrated transition/final critic sees no Painter justification/tool-success narrative. | **human-required** | Input isolation is designed/testable, but “calibrated” authority is not claimed until Task 8a human-labelled held-out calibration passes. |
| 13a.1C.10 | No new per-stroke model call, universal quality score or duplicate critic/style subsystem. | **repo-pass** | Current architecture uses the bounded shared critic/evaluation contract. |
| 13a.1C.11 | Regression fixtures cover contrasting briefs, unseen style, relative-best-but-short, identical pair and moon/house false-positive case without special runtime rule. | **repo-pass** | `artistic-contract` plus Task-8a held-out manifest contain these strata/cases. |
| 13a.1C.12 | Prompt/policy verification and compact first-paint path remain within existing context/latency budgets. | **repo-pass** | `verify:painting-policy` PASS at 17,972 prompt chars; compact first-paint embedded/live path is functioning. |
| 13a.2.1 | Current Guard/runtime/UXP versions appear in public capability/readiness output. | **repo-pass** | Public capability tests + strict UXP readiness. |
| 13a.2.2 | Old Guard payload, old runtime schema and old UXP revision each fail deterministically. | **repo-pass** | Legacy contract rejection, runtime-state version tests, UXP revision tests. |
| 13a.2.3 | Version mismatch is never healthy/degraded-ready/artistic blocker. | **repo-pass** | Strict readiness/schema errors. |
| 13a.3.1 | Archive existence, size/line count and hashes are verified before cutover. | **live-pass** | Real archive manifest exists with verified per-file inventory. |
| 13a.3.2 | Production runtime never loads or mutates the archive. | **repo-pass** | Runtime has no archive execution path; archive helper is one-way diagnostic evidence. |
| 13a.3.3 | Startup with old active-state directory fails clearly instead of guessing migration. | **repo-pass** | Runtime-state versioning regression. |
| 13a.3.4 | Clean v2 startup inherits no closure/planner/reconciliation debt. | **live-pass** | Actual cutover created v2 runtime; clean-start regression proves zero inherited debt. |
| 13a.4.1 | Repository search finds no production instruction recommending the legacy path. | **repo-pass** | Current maintained painting policy marks the Core/controller route retired/compatibility-only and canonical Plugins route as required; structural audit verifier passes. |
| 13a.4.2 | Legacy-only tools/fields are absent from public catalog/schema. | **repo-pass** | Standalone report/ack/verdict absent; public `next_operation` removed. |
| 13a.4.3 | No maintained test invokes a removed provider as a valid path. | **repo-pass** | `package.json` maintained acceptance now runs only native embedded-Guard/recovery/session-store/UXP suites. Former controller/Stage A/C/D/daemon/live fixtures are explicitly historical-only, and `legacy-consumer-retirement.test.ts` prevents package test commands from reintroducing them. |
| 13a.4.4 | Every required recovery action is reachable through the compact native route. | **repo-pass** | Required interruption, closure, reconcile, durable-job start/poll/resume, stall/orphan recovery, exact non-replay/lost-result material, preview/barrier and UXP exact-outcome behaviors are maintained on native suites. Daemon PID reuse/startup latency was not ported because it is a retired-provider property, not a required recovery capability. |
| 13a.5.1 | Legacy payloads fail with stable `legacy_contract_removed`-class error. | **repo-pass** | Embedded Guard rejection coverage. |
| 13a.5.2 | Rejection identifies the compact replacement without constructing a second request path. | **repo-pass** | Error names `next_pass`/current field; no adapter path. |
| 13a.5.3 | Compatibility flags cannot re-enable removed public contract in production. | **repo-pass** | Public compiler rejects removed fields regardless of internal compatible mode. |
| 13a.6.1 | Canonical painting live acceptance invokes no unintended COM/ExtendScript process and never foregrounds Photoshop on the selected UXP path. | **live-pending** | Historical run-04 proves the earlier UXP-only path stayed background-safe, but the current P1/P2/P3 post-migration build now permits intentional **pre-dispatch** ExtendScript/COM fallback for ordinary catalog tools. The final run must prove that its accepted UXP path stays on UXP with no helper process/foreground transition and that no fallback occurs after UXP dispatch or uncertainty. |
| 13a.6.2 | Catalog migration has an explicit backend policy for every migrated source surface. | **repo-pass** | P1/P2/P3 source migration is implemented: ordinary migrated tools are UXP-first with bounded pre-dispatch ExtendScript/COM fallback; `save_document` and `neural_filter` are intentional UXP-only exceptions; raw `photoshop_execute_script` is retired. |
| 13a.6.3 | UXP dispatch is never replayed through ExtendScript/COM after failure or uncertainty. | **repo-pass** | Focused selection/mask/painting/layer routing tests preserve pre-dispatch fallback while asserting no replay after a possibly dispatched UXP mutation fails. |
| 13a.6.4 | Legacy backend reachability is bounded to explicit pre-dispatch fallback and cannot bypass Guard/recovery invariants. | **repo-pass** | `PhotoshopBackendRouter` selects backend before dispatch; retained ExtendScript/COM paths are ordinary fallback implementations, not post-dispatch recovery. Save/neural remain fail-closed UXP-only, and raw execute-script bypass is retired. |
| 13a.7.1 | Old companion cannot register ready. | **repo-pass** | Missing/stale revision and obsolete registration shapes reject. |
| 13a.7.2 | Current companion completes readiness + exact-outcome recovery without compatibility probes. | **repo-pass** | Current protocol/receipt/result tests including delayed result after restart. |
| 13a.7.3 | Old registration/result shapes are rejected, not adapted. | **repo-pass** | Focused bridge regressions. |
| 13a.7.4 | Live acceptance verifies loaded child PID/build and companion revision before painting. | **live-pass** | Current preflight binds child PID `10772` to repository HEAD `67c0c00a94e071520532692fdbe95b3b535ddb80` and `dist/cos-plugin.js` SHA-256 `9023114D837A4307EBBE81D280226E1A6AD8F02DFAB35E4EC12208C0F8118801`; live ping is ready on UXP/long-poll with actual/expected revision `compact-v2-20260923-full`. This row is the load/revision gate only; 13a.6.1 and 13c.7 remain live-pending until the representative post-migration behavior run. |
| 13b.1 | Rainy-street `background fill -> same planner task -> 14-region block-in -> preview` has one compact path with no status/report/ack/verdict/Art Director detour. | **repo-pass** | Current embedded-Guard regression executes exactly 14 regions, closes the fill and dispatches the block-in in the same compact continuation, returns preview, and leaves the Planner task active. |
| 13b.2 | Local `target_resolved=yes` cannot silently complete a broader Planner task. | **repo-pass** | Rainy-street and Planner-task regressions explicitly assert the task remains active without task-scope evidence. |
| 13b.3 | Every nonterminal state has exactly one reachable canonical next action. | **repo-pass** | Recovery-state-machine + session-store guidance regressions cover bounded nonterminal states and canonical next action projection. |
| 13b.4 | A healthy Painter never needs repository-source/schema discovery to continue. | **live-pass** | Current compact live runs continue through the public semantic contract without a source/schema recovery detour. |
| 13b.5 | Execution success and artistic resolution remain independently representable and tested. | **live-pass** | Repo contract tests plus live `live13c-focal-test-20260922-03`: `execution_outcome=completed`, `artistic_outcome=unresolved`. |
| 13b.6 | Repeated unresolved work has a finite causal-retry path and explicit blocker outcome. | **repo-pass** | Bounded artistic-recovery policy tests same-strategy refusal, causal change and exhausted dependency/blocker outcome. |
| 13b.7 | Preparation setters, profile upgrades and degraded preview evidence each have one finite canonical transition with no visual-debt/legacy-closure detour. | **live-pass** | run-02 supplies real setter `not-applied/applied` and profile upgrade; degraded comparison transition is repo-tested on the compact closure path. Focused UXP receipt tests and the integrated 13a.1B regression now also prove lost-response brush setter recovery without a second setter dispatch. |
| 13b.8 | No maintained prompt/example advertises a removed field, stage, transport or tool sequence. | **repo-pass** | Compact-v2 structural verifier and current painting-policy verifier pass; legacy references are labelled historical/compatibility rather than a production recipe. |
| 13b.9 | Deletion manifest distinguishes compatibility code from still-required capabilities. | **repo-pass** | `compact-v2-contract-audit.md` deletion manifest separates removable controller/provider compatibility from bounded retained catalog capabilities. |
| 13b.10 | Unresolved ownership/reachability questions block deletion rather than being guessed. | **repo-pass** | Required compact-native ownership is now explicit and production legacy reachability is retired centrally. Historical source/fixtures may remain for evidence, while unmigrated public catalog names fail closed; no unresolved ownership question is silently guessed into a fallback path. |
| 13c.1 | Repository acceptance rejects old payload/state/bridge revisions while preserving pinning, idempotency, uncertain-outcome recovery, preview identity and transactional closure. | **repo-pass** | Current compact rejection, runtime-state, UXP receipt/revision, preview provenance and closure rollback suites are green. |
| 13c.2 | Live foundation pass -> observation+next-pass continuation -> actually dispatched multi-shape block-in -> delivered preview. | **live-pass** | Current run-01 provides the bounded compact live sequence; repository rainy-street regression independently covers the exact 14-region contour. |
| 13c.3 | Former 5071 trap: configuration setter has authoritative readback. | **live-pass** | run-02 op03 records `not-applied` with requested/effective mismatch; op05 records authoritative `applied` readback. |
| 13c.4 | Former 5071 trap: requested profile upgrade happens in place. | **live-pass** | run-02 durable state records `simple_graphic -> nontrivial_painting` on the same run and then executes a nontrivial pass. |
| 13c.5 | Former 5071 trap: one visual pass has canonical comparable previews. | **live-pass** | run-02 op06 has bound BEFORE/AFTER evidence and `comparison_metric.status=available`. |
| 13c.6 | Compact closure succeeds when a comparison metric is deliberately made unavailable. | **live-pass** | Disposable compact operation `cmp-unavail-14b` captured BEFORE at 400×300 and AFTER at 800×600 on pinned document 73, then closed through the compact facade with `execution_outcome=completed`, `artistic_outcome=resolved`, and `comparison_metric.status=unavailable` because output geometry differed. No legacy report/ack/verdict provider was used. |
| 13c.7 | Live final gate has no legacy Guard/provider detour, no cross-backend replay after dispatch/uncertainty, zero deterministic schema retry/source-schema reads and no general status/Art Director/value-analysis detour. | **live-pending** | Historical run-04 remains evidence for the compact Guard flow, but current acceptance must be repeated against the post-P1/P2/P3 architecture. Pre-dispatch fallback is now an intentional backend policy and is not itself a violation; any fallback after UXP dispatch/claim/uncertainty is a failure. |
| 13c.8 | Live acceptance includes one technically completed but artistically unresolved fixture and one genuinely resolved fixture, neither inferred from tool success alone. | **live-pass** | `live13c-focal-test-20260922-03` is completed+unresolved; foundation/block-in/focal-resolve operations record completed+resolved through explicit observations/verdicts. This proves state semantics, not human artistic calibration. |

## Tasks 14–21

| ID | Literal acceptance requirement | Status | Current evidence / remaining gate |
|---|---|---|---|
| 14.1 | Declared method matches actual executed tool. | **repo-pass** | Artistic-operation contract binds method to concrete primitives. |
| 14.2 | Mandatory preparation/state is verified before mutation. | **repo-pass** | Preparation provenance/effective-state tests. |
| 14.3 | Unsupported methods fail closed or choose explicit capability fallback. | **repo-pass** | Method-palette + artistic-operation fallback tests. |
| 14.4 | Curves/masks/blend/transform can execute under active Art Director directives. | **repo-pass** | Unified artistic-operation directive coverage. |
| 14.5 | No hidden dependence on stale Photoshop brush/tool state. | **repo-pass** | Stale effective brush preparation is rejected. |
| 15.1 | At least three style-contract fields demonstrably alter task/method/critic behavior. | **repo-pass** | Current style-runtime + method-palette tests cover edge policy, marks/layer bias, detail/color/finish and actual method planning. The earlier audit's method-wiring gap is closed. |
| 15.2 | Irrelevant fields do not add local-loop ceremony. | **repo-pass** | Unknown/irrelevant style evidence produces no method-selection traits/local projection. |
| 15.3 | Whole-image review detects explicit style drift despite technically sound structure. | **repo-pass** | Style-drift review regression. It remains advisory until critic authority is calibrated. |
| 15a.1 | Existing samples are described by actual coverage. | **repo-pass** | Brush-method evidence records visible gaps/bristles/taper without inventing cause. |
| 15a.2 | Method selection cites relevant evidence. | **repo-pass** | Method evidence/provenance selection tests. |
| 15a.3 | Invalidation is tested. | **repo-pass** | Explicit observed mismatch invalidates trusted evidence. |
| 15a.4 | Healthy continuation adds no routine probe round-trip. | **repo-pass** | Reuse path/probe-call contract is covered; preparation cache handles stable facts. |
| 15b.1 | Transform round-trips and crop mapping have unit coverage. | **repo-pass** | `spatial-support.test.ts`. |
| 15b.2 | Raster evidence checks placement independently of command metadata. | **live-pass** | Unit check plus the current run-01 exact live-placement evidence. |
| 15b.3 | Relation preservation is tested. | **repo-pass** | Spatial-support relation tests. |
| 15b.4 | Uncertainty survives continuation. | **repo-pass** | Unknown placement/relation remains uncertain rather than certified. |
| 15c.1 | Bounded reference/3D comparison demonstrates structural preservation and useful quality/throughput gain. | **exploratory-non-gate** | Roadmap explicitly defines this as optional exploratory support; no comparison is required to accept the canonical lane. |
| 15c.2 | Report remaining model/review errors; do not infer artistic mastery from a correct render. | **exploratory-non-gate** | Applies only when that optional experiment is performed. |
| 15d.1 | Compare before/after at whole-frame and local scales. | **live-pass** | Disposable document 73 now has a real bounded editable-atmosphere run. `technical-evidence.json` verifies exact registered whole-frame BEFORE/AFTER SHAs and derives fixed upper/lower local crops from those exact frames with raw-RGB hashes and mean-color evidence. |
| 15d.2 | Verify editable separation and preservation of structure. | **live-pass** | The live run keeps Background and `Atmosphere Veil` as separate layers, applies Soft Light + ~55% opacity, auto-creates a layer mask and draws the gradient on that mask. Photoshop history records `New Layer`, `Blending Change`, `Master Opacity Change`, `Add Layer Mask`, `Draw classic gradient on mask`; canvas geometry remains 800×600. |
| 15d.3 | Demonstrate material/atmosphere improvement rather than merely increased texture. | **human-required** | Requires visual judgment after the representative live scenario. |
| 15d.4 | Technical execution checks and artistic judgments remain separate. | **repo-pass** | Independent execution/artistic outcomes already enforce this separation. |
| 16.1 | Common local passes need one primary guarded execution cycle, not several orchestration calls. | **repo-pass** | Compact cycle + VisualMicroPlan semantic bundle coverage. |
| 16.2 | Batching does not weaken preview/verdict/rollback boundaries. | **repo-pass** | Multi-mutation plan produces one final authoritative barrier; incompatible/risky work is rejected/split. |
| 16.3 | Bundle size follows measured latency/risk rather than minimizing call count. | **repo-pass** | Bundle rules plus measured latency benchmark explicitly encode this choice. |
| 17.1 | Ordinary bounded Painter continuation requires no fresh whole-image Art Director critique. | **repo-pass** | Local check applicability and Planner cadence tests. |
| 17.2 | Global checks still run at cadence/stage/risky/global/final boundaries. | **repo-pass** | Boundary whole-image-glance/stage policy tests. |
| 17.3 | Artistic state does not multiply host/tool round trips per local pass. | **repo-pass** | Applicability resolver reports zero added host calls; preparation cache removes stable prep calls. |
| 17a.1 | Representative local/global replay omits irrelevant gates, preserves protections, never promotes unresolved goals, adds no mandatory host round trips and reports semantic-cycle latency. | **repo-pass** | `pass-check-applicability.test.ts` plus benchmark telemetry. |
| 17b.1 | Repeated disagreement, false alarms, independent continuation, blocked dependency and diagnostics remain bounded without fabricated success or relaxed safety. | **repo-pass** | `artistic-recovery-policy.test.ts`. |
| 18.1 | Normal continuation prompt/context is materially smaller. | **repo-pass** | Stage-policy test measures active context below 65% of eager all-stage projection; policy verifier passes. |
| 18.2 | Omitted modules cannot silently remove required safety invariants. | **repo-pass** | Always-on invariant kernel tests. |
| 18.3 | Stage switch deterministically activates the needed module. | **repo-pass** | Stage mapping tests including unknown-stage fail-closed. |
| 18.4 | Restart reconstructs the same active module set from durable state. | **repo-pass** | Byte-identical restart reconstruction test. |
| 19.1 | Repeated local passes do not re-query unchanged preparation. | **repo-pass** | Preparation-cache repeat case reduces preparation-host-call proxy from 2 to 0. |
| 19.2 | Stale Photoshop state cannot be trusted merely because it is cached. | **repo-pass** | Preset/document/layer/reconciliation invalidation coverage. |
| 19.3 | Cache hit/miss/invalidation reasons are observable. | **repo-pass** | Diagnostic events asserted in cache tests. |
| 19.4 | Measured cycle latency improves before cache is expanded further. | **live-pass** | Literal compact-v2 live VisualMicroPlan A/B is now recorded in `task19-cache-live-vmp-evidence.json`: three cold/warm pairs on disposable document 73 use three distinct restarted plugin-child PIDs. Every cold pass records `miss_empty` and one preparation host call; every warm pass records `hit` and zero preparation host calls with stable layer provenance `3`. Median Photoshop dispatch wall is 366→322 ms. Guard-preflight (147→220 ms), Guard total (1004→1101 ms) and semantic wall (13525→22606 ms) did **not** improve in this small noisy live sample, so no blanket latency-speedup claim is made. The acceptance is satisfied at the cache-expansion decision level: the cache demonstrably eliminates redundant preparation calls, while end-to-end timing is honestly dominated by other runtime/host gaps and therefore gives no basis to expand caching more aggressively. |
| 20.1 | Fixed/reference composition avoids unnecessary branching. | **repo-pass** | Fixed mode forbids branch ceremony; constrained skips alternatives absent a material unresolved choice. |
| 20.2 | Free scenes cannot commit immediately to one arbitrary arrangement. | **repo-pass** | Free mode requires at least two cheap hypotheses and explicit selection reason. |
| 20.3 | Exploration remains cheap relative to full painting. | **repo-pass** | Exploration is controller data and produces zero Photoshop operation records. |
| 21.1 | “Previous was stronger” cannot be recorded and ignored. | **live-pass** | Repo completion gate blocks stronger-previous; live op06 -> op07b -> op08 performed an actual guarded UXP restore. |
| 21.2 | Restored/anchor state is real and hash/path-backed. | **live-pass** | op08 restored the exact op06 SHA and has durable frame/path evidence. |
| 21.3 | A more detailed/weaker current version cannot silently become final. | **live-pass** | Repo gate blocks it; live deliberately degraded intermediate op07b was restored instead of retained. Whether a real artwork is artistically “weaker” remains a human judgment; the machine restore/final-selection behavior itself is proven. |

## Task 23 — Progressive form refinement / de-block-in

| ID | Literal acceptance requirement | Status | Current evidence / remaining gate |
|---|---|---|---|
| 23.A1–A2 | Early block-in still permits broad scaffold methods while late photoshop_paint_regions cannot substitute for rendering. | **repo-pass** | Existing stage-policy coverage remains green; Task 23 extends stage-exit evidence without reopening the early scaffold allowance or late-region prohibition. |
| 23.A3–A5 | DETAIL fails closed while lower-frequency refinement evidence is missing/unresolved; texture/detail-only progression cannot close form debt. | **repo-pass** | refinement_check is normalized into durable Art Director state and enforced by the existing plannerGate. Dedicated tests reject pending evidence, texture-only, secondary-form debt and residual-block-in uncertainty, and admit DETAIL only after a current-frame pass. |
| 23.A6 | Explicit stylized targets are not forced toward photoreal rendering. | **repo-pass** | style-not-applicable is accepted only when style_contract_basis.field/criterion exactly matches a relevant declared style-contract value; mismatch fails closed. Human false-positive behavior is still covered by 23.C. |
| 23.A7 | Implementation is subject-agnostic rather than horse/portrait/car/house specific. | **repo-pass** | The refinement contract uses six generic dimensions; a source regression test rejects subject-specific conditions for horse, face, hand, car, or house. |
| 23.A8 | Restart/resume restores the same durable refinement/stage state. | **repo-pass** | A SessionStore restart test reopens the same controller directory, observes equivalent refinement state and preserves DETAIL admission. |
| 23.A9 | Guard barriers, pinning, layer protection, VisualMicroPlan, backend-routing policy, recovery semantics and existing aliases do not regress. | **repo-pass** | Guard invariants remain unchanged under the UXP-first/pre-dispatch-fallback architecture; post-dispatch replay remains forbidden. Task-23 repository acceptance, TypeScript and painting/prompt verifiers passed on the recorded baseline. |
| 23.B | Controlled positive, texture-only, residual-geometry, overdetail and stylized representation-change cases distinguish real refinement from pseudo-refinement. | **human-required** | Machine fixtures prove contract/state mechanics for meaningful vs texture-only/debt/stylized cases. Perceptual truth is deliberately not inferred from mocks; the five-case blinded pack is defined in docs/painting-evaluation-suite.md. |
| 23.C | Blinded human evaluator labels the exact BEFORE/AFTER cases with the predeclared Task-23 questions. | **human-required** | Evaluation protocol is written. No human labels have been fabricated or inferred from producer self-review. |
| 23.D | Real disposable Photoshop run demonstrates block-in → major/secondary form → edge/material → final progression through the new canonical flow. | **live-pass** | Disposable document 1526 ran end to end through Chat_On_Steroids_Plugins → dist/cos-plugin.js → embedded Guard → UXP. BLOCK-IN op `task23-live-blockin-20260922-b` (SHA `043661a7…`) had Value PASS + Refinement FAIL and DETAIL was rejected before dispatch with `refinement_debt_unresolved`. Final FORM_AND_LIGHT op `task23-live-form-finalize-20260923-b` (SHA `ee0ff107…`) received exact-frame Value PASS + Refinement PASS / meaningful representation change. DETAIL op `task23-live-detail-admitted-20260923-f` then executed successfully (SHA `ed2c41e0…`) with a matched subtle-local before/after focus envelope; both Planner tasks and the Art Director directive completed and a final layered PSD was saved. |
| 23.E | Cowboy failure class is covered generically: local/detail temptation cannot hide primitive large form, and a destructive late correction can preserve/restore a stronger coherent state. | **human-required** | Machine policy now blocks DETAIL on unresolved form/block-in debt and existing anchor/correction recovery mechanics remain green. The general perceptual control still requires the Task-23 human pack; no horse-specific rule was added. |

## Concrete remaining machine-actionable gaps

There is **no remaining machine-actionable or disposable-live gate for Task 23**. The production
implementation and 23.D real-Photoshop progression are complete. Human perceptual labels below must
still not be fabricated from tool success, synthetic fixtures or model self-review.

Task 10 is intentionally **not** in this machine-action list yet: its implementation is gated by Task 8's human validation criterion. Adding a mandatory relation-memory schema before that gate would violate the roadmap.

## Human gates

- **Task 23 progressive-refinement perception:** run the blinded positive/texture-only/residual-
  geometry/destructive-overdetail/stylized controls and record the predeclared human labels.
- **Task 8 / 8a critic calibration:** human-labelled held-out adjudication is required before granting artistic blocking/promotion authority.
- **Task 6 reliability/false-positive claim:** after the real preview/model critic path exists, held-out human reference labels are still required to establish improved detection reliability and acceptable false-positive behavior.
- **13a.1A isolated visible-inadequacy claim / 13a.1C calibrated critic claim:** inherit the Task 8a calibration gate; repository isolation mechanics do not establish perceptual reliability.
- **Task 11 unforeseen-regression detection:** boundary scheduling is deterministic, but actual visual detection belongs to calibrated critic/human evaluation.
- **Task 15d artistic gain:** after the technical compositing fixture exists, a human must judge whether material/depth/atmosphere improved and structure remained visually convincing.
- **Task 21 artistic preference:** the technical restore is live-proven; using the scenario as evidence that one real artwork is artistically stronger/weaker still requires human visual judgment.

No human calibration or artistic-quality conclusion is claimed by this matrix.
