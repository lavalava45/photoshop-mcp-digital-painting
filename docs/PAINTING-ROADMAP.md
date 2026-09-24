# Painting Quality Roadmap

Last updated: 2026-09-24

This file is the canonical **forward-looking TODO** for the digital-painting project.
Completed work belongs in `CHANGELOG.md`; detailed acceptance evidence remains in
`docs/roadmap-final-acceptance-matrix.md`, Git history and the referenced test/live-evidence
artifacts.

The current canonical painting lane is compact-v2, Guard-controlled and UXP-first with a bounded
ExtendScript/COM fallback that may be selected only before any UXP dispatch. Do not reintroduce the
retired controller/daemon or raw-script bypass, and never add cross-backend replay after UXP
dispatch/claim/uncertainty/failure.

As of 2026-09-24, deterministic COMPOSITION / OBJECT / MICRO review selection and same-operation
read-only crop escalation are baseline compact-v2 Guard behavior rather than a remaining roadmap
item. A later global architecture/logic audit found residual correctness gaps around nested review
coverage, durable evidence reuse and frame/recovery semantics; those gaps are tracked below without
reopening the completed multiscale implementation itself. Future roadmap work must preserve
whole-frame context, source-document crop coordinates, existing local BEFORE/AFTER significance
evidence, stale-evidence rejection and no-mutation-replay semantics. The implementation/live
evidence belongs in `CHANGELOG.md` and the acceptance matrix.

## Priority order

The remaining work should be executed in this order. **P0-0 is closed as a code-integrity block and
is retained below only as a canonical architecture invariant. P0-1 is closed and recorded in
`CHANGELOG.md` / the acceptance matrix.**

1. **P0-2 — final UXP migration live acceptance:** rerun the remaining real-Photoshop
   **13a.6.1 / 13c.7** gate against the current rebuilt runtime.
2. **P0-A — host routing / CoS attribution:** Tasks **1 → 3 → 2 → 4**.
3. **P0-B — Guard state/evidence/review correctness:** close the residual
   multiscale/recovery/frame/evidence defects found by the global audit **and** the reproduced
   mechanical-patterning review failure before expanding recovery or critic authority.
4. **P0-C — accepted-state recovery:** Task **21a**.
5. **P0-D — human critic calibration / stop-decision calibration:** Tasks **8 / 8a → 8b**, then
   close the residual human claims from Tasks **6, 11 and 13a.1A/13a.1C** from the same labelled
   evidence where possible.
6. **P1 — human artistic acceptance:** Task **23 human pack → 22 → 15d.3**,
   then the real-artwork artistic-preference part of Task **21**.
7. **Conditional / P2 only after evidence:** Task **5** if ordinary ChatGPT/CoS routing remains
   unreliable; Task **10** only if Task 8/8a demonstrates measurable decision-quality gain; Task
   **15c** remains optional exploration.

Rationale:

- The global-audit P0-0 blockers are now closed at the code-contract level: pinned document identity
  is enforced at the actual UXP/legacy dispatch boundaries, Guard execution is explicit/default-deny,
  raw script is retired from compact-v2, and upstream `photoshop_recipe_*` workflows are deliberately
  excluded from the canonical painting lane rather than migrated into it.
- Repository verification is now deterministic: source-only Vitest discovery is fixed, production
  builds/packages exclude compiled tests, matrix-cited tests are drift-checked, CI runs the canonical
  gate, and gitignored live evidence has a committed hash ledger.
- Final UXP live acceptance is therefore the next remaining gate.
- Host routing comes next because losing the established Photoshop/CoS route can bypass the entire
  painting architecture regardless of its internal quality.
- Guard state/evidence correctness comes before higher-level recovery/calibration because a review
  system must not lose broad must-fix coverage, treat read-only observations as artistic frames,
  accept declarative rollback, or reuse unverifiable crop evidence.
