# Working-policy optimization and bootstrap latency audit

Date: 2026-09-20. Read-only analysis of an existing run; no Photoshop mutation,
restart, new painting or fault injection was performed for this audit.

## Evidence and clock boundaries

Sources: controller operations `uxp_bootstrap_accept_{create,fill,strokes}_20260920`
and the captured CoS session log, tool events seq 166–190.
Times below are UTC (local Jerusalem time was UTC+3).

| Event | Start | Measured end | Duration |
| --- | --- | --- | --- |
| Create cycle host call; returns async job | 13:56:33.150 | 13:56:33.532 | 0.382 s |
| Create background result ready (journal) | cycle received 13:56:33.151 | 13:56:35.813 | 2.662 s |
| Poll create | 13:56:40.100 | 13:56:40.104 | 0.004 s |
| Close create (no next operation) | 13:56:57.772 | 13:57:19.194 | 21.422 s |
| Bind art run (technical/short, simple_graphic smoke) | 13:57:35.149 | 13:57:35.227 | 0.078 s |
| Fill host cycle | 13:57:49.007 | 13:57:50.309 | 1.302 s |
| Open fill preview | 13:58:06.430 | 13:58:06.445 | 0.015 s |
| Close fill + start strokes; returns async job | 13:58:30.181 | 13:58:31.073 | 0.892 s |
| Strokes cycle result ready (journal) | cycle received 13:58:30.182 | 13:58:33.504 | 3.322 s |
| Poll strokes | 13:58:37.002 | 13:58:37.005 | 0.003 s |
| Open strokes preview | 13:58:43.368 | 13:58:43.383 | 0.015 s |
| Close strokes (no next operation) | 13:59:15.586 | 13:59:38.104 | 22.518 s |

Host ends are tool event time + durationMs, not independently observed UI-render
timestamps. Journal and host boundaries must not be mixed or double-counted.

The previously reported ~163 s ends at finalization invocation, not its return.
Measured host span is **184.954 s**. Ten sequential host calls total **46.631 s**;
the complement is **138.323 s between host calls**. Some background execution is
inside those gaps: the complement is NOT a measurement of model thinking.

Three journal execution cycles total 7.262 s, but omit separate close-only host
latency. The two close-only calls alone total **43.940 s**. Their returned
cycle_latency describes the PREVIOUS operation. In runtime.ts, closeLatency runs
before statusCompact and the close-only response returns previousRecord.latency.
Thus that field did not measure the current finalization call.

Subsequent isolated profiling on a **copy** of the current controller state proved
the local P0 cause rather than merely correlating it. With 512 operation records,
32 historical documents and 154 job directories, legacy `statusCompact()` took
27.245 s in the independent acceptance reproduction (the earlier diagnostic run
measured 31.50 s), called `activeJobs()` 193 times, read `job.json` 29,722
times and parsed the controller `painting-state.json` 193 times. The nested
rescan path was:

`statusCompact → visualCadenceState / continuationWatchState / documentNextRequiredAction`

with further cadence/next-action nesting beneath continuation watch.

The fix uses one request-local projection context: operation records once, parsed
painting state once, active jobs once and one capture timestamp. Document-specific
job filtering happens in memory. On a clone of the exact same saved source state,
with the same frozen `Date.now`, optimized `statusCompact()` took **0.595 s**,
called the full active-job scan once, read 154 `job.json` files once each and
read controller painting state once. The complete serialized output matched the
legacy output exactly. This does not prove that every historical 43.940 s of host
time was exclusively status projection, but it does prove and remove the dominant
local Guard projection defect reproduced from that session.

Fill operation completed at 13:57:49.843: **76.693 s after create invocation**.
Its preview was ready at 13:57:50.287: **77.137 s after create invocation**.
This is completion/preview evidence, not a sampled physical screen timestamp.
The user's original request-to-pixel time is not established by this chosen span.
The recognition metric (~0.4 s) starts later, at visual tracking, and is not TTFR
from the user request.

## Gaps worth addressing

- Create result ready → create closure begins: 21.959 s (includes polling).
- Closure returns → art-run bind begins: 15.955 s.
- Art-run bind returns → fill begins: 13.780 s.
- Fill host return → image viewer begins: 16.121 s.
- Fill viewer returns → next cycle: 23.736 s.
- Strokes viewer returns → finalization begins: 32.203 s.

The session logs page_tool labels, not independently verified ordinary assistant
report delivery. Report composition, image evaluation, scheduling and model time
cannot be separated from these timestamps. No Guard rejection/recovery/source
reading appears in this smoke interval. That falsifies a claim that this specific
delay was caused by successive Guard rejections.

A separate semantic issue: both visual verdicts supplied positive trend_signals
such as "uniform output" and "accepted background preserved". The policy requires
negative recurring defects only; success observations belong in observed_change.
The shorter kernel makes this distinction explicit. Historical journals were not
modified.

