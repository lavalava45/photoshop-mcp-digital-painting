# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] — Digital Painting fork

### Added

- 2026-09-24: add deterministic multiscale Guard visual review with COMPOSITION / OBJECT / MICRO
  profiles on the canonical compact-v2 path. Whole-frame context remains mandatory; bounded passes
  prefetch exact source-document crops at the minimum justified scale; existing local/detail
  BEFORE/AFTER significance evidence is preserved. Optional structured `review_findings` can now
  trigger bounded read-only crop escalation for the **same** pending operation without replaying the
  artistic mutation or dispatching the next pass. Requested/effective regions, pinned document id,
  bound whole-frame SHA and crop SHA/path are durable across status/resume; wrong-document, stale-SHA
  and changed-region evidence fail closed. Capability reporting marks `review_findings` as additive
  to `photoshop.guard.compact.v2`. Focused resolver/coordinate/state tests plus the embedded Guard
  integration prove same-operation escalation, max-two crop fan-out, deterministic dedupe/priority,
  zero extra mutation dispatch during escalation and closure only after the enriched evidence is
  observed. Real Photoshop/CoS acceptance on 2026-09-24 also verified COMPOSITION whole-frame-only
  review, bounded OBJECT crop delivery, same-operation MICRO escalation with pinned whole/crop SHA
  provenance, and no second Photoshop history step during read-only evidence enrichment.

- Add Task 23 progressive form refinement / de-block-in as a durable, subject-agnostic stage-exit
  contract in the existing Art Director/Guard state. refinement_check records exact current-frame
  evidence for major-form modelling, secondary forms, edge hierarchy, material/light response,
  selective detail and residual block-in plus a separate representation-change classification.
  DETAIL / MICRO_DETAIL now fail closed on missing/pending/failing refinement evidence;
  texture-only cannot masquerade as form completion, stale preview evidence is rejected, and a
  style-not-applicable escape requires an exact declared style-contract field/value instead of
  silently forcing flat/graphic work toward photorealism.
- Add a reproducible Task-23 human evaluation pack with positive-modelled-form,
  texture-only, residual-block-in, destructive-overdetail and stylized-flat controls. The pack
  predeclares eight perceptual questions and blinds the evaluator to tool logs, mark/layer counts,
  producer verdicts and expected answers; machine mechanics are explicitly kept separate from
  human artistic acceptance.

- Add non-destructive grayscale/value evidence and a real stage-aware value gate. `photoshop_analyze_value_structure` converts the existing preview to grayscale in Node and returns descriptive luminance evidence without scoring the artwork. Art Director `value_check` records large-value grouping, focal hierarchy, silhouette separation, local contrast budget and detail-before-form; DETAIL is blocked on failed/unobserved structure, with explicit justified `override` and `style-not-applicable` escape paths.

- Add executable boundary-level Edge Control. VisualMicroPlan `edges[]` supports `hard`, `firm`, `soft`, `lost`, and `broken` intents for explicit region pairs; mutation steps bind boundaries to real `method_id`s which are preflighted against the live method capability map with explicit fallback behavior. Guard verdicts require qualitative `edge_observations` for every declared boundary, so edge intent affects both execution and verification rather than remaining metadata.

- Add `photoshop_guard_art_director` and a durable two-level Art Director / Painter controller contract. Art Director reviews persist global assessment, priorities, bounded tasks and an adaptive review horizon; Painter VisualMicroPlans bind directive/task/scope/change domains and remain locally verified. Cadence, directive completion and event-driven serious-error/global-drift/likeness/unsafe-execution interrupts return control to Planner, while unapproved global-structure changes fail before Photoshop dispatch.

- Add `photoshop_get_painting_method_capabilities` and `photoshop_select_painting_method`, a read-only executable method palette derived from the live ToolRegistry. The contract routes `visual intent → impact class → method → registered runtime tool → fallback`, marks preset-dependent methods conditional, and records unsupported Clone Stamp, Mixer Brush and arbitrary radial paint/fill as unavailable rather than inventing APIs.

- Add an isolated digital-painting extension in `src/tools/painting-tools.ts`, integrated into the upstream server with only one import and one tool-registration call.
- Add `photoshop_list_brush_presets` with optional case-insensitive filtering and result limiting.
- Add `photoshop_select_brush_preset` for exact-name selection of installed Photoshop brush presets.
- Add `photoshop_get_brush_settings` and `photoshop_set_brush` for size, hardness, opacity, flow, spacing, angle, roundness, tip flips, pressure overrides, airbrush, and smoothing.
- Add `photoshop_set_foreground_color` for painting color control.
- Add `photoshop_sample_color` for pinned composite point sampling and optional local-average sampling via a temporary merged duplicate; returns RGB/8-bit RGB/HEX without modifying the source document or its Color Sampler markers.
- Add `photoshop_paint_strokes` for batched Brush/Pencil/Eraser/Smudge strokes, Bezier handles, closed paths, and Photoshop `simulatePressure`.
- Add per-stroke `color`, `size`, `opacity`, and `flow` overrides to `photoshop_paint_strokes`.
- Add interpolated `dynamics` profiles to `photoshop_paint_strokes` for size/opacity/flow changes along open strokes, with linear/ease-in/ease-out/ease-in-out interpolation and automatic segment-count selection.
- Add `AUTO`/`SINGLE_HISTORY` paint batching modes. `AUTO` proactively chunks expensive mixed batches before they hit the ExtendScript timeout; `SINGLE_HISTORY` keeps the legacy one-history-step behavior when that tradeoff is explicitly preferred.
- Allow one-point strokes as brush dabs/stamps; internally they are converted to a zero-length path stroke.
- Add `scripts/test-painting-tools.mjs` for live Photoshop validation.
- Add offline and live paint batching/dynamics regressions in `scripts/test-painting-batching.mjs` and `scripts/test-painting-batching-live.mjs`.
- Add `docs/digital-painting.md` for painting architecture and API documentation.
- Add `docs/digital-painting-agent-skill.md` and MCP guide prompt `ps.digital_painting_control` for iterative visual control, semantic passes, occlusion-aware drawing, cleanup, and state-based completion.
- Add `photoshop_measure_points`, `photoshop_add_guides`, `photoshop_list_guides`, and `photoshop_clear_guides` for explicit reference/proportion measurement and Photoshop guide control.
- Add `photoshop_transform_landmarks` and `photoshop_compare_landmarks` for reusable semantic-frame landmark transfer and normalized reference-vs-candidate error reporting without automatic landmark detection.
- Add `scripts/test-measurement-tools.mjs` for live measurement/guide smoke testing.
- Add `scripts/test-landmark-ergonomics.mjs` for Photoshop-independent landmark transform/compare regression coverage.
- Add offline and two-document live regressions for document targeting in `scripts/test-document-targeting.mjs` and `scripts/test-document-targeting-live.mjs`.
- Add offline and live color-sampling regressions in `scripts/test-color-sampling.mjs` and `scripts/test-color-sampling-live.mjs`.
- Add `photoshop_sample_colors` for batched visible-composite point sampling from a pinned reference document.
- Add `photoshop_paint_dabs` for grouped/chunked high-volume brush dabs without one MCP call per mark.
- Add `photoshop_execute_visual_microplan`: one MCP round-trip may now contain bounded preparation/read/configuration steps, exactly one approved visual mutation, and its mandatory preview. A per-document preview SHA/verdict gate prevents the next micro-plan from running before the returned frame is visually classified.
- Add VisualMicroPlan validation/regression tests for one-mutation enforcement, preview placement, brush-settings verification after preset selection, backward-only `$steps.*` result references, pinned document propagation, mutation-error preview reconciliation, and cross-plan preview-verdict blocking.
- Add multiscale preview observation: `photoshop_get_preview` may return a document-space `focus_region`, and VisualMicroPlan may capture one read-only before preview immediately before its single mutation plus the mandatory after preview.
- Add structured visual critique fields (`observed_change`, `target_resolved`, `regressions`, `uncertainty`) to the preview barrier contract and durable controller verdicts.
- Add a compact durable controller `painting-state.json` mirror with current/accepted frame, active problem/hypothesis and last structured critique, linked to operation ids.
- Add paint-dab execution telemetry for ordered style runs, unique styles, planned internal batches, affected center bounds and measured per-batch duration.
- Add `docs/painting-evaluation-suite.md` with sphere, cube/building, still-life, portrait and holdout-transfer exercises under fixed execution budgets.
- Add the embedded 13-tool `photoshop_guard_*` surface and dedicated `dist/cos-plugin.js` required-mode entry for Chat On Steroids, with durable operation receipts, exact acknowledgements, preview/verdict barriers, checkpoints, recovery, and in-process async jobs.
- Add durable continuation recovery data to Guard status/resume: after a lost completed async poll result, callers can recover the exact pending receipt token plus pending visual preview SHA/path without replaying the mutation.
- Add `silent_stall` continuation monitoring: known-next-step visual workflows are reported after roughly 90 seconds without semantic advancement; pending closure obligations identify the phase and read-only diagnostic churn does not reset the timer.
- Add sticky technical/artistic/mixed commentary modes with independent short/normal/detailed verbosity and one-action overrides.

