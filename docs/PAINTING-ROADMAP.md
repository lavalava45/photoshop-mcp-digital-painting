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

## Priority order

The remaining work should be executed in this order:

1. **P0-0 — final UXP migration live acceptance:** close the remaining live-only
   **13a.6.1 / 13c.7** gate before treating the UXP migration as fully accepted.
2. **P0-A — host routing / CoS attribution:** Tasks **1 → 3 → 2 → 4**.
3. **P0-B — accepted-state recovery:** Task **21a**.
4. **P0-C — human critic calibration / stop-decision calibration:** Tasks **8 / 8a → 8b**, then
   close the residual human claims from Tasks **6, 11 and 13a.1A/13a.1C** from the same labelled
   evidence where possible.
5. **P1 — progressive refinement + human artistic acceptance:** Task **23 → 22 → 15d.3**,
   then the real-artwork artistic-preference part of Task **21**.
6. **Conditional work only after evidence:** Task **5** if ordinary ChatGPT/CoS routing remains
   unreliable; Task **10** only if Task 8/8a demonstrates measurable decision-quality gain.
7. **P2 — optional exploration:** Task **15c**.

Rationale:

- Final UXP live acceptance comes first because the implementation is source-complete but the
  post-P1/P2/P3 behavior/no-focus-steal/no-replay gate is still live-pending.
- Host routing comes next because losing the established Photoshop/CoS route can bypass the entire
  painting architecture regardless of its internal quality.
- Accepted-state recovery comes next because a detected regression is only operationally useful if
  the ordinary Painter/Guard path can return to a known-good state without manual Photoshop-history
  arithmetic, mutation replay or an out-of-band file-open workaround.
- Critic calibration comes after recovery because it gates any claim of perceptual reliability and any
  broader critic authority; it also decides whether Task 10 should exist at all.
- Progressive refinement comes before final-target fidelity: Task 23 now has a machine-enforced
  de-block-in gate, but its real-Photoshop progression run and blinded human perceptual pack remain
  acceptance gates. Final target fidelity and the remaining compositing/final-selection questions
  follow after that.
- Optional 3D/reference support should not compete with routing or calibration work.

---

## P0-0 — Final UXP migration live acceptance

The P1/P2/P3 source migration is complete and the current rebuilt child/UXP companion revision has
already passed the load-and-revision preflight. What remains is one final **real Photoshop behavioral
acceptance** on a disposable document. This is not another implementation phase unless the live run
finds a defect.

The 2026-09-24 prerequisite smoke did find and close one concrete runtime defect before this final
acceptance: after a Photoshop restart, a fresh document reused historical numeric `document_id=59`
and initially inherited the old Guard art-run binding. Guard now treats every successful guarded
`create_document` / `open_image` bootstrap as a new document incarnation, resets stale
document-scoped state/barriers, and sequence-bounds history to the current incarnation. The live
retest superseded the old `run-01` binding, rebound the recycled id to fresh `run-05`, completed
a real UXP visual pass with preview/verdict closure, left no Guard debt, and observed zero Photoshop
foreground transitions / legacy helper processes in the bounded trace. This fixes the smoke blocker
but **does not by itself close P0-0**: the representative P1/P2/P3 no-replay behavioral trace below
is still the acceptance gate.

**Acceptance**

The final disposable run must prove all of the following on the current post-migration build:

1. representative **P1/P2/P3** operations execute successfully with UXP selected;
2. Photoshop does **not** steal foreground/focus during the accepted UXP-path trace;
3. no unexpected COM/ExtendScript helper process appears during steps claimed as UXP-path evidence;
4. after any UXP dispatch/claim/uncertainty/failure there is **zero cross-backend replay** through
   ExtendScript/COM;
5. Guard finishes the run without pending reports/acks, uncertain operations, unresolved visual
   verdict debt or active-job debt;
6. durable evidence is recorded and the remaining **13a.6.1** and **13c.7** rows in
   `docs/roadmap-final-acceptance-matrix.md` are changed from `live-pending` to `live-pass` only
   if the run actually proves those conditions.

Use `docs/compact-v2-live-acceptance-plan.md` as the detailed execution/evidence procedure. Keep
`photoshop_save_document` and `photoshop_neural_filter` as intentional UXP-only/fail-closed
exceptions; ordinary migrated tools may use ExtendScript/COM only when that backend is selected
**before** any UXP dispatch.

---

## P0-A — ChatGPT / CoS route integrity

### Task 1 — Reproduce and classify the ImageGen → CoS failure

**Priority:** first.

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

## P0-B — Accepted-state recovery

### Task 21a — One-action restore of an accepted anchor/checkpoint after regression

**Priority:** immediately after route integrity and before human critic authority is expanded.

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
4. human/critic review marks the later state as a regression relative to the registered anchor;
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

## P0-C — Human critic calibration and decision-quality validation

### Tasks 8 / 8a — Human adjudication of the isolated critic

**Priority:** highest remaining painting-quality task after route integrity and accepted-state recovery.

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
- stylized/surreal cases where ordinary-world assumptions should not trigger correction.

Human reference judgments must be recorded before critic answers are used to adjudicate disputed
cases. Keep producer reports, prior verdicts and expected answers out of critic input.

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

The machine implementation is complete and belongs to CHANGELOG.md: the existing durable
Art Director state now carries a subject-agnostic refinement_check, and the existing Guard
DETAIL / MICRO_DETAIL transition fails closed while lower-frequency form/block-in debt remains.
Texture-only change cannot close that debt, exact current-frame evidence is required, restart/resume
preserves the state, and intentional flat/graphic style may bypass realism only through an exact
declared style_contract criterion.

The disposable live Photoshop progression is now complete through the canonical
Chat_On_Steroids_Plugins → dist/cos-plugin.js → embedded Guard → UXP route. On disposable document
1526, the exact flat BLOCK-IN frame (`task23-live-blockin-20260922-b`, SHA `043661a7…`) produced
Value PASS + Refinement FAIL and a DETAIL request was rejected before Photoshop dispatch with
`refinement_debt_unresolved`. After actual FORM_AND_LIGHT modelling, the exact frame
`task23-live-form-finalize-20260923-b` (SHA `ee0ff107…`) received exact-current-frame Value PASS and
Refinement PASS. DETAIL then executed as `task23-live-detail-admitted-20260923-f` (SHA `ed2c41e0…`)
with a matched before/after focus envelope and meaningful subtle-local delta. Both Planner tasks and
the Art Director directive completed, all Guard closure debt was cleared, and the final layered PSD
is `processes/task23-progressive-refinement-process/run-01/task23-progressive-refinement-final.psd`.

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
- the live disposable run demonstrates the same stage gate through the rebuilt canonical runtime,
  with exact current-frame evidence and Guard closure;
- live disposable stage-gate acceptance is complete; until the blinded human labels exist, status is
  **machine-complete / live-pass / human-gate-pending**.

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
- deleting historical backend source solely for cleanliness when production reachability is already
  fail-closed.

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
4. no resurrection of retired public contracts or ExtendScript/COM production dispatch;
5. build/typecheck/lint/policy verification appropriate to the touched area;
6. real Photoshop/CoS host acceptance when the claim depends on real host or Photoshop behavior;
7. human-labelled evidence when the claim is perceptual/artistic/calibration-related;
8. updates to this roadmap, `CHANGELOG.md` and canonical acceptance docs rather than accumulating
   another temporary completion log.

Tool success, comparison SHA, pixel delta, layer creation and mocked critic verdicts are never, by
themselves, proof of artistic correctness.