## Documentation changes and preservation map

The detailed policy was split by original line range, preserving all original
sections and examples. Ranges below refer to the pre-refactor 1230-line file.

| Original range | New location | Trigger / preservation |
| --- | --- | --- |
| 1–435 | painting-policy/foundations.md | Brief, recognition, style/state, commentary, layers, cadence, checkpoints, hot loop |
| 436–826 | painting-policy/methods.md | Method selection, Director/Painter, edge/value/trend, action/scale, brushes, marks/stages |
| 827–998 | painting-policy/inspection.md | Execution evidence, local repair, rollback/cost, geometry/reference/portrait/helpers |
| 999–1229 | painting-policy/operations.md | Reporting, focus, bundle/capture, async/stalls, reconnect, completion, prompt usage |
| New entry kernel | digital-painting-agent-skill.md | Start/continue/finalize, artistic invariants, recovery branch table and section routes |

Explicit corrections beyond relocation:
- Artistic/mixed pre-operation commentary applies at ALL detail levels, matching
  the Guard. Short mode does not remove artistic_commentary.
- Replace stale UXP description with a pointer to the maintained migration inventory.
- Distinguish required Guard ACK from optional host delivery evidence.
- Document compact close-only finalization and exact-outcome recovery branches.
- Repair relative links after moving the detailed sections.
- Server instructions and MCP prompt expose compact continuation/finalization.
- Do not recapture an unchanged frame if the returned/materialized image suffices;
  the requirement to actually view the image is preserved.

No Guard runtime, tool schema, report frequency, preview requirement, brush gate,
artistic hierarchy or execution safety was relaxed. This is guided conditional
reading, NOT a runtime lazy policy loader. Server instructions and the MCP prompt
still carry their existing policy coverage; this patch does not claim a measured
model-speed improvement or eliminate all duplicated instructions.

Verification: retain every existing shared-invariant check against the concatenated
detailed modules AND runtime prompt; separately validate the <=13000-character entry
kernel, module routes, critical operating rules and closure fields across all three
entry surfaces. The section-preservation check compares the original to the moved
text with only the explicitly listed corrections.

## Follow-up

1. **Completed in repository:** close-only finalization now exposes
   `photoshop.guard.finalization_latency.v1` with separate current-invocation
   `guard_preflight_ms`, `active_job_snapshot_ms`, `closure_write_ms`,
   `status_projection_ms`, `response_construction_ms` and
   `finalization_total_ms`. The prior operation's `cycle_latency` remains
   historical and unchanged.
2. **Completed read-only live-host check:** the rebuilt Photoshop MCP child was
   restarted alone as PID 36924 (started 2026-09-20 18:34:53); Photoshop itself
   was not restarted and the unchanged UXP companion was not reloaded.
   `photoshop_guard_status` observed 2.064–3.745 s host wall and
   `photoshop_guard_resume` 0.961–4.202 s (last-three medians 3.168 s and
   2.275 s). The Guard remained clean. These figures include connector/tool
   transport and large-response serialization; they are not pure projection
   timings. A live close-only call was skipped because no already-pending safe
   operation existed, and creating mutation/debt only for measurement is forbidden.
3. Replay a comparable smoke only when requested/authorized, measuring call-return
   wall time and user-request → first visual result; do not use visual-tracking
   origin as a substitute.
4. Changing per-external-call reporting is a separate policy decision. This patch
   preserves it. Its exact time cost is not observable in the current log.
5. Continue the existing UXP migration acceptance plan independently; this audit
   neither claims open_image acceptance nor changes bootstrap recovery.

## 2026-09-21 compact artistic cycle follow-up — repository acceptance

This section records the newer compact-cycle implementation. It does not rewrite
the 2026-09-20 timing evidence above and does not claim live Photoshop acceptance.

### Responsibility and removable-complexity audit

