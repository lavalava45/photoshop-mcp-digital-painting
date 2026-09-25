# Painting Roadmap History

Last updated: 2026-09-25

This file archives roadmap blocks that are no longer forward-looking work. Detailed implementation
evidence remains in `CHANGELOG.md`, `docs/roadmap-final-acceptance-matrix.md`, Git history and the
referenced live/test artifacts. Do not move an item here until its remaining acceptance gates are
closed or explicitly transferred to an active follow-up in `docs/PAINTING-ROADMAP.md`.

## Archived 2026-09-25

### P0-0 — Canonical execution integrity invariants

The 2026-09-24 global architecture/logic audit found three production-reachability gaps. The code
block is now closed and the rules below are retained as non-regression architecture constraints.
Painter/Art Director should gain expressive power by composing semantic primitives, not by acquiring
pre-baked upstream workflow macros.

### P0-0.1 — Systemic fail-closed document targeting

`document_id` is currently admitted and carried in Guard context, but not every document-bound
mutation proves the same target at the actual Photoshop dispatch boundary. Some UXP handlers omit
the id, while legacy/ExtendScript execution can run without a systemic document guard.

Implement one end-to-end target invariant across:

```text
Guard admission
→ semantic tool
→ backend selection
→ document-target enforcement
→ UXP or bounded pre-dispatch legacy execution
```

Do not rely on each individual tool author remembering to inject a guard. UXP document-bound
commands must receive the pinned id automatically or through an equivalently exhaustive central
mechanism; legacy execution must fail closed against the same target before mutation.

**Acceptance**

- switching the active Photoshop tab/document between Guard admission and dispatch cannot mutate the
  wrong document;
- every document-bound UXP mutation carries/verifies the pinned target;
- every allowed legacy mutation is protected by the same fail-closed target invariant;
- create/open/bootstrap operations that legitimately have no prior document target remain explicitly
  classified rather than accidentally guarded;
- regression tests prove zero mutation on target mismatch for representative UXP and legacy paths.

### P0-0.2 — Guard executable policy and raw-script retirement

The public required-mode surface blocks direct raw mutation, but the compact compiler can currently
accept a registered `photoshop_execute_script` action and the Guard runtime can invoke the registry
internally. Registration must not imply canonical-execution permission.

Introduce one authoritative execution classification/allowlist for Guard-compiled actions, with
explicit categories such as allowed semantic mutation, read-only, preparation-only, retired and
forbidden. `photoshop_execute_script` must be unreachable from production compact-v2 execution.

**Acceptance**

- compact compilation rejects `photoshop_execute_script` before Photoshop dispatch;
- newly registered internal/debug tools are not automatically executable through Guard;
- executable policy, migration inventory and public/tool documentation all agree that raw-script
  execution is retired and unreachable from the canonical production lane;
- tests prove the denial at compiler/runtime boundaries without relying only on outer MCP mode.

### P0-0.3 — Recipes are excluded from the canonical painting lane

The 16 upstream `photoshop_recipe_*` tools are general Photoshop convenience workflows, not Painter
capabilities. Their pre-baked behavior conflicts with the project goal that Painter/Art Director
choose and compose expressive semantic operations themselves.

They may remain registered on the general MCP compatibility surface for upstream compatibility, even
if their upstream implementation uses legacy/monolithic scripting. **Registration does not make them
eligible for compact-v2/Guard execution.** No recipe migration is required for the painting project.
If a useful capability exists only inside a recipe, extract or implement the smallest reusable
semantic primitive instead of admitting that recipe into Painter.

**Permanent invariant / acceptance**

- every `photoshop_recipe_*` name is `forbidden` by the authoritative Guard execution policy;
- compact compilation/runtime rejects a recipe before any Photoshop dispatch, regardless of whether
  the recipe remains registered in the general ToolRegistry;
- no recipe is part of Painter/Art Director capability selection, method selection or fallback;
- the migration inventory explicitly labels recipes as general-MCP compatibility surface and outside
  canonical painting acceptance;
- adding a new upstream recipe does not make it executable through Guard without an explicit
  architecture change; the default-deny regression must catch this automatically;
- artistic functionality needed by Painter is provided as semantic primitives, leaving the artistic
  decision and composition of those primitives to Painter rather than to fixed recipes.

---

### P0-2 — Final UXP migration live acceptance

**Status: closed 2026-09-24.**

The final accepted real-Photoshop trace is
`processes/compact-v2-live-acceptance-process/run-10` against repository
`78125f2e9b314ad236cc9058921760bc485ac75f`, live Photoshop MCP child PID `30684`, and exact
actual/expected UXP revision `compact-v2-20260924-targeting`.