- Accepted-state recovery comes next because a detected regression is only operationally useful if
  the ordinary Painter/Guard path can return to a known-good state without manual Photoshop-history
  arithmetic, mutation replay or an out-of-band file-open workaround.
- Critic calibration comes after recovery because it gates any claim of perceptual reliability and any
  broader critic authority; it also decides whether Task 10 should exist at all.
- Progressive refinement comes before final-target fidelity: Task 23 already has a machine-enforced
  de-block-in gate and a completed disposable real-Photoshop progression run; only its blinded human
  perceptual pack remains as the forward acceptance gate. Final target fidelity and the remaining
  compositing/final-selection questions follow after that.
- Optional 3D/reference support should not compete with routing or calibration work.

---

## P0-0 — Canonical execution integrity invariants — **closed 2026-09-24**

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

## P0-2 — Final UXP migration live acceptance

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

### P0-2 follow-ups discovered during final acceptance

These do **not** invalidate the bounded `run-10` P0-2 acceptance, but they are concrete code/contract
gaps found while producing it and must remain visible:

1. **Explicit document activation can foreground Photoshop.** Diagnostic `run-09` recorded one
   Photoshop foreground transition exactly at UXP `document.activate`. Either make
   `photoshop_set_active_document` background-safe or explicitly classify it as UI-activating and
   prevent it from being used inside no-focus canonical traces.
2. **Selection-mask capability/compiler mismatch.** The capability snapshot advertises
   `selection-mask` as available, but the compact multi-action compiler currently cannot represent
   that mask method as a valid VisualMicroPlan and rejects it before dispatch. Align advertised
   availability with executable compact semantics.
3. **Negative regression sentinel normalization.** A compact visual observation carrying
   `regression: "none observed"` is currently treated as truthy regression evidence. Normalize
   explicit negative sentinel text so a resolved visual pass cannot be mislabeled `regression`.

---

## P0-A — ChatGPT / CoS route integrity

### Task 1 — Reproduce and classify the ImageGen → CoS failure

**Priority:** first.

**Current handoff state — 2026-09-24**

- P0-0, P0-1 and P0-2 are closed; the active roadmap frontier is now P0-A / Task 1.
- Historical project evidence already proves one **real attribution failure with connector visibility
  preserved**: a CoS session was recorded as `Unattributed activity` with no conversation id while
  Photoshop reads, Guard status and Guard cycle remained callable. This is evidence for
  `attribution_failure`, not for `connector_visibility_failure`.
- The current continuation independently reproduces the same diagnostic boundary: Core and Photoshop
  MCP calls continue to execute while their returned identity notice says the exact ChatGPT
  conversation is not known and the call is filed as `Unattributed`. Therefore current
  `Unattributed` state must not be described as “CoS/Photoshop disappeared”.
- This does **not** yet prove that the historical accidental ImageGen route and the attribution
  failure are the same incident. Task 1 remains open until one deterministic same-conversation
  real-host trace captures the route transition itself.
- A first attempt to recover the historical local chat transcript through the advertised CoS Core
  `session` surface failed concretely with `McpServerError: Tool session not found`. Other Core
  and Photoshop tools continued working, so this is a narrow session-record lookup/backend issue,
  not evidence that Core or the Photoshop connector is unavailable.
- **Next step in the new chat:** audit the Chat On Steroids fork/session-recording and attribution
  path to determine (a) where `Unattributed` activity is persisted, (b) why the `session` tool is
  present in the callable registry but its backend lookup returns `Tool session not found`, and
  (c) whether the historical “ты случайно запустил imagegen” conversation can be recovered as exact
  local evidence without invoking ImageGen again. Then use that evidence to design the minimal
  deterministic real-host reproduction required below.

The historical failure must be classified from one deterministic real-host trace, not from model
prose. Capture one same-conversation sequence:

```text
healthy attributed CoS Photoshop read
→ ordinary image/drawing/editing continuation language
→ unexpected host-native visual route or tool-selection failure
→ next attempted CoS/Photoshop continuation
```

