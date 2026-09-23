# Tasks 14–21 repository evidence audit

> Historical audit. Current final acceptance status is tracked in
> `docs/roadmap-final-acceptance-matrix.md`. In particular, later current-tree work closed the
> repository method-selection wiring gap noted here for Task 15 and added canonical restore
> completion semantics plus real compact-v2 UXP restore evidence for Task 21.

Date: 2026-09-22. Scope: current tree; no edits to active worker-owned Guard files.

Status: **repo-pass** = Acceptance directly exercised; **repo-partial** = useful repository evidence but an integration/measurement remains; **live/human-pending** = requires real Photoshop or independent judgment; **exploratory-pending** = intentionally not an accepted capability.

| Task | Acceptance evidence | Result |
|---|---|---|
| 14 | `artistic-operation-contract.test.ts` proves actual-tool binding, mandatory preparation provenance/effective brush state, explicit fallback/fail-closed; `unified-artistic-operation.test.ts` admits directive-bound Curves/mask/gradient-mask/blend/transform and rejects unbound operations | **repo-pass** |
| 15 | `style-contract-runtime.test.ts` shows `detail_density` changes task/stopping, edge/mark/layer-bias change method projection, color/finish change critic projection; irrelevant fields vanish; whole-image drift is detected advisory-only | **repo-pass for projection; repo-partial for downstream method-selection wiring** |
| 15a | `brush-method-evidence.test.ts` covers exact provenance citation, actual Round Blunt gaps/bristles/taper with unresolved cause, mismatch invalidation, diagnostic-only old sample, and one conceptual probe for an unknown combination | **repo-pass** |
| 15b | `spatial-support.test.ts` covers canvas↔preview round-trip, crop mapping, raster-evidence placement independent of command metadata, relation preservation, uncertainty continuation | **repo-pass unit/replay; exact live placement live-pending** |
| 15c | No bounded reference/3D comparison proving structural/throughput gain was found | **exploratory-pending** |
| 15d | Generic masks/layers/methods exist, but no bounded whole/local comparison proves material/atmosphere gain plus editable separation for a representative compositing case | **live/human-pending** |
| 16 | VisualMicroPlan tests enforce one semantic intent, 1–4 compatible mutations, one final preview/barrier, and separation of incompatible/independent work; latency benchmark explicitly favors risk/semantic bundling over call minimization | **repo-pass at bundle layer; compact-v2 host-cycle E2E still coupled to concurrent Guard migration** |
| 17 | `pass-check-applicability` adds zero host calls for local checks; stage/final/anchor modules keep whole-image review at boundaries; Task 19 removes repeated preparation calls | **repo-partial** — no single non-worker-owned E2E cadence test proves every global boundary |
| 17a | `pass-check-applicability.test.ts` replays local/global/preparation cases, omits irrelevant gates, preserves genuine protections, never turns unresolved prerequisites into achieved goals, adds zero host calls | **repo-pass** |
| 17b | `artistic-recovery-policy.test.ts` bounds same-strategy retry, requires causal change, handles anchored false alarms, continues independent work after two distinct failures, blocks exhausted dependency, and terminates diagnostics without dummy mutation | **repo-pass** |
| 18 | `painting-stage-policy.test.ts` proves invariant kernel, deterministic stage modules, unknown-stage fail-closed, byte-identical restart reconstruction, and active stage context <65% of eager all-stage policy projection | **repo-pass** |
| 19 | `preparation-cache.test.ts` proves identical local pass reuses preparation (2→0 prep-call proxy), stale provenance fails closed, diagnostics expose reasons, previews are never reused across mutation | **repo-pass except wall-clock A/B**; no real cache-on/off cycle timing yet |
| 20 | `planner-painter.test.ts` fixed forbids branch ceremony, constrained branches only for material unresolved choice, free requires ≥2 cheap hypotheses, and exploration creates zero Photoshop operation records | **repo-pass** |
| 21 | `planner-painter.test.ts` preserves SHA/path-backed primary/alternative anchors, refuses completion when a stronger anchor is preferred, rejects non-anchor comparison targets, and blocks a more-detailed-but-weaker current frame; selected current final is SHA/path-backed | **repo-pass for selection/state; restore/reconcile execution remains repo-partial** |

## Gaps that must not be promoted to acceptance

1. Task 15 method-selection integration: the open-ended style projection exists, but the current palette does not consume arbitrary style traits as selection input. Do not invent a named-style/string taxonomy merely to force wiring.
2. Task 15b exact live placement remains unmeasured in Photoshop.
3. Task 15c has no bounded empirical reference/3D comparison.
4. Task 15d has no authorized whole/local before-after evaluation proving visible material/atmosphere improvement rather than more texture.
5. Tasks 16/17 final compact host-loop cadence proof remains in concurrently owned Guard integration; do not duplicate it here.
6. Task 19 has a deterministic call-count latency proxy and historical semantic-cycle benchmark, but no real cache-on/cache-off wall-clock A/B.
7. Task 21 state logic requires restore/reconcile before completion when the anchor is stronger, but a full restore mutation + reconciliation + canonical-final flow is not proven outside the active Guard/state path.
8. Critic calibration (Tasks 8/8a) remains human-label pending; the harness intentionally has not run pending-label cases.

No roadmap status labels were edited by this audit.