### Changed

- 2026-09-24: treat every successful guarded `photoshop_create_document` / `photoshop_open_image`
  bootstrap as a new Photoshop document incarnation even when Photoshop recycles a historical
  numeric `document_id`. Guard now clears stale document-scoped painting state and visual barriers,
  records a bootstrap-sequence boundary, and excludes pre-incarnation visual/checkpoint/trend history
  from the current document. This prevents a fresh document from inheriting an old immutable
  `process_dir`. The live regression reproduced Photoshop reusing `document_id=59` after restart:
  the old `run-01` binding was superseded, the new incarnation was recorded at sequence 241, and the
  same id then bound successfully to `run-05`. The acceptance suite remains green at 174/174; the
  bounded runtime trace observed zero Photoshop foreground transitions and no legacy helper process.
- 2026-09-23: repair the public compact Guard contract so schema, compiler, VisualMicroPlan
  validation and runtime agree. `request_key` now remains the unique idempotency identity of one
  attempt while public `problem_id` persists artistic-problem identity across later attempts;
  explicit `action_class=REPLACE|ERASE` makes protected-layer replacement expressible without
  weakening exact target protection. Brush preflight is derived from actual brush-dependent
  actions rather than a narrow region-only allowlist, normal local passes receive the same required
  BEFORE/AFTER focus evidence without pretending to be `subtle_local`, and bounded late-stage
  `paint_regions` is allowed only as an exact-target clipped REPLACE/ERASE correction. The earlier
  experimental `pass_type`/automatic split-plan layer was removed: executable limits are reported
  from the VisualMicroPlan contract instead of a duplicate caller classification.
- 2026-09-23: keep document bootstrap outside the artistic-method selector. `photoshop_create_document`
  and `photoshop_open_image` now ignore accidental `visual_intent` / `impact_class` /
  `preferred_method_id` metadata carried from a painting request instead of being misclassified as
  methods such as `region-block-in` and rejected before dispatch. Regression coverage reproduces
  the exact `GLOBAL_BLOCK_IN + mass + construct + region-block-in` create-document failure.
- 2026-09-23: harden painting-continuation liveness around read-only Guard checks. Closing a
  read-only compact operation without `next_pass` no longer marks an active painting workflow as
  stopped; pending Art Director review now outranks a stale lifecycle `ready` projection; and
  `continuation_watch` exposes `nonvisual_progress_stall` plus the visual-idle duration without
  allowing read-only churn to reset that clock. Regression coverage reproduces the exact
  visual-pass → cadence-review → read-only-check failure mode and the >90 s no-visual-progress
  watchdog case. Also remove committed literal `\\n` EOF artifacts from seven Guard/value source
  files that prevented TypeScript/Vitest from parsing the current HEAD.
- 2026-09-23: fix the canonical selection-state lane after live regression testing. UXP selection
  mutations now perform their post-mutation selection readback with modal-safe `batchPlay` options
  while already inside `executeAsModal`, preventing a successfully applied `Feather` from being
  misreported as `Photoshop is in a modal state`. `photoshop_expand_selection`,
  `photoshop_contract_selection`, and `photoshop_feather_selection` are now classified by Guard as
  preparation/selection-state mutations rather than rendered-pixel visual mutations, so exact
  selection geometry no longer creates false JPEG significance or visual-verdict debt. The mixed UXP
  DOM/`batchPlay` implementation remains intentional; no broad DOM → Action Manager rewrite was made.
- 2026-09-23: complete the P1/P2/P3 catalog **source migration** to the final backend contract. Normal migrated Photoshop tools now ask `PhotoshopBackendRouter` before dispatch, prefer UXP when ready, and may use the existing ExtendScript/COM implementation only when routing selects it **before any UXP dispatch**. Once a UXP command is dispatched, claimed, uncertain, or returns an error, cross-backend replay is forbidden. `photoshop_save_document` and `photoshop_neural_filter` remain intentionally UXP-only/fail-closed, and raw `photoshop_execute_script` remains retired from the production surface. Guard pinning, preview/verdict barriers, exact-outcome recovery and no-blind-replay invariants are unchanged. Repository/source migration is complete and the current rebuilt child/UXP companion revision has now been loaded and verified; the remaining gate is the final post-migration behavioral live acceptance run.
- Make progressive representation change, rather than tool substitution or mark/texture count, a
  required precondition for representational DETAIL progression. The implementation extends the
  canonical Art Director directive and plannerGate; it does not add a second controller, art-state
  tree, subject-specific anatomy subsystem or universal aesthetic score.
- Align `photoshop_analyze_value_structure` with the canonical Guard whole-frame preview contract
  (`max_dimension_px=1000`, JPEG quality 8) so exact-current-frame value evidence hashes the same
  bytes as the durable Guard frame instead of becoming stale solely because the analyzer recaptured
  the unchanged document at a different preview size/quality. Regression coverage now asserts the
  canonical analyzer capture arguments.