Record, where observable:

- whether the CoS/Photoshop tool catalog is still offered to the model;
- CoS request id and conversation/page/Fiber identity evidence;
- attribution method: exact request id vs `Unattributed`;
- whether the plugin call is executed, refused, not selected, or genuinely unavailable;
- whether Guard status/resume remains reachable;
- page/browser reload or connector reattachment events;
- the exact host-visible failure before any claim that CoS is unavailable.

Classify the incident as one or more of:

1. `routing_failure` — another visual engine was selected although the Photoshop workflow was
   already established;
2. `attribution_failure` — CoS received/executed the call but could not prove conversation
   ownership;
3. `connector_visibility_failure` — the CoS/Photoshop surface genuinely disappeared from the host
   turn;
4. `model_recovery_failure` — the tools remained available/recoverable but were not checked before
   the model declared them absent.

**Acceptance**

- one minimal reproducible real-host transcript/trace exists;
- classification is evidence-based;
- a successful Photoshop mutation is never replayed to repair attribution;
- the same test can be rerun after every routing/rebind change.

### Task 3 — CoS attribution/rebind survival across non-CoS host-tool turns

**Priority:** immediately after Task 1.

This is an independent known failure class and is currently more actionable than adding more
painting-side routing text. The likely implementation owner is the **Chat On Steroids host/rebind
layer**, while Photoshop Guard state must remain conversation-independent.

Using Task 1 evidence, determine:

- whether the next CoS invocation carries a request id;
- whether URL/page/Fiber conversation identities agree;
- whether calls temporarily land in `Unattributed`;
- whether existing late-attribution repair can rebind them;
- whether the companion/browser connection actually changed;
- which exact missing event/evidence prevents reattachment if repair fails.

Do not bind Photoshop journal/art-run state to browser attribution. After rebind, a safe Guard
status/resume read must recover the pre-existing run without repeating work.

**Acceptance**

- a native/unrelated host-tool turn can be followed by a CoS Photoshop read in the same chat;
- exact attribution is restored when sufficient evidence exists;
- temporary `Unattributed` calls never cause replay of a successful mutation;
- Guard resume reaches the pre-existing document/art-run state;
- when identity truly cannot be proven, the failure is explicit and attribution-specific rather
  than presented as “Photoshop/CoS no longer exists”.

### Task 2 — Real-host sticky Photoshop route acceptance

**Priority:** after the Task 3 rebind path is trustworthy.

The repository already contains sticky-route metadata/instructions and a static routing corpus.
The remaining work is **real ChatGPT + CoS host acceptance**, because repository tests cannot prove
which host tool the model actually selects.

Run the established-workflow corpus in Russian and English, including:

- “продолжи изображение”;
- “дорисуй фон”;
- “улучши картинку”;
- “нарисуй здесь…”;
- “сделай изображение более реалистичным”;
- “continue painting this image”;
- “improve the artwork”;
- terse continuation such as “дальше”.

Run it only after confirming the rebuilt CoS Photoshop child/schema is the one actually serving the
conversation, so a stale process cannot invalidate the result.

**Acceptance**

- an established Photoshop workflow does not switch to another visual execution engine without an
  explicit user mode change;
- ordinary words such as “image”, “draw”, “рисуй”, “картинка” remain usable;
- failures are recorded as routing/visibility/attribution evidence rather than inferred from prose.

### Task 4 — Host recovery wording and three-state availability model

**Priority:** after Tasks 1–3 provide real observability.

Align CoS-facing guidance and recovery behavior around exactly three states:

```text
tool not selected
tool available but caller unattributed
tool/connector genuinely unavailable
```

The last state may be claimed only after a concrete availability check fails.

Preferred recovery order for an established Photoshop workflow:

```text
discover/use existing CoS Photoshop surface
→ safe Guard status/resume read
→ recover exact pending state if present
→ continue
```

