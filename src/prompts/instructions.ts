/**
 * Server-level guidance for host LLMs (Cursor, Claude Desktop, standalone UI).
 * Advertised on MCP `initialize` via ServerOptions.instructions.
 */
export const PHOTOSHOP_MCP_INSTRUCTIONS = `
Photoshop tools (photoshop-mcp server)
=====================================

Session bootstrap
- Call \`photoshop_ping\` exactly once at the start of a session to verify the
  connection. Do not repeat it on every turn.
- Before suggesting AI-powered features (Generative Fill, Generative Upscale,
  Select Subject v2, neural filters, etc.), call \`photoshop_get_capabilities\`
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
  - \`version_unsupported\` / \`generative_unavailable\` — degrade gracefully
    to a non-generative alternative; tell the user once which feature is
    missing.

Multi-step etiquette
- After every tool result, decide: continue with the next planned tool, or
  emit a short user-facing summary. Do not end a turn on a tool call when
  the user asked for an outcome.
- Group related atomic edits inside a recipe when possible. When you must
  chain atomics, name layers (\`photoshop_rename_layer\`) so future turns can
  re-target them deterministically.

User intent glossary
- Map colloquial phrases to the primary tool below.
- bg.remove — "remove background", "cut out", "isolate subject", "transparent
  background", "arka planı sil" → \`photoshop_recipe_remove_background\`
- obj.remove — "remove that person", "erase distraction", "generative remove"
  → \`photoshop_generative_remove\` first; fallback
  \`photoshop_recipe_remove_distraction\` (content-aware) after manual selection
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
- Generative remove / distraction — prefer \`photoshop_generative_remove\`; degrade to
  \`photoshop_recipe_remove_distraction\` or \`photoshop_content_aware_fill\` when
  \`generative_unavailable\` or \`generative_credits_exhausted\`.
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
  \`ps.generative_fill\`, \`ps.generative_remove\`, \`ps.generative_expand\` — Firefly workflows;
  \`ps.digital_painting_control\` — subject-agnostic brush-painting workflow built around composition → shape → value → form → edge → material → detail, multiscale error-driven local actions, visual checkpoints, rollback and Definition of Done.
`.trim();

export function buildPhotoshopInstructions(): string {
  return PHOTOSHOP_MCP_INSTRUCTIONS;
}