| Requirement | Implementation / owner | Real failure prevented | Separate model action? | Decision |
| --- | --- | --- | --- | --- |
| Stable retry identity | `cycle-compiler.ts` maps `request_key` to the durable operation id; `session-store.ts` fingerprints the compiled request | duplicate execution after lost/retried response; same key with different payload is rejected | No extra action | Keep safety, move identity plumbing into compiler/runtime |
| Artistic goal / summary / purpose / plan intent | one `next_pass.goal`; compiler expands internal summary/purpose/VisualMicroPlan intent | no safety failure from prose duplication; removes contradictory copies | No | Remove duplicate model metadata |
| Step prose | legacy `step.intent` normalizes to `description` | literal wording no longer causes false intent mismatch | No | Remove free-text equality gate |
| Document / region / protected ids | root compact pass plus existing VisualMicroPlan target validation | wrong document, protected target, cross-region mutation | No duplicate per-step copy | Keep structural checks |
| Method / risk / action class | compiler derives conservative values from actual mutation tools; existing VisualMicroPlan checks actual step method/risk | declared metadata cannot hide the mutation's real method/risk | No | Move to compiler |
| New logical layer | compact pass allows at most one create-layer rollback unit; VisualMicroPlan binds following mutations through the returned stable layer id | paint going to an unintended or untracked layer | No separate create-layer host call | Combine safely inside the pass |
| Technical report | `SessionStore.recordTechnicalReport` derives it from durable execution/result | journal still records what actually executed | No | Remove model-authored did/why/result bookkeeping |
| Durable receipt acknowledgement | compact closure uses the exact stored receipt token | stale/wrong receipt cannot close another operation | No token copy | Keep durable receipt; move ack plumbing into runtime |
| Host/user delivery evidence | remains a separate optional host-verified acknowledgement boundary | prevents execution receipt from being mislabeled as user delivery | Only when the host actually supplies evidence | Keep separate |
| Artistic observation/verdict | model supplies `previous_observation` after seeing the delivered frame; compiler expands the full internal verdict | prevents Guard from inventing artistic success | Yes: one short real observation | Keep model ownership |
| Final preview | existing VisualMicroPlan compiler/executor ensures one final AFTER preview | next visual mutation cannot proceed without review evidence | No separate recapture when already delivered | Keep |
| Microplan limits | existing max 12 steps / max 4 visual mutations and contiguous-mutation checks | bounded execution and understandable partial-failure semantics | No | Keep |
| Checkpoint / uncertainty / rollback gates | existing Guard session/runtime state | blind replay, mutation after unknown result, continuation past required persistence/rollback | Only when the gate is actually due | Keep |

The removed complexity is therefore model-side duplication and journal servicing,
not the durable operation record, idempotency, preview barrier, target protection,
rollback/uncertainty policy, or visual review requirement.

### Recommended compact request

The main entry point remains `photoshop_guard_cycle_auto`; no second journal or
parallel safety controller was added. A visual pass may use:

```json
{
  "next_pass": {
    "request_key": "hills-form-02",
    "document_id": 42,
    "goal": "Give the middle hills rounded light-to-shadow form while preserving the sky and distant ridge",
    "region": "middle-hills",
    "stage": "FORM",
    "scale": "medium",
    "actions": [
      {
        "id": "paint-form",
        "tool": "photoshop_paint_dabs",
        "description": "Broad form pass",
        "args": { "dabs": [{ "x": 300, "y": 400 }] }
      }
    ]
  }
}
```

After the returned frame is actually inspected, continuation/finalization uses
`previous_operation_id + previous_observation`; a continuing call also carries
the next `next_pass`. Removed full-operation and explicit closure payloads are not
public optimization or recovery paths; the compact facade owns technical closure.

### Existing execution capabilities used by the landscape path

| Need | Existing tool / mechanism | Transport on accepted compact path | Known limitation | Landscape suitability |
| --- | --- | --- | --- | --- |
| Solid shaped mass | `photoshop_paint_regions`; whole-layer base with `photoshop_fill_layer` | UXP; migrated mutation fallback to ExtendScript/COM is disabled | regions are block-in scaffolding, not a final rendering language; fill affects the target layer/selection semantics of the tool | Good for silhouettes, hill planes and base masses |
| Controlled light/shade inside form | `photoshop_paint_strokes` / `photoshop_paint_dabs` with pinned layer and existing brush settings/dynamics | UXP; no legacy mutation fallback | AUTO stroke chunking can leave earlier batches applied if a later batch fails; do not describe multi-batch execution as transactionally atomic | Good for broad modeled light, shadow and form transitions |
| Edge / containment control | region contours + `clip_bounds`, stable target layer ids and protected-layer ids; brush hardness/mark choice for soft edges | UXP for the listed painting primitives | true selection/layer-mask gradient helpers are still legacy paths and are not claimed here as accepted no-fallback compact-paint capabilities | Adequate for hard/soft hill edges without introducing a new art subsystem |

### Telemetry semantics

The Guard now records request JSON bytes, compile/dispatch/preview/closure
components, and `guard_invocation_count_observed`. The canonical interval between
one Guard response and the next Guard call is
`inter_call_unattributed_gap_ms`. It may include host scheduling, model work,
user-visible reporting or other activity and MUST NOT be called reasoning time.
`model_call_count` stays null because the Guard boundary cannot observe all model
turns. User-task start is likewise not inferable from dispatch; server time and
user wall-clock remain separate measurements.

### Acceptance boundary

Repository tests can prove normalization, deterministic rejection aggregation,
idempotent replay, closure rollback, compact finalization, VisualMicroPlan
execution and no-legacy-fallback routing. They do not prove live Photoshop visual
quality or end-to-end user-request latency. A live disposable-document acceptance
must remain a separate explicitly authorized step.
