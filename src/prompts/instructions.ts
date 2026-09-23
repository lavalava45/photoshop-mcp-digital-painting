/**
 * Server-level guidance for host LLMs (Cursor, Claude Desktop, standalone UI).
 * Advertised on MCP `initialize` via ServerOptions.instructions.
 */
export const PHOTOSHOP_MCP_INSTRUCTIONS = `
Photoshop tools (photoshop-mcp server)
=====================================

Session bootstrap
- STICKY PHOTOSHOP ROUTE: once the user is working through this Photoshop/CoS MCP
  workflow, ordinary requests to draw, paint, edit, improve, continue, modify or render
  an image/picture/artwork (including рисунок / изображение / нарисуй / дорисуй /
  улучши картинку / дальше) mean operate the current local Adobe Photoshop document
  through this MCP/Guard route. Those words alone never authorize switching to built-in
  or external image generation. Change execution mode only when the user explicitly asks.
- After a host/tool interruption, first verify the existing CoS Photoshop surface and use
  \`photoshop_guard_status\` / \`photoshop_guard_resume\` to recover durable state. If
  the Photoshop/CoS tools are genuinely unavailable, report the concrete connector or
  availability failure and stop Photoshop mutations; do not silently substitute another
  image engine.
- This fork contains an embedded durable Photoshop Guard. When the MCP catalog exposes
  \`photoshop_guard_*\`, prefer that native MCP surface instead of shelling through a
  separate controller. In Chat On Steroids the dedicated \`dist/cos-plugin.js\` entry
  enables \`PHOTOSHOP_GUARD_MODE=required\`: read-only tools remain directly callable,
  while raw mutating tools fail closed with \`guard_required\` and must be dispatched
  through \`photoshop_guard_cycle_auto\`.
- \`photoshop_guard_status\` and \`photoshop_guard_resume\` read the same durable
  journal/barrier/checkpoint state without replaying prior work. Do not reconstruct
  progress from chat memory alone and never replay a successful mutation to repair
  attribution or recovery state.
- \`scripts/photoshop-session.mjs\` remains a dev/debug/recovery compatibility CLI and
  is not the preferred normal CoS transport; the embedded Guard route has completed its
  dedicated live validation.
- In the current Chat On Steroids development setup, after rebuilding \`dist/cos-plugin.js\`
  restart only the custom Photoshop MCP plugin from CoS Plugins → Photoshop MCP Digital
  Painting Fork → … → Restart. Do not restart all of CoS or use old restart-helper scripts.
  ChatGPT Settings → Plugins → Refresh refreshes the host schema but does not guarantee a
  running child process has reloaded new code. After changing \`uxp-plugin/main.js\`, reload
  only Photoshop MCP UXP Bridge in Adobe UXP Developer Tool; after manifest changes use
  Unload → Load.
- Call \`photoshop_ping\` exactly once at the start of a session to verify the
  connection. Do not repeat it on every turn.
- Before suggesting version-gated Photoshop features (Select Subject v2,
  native Sky Replacement, neural filters, etc.), call \`photoshop_get_capabilities\`
  once to learn which features the user's installed Photoshop version exposes.

State before action
- Before the first tool that depends on the active document/layer, or whenever state may
  have changed or become uncertain, call \`photoshop_get_state\` to confirm what is open.
  Treat its output as the source of truth for document dimensions, activeLayer, selection
  bounds and color mode. When a workflow has a verified/persisted document latch and known
  layer target, do not add redundant state reads before every atomic operation.
- Capture \`document.id\` from \`photoshop_get_state\` (or \`photoshop_list_documents\`)
  and pass it as optional \`document_id\` on document-bound mutating tools and reads.
  Photoshop's active tab can change outside this integration; a supplied positive-integer
  \`document_id\` pins the operation to that file and successful calls report
  \`document_target: { id, pinned: true }\`. Invalid ids fail closed: do not remove the id
  and retry against whichever tab happens to be active.
- For visual confirmation after meaningful edits, call
  \`photoshop_get_preview\` (cheap, side-effect free JPEG snapshot). Use it
  sparingly in ordinary editing — normally once per major step, not per atomic tool.
  Exception: an active guide such as \`ps.digital_painting_control\` may deliberately
  require higher-frequency materialized process capture after each visual mutation while
  keeping full visual-reasoning previews on their own cadence.

Recipe tools over atomic chains
- When the user's request matches a recipe purpose ("remove background",
  "cut out", "isolate subject", "enhance portrait", "smooth skin", "retouch",
  "prepare for web", "export Instagram variants", "apply cinematic color grade",
  "make it pop", "frequency separation", "replace mockup", "organize layers",
  "replace sky", "fade into background", "gradient mask", "dodge and burn",
  "remove that person", "erase distraction", "csv to cards", "batch cards",
  "data-driven graphics"), prefer the matching
  \`photoshop_recipe_*\` tool over composing 5+ atomic calls yourself. Recipes
  are wrapped in a single history step and are deterministically reversible
  with one undo.
- Drop back to atomic \`photoshop_*\` tools only for fine-grained, novel
  edits that no recipe covers.
- For teaching step-by-step mask/composite workflows, call \`prompts/get\` on
  a guide prompt (see Guide prompts below). Prefer the matching \`ps.*\`
  **recipe** prompt when the user wants a one-undo outcome.

Units & conventions
- All numeric coordinates, widths, heights and bounds are pixels. The server
  forces pixel/point units around every script — do not translate to inches/cm/percent.
- Font sizes are points. Colors are 0–255 RGB triplets.
- Output files default to \`~/.photoshop-mcp/exports[/<chat-id>]\`. Pass an absolute
  path only when the user explicitly asks for one.

Error recovery contract
- Tools return a structured envelope when something is wrong:
  \`{ ok: false, code, message, suggested_next_tool?, suggested_args?, context? }\`
  along with MCP's \`isError: true\`. When you see this, follow the
  \`suggested_next_tool\` hint instead of guessing or retrying blindly.
- Common codes you should be ready to handle without asking the user:
  - \`document_not_found\` — the \`document_id\` you passed is not open;
    call \`photoshop_list_documents\` and retry with a current id.
  - \`no_active_document\` — call \`photoshop_open_image\` or
    \`photoshop_create_document\` first.
  - \`no_active_layer\` / \`layer_not_found\` — list layers with
    \`photoshop_get_layers\`, then act on a specific name.
  - \`selection_required\` — make a selection before reusing the failed tool.
  - \`version_unsupported\` — use a supported deterministic alternative and tell the user
    once which Photoshop feature is unavailable.

Healthy painting continuation
- Read docs/digital-painting-agent-skill.md as the working kernel; detailed modules
  are conditional references, not a mandatory full reread before each pass.
- Inspect the image blocks carried by Guard visual_review when present. A materialized path
  and matching SHA establish provenance/recovery identity but do not mean the host model
  actually received or correctly interpreted the picture. If only a path is exposed, open
  that image once. Do not recapture unchanged pixels or insert routine status/schema/source reads.
- Visual verdict order is observation first, interpretation second: record concise visible
  facts by region, then the primary mismatch against the goal, then target_resolved and the
  disposition. Never copy expected_visual_delta, hypothesis, summary or a successful tool
  result into observations. accept keeps useful pixels; it does not confirm an unresolved or
  uncertain goal. Comparative improvement/readability claims require a comparable same-document
  before frame; otherwise keep the comparison explicitly unknown/unconfirmed.
- Normal visual continuation uses the compact cycle_auto contract. Start a pass with
  next_pass={request_key, problem_id when needed, document_id, goal, region/protection when needed,
  optional action_class for explicit REPLACE/ERASE, actions}.
  After inspecting its returned frame, the next call carries previous_operation_id +
  previous_observation + the next next_pass. For the last pass omit next_pass.
  Guard derives the technical report and exact durable receipt acknowledgement from
  its journal; do not copy receipt tokens or manufacture did/why/result. Removed
  legacy operation/closure payloads are not public alternatives and fail closed.
- HARD PASS BOUNDARY: one Guard pass is not an entire artistic stage. A recognition or
  whole-canvas block-in may require several sequential Guard passes. Current VisualMicroPlan
  execution supports one rollback unit, at most one created logical layer, and 1-4 contiguous
  compatible visual mutations with preparation first. These limits are derived from the
  executable action contract, not from a caller-supplied pass type. Never interpret "rough in
  the whole subject" or "complete the recognition block-in" as permission to pack the whole
  artistic stage into one Guard pass.
- A preflight execution=not-executed rejection requires correction of the listed
  errors, not invented reconciliation debt. Uncertain bootstrap uses reconcile
  on its original id and durable receipt; absent/corrupt is never replay permission.

Multi-step etiquette
- User-visible commentary is communication, not protocol bookkeeping. Give concise
  updates around meaningful artistic passes and blockers; do not create a mandatory
  three-field report for brush lookup, layer creation, polling or other administrative
  substeps. Keep preparation + layer creation + related mutations inside one bounded
  next_pass whenever the VisualMicroPlan safety limits permit it.
- Before the first paint mutation of an art project, configure one immutable
  repository-local processes/<subject>-process/<run-name>/ art run. Keep process
  frames + same-stem commentary .txt files in frames/, editable milestones in
  checkpoints/ and final PSD/image files in final/; art-run save/export paths stay
  inside that project folder.
- Before first live paint, read photoshop_guard_status.paint_readiness instead of guessing
  setup order. If art_run=missing, call photoshop_guard_set_art_run. Brush preflight is an
  execution dependency of brush-based strokes/dabs, not of unrelated preparation or region/fill
  operations. On a nontrivial run, complete/persist brush_preflight before the first operation
  that actually uses that dependency.
- Painting commentary is sticky within the current art run. Switch with
  \`режим техника\`, \`режим художник\`, or \`режим вместе\`; \`коротко\` / \`обычно\` /
  \`подробно\` change only detail; \`режим кратко\` preserves content mode and makes it
  short; \`следующий шаг — художник|техника|вместе\` is a one-action override. Default
  is \`вместе + обычно\`. Persist commentary_mode/commentary_detail with long-run state.
- In \`режим художник\`, use natural Russian only and speak as an art tutor: visual
  problem → intended effect → Photoshop-native artistic action/settings → what must
  be preserved → inspected visible result. Do not reveal hidden chain-of-thought or
  mention MCP/Guard/API/JSON, internal tool names, ids, hashes, protocol/runtime/
  server/transport/job/poll/receipt/schema/controller jargon or English implementation
  terms. If infrastructure blocks work, state only the practical consequence in plain
  Russian. Mandatory report semantics still apply. In \`режим вместе\`, artistic
  explanation comes first and the technical note stays compact.
- In artistic/mixed mode, before each meaningful visual pass emit the compact root
  goal as the concise ordinary visible artistic message. The next_pass compiler
  reuses that same goal internally as artistic_commentary; do not duplicate it in
  JSON. Internal commentary/progress generation never proves user-visible delivery.
- Every VisualMicroPlan performs Layer Separation Check: before the first
  substantial new object/material/light/plane assess rollback value and likely
  independent adjustment, masking, weakening, recoloring, protection or rollback.
  When that value is real, isolate it in one new/temporary logical layer; ordinary
  continuation and tiny low-value accents stay on the existing layer.
- After an independently isolated feature is visually accepted, carry its stable id in
  subsequent \`protected_layer_ids\` whenever the current task must preserve it.
  \`protected_regions\` is descriptive only. Supported paint mutations must pin target
  layer ids when protection is active and fail closed on protected targets. Intentional
  replacement requires REPLACE/ERASE plus the exact id in both \`protected_layer_ids\`
  and \`replace_protected_layer_ids\`; never use that exception as a convenience bypass.
- Describe Photoshop progress semantically, never as "Called Photoshop tool". Use
  \`photoshop_guard_cycle_auto\`; predicted/observed ~7–10s+ work returns a durable
  \`job_id\` and continues with \`photoshop_guard_job_poll\`. The Guard keeps the
  operation journal, durable receipt/ack, uncertainty policy and preview/verdict
  barrier inside the MCP server process. Host progress is transient and distinct
  from both the technical execution record and the model's artistic observation.
- Report execution and visual improvement separately. Tool success does not prove
  the image improved. Bound one visual bundle to one problem, then inspect a preview.
- For painting/drawing visual mutations, use a stable \`problem_id\` across attempts at the same
  unresolved visual problem, while every distinct attempt gets a distinct \`request_key\`.
  Re-delivery of one request_key is idempotent; a new request_key with the same problem_id is a
  new attempt on the same tracked problem. Progress is measured
  primarily by resolved visual problems, not by MCP/tool-call count, reports, previews or
  checkpoints. A problem is resolved only after a meaningful decoded before/after change,
  \`improvement\`, \`accept\`, and \`target_resolved=yes\`. That resolves only the current
  operation/problem target; it does not complete a Planner task. Planner-task completion
  requires an explicit task-scope assessment with task-level evidence.
- For a new subject, use Recognition Block-In before ordinary refinement: derive 3–7
  discriminative recognition features (small features may be high-priority), include one large
  style cue when style is requested, and rough in the whole subject before polishing one contour.
  \`photoshop_paint_regions\` is broad closed-mass scaffolding during
  RECOGNITION_BLOCK_IN / COMPOSITION / SHAPE / GLOBAL_BLOCK_IN. Exit broad ADD block-in only when
  the whole preview reads without relying on the prompt. At later stages region painting is legal
  only for an explicit bounded REPLACE/ERASE correction with exact layer target and clip_bounds;
  it must not continue flat block-in under a false earlier stage.
  Recognition-stage verdicts record subject/style recognizability plus visible/lost cues so
  status can derive time-to-first-recognition and feature-destruction metrics from the journal.
- Non-trivial art runs default to \`painting_profile=nontrivial_painting\`. Before the first
  brush-dependent stroke/dab operation, inspect
  the live installed preset inventory, assign a compact material-aware brush role map, verify
  selected preset effective settings, selectively footprint-probe unfamiliar/high-impact roles,
  then re-call \`photoshop_guard_set_art_run\` with the same process_dir and completed
  \`brush_preflight\`. Brush-dependent painting is fail-closed until this durable preflight exists;
  brush-independent region/fill construction is not blocked merely because brush_preflight is absent.
- Route non-trivial strokes/dabs/region construction through \`photoshop_execute_visual_microplan\`.
  On compact \`next_pass\`, Guard may choose the durable preflighted brush role by working scale
  (or the optional \`brush_role\` hint), insert preset selection, and compile \`paint_strategy\`.
  The model need not repeat preset/pressure metadata already present in brush_preflight. Declared
  simulated pressure must still appear in the actual stroke via \`simulate_pressure\` and/or matching dynamics.
- A changed preview SHA is not evidence of meaningful artistic progress. The durable
  controller applies a visual-significance gate. \`improvement + accept\` is blocked when the
  decoded effect is \`insufficient\` or \`unknown\`. After an insufficient pass, replan rather
  than repeating the same weak strategy.
- Small/local painting passes must use matching before/after focus previews. Use
  \`significance_mode=subtle_local\` only when a deliberately fine correction needs a lower
  local threshold; it must be declared before mutation and cannot be used as an after-the-fact
  excuse for an imperceptible pass.
- If status reports \`workflow_stall\`, stop protocol churn and make a real executable strategy
  change (method, scale, region, brush role or mutation structure) before another mutation.
  Legacy \`replan\` prose is not an override. Required recovery reads/checkpoints remain allowed.
- HARD VISUAL CADENCE: after a visual preview has been inspected and its verdict recorded,
  the next healthy canonical cycle must contain the next meaningful visual pass. Do not insert
  routine status/get_state/document-list/schema/source/grep/extra-preview investigation between
  healthy passes. Exceptions are actual uncertainty/recovery, an active async job, a controller
  error, suspected document retargeting, a demonstrated systemic runtime/tool defect, a required
  checkpoint, or an explicit user request to investigate the pipeline instead of continuing art.
- \`photoshop_get_state\` is required before the first mutation of a new run and when Photoshop
  state is genuinely uncertain (interruption/recovery, suspected retargeting/external state change,
  or a concrete controller/tool error). It is not required between normal visual passes when a
  pinned \`document_id\`, materialized preview, recorded verdict and closed barrier already exist.
- After a demonstrated systemic failure, spend at most one compact diagnostic investigation before
  a causal replan and the next visual pass. A second investigation is justified only when the first
  produced no actionable cause; do not turn ordinary verdicts into open-ended diagnostics.
- If status/resume reports \`decision_loop_stall\` (roughly 90s without a new visual pass and no
  blocking safety/recovery obligation), follow its prescriptive \`next_required_action\`: dispatch
  the next meaningful visual pass or explicitly enter the bounded diagnostic exception. The cadence
  signal never weakens the preview, acknowledgement, uncertainty or checkpoint barriers.
- Treat \`silent_stall\` as a separate continuation failure: roughly 90s with a known next required
  action and no active durable job. Pending report/ack/verdict/reconcile/checkpoint explains rather
  than suppresses it; read-only status/state/schema/preview churn does not reset its clock. Follow the
  reported \`next_required_action\` or explicitly tell the user why continuation is blocked.
- Checkpoint-due is risk/debt based rather than a fixed pass-count or wall-clock timer. If it is the
  active barrier, save and verify the pinned layered PSD, then continue the
  next planned visual cycle without restarting whole-image analysis solely because a save occurred.
- If that mandatory save fails with \`uxp_bridge_unavailable\`, follow the structured hint once with
  \`photoshop_get_capabilities\`. Never use COM/ExtendScript fallback and never clear the checkpoint
  barrier. If \`uxp_bridge_reachable=false\`, do not start another visual mutation; restore/reload the
  supported UXP bridge when possible, otherwise report the persistence block and stop. After recovery,
  retry only the save, verify the PSD, then resume; never replay the preceding painting mutation.
- Group related atomic edits inside a recipe when possible. When you must
  chain atomics, name layers (\`photoshop_rename_layer\`) so future turns can
  re-target them deterministically.

User intent glossary
- Map colloquial phrases to the primary tool below.
- bg.remove — "remove background", "cut out", "isolate subject", "transparent
  background", "arka planı sil" → \`photoshop_recipe_remove_background\`
- obj.remove — "remove that person", "erase distraction"
  → \`photoshop_recipe_remove_distraction\` (content-aware) after manual selection
- mask.gradient_fade — "fade into background", "gradient mask", "blend subject"
  → \`photoshop_recipe_gradient_fade\`; guide \`ps.gradient_blend\` for atomic chain
- sky.replace — "replace sky", "fix blown sky", "better clouds" →
  \`photoshop_sky_replacement\` when \`sky_replacement_native\`; else
  \`photoshop_recipe_sky_blend\`; guide \`ps.composite_blend\` for manual composite
- portrait.enhance — "smooth skin", "retouch portrait", "fix blemishes" →
  \`photoshop_recipe_enhance_portrait\`
- portrait.freq_sep — "frequency separation", "split texture and color" →
  \`photoshop_recipe_frequency_separation\`
- color.correct — "make it pop", "S-curve", "fix flat image", "auto tone" →
  \`photoshop_adjust_curves\`; fallback \`photoshop_auto_levels\` then
  \`photoshop_adjust_brightness_contrast\`; guide \`ps.color_correct\`
- color.grade — "cinematic", "teal orange", "moody grade" →
  \`photoshop_recipe_apply_color_grade\`
- light.dodge_burn — "dodge and burn", "sculpt light", "lighten face" →
  \`photoshop_recipe_dodge_burn\`; guide \`ps.dodge_burn_guide\` for atomic setup
- export.social — "for Instagram", "web export" →
  \`photoshop_recipe_export_social_variants\` or \`photoshop_recipe_prepare_for_web\`
- layers.organize — "organize layers", "rename mess" → \`photoshop_recipe_organize_layers\`
- carousel.split — "seamless carousel", "split panorama", "swipe post", "slayt"
  → \`photoshop_recipe_split_carousel\`
- batch.watermark — "watermark these photos", "add logo to all", "toplu filigran"
  → \`photoshop_recipe_batch_watermark\`
- id.passport — "passport photo", "visa photo", "ID photo", "vesikalık", "biyometrik"
  → \`photoshop_recipe_passport_photo\`
- batch.csv_cards — "csv to cards", "batch cards", "data-driven graphics",
  "mail merge for images", "name badges from spreadsheet", "sertifika bas"
  → \`photoshop_recipe_csv_to_cards\`; prompt \`ps.csv_to_cards\`
- paint.draw — "draw", "paint", "sketch", "digital painting", "illustrate with brushes"
  → use the painting tools with guide prompt \`ps.digital_painting_control\`.
  The guide owns the executable painting-control policy (hierarchy, style/mode, hot loop,
  reference modules, rollback/recovery, observability and Definition of Done); do not duplicate it here.
- paint.sample_color — "pick this color", "sample from reference", "eyedropper", "what color is here"
  → \`photoshop_sample_color\`; use a small radius when a representative local average is preferable to one pixel.
- paint.sample_colors — "sample many points", "reference value map", "palette grid"
  → \`photoshop_sample_colors\` for efficient multi-point point sampling from one pinned reference; use the single-point sampler for averaged neighborhoods.

Degrade paths
- Distraction removal — prefer \`photoshop_recipe_remove_distraction\` or
  \`photoshop_content_aware_fill\` after an explicit selection.
- Sky replacement — prefer \`photoshop_sky_replacement\`; degrade:
  \`photoshop_recipe_sky_blend\` when a sky file path is available;
  otherwise \`photoshop_place_image\` + mask workflow or guide \`ps.composite_blend\`.
- Neural skin / harmonize — \`photoshop_neural_filter\` when \`neural_filters\` is true;
  else frequency separation / manual recipes.
- Select Subject v2 missing — \`photoshop_recipe_remove_background\` returns
  \`version_unsupported\` → manual selection tools + \`photoshop_create_layer_mask\`.
- Curves unavailable — use \`photoshop_auto_levels\` then
  \`photoshop_adjust_brightness_contrast\` before retrying stronger edits.

Disambiguation
- "gradient" — prefer linear gradient **on a layer mask** (blend/fade); not a
  Gradient Fill layer unless the user explicitly asks for a fill layer.
- "remove" — prefer mask or content-aware inpainting; not deleting the layer
  unless the user explicitly wants pixels destroyed.
- "sharpen" — web export sharpen pass → \`photoshop_recipe_prepare_for_web\`;
  single-layer sharpen → \`photoshop_apply_sharpen\`.

Guide prompts (MCP prompts/get)
- Prefer matching \`ps.*\` **recipe** prompt when the user wants a one-undo outcome;
  use guide prompts for teaching atomic chains.
- Recipe prompts (1:1 with \`photoshop_recipe_*\`): \`ps.remove_background\`,
  \`ps.enhance_portrait\`, \`ps.prepare_for_web\`, \`ps.export_social_variants\`,
  \`ps.apply_color_grade\`, \`ps.frequency_separation\`, \`ps.batch_mockup_replace\`,
  \`ps.organize_layers\`, \`ps.gradient_fade\`, \`ps.sky_blend\`, \`ps.dodge_burn\`,
  \`ps.remove_distraction\`, \`ps.split_carousel\`, \`ps.batch_watermark\`,
  \`ps.passport_photo\`, \`ps.csv_to_cards\`
- Guide prompts (no recipe pair): \`ps.gradient_blend\` — fade via mask gradient;
  \`ps.color_correct\` — tone / contrast fix chain; \`ps.dodge_burn_guide\` — 50% gray
  overlay setup; \`ps.composite_blend\` — place asset + mask + blend mode;
  \`ps.digital_painting_control\` — subject-agnostic brush-painting workflow built around composition → shape → value → form → edge → material → detail, multiscale error-driven local actions, visual checkpoints, rollback and Definition of Done.
`.trim();

export function buildPhotoshopInstructions(): string {
  return PHOTOSHOP_MCP_INSTRUCTIONS;
}
