# Photoshop Guard Architecture

This document records the current reliability architecture and the intended
separation between the AI host, the Photoshop workflow guard, and the Photoshop
executor. It is the canonical high-level design note for the controller work that
grew out of the 2026-09 reliability audit.

← Back to [README](../README.md)

## 1. Goal

The project should keep a small stable host-facing contract while Photoshop mutations
remain deterministic, recoverable, and independently verified. Backward compatibility
with obsolete project-local Guard contracts is not a requirement.

The host must be allowed to update frequently without forcing this repository to
fork or pin the host application merely to preserve Photoshop workflow safety.

The guiding split is:

```text
AI host / Chat On Steroids
        │
        │ ordinary MCP / process transport
        ▼
Photoshop Guard / controller
        │
        │ verified, stateful execution contract
        ▼
Photoshop MCP executor
        │
        ▼
Adobe Photoshop
```

The Guard owns workflow safety. The host may add stronger UI evidence and better
presentation, but Photoshop safety must not depend on host-specific internals.

## 2. Current topology and production state

The canonical production path is now the native guarded Plugins route:

```text
ChatGPT
  ↓
Chat On Steroids Plugins
  ↓ stdio
this fork / dist/cos-plugin.js
  ↓
embedded Guard (journal / barriers / jobs / recovery)
  ↓ internal ToolRegistry dispatch
Photoshop executor
  ↓
Photoshop
```

The earlier Core/controller route still exists in the current tree only while its
remaining dependencies are audited and migrated:

```text
ChatGPT → Chat On Steroids Core → scripts/photoshop-session.mjs
        → persistent repository-local MCP daemon → dist/index.js → Photoshop
```

`photoshop-session.mjs` plus the persistent daemon implements the older external
form of the Photoshop Guard. These responsibilities identify migration requirements,
not a second supported architecture. It owns:

- the durable operation journal;
- immutable operation ids and replay protection;
- controller locking;
- persistent MCP lifecycle;
- async job start/poll/recovery;
- the shared PreviewBarrier;
- visual verdict requirements;
- significance checks and replan rules;
- checkpoint deadlines;
- document pinning expectations;
- semantic operation narrative;
- durable resume/status state;
- Guard operation receipts and acknowledgements.

On 2026-09-17 the controller state machine was migrated into the MCP server itself:

```text
ChatGPT / ordinary MCP host
  ↓
Chat On Steroids Plugins (or another MCP client)
  ↓ stdio
dist/cos-plugin.js
  ↓
embedded Guard (journal / barriers / jobs / recovery)
  ↓ internal ToolRegistry dispatch
Photoshop executor
  ↓
Photoshop
```

The dedicated `dist/cos-plugin.js` entry sets `PHOTOSHOP_GUARD_MODE=required` before
loading the normal server. The public catalog still contains the underlying Photoshop
tool schemas so the model can build a valid nested operation, but a direct public raw
mutation returns `guard_required`. The Guard invokes the underlying handler internally
only after its durable preflight succeeds.

The native route has now passed both offline validation and the dedicated live
CoS/Photoshop acceptance sequence. The current compact-only source catalog is 145 tools / 11 public Guard tools;
publication and schema budget, fail-closed raw mutation gating, direct reads, guarded
mutation + materialized preview + visual verdict closure, async jobs, durable
process-restart resume, fresh-evidence reconciliation, and no-blind-replay behavior.
It is therefore canonical for ordinary Chat On Steroids Photoshop work.

The Guard now also owns a two-level Art Director / Painter state machine. Art Director
reviews are state-only `photoshop_guard_art_director` calls: they persist whole-image
assessment, bounded tasks and a chosen review horizon. Painter visual micro-plans are
admitted only when bound to that directive/task and when their declared change domains
remain within delegated scope. Cadence completion and early interrupt set `review_due`,
which blocks further Painter dispatch until Art Director reviews again.