Never repair binding by repainting or replaying a successful mutation.

**Acceptance**

- host/model guidance does not collapse “not selected” or “unattributed” into “unavailable”;
- concrete failure evidence is surfaced when the connector is genuinely unavailable;
- recovery preserves existing Guard/art-run state.

---

## P0-B — Guard state/evidence/review correctness

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
  intentional-rhythm controls, while held-out human calibration covers whether borderline repeated
  patterns are perceptually objectionable.

**Internal ordering inside P0-B:** close frame/evidence/incarnation/restore-proof invariants
(P0-B.3/.4/.5/.6/.7) before making P0-B.2 recovery policy authoritative. P0-B.1 and P0-B.8 may
proceed in parallel because they are independent review-correctness defects; P0-B.8 must be closed
before using repeated small-object/character passes as evidence for human artistic acceptance.

---

## P0-C — Accepted-state recovery

### Task 21a — One-action restore of an accepted anchor/checkpoint after regression

**Priority:** after P0-B state/evidence correctness and before human critic authority is expanded.

Low-level anchor/checkpoint persistence and exact restoration mechanisms already exist, but a real
painting run exposed a remaining operational gap: after a regression, the ordinary Painter/Guard
workflow may still require manual journal inspection and Photoshop-history-step arithmetic to return
to a known-good state.

The canonical recovery path should allow the model to reference a previously registered accepted
anchor/checkpoint and request one bounded Guard-owned recovery action. Internal implementation may
perform multiple Photoshop operations if required, but the host/model contract must remain one
logical recovery request.

The recovery path must not require:

- manual counting of Photoshop history steps;
- manual inspection of operation journals to derive undo counts;
- replay of successful visual mutations;
- direct/out-of-band file opening that bypasses Guard;
- silent switching to another Photoshop document to satisfy a pinned target.

**Acceptance**

Run a disposable live acceptance with all of the following predeclared before the regression is
introduced:

1. register one accepted anchor/checkpoint with stable identity and exact whole-frame preview SHA;
2. record the relevant layered document state needed for parity checking;
3. perform at least two later visual mutations, including at least one multi-history-step/auto-chunked
   mutation;
4. a predeclared human-labelled fixture marks the later state as a regression relative to the
   registered anchor; a critic may substitute only if that critic already has calibrated authority
   for this decision class;
5. from that degraded state, issue exactly one **logical Guard recovery request** referencing the
   accepted anchor/checkpoint identity rather than a computed undo count.

The task passes only if:

- the recovery request is admitted through the canonical Guard path and is fail-closed on missing,
  mismatched or stale anchor identity;
- the visible composite after recovery has the exact registered anchor preview SHA;
- the layered state matches the registered anchor for all contractually preserved properties,
  including layer ordering/visibility/opacity, active-layer semantics and selection state where
  applicable;
- document targeting remains fail-closed and no hidden tab/document switch is used to make the
  restore succeed;
- no successful unrelated mutation is replayed;
- no model-visible manual history-step arithmetic or journal-derived undo count is required;
- Guard closes the recovery with no remaining preview/report/ack/verdict/reconciliation debt;
- repeating the same recovery acceptance from the same degraded fixture produces the same restored
  visual/state result.

If exact anchor SHA cannot be restored by the proposed implementation, Task 21a remains open; do not
weaken acceptance to a vague “looks similar” claim merely to close the task.

---

## P0-D — Human critic calibration and decision-quality validation

### Tasks 8 / 8a — Human adjudication of the isolated critic

**Priority:** highest remaining painting-quality task after route integrity, Guard correctness and
accepted-state recovery.

The machine infrastructure is already present. The remaining work is real human reference
judgment, not more critic plumbing.

Use:

- review pack: `task8a-review-pack/review.html`;
- human reference file generated from the pack/template;
- validator: `node scripts/task8a-calibration.mjs validate`.

The held-out set must include:

- genuine improvements;
- regressions;
- ambiguous tradeoffs;
- identical before/after pairs;
- locally successful edits that weaken the whole;
- useful simplifications;
- lost accidental strengths;
- mechanically repeated character/creature/decorative motifs, including transform-only and
  parameter-jitter variants;
- legitimate intentional regular rhythms, so calibration measures false alarms as well as detection;
- stylized/surreal cases where ordinary-world assumptions should not trigger correction.

Human reference judgments must be recorded before critic answers are used to adjudicate disputed
cases. Keep producer reports, prior verdicts and expected answers out of critic input.

The existing `world-consistency-critic` fixture remains useful as plumbing/suppression coverage, but
its injected expected `flaggedIds` are not independent evidence of critic detection accuracy and must
not be promoted into a reliability claim.

Compare, under the same evidence/time budget:

1. current image comparison + style/Art Director state;
2. the same evidence plus the bounded critic/relational context being evaluated.

Measure:

- additional true detections;
- misses;
- false alarms;
- appropriate abstentions/uncertainty;
- changed keep/rollback/global-promotion decisions;
- latency/cost;
- consistency on repeated/order-balanced cases.

**Acceptance**

- grant narrow critic authority only where held-out human-labelled evidence shows useful reliability
  at acceptable overhead;
- otherwise keep the critic advisory/shadow-only or restrict it to narrower tasks;
- agreement between models is never treated as truth;
- no mandatory second-model call per layer/stroke;
- mocks/tool success/pixel delta do not substitute for human calibration.

### Task 8b — Calibrate the decision to STOP / FINALIZE

**Priority:** immediately after the base Task 8/8a calibration corpus is labelled.

A painting system that can always propose another local pass is not complete. The critic/Art
Director path must also be evaluated on whether it can recognize when the current frame is already
good enough to finalize and when a further edit would create more regression risk than expected
benefit.

Extend the held-out human-labelled corpus with three explicit decision classes:

~~~
FINALIZE_NOW
CONTINUE_REQUIRED
CONTINUE_OPTIONAL_OR_AMBIGUOUS
~~~

The corpus must include:

- already-good frames where no user-critical mismatch remains;
- frames with at least one clearly unmet hard perceptual requirement;
- frames with a real but low-value local imperfection whose correction carries meaningful global
  regression risk;
- frames where a later “improvement” loses an accidental strength or weakens the whole;
- ambiguous tradeoffs where abstention or human review is appropriate.

Human labels must be recorded before critic/Art Director answers are used for adjudication. The
evaluation manifest must predeclare the case counts, repeat/order-balancing procedure and any numeric
pass thresholds before results are unblinded.

Measure separately:

- false-finalize rate on CONTINUE_REQUIRED;
- unnecessary-continue rate on FINALIZE_NOW;
- abstention/review rate on ambiguous cases;
- changed keep/continue/finalize decisions versus the current baseline;
- consistency across repeated/order-balanced evaluation;
- whether a FINALIZE_NOW decision actually prevents another visual mutation.

**Acceptance**

- **zero** held-out false FINALIZE_NOW decisions are allowed on cases whose human label is
  CONTINUE_REQUIRED because an explicit hard user requirement is still visibly unmet;
- on the human-labelled FINALIZE_NOW subset, the stop-aware path must reduce unnecessary
  continuation decisions versus the same-evidence baseline, not merely produce shorter or more
  confident explanations;
- any predeclared repeat/order-consistency threshold must be met before stop authority is promoted;
- CONTINUE_OPTIONAL_OR_AMBIGUOUS cases may abstain/escalate rather than being forced into a false
  binary decision;
- once FINALIZE_NOW is accepted, only save/export/final Guard closure operations may follow; no
  further visual mutation may be auto-scheduled without new user input or new contradictory
  evidence;
- tool success, number of completed passes, elapsed time, pixel delta or “more detail” are never
  sufficient evidence to finalize;
