import {
  argEnum,
  argInt,
  argString,
  userPrompt,
  type PhotoshopPromptTemplate,
} from '../_shared.js';

const FINISH_LEVELS = ['sketch', 'study', 'polished'] as const;
const BUDGET_MODES = ['soft', 'hard'] as const;

export const digitalPaintingControlTemplate: PhotoshopPromptTemplate = {
  name: 'ps.digital_painting_control',
  description:
    'Guide subject-agnostic Photoshop painting through multiscale planning, visual checkpoints, rollback and state-based completion.',
  arguments: [
    {
      name: 'subject',
      description: 'What to draw or paint. Required.',
      required: true,
    },
    {
      name: 'style',
      description: 'Optional style direction, e.g. anime, ink sketch, painterly, charcoal, comic.',
      required: false,
    },
    {
      name: 'finish_level',
      description: 'Target finish level: sketch, study, or polished. Default: study.',
      required: false,
    },
    {
      name: 'constraints',
      description: 'Optional user constraints such as monochrome, layer count, canvas size, or required features.',
      required: false,
    },
    {
      name: 'preferred_brushes',
      description:
        'Optional preferred brush pack or preset names; preference does not make all brushes mandatory.',
      required: false,
    },
    {
      name: 'required_brushes',
      description:
        'Optional exact brush presets that must be used meaningfully; report missing presets instead of substituting.',
      required: false,
    },
    {
      name: 'stroke_budget',
      description: 'Optional approximate stroke count; soft planning budget by default.',
      required: false,
    },
    {
      name: 'budget_mode',
      description: 'soft (default) or hard; hard must not exceed stroke_budget.',
      required: false,
    },
  ],
  handler: (args) => {
    const subject = argString(args, 'subject', 'unspecified subject');
    const style = argString(args, 'style', 'unspecified style');
    const finishLevel = argEnum(args, 'finish_level', FINISH_LEVELS, 'study');
    const constraints = argString(args, 'constraints', 'none stated');
    const preferredBrushes = argString(args, 'preferred_brushes', 'none stated');
    const requiredBrushes = argString(args, 'required_brushes', 'none stated');
    const strokeBudget = Math.max(0, argInt(args, 'stroke_budget', 0));
    const budgetMode = argEnum(args, 'budget_mode', BUDGET_MODES, 'soft');

    const budgetText =
      strokeBudget > 0
        ? budgetMode === 'hard'
          ? `Hard stroke cap: ${strokeBudget}. Respect it as a user constraint; simplify the plan if necessary.`
          : `Soft stroke budget: about ${strokeBudget}. Use it to estimate scope and batching, but do not stop merely because the number was reached. Continue if a required corrective pass remains.`
        : `No stroke budget was provided. Choose the number of strokes according to visual needs and the requested finish level.`;

    const finishText =
      finishLevel === 'sketch'
        ? 'Sketch finish: prioritize readable silhouette, proportion, gesture and the main value/color statement; leave nonessential micro-detail unresolved.'
        : finishLevel === 'polished'
          ? 'Polished finish: require resolved focal details, coherent edges/line hierarchy, deliberate accents, and a dedicated cleanup pass.'
          : 'Study finish: resolve the main forms, depth relationships, focal details, values/colors and obvious cleanup issues without chasing micro-detail.';

    const text = [
      `Goal: Paint "${subject}" in Photoshop through a short preview-driven control loop; do not execute a long blind stroke program.`,
      `Style: ${style}`,
      `Finish: ${finishLevel}`,
      `Constraints: ${constraints}`,
      `Preferred brush source/presets: ${preferredBrushes}`,
      `Required brush presets: ${requiredBrushes}`,
      budgetText,
      finishText,
      ``,
      `HARD EXECUTION INVARIANTS:`,
      `- Photoshop/COS/MCP mode is sticky. Canonical route: Chat_On_Steroids_Plugins → dist/cos-plugin.js → embedded Guard. The old Core/controller route is retired and is not a recovery path. Do not switch to image_gen unless the user explicitly changes execution mode.`,
      `- Capture the working document.id and pin document-bound operations with document_id whenever tab retargeting is possible. Invalid/closed ids fail closed; never silently fall back to the active tab.`,
      ``,
      `- CYCLE: Pass 1 uses next_pass={request_key,document_id,goal,region/protection,actions} and returns preview. Continue with previous_operation_id + previous_observation + next_pass; previous_observation remains model-owned and target is operation-local. Add planner_task_assessment only for the whole task. Omit next_pass to finalize. Guard derives technical closure and exact stored receipt acknowledgement internally; removed standalone closure providers are not recovery alternatives.`,
      `GUARD / CONTROLLER:`,
      `- OPEN BRIEF: if the user delegates the subject, once compare 4–6 candidates from at least four families (at most one scenic/architecture-led vista). Never browse prior runs for inspiration. Reject repeats and atmosphere-only premises; choose a specific subject+setting+action+spatial problem. Ease never decides alone. Commit unless asked; no Guard gate or repeat inside the paint loop.`,
      `- Hierarchy: COMPOSITION → SHAPE → VALUE → FORM → EDGE → MATERIAL → DETAIL. Do not advance while a lower-frequency must-fix remains.`,
      `- RECOGNITION BLOCK-IN precedes refinement: derive 3–7 discriminative cues (importance is not proportional to size) + style cue if needed; rough the whole subject. Until overview reads unaided, fix the largest recognition barrier; record subject/style/evaluator + visible/lost cues.`,
      `- Choose REFERENCE REPRODUCTION, FREE COMPOSITION, or STYLIZED PAINTING; free composition establishes composition/light/depth/palette before detail.`,
      `- Derive a minimal STYLE CONTRACT; judge USER BRIEF + STRUCTURAL READABILITY + STYLE CONTRACT. Style never excuses broken tangencies/occlusion.`,
      `- ART RUN: before paint call photoshop_guard_set_art_run once with immutable processes/<subject>-process/<run>/; keep frames/, checkpoints/, final/, painting-state.json there; accepted_frame != current_frame.`,
      `- LAYER SEPARATION CHECK: substantial independently-correctable object/material/light/plane uses create-new/temporary-hypothesis, never layer per stroke. Accepted stable ids go in protected_layer_ids; protected_regions is descriptive only. REPLACE/ERASE of protected content needs exact replace_protected_layer_ids.`,
      `- COMMENTARY: sticky "режим техника|художник|вместе" + detail. In artistic/mixed mode emit the root goal before each meaningful visual pass; compiler reuses it as artistic_commentary, so do not duplicate it. Artist voice is natural Russian: problem → intent → action → preserve → result; no hidden chain-of-thought or infrastructure jargon.`,
      `- HOT LOOP: problem → scale/region → ACTION CLASS → visual intent → impact class → method → registered runtime tool/fallback (never invent APIs) → hypothesis → mutate → inspect → factual observed change + target resolved/unresolved/uncertain → accept/correct/rollback → structurally change strategy when needed. Guard derives legacy observed_change/target_resolved/regressions/uncertainty fields from the compact observation.`,
      `- SCENE-RELATIONSHIP AUDIT: global/shape/form + stage/final review checks support/contact, gaps/floating, cast shadow, occlusion/depth, tangencies/intersections, silhouette/proportion; detail passes get a quick regression scan. Local success cannot excuse equal/higher structural defects.`,
      `- Action classes: ADD, REFINE, REPLACE, ERASE, ROLLBACK, LEAVE. ADD is not default; do not bury a known regression. A successful rollback must still be inspected and replanned unless the user said stop/wait or DoD passes.`,
      ``,
      `BRUSH PREFLIGHT / ROLE MAP:`,
      `- Before non-trivial paint, perform a bounded brush inventory: presets → roles → shortlist/select → effective settings → selective probe → completed brush_preflight on the same art run. Guard blocks paint until it exists.`,
      `- photoshop_select_brush_preset returns a fresh authoritative effective-settings readback; do not duplicate it unless stale/changed/diagnostic. On compact next_pass Guard may insert this selection from durable brush_preflight; the model need not name the preset again.`,
      `- Keep a compact brush role map. Guard compiles paint_strategy (material → intent → role → preset → pressure); optional next_pass.brush_role disambiguates roles. Raw bypass is blocked; simulated pressure must exist in the stroke.`,
      ``,
      `MARK / STRUCTURE GUARDS:`,
      `- Structure before texture: fix thumbnail/blur structure first. paint_regions is temporary scaffold only in RECOGNITION_BLOCK_IN / COMPOSITION / SHAPE / GLOBAL_BLOCK_IN; later stages must change representation, not decorate polygons.`,
      `- Match brush scale/topology to unresolved information. Use 2D patches for broad coverage, wide strokes for planes/volume/flow when their footprint supports form, and narrow strokes for linear structure. Reject wrong visible footprints, not primitive categories.`,
      `- Primitive footprint is must-fix in realistic work when circles/scallops/ribbons/regular bands read before the depicted form. Roll back, erase or structurally repaint; do not hide it with weak texture.`,
      `- Respect occlusion/protected regions. Long strokes are allowed only when the whole path is visually clear. Correct silhouette boundaries with erase/mask/repaint or a genuine local background patch, not one flat sampled-color carve.`,
      `- NORMAL is the structural blend baseline; other modes are isolated problem-specific tools, never concealment for unresolved structure.`,
      `- Use history and semantic layers as recovery tools. Before risky work establish a history anchor or isolated correction layer. AUTO may create multiple history steps; use SINGLE_HISTORY only when one undo step is worth higher timeout risk.`,
      `- Transport normalization preserves mark role/scale/value/chroma/opacity/flow; never blindly K-means raw [R,G,B,size].`,
      `- CORRECTION ACCEPTANCE GATE: after REPLACE/ERASE/silhouette/background repair inspect the fix and transition perimeter at local and normal/thumbnail scale. Reject seams, patch boundaries, hard corners, halos, value/color discontinuities, repeated dabs/scallops or same-or-higher-severity artifacts.`,
      ``,
      `CONDITIONAL REFERENCE RULES:`,
      `- Keep reference and target separate/pinned; sample as evidence, never default to underlay/paste/trace.`,
      `- Proportion-sensitive work: use landmarks/guides/measure/compare; prefer semantic bounds + local u/v over guessed coordinates.`,
      `- Manufactured/geometric integrity: check axes/taper/symmetry/parallelism/convergence/spacing/silhouette; do not impose unsupported perfection.`,
      `- Discrepancy diagnostics are critic evidence, never paint or an optimization target.`,
      `- Photoreal portrait: scale marks to face width (value 8–12%, form 2–6%, feature edges/hair 0.5–2%, micro <0.5%); use patches for planes and paths mainly for deliberate linear detail.`,
      `- Optional curve fitting, segmentation, discrepancy helpers, quantization and surrogate preflight are evidence/proposals/constraints only. Preserve the no-tracing default and Photoshop-as-ground-truth loop.`,
      ``,
      `WORKFLOW / PACING:`,
      `- USER COMMUNICATION: commentary is not Guard bookkeeping. Give concise visible updates around meaningful artistic passes and practical blockers; do not manufacture a three-field report after brush lookup, layer preparation, polling or other administrative substeps. Host/tool UI evidence is separate from the durable operation receipt.`,
      `- LONG-CALL UX: cycle-auto ~7–10s+ work returns durable job_id + semantic progress. Poll the same job with photoshop_guard_job_poll (Core: job-poll); a job id is not completion and does not replace the eventual visual observation.`,
      `- HARD UI FOCUS BARRIER: keep Photoshop backgrounded. Never foreground/activate it or automatically switch the active Photoshop document/tab without explicit user permission. Do not use photoshop_set_active_document for convenience; prefer pinned document_id.`,
      `- ATOMIC VISUAL BUNDLE: one visual problem, one semantic region/tightly-coupled set, one action class, one stage/scale, one acceptance question. Otherwise split and preview separately.`,
      `- HARD PREVIEW BARRIER: no next visual mutation may begin until the previous mutation/bundle has completed → been captured → been visually inspected → been classified improvement|neutral|regression. A process/session id is not completion; do not queue hidden multi-pass chains.`,
      `- PRIMARY PROGRESS METRIC: resolved visual problems, not protocol activity. Resolve only after meaningful change + improvement + accept + target_resolved=yes; accept alone retains pixels, not resolution. trend_signals are negative recurring defects only.`,
      `- HARD VISUAL EXECUTION-EVIDENCE GATE: meaningful|insufficient|unknown; unknown/no-op cannot be accepted as improvement. Delta proves execution only; comparison claims need comparable same-document before, else neutral/unknown. SHA/delivery is identity, not art.`,
      `- subtle_local is pre-declared for fine corrections: require the same focus region BEFORE and AFTER; small/local work requires matching focus evidence.`,
      `- WORKFLOW-STALL GATE: after 8 external actions without a meaningful visual change, or 2 visually insufficient passes, another mutation requires a structural executable strategy change. Legacy replan prose never bypasses the gate.`,
      `- HARD VISUAL CADENCE: after verdict, next canonical cycle = next meaningful visual pass. photoshop_get_state is not required between normal visual passes. Proven systemic failure → one compact diagnostic investigation → causal replan → next visual pass. decision_loop_stall at 90s is advisory.`,
      `- TWO-LEVEL CONTROL: Art Director owns global structure; bounded Painter tasks use adaptive ~5–10-plan review cadence, not a magic constant. A successful local pass never completes planner_task_id unless planner_task_assessment explicitly says completed with task-scope evidence.`,
      `- PAINTER: local preview/verdict; no global re-plan per stroke; bind directive/task/scope/change_domains.`,
      `- EARLY PLANNER RETURN on serious error, global value/composition drift, likeness/main-shape loss or unsafe directive; global edits need task permission.`,
      `- SILENT-STALL: silent_stall after ~90s with known next action/pending obligation and no job; read-only churn does not reset it.`,
      `- Development capture: Guard archives a monotonic frame after each mutation/tiny bundle under the bound project frames/ and keeps a same-stem .txt commentary sidecar; split cross-region/role/stage work.`,
      `- LAYER ROLLBACK: one layer = one reversible hypothesis; every VisualMicroPlan declares layer_separation_check; reuse/discard/merge ids explicitly.`,
      `- EDGE CONTROL: boundary hard|firm|soft|lost|broken; edge intent changes method selection/fallback; mutation names method_id; AFTER edge_observations require boundary_id + observed_behavior + target_met.`,
      `- STAGE GATES: VALUE GATE: unobserved analysis never PASS; DETAIL blocks fail/missing; override then style-N/A require justification. REFINEMENT GATE: DETAIL blocks refinement_check pending/fail; pass needs meaningful representation_change + resolved major/secondary form, edge/material, residual_block_in; texture-only never closes debt; style-N/A binds exact style_contract.`,
      `- Batching only inside one atomic bundle; never combine independent semantic passes or postpone preview/inspection barrier.`,
      `- GUARDED TRANSACTION: VisualMicroPlan allows 1–4 contiguous ops under one intent/region/method/risk. Optional BEFORE + mandatory AFTER bracket it; subtle_local keeps matching >=800px focus. Guard verdict releases the shared HARD PREVIEW BARRIER.`,
      `- Never auto-retry a VisualMicroPlan mutation error: capture/classify the reconciliation preview first, then correct/rollback/replan.`,
      `- PAIRED PSD CHECKPOINT: checkpoint/stage/recovery PSD → checkpoints/, finals → final/. checkpoint-due is mutation-risk debt, not a fixed timer; save+verify, then resume the next planned visual cycle. uxp_bridge_unavailable → photoshop_get_capabilities once; never COM/ExtendScript fallback or clear barrier; no next visual mutation until restored. After recovery retry only the save, never repaint.`,
      `- Fresh-composition work reuses generic infrastructure only, never prior scene geometry/plans or prior runs as subject inspiration.`,
      `- On timeout/disconnect/restart/interrupted UI, do not blindly retry: check the original process, verify document/state/history/preview, compare with persisted frame, classify completed|not-executed|partial/uncertain, reconcile state, then recover.`,
      ``,
      `DEFINITION OF DONE:`,
      `- Composition/subject read at intended scale; major forms/proportions/silhouette, support/contact, cast-shadow relationships and depth/occlusion are coherent; focal features, value/color and edge hierarchy satisfy the finish/style contract.`,
      `- Applicable measurement evidence is reconciled; cleanup is complete; no must-fix structural/overlap/tangent/readability defect remains; explicit user constraints are satisfied.`,
      `- Stop when additional marks are optional refinement. A soft stroke budget is not a finish line; a hard budget remains a user constraint.`,
    ].join('\n');

    return userPrompt(
      `Digital painting control: ${subject} — ${finishLevel}${style !== 'unspecified style' ? `, ${style}` : ''}.`,
      text
    );
  },
};