The accepted monitored window proves:

- representative P1 `layer.create`, P2 `filter.gaussian_blur`, and P3 `history.read` all selected
  `uxp` at the pre-dispatch backend boundary with `fallback_used=false`;
- the helper `painting.regions` pass, required preview reads, deliberate mismatch `history.read`,
  and bounded recovery `state.read` also remained on UXP with no cross-backend replay;
- the 69.24 s foreground/process window started with Chat On Steroids foregrounded and recorded
  **zero Photoshop foreground transitions** and **zero legacy COM/ExtendScript helper processes**;
- the deliberate pinned read for inactive document `3743` while acceptance document `3746`
  remained active failed closed with `document_not_active`; the bounded `photoshop_get_state`
  recovery confirmed document `3746` was still active with the expected two-layer blurred target,
  and the failed operation was reconciled without replay;
- the normal trace used zero deterministic schema retries, zero repository source/schema reads, zero
  general Guard-status / Art Director / value-analysis detours, and no document activation inside the
  accepted window;
- the post-trace Guard projection had no pending reports, operation acknowledgements, uncertain
  operations, visual-verdict debt, or active jobs.

Dispatch-level evidence is in `run-10/evidence/backend-route-window.ndjson`; the independent
foreground/process trace is `run-10/evidence/runtime-window.json`; operation copies, preflight,
post-trace state, call ledger, and the consolidated acceptance ledger are stored beside them. Their
hashes are committed in `docs/live-evidence-ledger.json`.

`run-07`, `run-08`, and `run-09` are retained as diagnostic evidence and are **not** credited
as the final pass. They respectively exposed invalid trace hygiene, a direct compact artistic-method
compiler leak fixed in `78125f2`, and a Photoshop foreground transition during explicit
`photoshop_set_active_document`.

**Acceptance**

The final disposable run must prove all of the following on the current post-migration build:

1. representative **P1/P2/P3** operations execute successfully with UXP selected, with direct
   dispatch-level evidence (bridge action/receipt/backend instrumentation) for every step claimed as
   UXP-path evidence;
2. Photoshop does **not** steal foreground/focus during the accepted UXP-path trace;
3. no unexpected COM/ExtendScript helper process appears during steps claimed as UXP-path evidence;
   process/focus observations are ancillary and do not substitute for dispatch-level route evidence;
4. after any UXP dispatch/claim/uncertainty/failure there is **zero cross-backend replay** through
   ExtendScript/COM;
5. one deliberate pinned-document mismatch / active-document-switch probe fails closed with zero
   mutation to the wrong document, proving the repaired P0-0.1 invariant on real Photoshop;
6. Guard finishes the run without pending reports/acks, uncertain operations, unresolved visual
   verdict debt or active-job debt;
7. durable evidence is recorded and the remaining **13a.6.1** and **13c.7** rows in
   `docs/roadmap-final-acceptance-matrix.md` are changed from `live-pending` to `live-pass` only
   if the run actually proves those conditions.

Use `docs/compact-v2-live-acceptance-plan.md` as the detailed execution/evidence procedure. Keep
`photoshop_save_document` and `photoshop_neural_filter` as intentional UXP-only/fail-closed
exceptions; ordinary migrated tools may use ExtendScript/COM only when that backend is selected
**before** any UXP dispatch.

> The three follow-ups discovered during this acceptance were **not** archived; they remain active in
> `docs/PAINTING-ROADMAP.md` under “Active follow-ups inherited from closed P0-2 acceptance”.

---

### P0-B — Guard state/evidence/review correctness

The machine-enforceable correctness block below is closed and retained as a non-regression contract.
Repository acceptance is recorded in `docs/roadmap-final-acceptance-matrix.md`; implementation details
and the 2026-09-25 canonical verification are recorded in `CHANGELOG.md`. Borderline perceptual
judgement about whether a repeated pattern is artistically objectionable remains part of later human
critic calibration rather than a code-completion gate for this block.

The global audit found several runtime-semantic gaps that do not invalidate the existence of the
multiscale/recovery machinery, but do weaken the correctness guarantees built on top of it. Close
these before Task 21a or critic authority is expanded. A 2026-09-24 live painting run also exposed
an independent review failure: repeated object geometry, parameter-jitter variants and uniform
thin-line detailing could satisfy narrow operation-local goals while the visible result became
obviously mechanical at object scale. That failure is tracked below as P0-B.8 rather than being
treated as a generic aesthetic preference.