- Complete the compact-v2 painting-control migration: the normal public Guard path is now compact-only, legacy full-operation/standalone closure payloads are rejected rather than adapted, runtime state is versioned, and maintained acceptance no longer depends on the retired controller/daemon path.
- Make the canonical Photoshop production lane **UXP-first with bounded pre-dispatch fallback**. `PhotoshopBackendRouter` chooses the backend before dispatch: migrated catalog tools prefer the current UXP bridge and may use their retained ExtendScript/COM implementation only when UXP is unavailable before dispatch. A UXP command is never replayed through another backend after dispatch, claim, uncertainty or failure. Persistence (`photoshop_save_document`) and neural-filter execution remain intentionally UXP-only/fail-closed.
- Complete the artistic-state split between technical execution, local artistic outcome and global brief outcome. Local repairs no longer imply whole-image improvement, and explicit hash/path-backed artistic anchors survive restart/resume and can be retained, promoted, compared or restored.
- Complete the machine implementation of the object-agnostic World Consistency Critic and isolated critic evaluation harness. The critic uses one prompt-aware relation vocabulary, preserves uncertainty, binds evaluation to exact registered preview evidence and remains advisory until human-held-out calibration grants narrower authority.
- Complete the recovery/state-machine audit for the compact native route, including exact-outcome UXP recovery, bounded uncertain/reconcile paths, transactional closure rollback, stalled/orphan job handling and finite causal artistic retry without blind mutation replay.
- Replace repeated Guard status/finalization projection scans with a request-local projection context. On the preserved large controller-state benchmark, `statusCompact()` fell from 27.245 s to 0.595 s while producing equivalent projected state.
- Complete the representative painting-cycle latency benchmark and use measured semantic-cycle components rather than raw tool-call counts to guide optimization. The dominant observed interval in representative VisualMicroPlan runs is the unattributed host/model/visual-evaluation gap, not Photoshop dispatch alone.
- Complete the unified artistic-operation/method contract, upstream `style_contract` wiring, reusable brush/method evidence, spatial-support transforms and provenance, semantic VisualMicroPlan bundling, per-pass/global-gate separation, bounded artistic recovery and stage-scoped policy loading.
- Complete dependency-bound preparation caching with observable hit/miss/invalidation reasons. Live cold/warm A/B evidence confirms redundant preparation calls are removed, while the small sample does not support a blanket end-to-end latency-speedup claim or more aggressive caching.
- Complete the machine-side composition-freedom policy and final-anchor restore mechanics: fixed/reference work avoids unnecessary branching, free composition requires cheap alternative hypotheses, and a guarded live restore reproduced the exact prior anchor SHA before finalization.
- Complete the technical compositing/mask acceptance fixture with editable layer separation, blend/opacity/mask operations and exact whole-frame/local BEFORE/AFTER evidence. Whether the result is artistically stronger remains a human visual judgment rather than a tool-success claim.
- Keep compact relational artistic memory conditional rather than mandatory: Task 10 is intentionally not implemented until the Task 8/8a human experiment demonstrates measurable decision-quality gain.

- Integrate executable stable-layer protection into the canonical painting policy: accepted isolated features now carry their stable ids forward through `protected_layer_ids`; `protected_regions` is explicitly descriptive-only, and intentional protected-layer replacement requires `REPLACE`/`ERASE` plus the exact `replace_protected_layer_ids` exception.
- Define fail-closed recovery for mandatory PSD checkpoints when the UXP bridge is unavailable: `photoshop_save_document` intentionally has no COM/ExtendScript fallback, no next visual mutation proceeds while persistence is blocked, and recovery retries only the checkpoint save after bridge readiness without replaying prior paint work.
- Remove the machine-specific repository path from the canonical painting skill and synchronize the current compact-only native surface to 145 tools / 11 public Guard tools; older development measurements remain historical snapshots rather than current catalog counts.
- Fix `photoshop_image_stack` ExtendScript path serialization: emit one flat array of `jsStringLiteral` values instead of wrapping `JSON.stringify(jsString(...))`, eliminating both the accidental nested `[[...]]` array and double-escaped Windows backslashes while preserving non-ASCII `\\uXXXX` protection.
- Make embedded Guard async-job reservation atomic across MCP/Node processes. `startJob()` now holds the existing controller `wx` lock across `activeJobs()` + durable job creation, and synchronous `cycle()` performs its competing-job check under the same lock, preventing duplicate `{ state: "starting" }` jobs from a check-then-act race.
- Expand VisualMicroPlan `method_class` from generic paint/fill/rollback to fail-closed executable painting mechanisms: `line`, `region`, `smudge`, `erase`, and `preset-brush` join `paint`, `fill`, and `rollback`. Pencil/Smudge/Eraser modes, region painting, and explicit preset selection must match the declared method class.
- Add rollback-semantic logical layers to VisualMicroPlan: `create-new`, `continue-logical-layer`, `temporary-hypothesis`, `keep`, `adjust`, `discard`, and `merge` are explicit decisions tied to stable artistic `hypothesis_id` metadata. New logical layers are limited to one per micro-plan and all mutations must target that rollback unit; continue/adjust reject redundant layer creation. Exact-id layer discard and exact adjacent merge-down paths prevent unrelated accepted edits from being destroyed.
- VisualMicroPlan now treats one semantic correction, not one primitive Photoshop mutation, as the verification unit: 1–4 contiguous compatible visual operations may run between one optional BEFORE preview and one mandatory AFTER preview when they share intent, region, method class, and bounded risk. `subtle_local` keeps matching >=800 px local evidence, and the hard preview/verdict barrier still spans the whole transaction.
- Route `photoshop_save_document` through the UXP companion only, using `asCopy=true` and explicit before/after invariants for active document, working path, active layers, active tool, and selection. COM/ExtendScript save fallback is intentionally disabled so persistence fails closed instead of stealing foreground focus.
- The live-tested Photoshop 2026 UXP runtime rejects narrowed loopback HTTP entries for the bridge with `Manifest entry not found`; the companion manifest temporarily uses `requiredPermissions.network.domains: "all"` while the Node bridge continues to bind only to `127.0.0.1`. Manifest permission changes require UDT **Unload → Load**.
- Replace the UXP bridge's fixed 400 ms command polling plus 250 ms result polling with a localhost long-poll and exact per-command result waiters. The Photoshop plugin now keeps one `/poll` request open and receives queued commands immediately; failed-server retry backoff remains bounded.
- Document and live-verify the supported development restart boundary: after rebuilding `dist/cos-plugin.js`, restart only **Chat On Steroids app → Plugins → Photoshop MCP Digital Painting Fork → … → Restart**. ChatGPT Plugins Refresh is schema refresh, not a guaranteed child-process restart. UXP `main.js` changes use Adobe UXP Developer Tool **Reload**; manifest changes use **Unload → Load**. Whole-CoS restart and obsolete restart-helper scripts are not part of the normal workflow.
- On Windows, Photoshop execution is now background-safe by default: the COM transport attaches to an already-running Photoshop instance with `GetObject` instead of calling `CreateObject("Photoshop.Application")` for every script request. Because live verification showed that Photoshop can still foreground itself from inside `DoJavaScript`, default-mode calls now run with a short-lived Win32 foreground guard that restores the user's most recent non-Photoshop window when Photoshop raises itself without an explicit user switch gesture. Automatic Photoshop launch / UI activation and the foreground guard opt-out both require `PHOTOSHOP_MCP_ALLOW_UI_ACTIVATION=1`. Regression coverage verifies the default wrapper and guard contracts.
- Brush-setting updates now preserve the full active Photoshop Brush Tool descriptor and modify only requested fields, avoiding accidental loss of complex preset dynamics/settings.
- Painting batches cache the active Brush Tool descriptors and avoid redundant descriptor reads/writes for unchanged per-stroke overrides.
- Painting completion guidance now treats stroke counts as soft planning budgets by default; visual Definition of Done is the normal stopping criterion unless the user explicitly requests a hard cap.
- Strengthen the hard user-visible report barrier: internal commentary/progress/page-tool summaries do not count as delivery; after a completed external call the next external call remains blocked until a materialized user-visible assistant update exists. Hosts that cannot guarantee that delivery must fail closed and continue in a later turn.
- Painting-skill evaluation now has a fresh-composition rule: prior demo coordinates, stroke lists, object proportions and precomputed object-specific occlusion geometry must not be reused unless the user explicitly asks for a variation/refinement.
- Add release-oriented installation documentation for clean GitHub clone/ZIP installs, Chat On Steroids Core/direct-stdio and generic MCP host configuration, verification, updating, and a release checklist.
- Make the live-accepted Chat On Steroids Plugins route (`dist/cos-plugin.js` → embedded Guard) canonical for ordinary Photoshop work. Retain Core + `photoshop-session.mjs` + the persistent daemon only for dev/debug/recovery compatibility and legacy regression/live-test coverage.
- Painting guidance now supports explicit measurement checkpoints for portraits, architecture, perspective, and other proportion-sensitive work; supplied landmark coordinates remain visually chosen rather than automatically detected.
- Photoshop/COS execution is now sticky in the digital-painting control contract: short continuation turns cannot silently reroute an established Photoshop workflow to external image generation.
- Harden optional `document_id` targeting across document-bound tools: ids must be positive integers, unknown ids fail closed, successful pinned calls expose `document_target`, and pinned calls no longer auto-switch the active Photoshop document. If the requested document is open but not already active, execution fails closed instead of changing the user's tab; regression coverage enforces this for ExtendScript and the UXP preflight path.
- Separate fork identity from upstream branding/distribution across README, translated docs, package/server/MCPB metadata, client examples, web/site surfaces, and release tooling. The fork is source-distributed from `lavalava45/photoshop-mcp-digital-painting`; upstream `photoshop-mcp.com`, `@alisaitteke/photoshop-mcp`, and `io.github.alisaitteke/photoshop-mcp` are now explicitly labeled as upstream-only rather than fork distribution channels.
- Disable inherited upstream analytics by default in the fork by removing the embedded upstream Rybbit site id; analytics now require an explicit fork-owned `RYBBIT_SITE_ID` configuration.
- Remove inherited upstream publishing/sponsorship/directory machinery from the fork (`npm`/MCP Registry GitHub Actions, upstream Funding/Glama metadata, upstream release-note publishing scripts). Replace inherited translated upstream READMEs with short fork-safe archive notices pointing to the canonical fork README/INSTALL instead of executable upstream install commands.
- Digital-painting transport guidance now prefers VisualMicroPlan when it can safely collapse setup/read calls around one atomic visual bundle; the hard preview barrier remains mandatory and mutation errors are reconciled by preview rather than blind retry.
- Preserve `photoshop_paint_dabs` caller order: batching now collapses only adjacent compatible dabs instead of globally regrouping equal styles, preventing compositing changes such as red → blue → red becoming red → red → blue.
- Treat brush stages as priority bands rather than a rigid one-way staircase, allow broad directional strokes for surfaces/form when their footprint is appropriate, and remove the former 100+ frame-count target from evaluation guidance.
- Reuse the authoritative post-selection settings returned by `photoshop_select_brush_preset`; an immediate duplicate `photoshop_get_brush_settings` is no longer mandatory when brush state has not changed.
- Scope the controller's three-non-improving-attempt replan gate to the same explicit `problem_id` instead of the last three unrelated visual operations.
- Separate non-trivial scenes by expected independent correction: background/support, cast shadow and major movable/repaintable objects should remain independently editable instead of sharing one convenience raster layer.
- Require an independent scene-relationship audit after global/shape/form work and at stage/final gates, covering support/contact, unintended gaps/floating, cast-shadow relation, occlusion/depth, tangencies/intersections and silhouette/proportion.
- Restrict `trend_signals` to recurring negative defects/symptoms; stable or successful features are no longer valid trend labels.