The Core/controller/daemon path is no longer the production default. It remains in
the repository because current regression/live-test utilities still depend on it and
because it is useful for isolated development, diagnostics, and recovery experiments.
Its eventual removal requires a separate dependency-migration cleanup.

## 3. Target topology

The desired steady state is:

```text
stock/latest COS or another MCP host
              │
              │ standard MCP
              ▼
┌───────────────────────────────────────┐
│ Photoshop MCP Digital Painting Fork  │
│                                       │
│ Guard gateway                         │
│ ├ workflow state machine              │
│ ├ operation journal                   │
│ ├ postcondition verification          │
│ ├ PreviewBarrier / verdict gate       │
│ ├ retry/reconcile policy              │
│ ├ durable in-process jobs             │
│ └ operation receipts                  │
│              │                        │
│              ▼ internal dispatch      │
│ Photoshop ToolRegistry / executor     │
└──────────────────┬────────────────────┘
                   │
                   ▼
              Photoshop
```

The host should be replaceable. The Photoshop executor should be treated as an
executor whose claimed `success` is useful evidence, but not universal proof that
the intended external state change actually happened.

## 4. Ownership boundaries

### Host responsibilities

The host owns concerns that only the host can know:

- whether a specific assistant message actually rendered in the user-visible UI;
- native rendering of structured progress inside the host UI;
- tool discovery and ordinary MCP/process transport;
- host lifecycle and conversation/session presentation.

These capabilities may improve evidence and UX, but they must not own the Photoshop
mutation state machine.

### Guard responsibilities

The Guard owns:

- whether the previous operation is causally acknowledged;
- whether a mutation is allowed to start;
- whether an uncertain mutation may be retried;
- whether a required preview exists;
- which minimum spatial review level (COMPOSITION / OBJECT / MICRO) is required for the pass;
- whether exact local crop evidence requested by a structured finding has been delivered for the
  same operation/document/whole-frame identity;
- whether the exact preview frame was classified;
- whether a visual problem is accepted/corrected/rolled back;
- whether postconditions have been checked;
- whether the workflow is stalled and requires a replan;
- recovery after process/host interruption;
- durable operation and job state.

### Photoshop MCP executor responsibilities

The executor owns:

- Photoshop detection and connection;
- document-target validation;
- ExtendScript/COM/UXP execution;
- atomic Photoshop tools;
- VisualMicroPlan execution primitives;
- state and preview reads;
- returning structured execution outcomes.

## 5. Current Guard protocols

### `photoshop.guard.operation_receipt.v1`

Every completed operation gets durable receipt evidence containing an unpredictable
token. The compact facade resolves and closes that technical evidence internally when
the caller continues with the exact `previous_operation_id` and an honest
`previous_observation`. The model does not copy receipt tokens in the normal loop.

### `photoshop.guard.operation_ack.v1`

The explicit model-authored operation-ack field has been removed from the public compact
schema. The durable acknowledgement record remains internal recovery state and is consumed
behind the compact facade.

The token is recovery data as well as a causal gate. If a durable async operation
finishes but its final poll response is lost, `photoshop_guard_status` /
`photoshop_guard_resume` surface the **same exact pending receipt token** from the
journal rather than minting or accepting a substitute. For a pending visual closure,
resume/status also expose the materialized preview identity (SHA/path) needed for the
verdict. Recovery therefore restores evidence, not execution: the original mutation
remains non-replayable. The compact facade must consume the recovered exact evidence
without asking the model to reproduce protocol tokens.

### `operation.progress.v1`

Semantic progress is transport-neutral and describes the work rather than the
tool transport:

```text
Сейчас: корректирую форму лица
Почему: глаза читаются как символы
Photoshop: mutation выполняется
Следом: локальный before/after preview
```

`cos.host_progress.v1` remains only a compatibility alias for COS builds that know
how to promote the payload into a native progress row.

### `photoshop.guard.capabilities.v1`

The controller reports capabilities rather than requiring a particular host
version. Current capability reporting distinguishes required Guard guarantees from
optional host guarantees.

### `photoshop.guard.review_escalation.v1`