### P0-B.1 — Preserve broad review coverage during nested deduplication

Current overlap-based deduplication can merge a broad must-fix OBJECT region with a smaller nested
MICRO finding and retain the tighter region while carrying forward the stricter severity. That can
allow a tiny crop to satisfy what was originally a broad coverage requirement.

Separate **coverage region** from **inspection level**. A higher review level may tighten/augment the
inspection evidence, but must not silently erase the larger semantic area that still requires proof.

**Acceptance**

- an extreme nested containment fixture preserves the broad must-fix coverage requirement;
- OBJECT + nested MICRO findings may share evidence where valid, but closure cannot occur from a
  micro crop that does not cover the unresolved broad region;
- bounded crop fan-out and deterministic priority ordering remain intact.

### P0-B.2 — Make bounded artistic recovery the production decision core

`resolveArtisticRecovery()` is currently unit-tested but not authoritative in the production
SessionStore path. Wire one explicit recovery policy into runtime state transitions rather than
maintaining parallel heuristic behavior.

At the same time, split structural strategy identity from incidental execution parameters. Changes
to color, opacity or dab/stroke count must not by themselves masquerade as a new recovery strategy.
Do not make the policy authoritative until its evidence inputs are also fail-closed: an anchor id
must resolve to a real durable anchor for the same document/incarnation, counterevidence must bind to
fresh current-frame observation evidence, and structural strategy identity must be Guard-derived or
validated from admitted mutation structure rather than trusted as a free model label.

**Acceptance**

- repeated same-cause/same-strategy failure reaches deterministic finite termination;
- a real structural strategy change is distinguished from a parameter variant;
- independent continuation remains possible where policy allows it;
- restart/resume preserves the same recovery decision state;
- false-alarm recovery cannot be accepted from a bare anchor id + free-text counterevidence;
- strategy identity used for retry/reset decisions is Guard-derived or validated against the admitted
  operation structure;
- the acceptance matrix no longer cites an unwired helper as proof of runtime enforcement.

### P0-B.3 — Separate artistic frame identity from read-only observations

Read-only preview/capture operations must not replace the identity of the current artistic frame.
Persist an explicit distinction between the last visual mutation frame and the latest observation
evidence, or enforce an equivalent invariant in the existing schema.

**Acceptance**

- `photoshop_get_preview` and review-only crop capture cannot advance the artistic frame identity;
- anchor promotion/final comparison continue to reference the latest classified visual mutation;
- restart/resume preserves both artistic-frame and observation evidence correctly.

### P0-B.4 — `reversed` must prove an actual restored image state

`incomplete_hypothesis_resolution='reversed'` must not clear a hypothesis merely because the label was
submitted. The current frame must be proven to match the rollback target through exact registered
state/evidence, or through an equivalently strict verified restore contract.

**Acceptance**

- declaring `reversed` without a qualifying restore does not clear the hypothesis;
- a successful reverse binds to the intended prior frame/anchor identity and exact current evidence;
- tests cover both false declarative reversal and real verified reversal.

### P0-B.5 — Verify persisted crop evidence before reuse

A stored path/SHA string is not durable proof that the same crop bytes still exist after restart.
Before persisted review evidence satisfies a pending requirement, verify the materialized artifact
still exists and matches the recorded identity, or recapture it read-only.

**Acceptance**

- deleted, replaced or hash-mismatched crop files cannot satisfy pending review closure;
- valid unchanged evidence can still be reused without replaying the artistic mutation;
- restart tests cover valid reuse, deletion and replacement/corruption cases.

### P0-B.6 — Detect external document reincarnation, not only Guard bootstrap reuse

The existing incarnation reset handles successful guarded create/open bootstrap. The remaining gap is
external/manual close-reopen behavior where Photoshop may reuse the same numeric document id without
passing through Guard bootstrap.

Add a bounded document-incarnation proof at state/operation admission so stale document-scoped state
cannot survive a materially different document that happens to reuse an id.

**Acceptance**

- externally recycled numeric document ids cannot inherit stale art-run/barrier/recovery state;
- unchanged live documents do not spuriously reset;
- the proof is restart-safe and does not depend only on Guard-owned create/open operations.

### P0-B.7 — Bind whole-image-glance evidence to the exact due boundary/frame

Task 11 scheduling can mark a whole-image glance due at stage/global/final boundaries, but the stored
glance record is still too declarative: a supplied observation can clear `due` without proving that it
was made for the exact pending trigger and exact current visual frame that caused the glance request.