### Validation

- 2026-09-23 selection-path regression: focused tests passed **42/42** after the fix. After rebuilding
  `dist/cos-plugin.js`, restarting only the Photoshop MCP child, and reloading only the Photoshop UXP
  companion, a disposable Photoshop 2026 document completed `expand_selection(20)` with bounds
  `80,80–320,320`, `contract_selection(10)` with bounds `90,90–310,310`, and
  `feather_selection(8)` without the former post-mutation modal-state failure. All three Guard records
  completed with `visual=false`, no preview/verdict debt, and final Guard status had no pending
  reports/acks, uncertain operations, visual verdicts, or active jobs. A 12 s / 5 ms Win32 monitor
  beginning with Word in foreground observed zero Photoshop foreground transitions and zero legacy
  helper processes during the covered initial portion of the smoke; this narrow trace does **not**
  replace the still-pending full P0-0 post-migration no-focus behavioral acceptance.
- Live-tested on Photoshop 2026 for Windows.
- Enumerated 123 installed brush presets through Photoshop `presetManager` during the 2026-09-14 test.
- Verified exact selection of `Hard Round Pressure Size`.
- Verified write/readback of pressure-size, pressure-opacity, airbrush, and smoothing settings.
- Verified batched straight, pressure-simulated, and Bezier strokes.
- Verified textured `Square Charcoal` painting and pressure tapering.
- Verified per-stroke color/size/opacity/flow overrides and one-point dabs.
- Validated the painting primitives with iterative artistic tests in Photoshop.
- Mixer Brush path stroking is not yet considered supported: a direct Action Manager `stroke` attempt using `wetBrushTool` returned an invalid-parameters Photoshop error.
- Verified a 24-stroke heterogeneous pass through `AUTO` batching (6 internal batches) and a 32-segment Bezier taper through dynamics (8 internal batches) on Photoshop 2026 without per-script timeout.
- Verified RGB per-stroke overrides remain intact while descriptor caching is active.
- Verified document targeting with two simultaneously open temporary documents: while document B was active, pinned layer creation and guide mutation affected only document A, and pinned close closed A while leaving B open (`DOCUMENT_TARGETING_LIVE_TEST_OK`).
- Verified `photoshop_sample_color` on Photoshop 2026 with two temporary documents: pinned point samples returned the intended document's composite color, radius-based Average sampling returned the same known uniform color, source documents were unchanged, and out-of-bounds coordinates failed closed (`COLOR_SAMPLING_LIVE_TEST_OK`).
- Verified the current source catalog at 145 tools (129 atomic/non-recipe + 16 recipes); the maintained public Guard surface is compact-only.
- Current regression baseline after the 2026-09-23 selection-path fix: `npm run test:unit`
  **585/585 PASS**, `npm run test:acceptance` **160/160 PASS**, `npx tsc --noEmit` PASS,
  `npm run verify:painting-policy` PASS (kernel=12999, prompt=17995),
  `npm run verify:photoshop-prompts` PASS, and `npm run build:server` PASS.