Multiscale review is an additive compact-v2 Guard capability, not a second workflow. The review
profile is derived from durable/compiled facts such as scale, significance mode, action/impact class,
bounded region and same-problem state. Whole-frame evidence remains mandatory at every level.

`previous_observation.review_findings[]` is optional and subject-agnostic. OBJECT/MICRO finding kinds
must carry exact source-document `region_bounds`. If adequate current evidence is missing, the Guard:

1. keeps the original visual operation open;
2. records durable pending review requirements bound to the operation id, pinned document id and
   current whole-frame SHA;
3. performs only read-only `photoshop_get_preview` focus captures, at most two new crops per round;
4. returns the crops through the normal `visual_review` image-delivery path;
5. blocks verdict closure and the next visual mutation until a subsequent observation can classify
   the enriched evidence.

The mutation is never replayed and escalation never receives a new artistic operation id. Status and
resume project the same pending review level, requested/effective regions and crop SHA/path after a
process restart. Crop materialization/path identity is evidence provenance only; the delivery metadata
uses `image_delivered_for_review` and does not claim that the model interpreted the image correctly.

Because `review_findings` is optional and all prior compact requests remain valid, this is explicitly
an additive `photoshop.guard.compact.v2` schema change; no compact protocol revision is required.

## 6. Postcondition verification

The Guard must not equate an executor response of `success` with proof that the
intended world state changed.

Current verified checks include:

- visual mutations require a materialized after-preview;
- visual acceptance requires the exact preview SHA plus a visual verdict;
- PSD checkpoints require a real non-empty file on disk;
- uncertain dispatched work cannot be blindly replayed;
- state/preview evidence used for reconciliation must be fresh and belong to the
  same pinned document.
- escalated crop evidence is stale when its bound whole-frame SHA/document changes, and a changed
  requested region requires fresh evidence.

Future Guard work should add tool-specific state readback where the result is
machine-verifiable, for example layer opacity/name/state or other exact Photoshop
properties.

## 7. Two host capabilities we want upstream

There are two generic host capabilities that are useful enough to propose to the
Chat On Steroids author. They are deliberately not Photoshop-specific.

### A. Verified assistant-message delivery receipt

Desired property:

```text
assistant emits report
       ↓
host observes exact rendered message
       ↓
next tool invocation receives host-created receipt
```

Useful receipt fields include:

- host message id;
- exact text hash;
- delivered/rendered timestamp;
- optional turn id;
- a versioned receipt protocol.

This is additional evidence that the completion prose actually appeared in the UI.
It is valuable for auditable agent workflows, but **must remain optional for
Photoshop safety**. The Guard acknowledgement is the safety boundary.

### B. Structured semantic progress from MCP/tool subprocesses

Desired property:

```text
tool / gateway emits versioned progress object
       ↓
COS recognizes it generically
       ↓
one native progress row is created/revised in the live turn
```

The host should not need Photoshop-specific knowledge. A generic progress payload
needs at least:

- `progress_id`;
- `operation_id` where available;
- state/revision;
- human-readable semantic text.

This allows long-running MCP/gateway operations to communicate meaningful progress
without printing transport labels such as `Called Photoshop tool`.

## 8. Decision if the host author does not add those capabilities

Do **not** maintain a large permanent fork of Chat On Steroids merely for this
project.

The earlier preferred fallback was a small external MCP proxy. The repository now has
a simpler option: the Guard and executor are separate **architectural layers inside the
same MCP server process**. This preserves host independence without introducing another
network/process hop.

An external proxy remains a fallback only if a future host makes the single-process
gateway impossible:

```text
stock/latest COS
      ↓ standard MCP
small external MCP Guard / proxy
      ↓
Photoshop MCP
```

The external proxy should be transparent in both directions while enforcing the
state machine and verifying postconditions. It may reject the next action and
return an explicit required next step when the executor or agent has not satisfied
the workflow contract.

### Continuation watchdog