Bind each due glance to the reason/boundary identity and exact current artistic frame/evidence. A
stale or mismatched glance must not clear the pending requirement.

**Acceptance**

- submitted `trigger` must match the actual pending glance reason;
- the glance record binds to the exact current artistic frame/whole-frame evidence and rejects stale
  frame identity;
- restart/resume preserves the same pending reason/frame requirement;
- a mismatched/stale glance cannot clear `due`;
- Task 11 scheduling/state mechanics are not treated as fully machine-complete until this invariant
  is covered, while perceptual usefulness remains a separate human calibration claim.

### P0-B.8 — Mechanical-patterning / copy-geometry guard with mandatory instance-scale review

The live pink-city failure showed that the current loop can accept a pass because it visibly added
characters, birds, architectural marks or “detail” while missing that several visible objects were
constructed from the same geometric template. Whole-frame review can hide this because the repeated
instances are small; later passes then amplify the defect by adding more lines to the same weak
construction.

The canonical painting lane must distinguish **semantic reuse** from **visible geometry reuse**:
Painter may reuse the concept “flying bird”, “ninja”, “balcony” or “roof”, but independent visible
instances must not silently reuse the same normalized stroke/region geometry unless deliberate
uniform repetition is part of the user/design intent. Translation, uniform scale, small rotation,
color swaps or small coordinate jitter do **not** count as structural variation.

Implement a bounded mechanical-patterning check around admitted compact visual actions:

1. derive normalized signatures for repeated stroke/region constructions by removing incidental
   placement/scale and comparing topology, proportions, relative angles and primitive ordering;
2. prefer Guard-derived grouping from admitted action structure; add only the smallest optional
   instance/motif identity metadata if reliable grouping cannot otherwise be recovered;
3. detect exact copies and near-copies that differ only by transform, color or parameter jitter;
4. when repeated **character / creature / organic / irregular decorative** instances are introduced,
   choose representative source-document crops automatically (at minimum the closest/largest
   instance and the most-similar pair) even if whole-frame review did not already produce a local
   finding;
5. review those crops for silhouette/pose/construction variation, accidental tangencies or
   intersections, line-weight hierarchy and whether the objects read as actual forms rather than
   wireframe glyphs;
6. treat intentional regular systems such as window grids, rail posts, tiles, machine-made modules
   or an explicitly requested clone/uniform formation as allowed rhythm, not as an automatic defect;
7. never “fix” repetition by injecting random noise. Variation must come from a structural reason
   such as pose, viewpoint, wing phase, occlusion, perspective, role, depth or differing construction;
8. do not accept “more detail” merely because primitive/stroke count increased. A detail pass must
   add readable form, plane/material information, spatial relation or deliberately useful texture.

This is a review gate, not a universal numeric beauty score. Deterministic geometry similarity may
raise review debt; the artistic conclusion still comes from the exact visual evidence at the
appropriate scale. Existing COMPOSITION / OBJECT / MICRO crop machinery should be reused rather than
creating a second review subsystem.

**Acceptance**

- four identical distant-bird glyphs at different positions trigger mechanical-patterning review;
- the same glyphs with only scale/rotation/color/jitter changes still trigger;
- structurally different birds with meaningfully different wing phase/silhouette do not fail merely
  because they share the same semantic class;
- a legitimate regular window/railing/tile rhythm remains admissible under an explicit/derived
  regular-pattern classification;
- a fixture of repeated block-character skeletons analogous to the pink-city ninjas forces
  instance-scale crop evidence before the pass can be artistically accepted;
- a crop exposing a railing/architecture line passing through a key character cannot be closed as
  “character readability resolved” from whole-frame evidence alone;
- local crop selection uses exact source-document coordinates and does not replay the artistic
  mutation;
- parameter jitter/randomization alone is never recorded as structural variation;
- tool success, pixel delta, primitive count or a satisfied operation-local “objects were added”
  target cannot by themselves close the artistic review;
- repository tests cover exact-copy, transform-only-copy, jitter-only-copy, structural-variation and
  intentional-rhythm controls; held-out human calibration of borderline perceptual cases is tracked
  under the later critic-calibration block rather than reopening this machine-correctness task.

**Internal ordering inside P0-B:** close frame/evidence/incarnation/restore-proof invariants
(P0-B.3/.4/.5/.6/.7) before making P0-B.2 recovery policy authoritative. P0-B.1 and P0-B.8 may
proceed in parallel because they are independent review-correctness defects; P0-B.8 must be closed
before using repeated small-object/character passes as evidence for human artistic acceptance.

---
