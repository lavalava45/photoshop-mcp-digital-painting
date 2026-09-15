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
    'Guide an agent through subject-agnostic digital painting using composition, multiscale error-driven action selection, shape/value/form/edge/material/detail hierarchy, visual checkpoints, rollback and state-based completion criteria.',
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
        'Optional user-selected brush pack or preset names that should be the primary candidate source. These are preferred, not necessarily all mandatory.',
      required: false,
    },
    {
      name: 'required_brushes',
      description:
        'Optional exact Photoshop brush preset names that must be used meaningfully. Missing required presets must be reported; do not silently substitute another brush.',
      required: false,
    },
    {
      name: 'stroke_budget',
      description: 'Optional approximate number of strokes. By default this is a soft planning budget, not a completion rule.',
      required: false,
    },
    {
      name: 'budget_mode',
      description: 'soft (default) or hard. Hard means do not exceed stroke_budget unless the user changes the constraint.',
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
      `- Photoshop/COS/MCP mode is sticky across short continuations. Use Chat_On_Steroids_Core for Photoshop execution and do not switch to image_gen unless the user explicitly changes execution mode.`,
      `- Capture the working document.id and pin document-bound operations with document_id whenever tab retargeting is possible. Invalid/closed ids fail closed; never silently fall back to the active tab.`,
      ``,
      `CORE CONTROLLER:`,
      `- Hierarchy: COMPOSITION → SHAPE → VALUE → FORM → EDGE → MATERIAL → DETAIL. Do not advance while a lower-frequency must-fix remains.`,
      `- Choose mode first: REFERENCE REPRODUCTION, FREE COMPOSITION, or STYLIZED PAINTING. For free composition establish the composition/light/depth/palette hypothesis before detail.`,
      `- Derive a minimal STYLE CONTRACT upstream of tool choice; judge the real preview against USER BRIEF + STRUCTURAL READABILITY + STYLE CONTRACT. Style changes what counts as an error but never excuses accidental tangencies/broken occlusion.`,
      `- Maintain painting state for non-trivial work. In long/development sessions persist process-dir/painting-state.json after accept/rollback/stage/replan/recovery; keep accepted_frame distinct from current_frame and reconcile actual Photoshop state on resume.`,
      `- HOT LOOP: largest unresolved problem → scale/protected areas/region priority → ACTION CLASS → primitive/tool → short mutation → inspect Photoshop result → execution sanity → improvement|neutral|regression → accept|correct|rollback → persist/replan.`,
      `- Action classes: ADD, REFINE, REPLACE, ERASE, ROLLBACK, LEAVE. ADD is not default; do not bury a known regression. A successful rollback must still be inspected and replanned unless the user said stop/wait or DoD passes.`,
      `- Use short-horizon, multiscale planning. After block-in choose semantic/adaptive regions by severity, perceptual importance, structural dependency, expected gain and execution/recovery cost; fixed grids are diagnostic only.`,
      ``,
      `BRUSH PREFLIGHT / ROLE MAP:`,
      `- Before the first paint mutation, perform a bounded brush inventory: inspect the installed-preset list once, derive only the roles needed by this image/pass, and build a small candidate pool. Do not brute-force or footprint-test the whole installed library.`,
      `- Candidate widening order: (A) small trusted/default baseline already characterized, (B) user preferred_brushes/pack as the primary source when supplied, then (C) broader installed-library discovery only if A/B cannot fill a needed role. A normal painting should usually evaluate only a handful of candidates, roughly 5–12 total and often fewer.`,
      `- required_brushes are hard user constraints: confirm every named preset exists before relying on it, use each meaningfully in a suitable role, record where it was used, and report any unavailable preset instead of silently replacing it. Do not force a required brush into an unsuitable structural role merely to tick a box; choose a safe meaningful role or surface the conflict.`,
      `- After every photoshop_select_brush_preset, call photoshop_get_brush_settings before the first visual mutation with that newly selected preset. Verify effective size, hardness, roundness, spacing, opacity, flow, exposed pressure-override flags, airbrush and smoothing; never trust the preset name alone. Those pressure flags do not expose the preset's full Photoshop Shape Dynamics, so use a footprint probe when pressure/dynamics behavior matters.`,
      `- Use approx stamp interval px = brush size × spacing% / 100 as a diagnostic. Spacing limits are role-dependent: low spacing usually suits continuous low-frequency mass; higher spacing may be intentional for broken texture/charcoal/foliage. Never impose one universal spacing threshold.`,
      `- A settings read is necessary but not always sufficient. Run a disposable footprint probe only for an unknown preset, new role, major scale change, suspicious settings, expensive/large-area use, or mark-language-critical pass. Reuse a valid cached characterization instead of re-probing unchanged preset+settings+role+scale.`,
      `- Keep probes isolated from artwork: prefer a disposable scratch document for uncertain/expensive tests; a temporary dedicated layer is acceptable for a tiny local probe when history pollution is understood. Delete/close the probe artifact and deliberately restore the latched painting document before real mutations.`,
      `- Maintain a compact brush role map in brush_state: role → preferred preset, alternative, effective settings/scale band, probe status/signature and caveats. Useful roles may include smooth mass/atmosphere, soft modeling, hard structural mass, planar/block mark, broken texture, fine line/detail and glaze/light; instantiate only roles actually needed.`,
      `- Invalidate/re-probe a role mapping when the preset/effective settings changed materially, the working scale moved to a different band, or the real painting shows periodic circles/scallops, gaps, repeated texture frequency, chains/grids or another primitive footprint. The real Photoshop preview remains final authority.`,
      ``,
      `MARK / STRUCTURE GUARDS:`,
      `- Structure before texture: if an error survives thumbnail/blur view, fix composition/shape/value/form first. Block-in primitives are temporary scaffolding.`,
      `- Match brush scale to unresolved information. For continuous surfaces use irregular 2D patches, not grids/chains/mechanical sweeps; reserve line strokes for genuinely linear structures. Quantize dense dab styles into a small reusable set and create variation mainly by placement/density/overlap.`,
      `- Primitive footprint is must-fix in realistic work when circles/scallops/ribbons/regular bands read before the depicted form. Roll back, erase or structurally repaint; do not hide it with weak texture.`,
      `- Respect occlusion/protected regions. Long strokes are allowed only when the whole path is visually clear. Correct silhouette boundaries with erase/mask/repaint or a genuine local background patch, not one flat sampled-color carve.`,
      `- NORMAL is the structural blend-mode baseline. MULTIPLY/COLOR/SOFTLIGHT/OVERLAY/SCREEN/LINEARDODGE are optional isolated-layer tools only when the current visual problem benefits; never use them to conceal unresolved structure.`,
      `- Use history and semantic layers as recovery tools. Before risky work establish a history anchor or isolated correction layer. AUTO may create multiple history steps; use SINGLE_HISTORY only when one undo step is worth higher timeout risk.`,
      `- Plan visual and execution cost together. Optional transport normalization may reduce dab style groups but must preserve mark role/scale/value/chroma/opacity/flow; do not blindly K-means raw [R,G,B,size].`,
      `- CORRECTION ACCEPTANCE GATE: after REPLACE/ERASE/silhouette or background reconstruction/other patch-like repair, inspect the intended fix plus the full transition perimeter at local and normal/thumbnail scale. Reject or correct new seams, rectangular/straight patch boundaries, hard corners, halos, value/color discontinuities, repeated dabs/scallops or any same-or-higher-severity artifact introduced by the repair.`,
      `- At resume or before a new stage after broad dabs, local reconstruction or rollback/recovery, run a quick whole-image artifact scan before adding detail; do not let a locally successful repair hide a residual primitive footprint or patch seam elsewhere.`,
      ``,
      `CONDITIONAL REFERENCE RULES:`,
      `- Keep reference and target separate/pinned. Sample colors/values as evidence; do not paste/place/blend the reference as an underlay or mechanically trace it by default.`,
      `- For proportion-sensitive work use landmarks/guides/measure_points and compare_landmarks when useful; if measurement evidence was established, revisit it at the final structural gate. Spatial anchors should use semantic bounds + local u/v rather than guessed absolute coordinates when precision matters.`,
      `- Manufactured/geometric forms: before detail and after structural corrections, check only object-relevant geometric relationships such as primary axes, intended straightness/taper, applicable parallelism/symmetry, perspective convergence, repeated spacing/alignment and silhouette continuity. Use measurement helpers when precision matters; do not impose perfect geometry or a universal cylinder-gradient formula when reference/style does not support it.`,
      `- Optional discrepancy diagnostics may use registered low-frequency, edge, value and late color/detail evidence; present heatmaps as separate critic evidence, not paint or an optimization target.`,
      `- Photoreal portrait: measure marks against face width (value 8–12%, form 2–6%, feature edges/hair 0.5–2%, micro <0.5%); use 2D patches for broad facial planes, chains only for elongated forms, and path strokes mainly for deliberate linear detail.`,
      `- Optional curve fitting, segmentation masks, discrepancy helpers, transport quantization and surrogate preflight provide evidence/proposals/constraints only. Validate them; preserve the no-tracing default and Photoshop-as-ground-truth preview loop.`,
      ``,
      `WORKFLOW / PACING:`,
      `- Stages: analyze/compose → global block-in → medium form → adaptive local refinement → edges/features → finish/cleanup. Preview/replan before advancing through unresolved earlier-stage errors.`,
      `- One short mutation / ATOMIC VISUAL BUNDLE at a time. A bundle is atomic only when every included mark solves one visual problem, affects one semantic region or inseparable region set, uses one action class, stays within one stage/scale decision, and can be judged by one before/after acceptance question. Independent sky, land/water, foliage, architecture or other separately judgeable passes are never one bundle just because one MCP/script call can encode them.`,
      `- HARD PREVIEW BARRIER: no next visual mutation may begin until the previous mutation/bundle has completed → been captured → been visually inspected → been classified improvement|neutral|regression. A process/session id is not completion; do not queue hidden multi-pass chains.`,
      `- Use visual-delta only as execution sanity: identical/near-zero change when visible mutation was expected triggers targeting/tool-state checks; non-zero delta is never an improvement score.`,
      `- In development/testing, high-frequency process capture is ON unless disabled: save monotonic JPEGs after each visual mutation/tiny atomic bundle and avoid read-only duplicates. MUST split any visually large, multi-region, multi-role or multi-stage change into separately completed/captured/inspected mutations; target roughly 100+ meaningful frames for a medium-complexity evaluation when practical.`,
      `- Batching/style grouping/transport quantization may reduce execution calls only inside one already-approved atomic visual bundle. Never use optimization to combine independent semantic passes, cross a stage/scale decision, or postpone the required preview/inspection barrier.`,
      `- PAIRED PSD CHECKPOINT: whenever a preview/export is promoted to an accepted intermediate checkpoint, stage transition or recovery anchor, save a layered PSD with the same serial/stem in the same process directory before continuing, using the latched document_id. Record the path in painting state and do not silently proceed after a failed PSD write. Do not make a PSD for every high-frequency JPEG unless the user explicitly requests that denser cadence.`,
      `- Fresh-composition evaluation must not reuse scene-specific geometry/execution plans from prior demos; generic helpers/infrastructure may be reused.`,
      `- On timeout/disconnect/restart/interrupted UI, do not blindly retry: check the original process, verify document/state/history/preview, compare with persisted frame, classify completed|not-executed|partial/uncertain, reconcile state, then recover.`,
      ``,
      `DEFINITION OF DONE:`,
      `- Composition/subject read at intended scale; major forms/proportions/silhouette and depth/occlusion are coherent; focal features, value/color and edge hierarchy satisfy the finish/style contract.`,
      `- Applicable measurement evidence is reconciled; cleanup is complete; no must-fix structural/overlap/tangent/readability defect remains; explicit user constraints are satisfied.`,
      `- Stop when additional marks are optional refinement. A soft stroke budget is not a finish line; a hard budget remains a user constraint.`,
    ].join('\n');

    return userPrompt(
      `Digital painting control: ${subject} — ${finishLevel}${style !== 'unspecified style' ? `, ${style}` : ''}.`,
      text
    );
  },
};