The embedded Guard also exposes a durable continuation watch. It distinguishes
three different failure classes that must not be conflated:

- `workflow_stall`: protocol activity is happening, but meaningful visual progress
  is not; another visual mutation requires a concrete replan;
- `decision_loop_stall`: the visual barrier is already clear, yet the next healthy
  visual pass has not been dispatched for roughly 90 seconds; this is advisory;
- `silent_stall`: a non-`ready` continuation is already known, no durable job is
  running, and roughly 90 seconds pass without semantic advancement. Pending
  report/receipt-ack/verdict/reconcile/replan/checkpoint obligations identify the
  `silent_stall_reason` rather than suppressing the signal.

The silent-stall clock is deliberately not a generic "last tool call" clock.
Routine status/state/schema/source reads and unrelated extra previews must not make
an abandoned workflow look alive. The Guard persists and reports the condition on
the next host call; it cannot itself originate a new ChatGPT/COS message while the
host is idle.

Candidate proxy infrastructure already identified for evaluation:

- `MoaidHathot/mcp-proxy` — attractive because its design exposes pre/post invoke
  hooks, tool interception, result transformation, and virtual tools;
- `joshrotenberg/mcp-proxy` — a broader/more infrastructure-oriented proxy option;
- `postcondition-mcp` — useful primarily as a design reference for the
  intent → action → independent observation → satisfied/violated/unknown model.

No external proxy is adopted. Before making one a production dependency, audit
its code, maintenance status, transport support, license, failure semantics, and
whether it can preserve our durable PreviewBarrier/recovery guarantees.

The existing controller has now been evolved into that MCP gateway; Photoshop safety
still lives in this repository rather than in COS internals.

## 9. Update strategy

The desired maintenance model is:

```text
OpenAI changes ChatGPT
        ↓
COS author updates COS rapidly
        ↓
user keeps stock/latest COS

Photoshop Guard remains independent
        ↓
capability negotiation detects optional host features
```

This prevents the Photoshop project from lagging behind frequent COS/OpenAI fixes.
Host version numbers should not be hard-coded into the Guard; capabilities are the
contract.

## 10. Near-term roadmap

1. Keep `Chat On Steroids Plugins → dist/cos-plugin.js → embedded Guard` as the
   canonical production route.
2. Complete the dependency and state-machine audit in `PAINTING-ROADMAP.md` task 13b.
3. Migrate remaining internal test/live-utility consumers, then remove the retired
   Core/controller/daemon implementation under tasks 13a–13c. The duplicate public Guard
   contract is already removed; do not add new consumers of the retired internals.
4. Keep Photoshop safety independent of host-render receipts and add more tool-specific
   postcondition readbacks as evidence justifies them.

## 11. Legacy daemon/CLI retirement decision

**Decision, superseded 2026-09-21: remove it after an explicit dependency audit; do not
maintain backward compatibility.** The following known consumers explain why removal must
be staged, but they are migration work rather than reasons to retain the route:

- `package.json` now uses source-wide compact-native Vitest discovery for `test:acceptance`;
- Stage C/D and controller acceptance tests execute `photoshop-session.mjs` directly;
- `test-mcp-daemon.mjs` and multiple live-test utilities use `PersistentMcpClient`;
- controller/session-store tests still cover durable journal, async-job, recovery,
  and compatibility behavior independently of the native Plugins transport;
- documentation and examples may still point to the old route.

Roadmap task 13b must enumerate every consumer and state-machine dependency. Tasks
13a.1–13a.7 then migrate or delete them, reject obsolete aliases, retire legacy backends
capability by capability, and remove the old handshake. Task 13c proves that the compact
native route is the only supported public workflow and that deleted paths cannot silently
reactivate.

## 12. Related documents

- [Retired Core workflow notice](reliable-core-workflow.md)
- [Digital painting implementation](digital-painting.md)
- [Digital painting agent skill](digital-painting-agent-skill.md)
- [Reliability audit](reliability-audit-2026-09-16.md)
- [General project architecture](architecture.md)\n