- Task-23 targeted mechanics include exact-current-frame/stale-evidence checks, texture-only and
  residual-form-debt rejection, explicit stylized control, fail-closed DETAIL admission,
  restart/resume persistence and a generic-implementation check forbidding subject-specific
  horse/face/hand/car/house conditions.
- Task-23 disposable live acceptance now passes end to end through
  `Chat_On_Steroids_Plugins → dist/cos-plugin.js → embedded Guard → UXP Photoshop` on document 1526.
  The exact flat BLOCK-IN frame (`task23-live-blockin-20260922-b`, SHA `043661a7…`) had Value PASS
  but Refinement FAIL; an attempted DETAIL operation was rejected before Photoshop dispatch with
  `refinement_debt_unresolved`, `next_operation_dispatched=false`, and
  `visual_mutation_started=false`. After real FORM_AND_LIGHT modelling, the exact current form frame
  (`task23-live-form-finalize-20260923-b`, SHA `ee0ff107…`) received exact-frame Value PASS plus
  `refinement_check=pass` / `representation_change=meaningful`. The subsequent DETAIL pass
  (`task23-live-detail-admitted-20260923-f`, SHA `ed2c41e0…`) executed successfully with a matching
  before/after focus envelope and a meaningful `subtle_local` delta while preserving the resolved
  silhouette and major value/light structure. Both Planner tasks completed and Art Director status
  is `completed`; final layered evidence is saved as
  `processes/task23-progressive-refinement-process/run-01/task23-progressive-refinement-final.psd`.
- The same live run exposed and fixed an exact-evidence bug: value analysis had been recapturing the
  unchanged document with a different JPEG size/quality, so its `source_preview_sha256` could not
  equal the durable current-frame SHA. After the canonical-preview fix and CoS child restart, the
  analyzer source SHA matched the Guard frame exactly. A Smart Blur attempt also confirmed the
  retained catalog capability is unavailable on the UXP-only production lane; recovery preserved the
  unchanged frame and the acceptance run continued with executable brush methods instead.
- `npm run build:server` and `npm run lint` pass for the current painting branch.
- Historical native Chat On Steroids/Photoshop acceptance passed for the then-current 148-tool / 13-Guard-tool catalog, `guard_required` raw-mutation gating, direct reads, guarded mutation + materialized preview + verdict closure, async jobs, restart/resume/reconcile and no-blind-replay behavior. It remains supporting evidence, not the final acceptance of the 2026-09-23 P1/P2/P3 backend migration.
- Verified the UXP long-poll transport live on Photoshop 2026 for Windows. A 30-call read-only `batchPlay` diagnostic measured 9 ms median / 11 ms p95 full bridge round-trip with the Photoshop action itself at 0–1 ms; the comparable current COM/ExtendScript read-only micro-call measured ~540 ms median. This is a transport microbenchmark, not a claim that real painting is 60× faster. A 5 ms foreground monitor observed zero Photoshop foreground transitions during the UXP run.
- Verified local development can reload the rebuilt CoS server by restarting only the installed Photoshop MCP custom plugin, producing a new `dist/cos-plugin.js` child PID without restarting the Chat On Steroids application.
- 2026-09-23 post-migration cutover preflight: the rebuilt Photoshop MCP child is PID `10772` (started `2026-09-23T07:15:39.5184010Z`) and is running `dist/cos-plugin.js` SHA-256 `9023114D837A4307EBBE81D280226E1A6AD8F02DFAB35E4EC12208C0F8118801` from repository HEAD `67c0c00a94e071520532692fdbe95b3b535ddb80`. Live `photoshop_ping` reports `connected=true`, `ready=true`, `transport=uxp`, long-poll bridge revision `compact-v2-20260923-full`, exact revision match, and Guard reports no pending reports/acks, uncertain operations, visual verdicts, or active jobs. This closes the loaded-build/revision preflight only; representative post-P1/P2/P3 behavioral acceptance is still pending.
- Live-accepted UXP `photoshop_save_document` on a disposable Photoshop document: PSD copy was written through `transport=uxp` with `as_copy=true`, all persistence invariants true, and a PID-based 10 ms foreground watcher observed zero Photoshop foreground hits during the save.
- Session-controller regression coverage now includes 34 checks, including silent-stall detection and read-only-churn resistance.
- Historical compact-v2 live acceptance on 2026-09-22 bound the then-current `dist/cos-plugin.js` child to the expected `compact-v2-20260922` UXP bridge revision, executed a real visual mutation, observed zero Photoshop foreground transitions and no COM/ExtendScript helper process, and left Guard with no pending reports, acknowledgements, uncertain operations, visual verdicts or active jobs. The 2026-09-23 rebuilt child/current companion revision cutover preflight now also passes; the remaining final live gate is behavioral coverage of the post-P1/P2/P3 architecture.
- Live acceptance also covers authoritative brush-setter `applied`/`not-applied` readback, in-place `simple_graphic -> nontrivial_painting` transition, canonical comparable previews, deliberately unavailable comparison geometry, exact-placement raster evidence, a real editable compositing fixture, and hash-exact guarded artistic-anchor restore.

### Pending

- Record the blinded Task-23 five-case perceptual labels. The machine implementation and disposable
  real-Photoshop stage-gate run are complete; perceptual truth is still intentionally not inferred
  from producer self-review. Status: **machine-complete / live-pass / human-gate-pending**.
- Investigate richer pressure representation beyond Photoshop's binary `simulatePressure` flag.

## [1.7.6] - 2026-09-09