- if these gates fail, stop/finalize judgment remains human/Art-Director-controlled or advisory-only
  rather than being granted automatic authority.

### Task 6 — Remaining World Consistency Critic human gate

The object-agnostic critic implementation is complete. Only these empirical claims remain:

- known support/contact/connectivity/intersection failures are detected more reliably than the
  previous baseline;
- explicit stylization/surreal intent does not create an unacceptable systematic false-positive
  pattern.

Use the Task 8/8a human-labelled evidence rather than creating a second evaluation stack.

**Acceptance**

- relation-specific held-out results support or reject the two claims above;
- unsupported claims remain advisory and are not promoted to runtime authority.

### Task 11 — Remaining unforeseen-regression human gate

Scheduling and bounded relation-aware review mechanics are complete. The remaining perceptual claim
is whether an independent whole-image look actually surfaces unforeseen regressions often enough to
be useful.

Evaluate this from the same held-out review/calibration process where possible.

**Acceptance**

- observed unforeseen-regression detection is documented against human labels;
- false alarms and abstentions are reported;
- no recursive critique loop is added to compensate for weak detection.

### 13a.1A / 13a.1C — Calibrated critic claims

The compact-v2 isolation/provenance/state mechanics are complete. The remaining claims inherit the
Task 8a gate:

- an isolated critic can reliably reject a technically admissible but visibly inadequate result;
- any transition/final critic authority is calibrated rather than inferred from repository mocks.

Do not reopen compact-v2 transport/state-machine work to address these human claims.

---

## P1 — Human artistic acceptance on representative real artwork

### Task 23 — Progressive form refinement / de-block-in

**Priority:** first P1 gate, before final-target fidelity.

Machine implementation and disposable live progression are already complete and belong in
`CHANGELOG.md` / the acceptance matrix rather than this forward-looking TODO. The remaining Task 23
work is only the blinded human perceptual pack below.

Only the following acceptance work remains forward-looking:

1. **Blinded human perceptual pack**
   - positive modelled-form case;
   - texture-only negative control;
   - residual-block-in negative control;
   - destructive-overdetail negative control;
   - intentionally flat/graphic stylized control.

The evaluator receives only exact BEFORE/AFTER frames, the original target/style contract and the
predeclared Task-23 questions from docs/painting-evaluation-suite.md; tool logs, layer/stroke
counts, producer verdicts and the expected answer stay hidden.

**Acceptance**

- the positive case is judged to have genuinely improved major/secondary form rather than merely
  added marks or texture;
- texture-only, residual-block-in and destructive-overdetail controls are rejected;
- the stylized-flat control is not incorrectly pushed toward realism;
- machine/live stage-gate acceptance is already satisfied; until the blinded human labels exist,
  status remains **machine-complete / live-pass / human-gate-pending**.

### Task 22 — Final target fidelity / prompt-to-frame acceptance

**Priority:** second P1 gate, after Task 23 and before compositing polish or anchor preference.

Before a real artwork is called finished, evaluate the exact final frame against the important
user-visible perceptual requirements in the original request. A readable composition or technically
successful Guard run is not enough if the requested style, realism level, atmosphere, lighting,
material treatment or other explicit visual target is still visibly wrong.

For each representative acceptance case, prepare a concise review checklist from the original user
request before looking at the final verdict. Classify only user-explicit or genuinely necessary
visual requirements as:

~~~
hard_perceptual
soft_preference
technical/non-visual
~~~

Do not turn this checklist into a new mandatory production schema or a universal aesthetic score.
It is an acceptance artifact for testing prompt-to-frame fidelity.

The human evaluator receives:

- the original user request;
- the exact registered final whole-frame preview;
- the predeclared requirement checklist;
- no tool-success, pass-count, expected-answer or producer-verdict cues.

For every hard_perceptual item, record exactly one:

~~~
MET
NOT_MET
UNCERTAIN
~~~

The representative set must include at least:

- one positive control where subject/composition/style requirements are all judged met;
- one negative control where subject and composition are broadly correct but the explicitly
  requested style/realism/finish level is wrong;
- one case where lighting/atmosphere is a central explicit target;
- one case where material/detail treatment is explicit enough that a flat block-in should not pass
  as finished.

**Acceptance**

- no final state is accepted while any hard_perceptual requirement is NOT_MET;
- any UNCERTAIN hard requirement blocks automatic finalization and requires human adjudication;
- when style/realism level is explicit, a content/composition match cannot compensate for a style
  miss;
- the negative style/finish control is rejected even if the scene content is recognizable;
- the positive control is accepted without requiring extra polishing merely because another edit is
  possible;
- judgment is made from the exact final whole-frame evidence, not from layer count, tool success,
  pixel delta or the fact that the composition is readable;
- the recorded result identifies which user-visible requirement blocked acceptance when a case
  fails, so the next pass addresses a concrete mismatch rather than generic “make it better” advice.

### Task 15d.3 — Compositing/material/atmosphere gain

The editable technical fixture already exists. A human must judge whether the representative
before/after:

- improves material/depth/atmosphere rather than merely increasing texture;
- preserves important structure;
- avoids letting blend/mask effects substitute for unresolved form/composition problems.

**Acceptance**

- human judgment is recorded against the exact registered BEFORE/AFTER evidence;
- technical execution facts remain separate from the artistic conclusion.

### Task 21 — Real-artwork artistic preference over anchors

Low-level hash/path-backed anchor restore is technically proven; Task 21a separately covers whether
the ordinary Painter/Guard workflow can invoke that recovery as one bounded action after a real
regression. This Task 21 remains purely about whether the selected anchor is actually artistically
preferable in a representative real artwork.

Use a human comparison when a real run contains a meaningful current-vs-anchor tradeoff.

**Acceptance**

- the preference is recorded as human artistic judgment, not inferred from detail count, pixel
  difference or successful restore;
- if the later state is judged weaker, the existing anchor/restore machinery is used rather than
  silently finalizing it.

---

## Conditional work — do not implement before its trigger

### Task 5 — Thin Photoshop-only host with fail-closed tool allowlist

**Current priority:** inactive contingency.

Activate only if Tasks 1–4 show that ordinary ChatGPT + CoS still cannot preserve the established
Photoshop route reliably enough, or if a hard architectural guarantee is explicitly required.

If activated, first build only a minimal headless/CLI proof:

1. start independently of ChatGPT/CoS;
2. connect to the existing Photoshop MCP;
3. expose only explicitly approved Photoshop MCP tools;
4. prove unrelated visual engines/tools are absent from the acting model's catalog;
5. keep embedded Guard required;
6. deliver fresh Photoshop preview evidence back to model vision;
7. execute and continue one visual request end to end;
8. survive host restart without losing Guard/art-run state.

Reuse the existing Guard, Planner/Painter state, UXP transport and art-run persistence. Do not create
a second controller or duplicate project tree.

Only after that proof should any UI/panel or hard commentary-delivery ACK barrier be considered.

**Acceptance for activation**

- Tasks 1–4 still reproduce unacceptable route substitution after softer fixes, or a hard allowlist
  guarantee is explicitly required;
- the host/API surface actually supports the needed tool allowlist/tool-choice control;
- the added host complexity is justified by measured reliability gain.

### Task 10 — Compact artistic relationships / achieved-quality memory

**Current priority:** blocked by Task 8/8a evidence.

Implement only if human calibration shows that compact relational memory measurably improves
keep/rollback/global-promotion decisions or catches losses the baseline repeatedly misses.

If activated:

- keep only a small number of causal artistic hypotheses/achieved qualities;
- distinguish user constraints, chosen artistic hypotheses and emergent valuable qualities;
- bind every stored relation to observed frame/anchor evidence;
- allow relations to become questioned/retired;
- keep state compact enough for normal continuation;
- never hard-code generic aesthetic preferences as universal truth.