[v1.7.5...HEAD](https://github.com/alisaitteke/photoshop-mcp/compare/v1.7.5...HEAD)

### Changed

- Update anonymous usage analytics for the MCP server, standalone UI, and marketing site ([#36](https://github.com/alisaitteke/photoshop-mcp/pull/36)).

## [1.7.5] - 2026-09-07

[v1.7.4...v1.7.5](https://github.com/alisaitteke/photoshop-mcp/compare/v1.7.4...v1.7.5)

### Fixes

- Map `photoshop_set_layer_blend_mode` `COLOR` to ExtendScript `BlendMode.COLORBLEND`; Darker/Lighter Color fall back to Action Manager ([#29](https://github.com/alisaitteke/photoshop-mcp/issues/29)).
- Fix `photoshop_apply_layer_style` drop shadow (and other styles) `putObject` class-id argument; Use Global Light is off so `angle` applies.
- Treat `photoshop_place_image` `x`/`y` as absolute canvas top-left, not an offset from centered Place.
- `photoshop_recipe_remove_background` falls back to Color Range on uniform/high-key studio backgrounds (`details.method`).
- Optional `document_id` on mutating tools pins edits to a document from `get_state` / `list_documents`; `document.id` is included in context.
- Drop shadow no longer sets a locale-specific "Linear" contour name; Color Range fallback writes both Lab min and max; `place_image` fails instead of silently skipping translate.
- Wrap generative `prompt` values in ExtendScript string literals (`jsStringLiteral`); non-ASCII is `\uXXXX`-escaped so multi-word prompts no longer break JSX syntax ([#31](https://github.com/alisaitteke/photoshop-mcp/issues/31)).
- Apply the detected Photoshop app name on macOS before the first ExtendScript run ([#32](https://github.com/alisaitteke/photoshop-mcp/pull/32)).

### Docs

- Simplify the README landing page, restore badges, and regenerate the hero image.
- Improve site SEO and AI-search readiness; point the marketing site at photoshop-mcp.com; serve trailing-slash doc URLs on GitHub Pages; link the footer to alisait.com and LinkedIn.

### Other

- Validate release tags and recover notes when a tag points at the wrong commit.

## [1.7.4] - 2026-08-29

[v1.7.3...f8ada83](https://github.com/alisaitteke/photoshop-mcp/compare/v1.7.3...f8ada83)

### Other

- Expand atomic tool surface to 118 tools and sync agent documentation. (`5a9d3cd`)

## [1.7.3] - 2026-08-25

[v1.7.2...v1.7.3](https://github.com/alisaitteke/photoshop-mcp/compare/v1.7.2...v1.7.3)

### Features

- feat(analytics): revert to PostHog-only and remove Mixpanel (`6041ea9`)

### Fixes

- fix(ci): install deps before MCP registry sync workflow (`d1af8e1`)

### Other

- ci: add MCP registry-only workflow and resilient npm publish (`6cfc560`)

### Version bumps

- 1.7.3 (`53c25b5`)

## [1.7.2] - 2026-08-25

[v1.7.1...v1.7.2](https://github.com/alisaitteke/photoshop-mcp/compare/v1.7.1...v1.7.2)

### Fixes

- fix(ci): defer PhotoshopConnection executor init to avoid Linux throw (`0f49d30`)

### Version bumps

- 1.7.2 (`38aa0ba`)

## [1.7.1] - 2026-08-25

[v1.7.0...v1.7.1](https://github.com/alisaitteke/photoshop-mcp/compare/v1.7.0...v1.7.1)

### Fixes

- fix(ci): align @eslint/js with eslint 9 for npm install (`f4bd3d4`)

### Version bumps

- 1.7.1 (`b9d3132`)

## [1.7.0] - 2026-08-25

[v1.6.1...v1.7.0](https://github.com/alisaitteke/photoshop-mcp/compare/v1.6.1...v1.7.0)

### Features

- feat(site): add llms.txt, AI discoverability, and full SEO meta layer (`cfccd5a`)
- feat(workflows): add GitHub Actions workflow for deploying marketing site to GitHub Pages feat(workflows): enhance release workflow to include npm publishing and MCP Registry publishing chore(gitignore): update .gitignore to exclude generated site content and build artifacts docs(CONTRIBUTING): update contributing guidelines to reflect new release and publishing processes (`1e56306`)

### Fixes

- fix(uxp): register bridge panel with manifestVersion 4 and correct entrypoint (`df70d46`)
- fix(site): use Photoshop MCP icon instead of recipe illustration as logo (`7a0710a`)
- fix(ci): commit site lockfile so Pages deploy can run npm ci (`bf5982f`)

### Other

- Add agent discoverability docs and fix MCP registry description sync. (`a1f976b`)

### Version bumps

- 1.7.0 (`ede9928`)

## [1.6.1] - 2026-08-11

[v1.6.0...v1.6.1](https://github.com/alisaitteke/photoshop-mcp/compare/v1.6.0...v1.6.1)

### Other

- Add csv-to-cards recipe infographic and README showcase section (`a928b50`)
- Add 13 tools and csv-to-cards recipe, expanding coverage to 102 tools. (`f79392b`)

### Version bumps

- 1.6.1 (`863c1ae`)

## [1.6.0] - 2026-08-07

[v1.5.0...v1.6.0](https://github.com/alisaitteke/photoshop-mcp/compare/v1.5.0...v1.6.0)

### Fixes

- fix(ui/server): require a per-session token on /api/* (`439d5c3`)
- fix(platform): AppleScript timeout block, queue cancellation, jsString control chars (`93574e1`)
- fix(macos): no focus-steal by default, per-app pgrep, timeout kills child, 2026/Beta paths (`d8adf79`)

### Other

- Improve docs and CLI auth UX for open issues #17–#19. (`5cc17b1`)
- test: add vitest unit-test harness (npm run test:unit) (`ffd21e4`)

### Version bumps

- 1.6.0 (`91d52ae`)

## [1.5.0] - 2026-07-27

[v1.4.0...v1.5.0](https://github.com/alisaitteke/photoshop-mcp/compare/v1.4.0...v1.5.0)

### Features

- feat(tools): add split_carousel, batch_watermark, passport_photo recipes and neural colorize (`f266aee`)

### Fixes

- fix(layers): make photoshop_duplicate_layer activate the duplicate (`50b1a88`)

### Documentation

- docs(readme): make recipe examples visible with infographics for all 15 recipes (`afbe5be`)
- docs(i18n): add locale README translations (ES, ZH, DE, JA, TR) (`bdde203`)

### Version bumps

- 1.5.0 (`5935101`)

## [1.4.0] - 2026-07-03

[v1.3.13...v1.4.0](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.13...v1.4.0)

### Other

- release: v1.4.0 — Photoshop native AI (Generative + Neural Filters) (`d76e822`)

### Version bumps

- 1.3.13 (`b94812f`)

## [1.3.13] - 2026-07-03

[v1.3.12...v1.3.13](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.12...v1.3.13)

### Documentation

- docs: add README hero banner with alisait.com branding (`c535f7d`)
- docs: add portfolio positioning, architecture deep-dive, and social preview assets (`1011044`)

### Chores

- chore(images): update og-social.png to enhance visual quality and branding (`74d48e5`)

## [1.3.12] - 2026-07-02

[v1.3.11...v1.3.12](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.11...v1.3.12)

### Features

- feat(analytics): improve Mixpanel tracking with cohorts, milestones, and flush parity (`b7daf3a`)

### Version bumps

- 1.3.12 (`d016e61`)

## [1.3.11] - 2026-07-02

[v1.3.10...v1.3.11](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.10...v1.3.11)

### Features

- feat(ui): add custom OpenAI/Anthropic-compatible API provider (`a1d3a1a`)
- feat(analytics): default to Mixpanel with PostHog rollback path (`4e9444d`)

### Fixes

- fix(release): generate CHANGELOG from package.json before tag exists (`c7f1a58`)

### Documentation

- docs: add CHANGELOG section for 1.3.10 and fix release tag order (`e6a58c1`)

### Version bumps

- 1.3.11 (`7908066`)

## [1.3.10] - 2026-06-24

[v1.3.9...v1.3.10](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.9...v1.3.10)

### Features

- feat(release): add CHANGELOG, categorized notes, and npm refresh workflow (`844485c`)
- feat(release): enrich GitHub release notes with npm install links (`087bca1`)

### Version bumps

- 1.3.10 (`65dce09`)

## [1.3.9] - 2026-06-24

[v1.3.8...v1.3.9](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.8...v1.3.9)

### Features

- feat(release): add GitHub Actions workflow for automated releases on version tags docs(CONTRIBUTING): update contributing guide with release process details docs(README): add GitHub release badge to README for better visibility chore(scripts): add backfill script to create GitHub Releases for existing tags without releases (`be01916`)

### Other

- Add GitHub Sponsors username to FUNDING.yml (`5f619dd`)
- Add GitHub Sponsors username to FUNDING.yml (`d4c2c66`)

### Version bumps

- 1.3.9 (`b8a3f47`)
- 1.3.5 (`7949efc`)
- 1.3.4 (`cfce75b`)

## [1.3.8] - 2026-06-18

[v1.3.7...v1.3.8](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.7...v1.3.8)

### Features

- feat(analytics): add app version retrieval from package.json for server-side events fix(docs): update anonymous usage analytics documentation to clarify app version tracking (`f767166`)

### Version bumps

- 1.3.8 (`b3c3871`)

## [1.3.7] - 2026-06-18

[v1.3.6...v1.3.7](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.6...v1.3.7)

### Features

- feat(analytics): enhance anonymous usage analytics to track MCP client connection and disconnection events feat(analytics): add support for recording active provider and model in analytics feat(analytics): implement usage surface tracking for anonymous profiles feat(analytics): create smoke tests for MCP client analytics functionality fix(analytics): update event properties to include new metrics for MCP client refactor(analytics): reorganize code for better clarity and maintainability chore(docs): update documentation to reflect changes in analytics tracking and events (`8b71106`)

### Version bumps

- 1.3.7 (`f9245c8`)

## [1.3.6] - 2026-06-18

[v1.3.5...v1.3.6](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.5...v1.3.6)

### Version bumps

- 1.3.6 (`9d84bf0`)

## [1.3.5] - 2026-06-18

[v1.3.4...v1.3.5](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.4...v1.3.5)

### Features

- feat(analytics): enhance tool batch flushing logic to improve performance and responsiveness during usage sessions fix(analytics): add flush method to analytics providers to ensure queued events are sent before shutdown docs(analytics): update documentation to reflect changes in tool batch flushing criteria and behavior (`0ce8d42`)

### Chores

- chore(images): update frame_generic_light.png to improve visual quality and consistency (`a5e8eb2`)

### Version bumps

- 1.3.5 (`4a11910`)

## [1.3.4] - 2026-06-17

[v1.3.3...v1.3.4](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.3...v1.3.4)

### Features

- feat(analytics): enhance anonymous usage analytics to collect more detailed runtime environment data including system locale, CPU count, and memory tier feat(analytics): implement MCP session tracking with tool usage summaries and error reporting fix(analytics): ensure proper identification of analytics person with additional properties for better segmentation fix(server): update tool handler registration to include tool name for accurate tracking fix(server): capture connection events and tool call metrics to improve error handling and analytics reporting docs(anonymous-usage-analytics): update documentation to reflect new data collection practices and clarify what is collected and not collected (`ec1dda2`)

### Version bumps

- 1.3.4 (`26e4849`)

## [1.3.3] - 2026-06-17

[v1.3.2...v1.3.3](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.2...v1.3.3)

### Version bumps

- 1.3.3 (`09ed18d`)

## [1.3.2] - 2026-06-17

[v1.3.1...v1.3.2](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.1...v1.3.2)

### Version bumps

- 1.3.2 (`e09cae6`)
- 1.3.1 (`17891a4`)

## [1.3.1] - 2026-06-17

[v1.3.0...v1.3.1](https://github.com/alisaitteke/photoshop-mcp/compare/v1.3.0...v1.3.1)

### Features

- feat(analytics): implement anonymous usage analytics with locale support to enhance user insights docs(README): simplify anonymous usage analytics section and link to detailed documentation docs(anonymous-usage-analytics): create dedicated documentation for anonymous usage analytics details fix(db): update data directory path to use getPhotoshopMcpHomeDir function for better compatibility (`b1b58e8`)

## [1.3.0] - 2026-06-17

[v1.1.3...v1.3.0](https://github.com/alisaitteke/photoshop-mcp/compare/v1.1.3...v1.3.0)

### Features

- feat(analytics): add launch method detection to capture analytics context (`39beb6c`)
- feat(analytics): implement analytics system with PostHog integration for usage tracking and beta telemetry feat(analytics): add API endpoints for managing analytics settings and beta telemetry opt-in feat(analytics): create UI components for user interaction with analytics settings and beta team participation feat(analytics): capture relevant events for analytics during server and UI operations feat(analytics): enable environment-based configuration for analytics settings docs: update README and .env.example to include new analytics configuration options and usage instructions (`097d19f`)
- feat(ui): enhance chat functionality by adding clear all chats feature and improving tool output handling (`8cef6e7`)
- feat(PlanCard.vue): refactor PlanCard component to use ToolCallStrip for better organization and clarity feat(StreamingMessage.vue): integrate ToolCallStrip for standalone tool calls display chore: remove ToolCallCard component as its functionality is replaced by ToolCallStrip feat: add ToolCallDetailDialog and ToolCallOrb components for enhanced tool call interaction feat: implement utility functions for tool name display and icon retrieval in tool-display and tool-icons modules (`6151bfc`)
- feat(README.md): update version description to include Action Plan (beta) feature and its benefits feat(Action Plan): implement Action Plan (beta) feature for streamlined execution of Photoshop commands feat(ui): add AppLoader component for improved loading experience during app initialization refactor(ui): remove Footer component and integrate author information into Sidebar fix(ui): enhance loading state management in SettingsDialog and ChatView components fix(ui): improve message handling in MessageList and StreamingMessage components for better user experience style(ui): add custom scrollbar styles for a cleaner interface chore(api): update API interfaces to include reasoning and activity tracking for chat messages chore(store): enhance chat store to manage streaming messages and reasoning deltas effectively chore(vite): configure proxy response headers to disable buffering and caching for real-time updates (`cd7d799`)
- feat(ChatView.vue): refactor layout to improve message list and composer positioning for better user experience feat(Composer.vue): implement textarea auto-resizing for improved usability style(Composer.vue): enhance styling of the composer component for better visual appeal fix(ModelSelector.vue): adjust button hover styles for better accessibility and user feedback (`a82cd5f`)
- feat(package.json): add packageManager field to specify pnpm version for consistency across environments feat(agent.ts): implement action plan feature to generate and execute a complete ordered plan for Photoshop tool calls feat(action-plan.ts): create action plan execution logic to handle planning and executing tool calls in a single pass feat(shared.ts): define new types for plan step status and plan view to support action plan feature feat(config.ts): add actionPlanBeta configuration option to enable or disable action plan feature feat(server.ts): add API endpoint to toggle action plan feature in the server configuration feat(chats.ts): extend chat message structure to include action plan details for better state management feat(App.vue): integrate action plan toggle in the UI to allow users to enable or disable the feature feat(ChatView.vue): display action plan and tool calls inline for better user experience feat(PlanCard.vue): create a new component to visualize the action plan and its steps feat(MessageList.vue): update message list to conditionally render action plan and tool calls feat(useTextareaAutosize.ts): add composable for auto-resizing text areas to improve user input experience feat(api.ts): implement API call to set action plan feature state in the backend fix(server.ts): ensure assistant messages persist action plan state when saving chat history (`de0c500`)

### Fixes

- fix(windows-executor.ts): remove unnecessary return statement in DoJavaScript call to streamline execution of JSX script (`2e8f719`)

### Refactors

- refactor: simplify error handling by removing error parameter in catch blocks across platform detector and executor files to enhance code readability and maintainability (`4253d62`)

### Chores

- chore(release): bump version to 1.3.0 (`5e1acaf`)
- chore(images): update image assets to improve visual quality and consistency (`8751c8a`)
- chore(eslint): update ESLint configuration to include globals for Node.js and ES2021 refactor(eslint): adjust no-unused-vars rule to improve TypeScript compatibility and ignore specific patterns (`b440fa1`)

### Version bumps

- 1.2.0 (`51f1756`)

## [1.1.3] - 2026-06-11

### Features

- feat(README.md): update tool counts and descriptions to reflect new features and improvements feat(api): add font listing functionality and enhance text layer creation with font support fix(api): resolve font names for text layers to ensure correct font application fix(errors): add 'font_not_found' error code for better error handling test: add tests for font listing and text layer creation with specified fonts (`5530756`)
- feat(CONTRIBUTING.md): add command for targeted regression tests for issue #2 feat(README.md): update recorded test results to reflect issue #2 fixes and new test harness feat(package.json): add new script for targeted regression tests for issue #2 feat(spike-issue-2.ts): create a new script for targeted regression tests for issue #2 fix(test-all-mcp-tools.ts): improve document info assertion to handle errors gracefully feat(layer-tools.ts): add new tool to select layer by name, including nested groups fix(extendscript.ts): improve error handling when accessing document properties fix(photoshop-api.ts): ensure alert suppression works correctly during script execution fix(macos-executor.ts): ensure ExtendScript BOM is prefixed when writing scripts fix(windows-executor.ts): ensure ExtendScript BOM is prefixed when writing scripts chore(_shared.ts): refactor jsString function to use utility from js-string module feat(extendscript-file.ts): add utility to prefix UTF-8 BOM for ExtendScript files feat(js-string.ts): create utility for escaping JavaScript strings (`68322ce`)
- feat(docs): update README and related documentation to reflect the addition of 12 new recipe tools and 4 new atomic tools, bringing the total to 78 tools fix(docs): correct tool coverage count in test script to match updated total of 78 tools (`6502d01`)
- feat(package.json): add new test script for intent expansion features feat(test-intent-expansion): create local integration test for prompt-intent-expansion features to ensure functionality and coverage of new features (`8fe5a68`)
- feat(docs): update README to reflect new MCP prompts and tools, including 16 pre-engineered templates and 12 outcome-oriented recipe tools feat(docs): add user intent glossary and degrade paths for better user guidance feat(docs): enhance instructions for prompt-layer usage and multi-step workflows feat(docs): finalize intent taxonomy and update phase documentation for clarity feat(prompts): introduce new prompts for gradient fade, sky blend, dodge & burn, and remove distraction feat(tools): add new mask tools for gradient application and enhance existing adjustment tools feat(recipes): implement new recipes for gradient fade, sky blend, dodge & burn, and remove distraction to streamline user workflows fix(extendScript): improve error handling and add new helper functions for gradient and mask operations fix(tests): update tests to cover new prompts and recipes, ensuring all functionalities are validated (`1ce32bb`)
- feat(tests): add local and all MCP tools test scripts to improve testing coverage chore(package.json): add new test scripts for local and all MCP tools to facilitate testing process refactor(extendscript): improve layer handling and error management in ExtendScript snippets for better reliability refactor(recipes): streamline recipe functions to utilize shared helper functions for consistency and maintainability (`56f303d`)
- feat(docs): add AI/Prompt Layer documentation to README.md to explain new features and usage feat(docs): create prompt-layer.md to provide detailed reference for AI/prompt layer functionality chore(gitignore): add local maintenance scripts to .gitignore to prevent unnecessary tracking feat(scripts): add verify-photoshop-prompt-coverage script to ensure prompt and recipe parity feat(scripts): create test-mcp-local script for local smoke testing of the photoshop-mcp server feat(core): implement PromptRegistry to manage prompt definitions and handlers feat(core): integrate prompt handling into PhotoshopMCPServer for improved functionality feat(recipes): add various recipe tools for enhanced image processing capabilities feat(recipes): implement frequency separation, enhance portrait, and batch mockup replace recipes feat(recipes): create export social variants and prepare for web recipes for streamlined exports fix(api): improve error handling in getContextInfo function to prevent crashes fix(api): ensure active layer checks are robust to avoid runtime errors fix(api): enhance error classification for better user feedback on failures fix(tools): update tool descriptions to clarify usage and preconditions for better developer experience (`3e871ab`)
- feat(extendscript): implement hue, saturation, and lightness adjustment for active layer using Action Descriptor for better compatibility with Photoshop (`77a35de`)
- feat: add provider and model information to chat messages and UI components (`80050c4`)
- feat(extendscript): enhance fillLayer function to handle locked and text layers and return additional information fix(macos-executor): improve error handling in parseResult method to throw an error for specific error messages (`658cdad`)
- feat: add Google AI Studio provider support to the application (`34eef62`)
- feat(ui): enhance chat functionality with usage tracking and cost calculation (`77f0cc6`)

### Fixes

- fix(extendscript.ts): improve hasSelection logic to handle exceptions when no active selection exists (`73f94ba`)

### Documentation

- docs(README): update features list formatting for improved readability and consistency (`d8688bb`)
- docs: update contributing and development documentation for clarity and organization (`dfb6878`)
- docs: add CONTRIBUTING.md and pull request template for better contribution guidelines and process clarity (`832292c`)
- docs(README.md): update README to reflect version 1.1 features and integration test results for better clarity and user guidance docs(prompt-intent-expansion): add initial documentation for prompt intent expansion project to outline phases and confirmed decisions docs(intent-taxonomy): create intent taxonomy draft to map user phrases to corresponding tools and recipes for improved user interaction (`1ec19f0`)
- docs(README): update screenshot image for standalone UI to reflect new design feat(images): add new screenshot image for standalone UI in light frame (`1aa0e79`)
- docs(README): add screenshot of standalone UI to enhance documentation clarity feat(images): add standalone UI screenshot to provide visual reference for users (`a3833f1`)
- docs(README): update documentation to include standalone UI mode and usage instructions for better user guidance (`34149f5`)

### Chores

- chore(package.json): update build:web script to use install instead of ci for better dependency management (`1bb0075`)
- chore(.gitignore): add local planning docs directory to .gitignore to prevent tracking of unpublished files (`cc18f6c`)
- chore(.gitignore): add *.tgz to ignore list to prevent tarball files from being tracked (`b5e7097`)
- chore: update package versions to 0.1.8 for both main and web packages to reflect new changes chore: update author information in package.json for better attribution chore: add repository, homepage, and bugs fields in package.json for better project visibility chore: clean up .npmignore by removing unnecessary entries and adding defensive filters feat(cli.ts): dynamically retrieve package version from package.json for CLI output feat(server.ts): implement cache control headers for static assets to improve performance and caching behavior (`9dabea6`)
- chore(package.json): update build:web script to use npm ci for better performance and reliability chore(web/.npmignore): add .npmignore file to exclude unnecessary files from the package feat(web/package.json): add @lobehub/icons-static-svg dependency for icon support feat(main.ts): self-host only the Latin subset of Source Sans 3 Variable font to reduce bundle size (`9101fbe`)

### Version bumps

- 1.1.3 (`bcbba5c`)
- 1.1.2 (`0414f29`)
- 1.1.1 (`5cac9c1`)
- 1.1.0 (`6e1c1f0`)
- 1.0.0 (`17d8d91`)