If the experiment only lengthens explanations without changing decisions, close Task 10 as
**not adopted** rather than adding another mandatory schema.

---

## P2 — Optional exploration

### Task 15c — Reference / 3D construction support

This is not required for the canonical painting lane.

For proportion-sensitive subjects, optionally evaluate a verified reference or bounded 3D blockout
as construction evidence for silhouettes, landmarks, masks, depth/occlusion or plane relationships.
Treat projected/estimated geometry as evidence with provenance and uncertainty, not proof of
artistic quality.

**Acceptance before adoption**

- a bounded comparison demonstrates useful structural preservation and/or throughput gain over the
  unsupported workflow;
- remaining model/review errors are reported;
- a technically correct render is not described as artistic mastery;
- no mandatory 3D dependency is added to ordinary painting.

---

## Work deliberately not prioritized

Do not optimize these merely because they are measurable:

- migrating every remaining Photoshop primitive to UXP when it is not on the canonical required
  painting path;
- maximizing mutations per bundle;
- caching arbitrary Photoshop state without invalidation proof;
- weakening preview/verdict/recovery evidence to save calls;
- optimizing raw tool count instead of semantic-cycle wall time;
- deleting historical backend source solely for cleanliness **after** P0-0 has proven production
  reachability fail-closed; reachability proof comes before source cleanup.

Current measurements show that real semantic-cycle latency is often dominated by the
host/model/visual-evaluation interval rather than Photoshop dispatch alone. New speed work must
target a measured bottleneck.

## Explicit non-goals

Do not add these without new evidence:

- universal numeric composition/style/expressiveness scores;
- one aggregate artistic “quality score”;
- full Art Director critique after every stroke/pass;
- mandatory rendered thumbnails for every scene;
- more Guard safety layers without a reproduced integrity failure;
- large required schemas whose fields do not change execution or review behavior;
- category-specific anatomy/hand/object pipelines as the default world-consistency mechanism;
- a second Guard/controller or duplicate art-run persistence tree.

## Upstream integration policy

Upstream changes must continue to be evaluated selectively against the current fork. Do not perform
wholesale merges that can restore retired controller/raw-script paths or overwrite the compact-v2
UXP-first/pre-dispatch-fallback painting architecture.

Interrupt this roadmap for upstream work only when a change:

- fixes a reproduced current bug;
- is required for host/API compatibility;
- or provides a measured material advantage relevant to an active task.

## Validation policy for remaining roadmap work

Every implemented item should include, as applicable:

1. a minimal reproduced failure/need or a predeclared human-evaluation question;
2. fail-closed or explicitly bounded semantics;
3. targeted regression tests for machine behavior;
4. no resurrection of retired public contracts or raw-script bypass; any allowed
   ExtendScript/COM fallback must be selected before UXP dispatch, remain document-targeted and never
   be used for cross-backend replay;
5. preservation of the multiscale visual-review barrier: whole-frame context at every review level,
   exact source-coordinate escalation crops, and zero artistic mutation replay during evidence enrichment;
6. the canonical non-Photoshop repository gate runs for every code change, plus any area-specific
   build/typecheck/lint/policy verification required by the touched subsystem;
7. real Photoshop/CoS host acceptance when the claim depends on real host or Photoshop behavior;
8. human-labelled evidence when the claim is perceptual/artistic/calibration-related;
9. updates to this roadmap, `CHANGELOG.md` and canonical acceptance docs rather than accumulating
   another temporary completion log.
10. for anti-mechanical-patterning work, paired controls for exact/near copy, transform/jitter-only
    variation, genuine structural variation and intentional regular rhythm; randomization is not an
    accepted substitute for structural artistic variation.

Tool success, comparison SHA, pixel delta, layer creation and mocked critic verdicts are never, by
themselves, proof of artistic correctness.
