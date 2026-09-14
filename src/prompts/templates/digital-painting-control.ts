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
    'Guide an agent through iterative digital painting with semantic passes, visual checkpoints, occlusion-aware strokes, cleanup, and state-based completion criteria.',
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
      `Goal: Paint "${subject}" in Photoshop using the digital-painting tools while continuously checking the actual image instead of executing a long blind stroke list.`,
      ``,
      `Style: ${style}`,
      `Finish level: ${finishLevel}`,
      `Constraints: ${constraints}`,
      budgetText,
      finishText,
      ``,
      `HARD TOOL-ROUTING INVARIANT — Photoshop mode:`,
      `- This workflow is already in Photoshop/COS/MCP mode. Treat that execution mode as sticky across subsequent turns until the user explicitly exits it.`,
      `- Short continuations such as "да", "давай", "продолжай", "сделай", "рисуй", "дальше", "есть доступ", "ок", or "попробуй еще" inherit the current Photoshop execution path. Do not reclassify them as a new image-generation request.`,
      `- In Chat On Steroids, use Chat_On_Steroids_Core for Photoshop MCP/terminal execution; use Chat_On_Steroids_Desktop only for read-only UI inspection when useful.`,
      `- Do NOT call image_gen or another external image-generation path while Photoshop mode is active, even if the request uses words such as draw, paint, image, portrait, render, create, edit, or repaint.`,
      `- A short or ambiguous follow-up can never switch execution mode. Switch away from Photoshop only when the user explicitly asks for a different execution path, for example "используй ImageGen" or "не в Photoshop".`,
      `- Routing guard: if image_gen would be the next tool while Photoshop mode is active, stop that route and continue through the established Photoshop MCP path instead.`,
      `- Operational latch: CURRENT_EXECUTION_MODE = PHOTOSHOP_MCP. Do not reconsider the tool family unless the user explicitly changes mode.`,
      ``,
      `HARD DOCUMENT-TARGETING INVARIANT:`,
      `- Capture the working document.id from photoshop_get_state or photoshop_list_documents and keep it as the workflow document latch.`,
      `- When multiple documents are open, or another agent/user/UI action could change tabs, pass document_id on every document-bound read/mutation that accepts it. Do not trust the currently visible tab.`,
      `- A supplied document_id is fail-closed: malformed/non-positive ids are invalid_arguments and closed/unknown ids are document_not_found. Never drop the id and silently retry on the active tab.`,
      `- Successful pinned calls report document_target { id, pinned: true }; verify it when deterministic cross-document execution matters.`,
      ``,
      `Core discipline:`,
      `- Treat painting as an iterative perceive → plan → paint → inspect → correct loop.`,
      `- Technical tool success is not visual success. A stroke that executes without error may still be compositionally wrong.`,
      `- New strokes must account for existing forms, depth order and occlusion. Do not draw through foreground forms unless the overlap is intentional.`,
      `- Prefer short, intentional strokes over long blind strokes when a path crosses complex geometry. Split strokes around protected/foreground regions.`,
      `- Do not continue detailing on top of a visible structural error. Correct the error first.`,
      `- For reference-driven color work, use \`photoshop_sample_color\` on the pinned reference document instead of guessing RGB values. Use radius=0 for a precise point and a small radius for representative local averages such as skin, hair, lips, fabric, or shadow.`,
      `- For proportion-sensitive work (portraits, architecture, perspective, repeated geometry), use a measurement checkpoint when useful: choose visible semantic landmarks, optionally add/list guides, call \`photoshop_measure_points\`, and correct structure before detailing.`,
      `- To reuse landmarks across references/canvases, define an axis-aligned semantic frame {left, top, right, bottom}, use \`photoshop_transform_landmarks\` to preserve local u/v position, and use \`photoshop_compare_landmarks\` for normalized per-point plus mean/RMSE/max error. These tools measure caller-supplied geometry; they do not detect landmarks automatically.`,
      `- When this is a fresh-composition skill test, do not reuse coordinates, stroke lists, object proportions or precomputed object-specific occlusion geometry from earlier artistic demos unless the user explicitly asks for a variation/refinement of an existing image. Generic helpers and brush infrastructure may be reused.`,
      `- Keep execution observable: one short semantic pass at a time. Wait for the current MCP/terminal operation to finish completely before starting another Photoshop mutation.`,
      `- Keep the user informed in chat. Before a pass, say what you are changing; after it completes, say that it completed; after preview, summarize what visibly changed and what needs attention next.`,
      `- If Photoshop may look unchanged while a long ExtendScript/MCP call is running, explicitly say that the operation is still running rather than leaving the user to infer that the session froze.`,
      `- If the chat/UI reloads or reports an interrupted response, verify whether an already-launched MCP/terminal job is still running before issuing any new paint command. A chat interruption does not imply that Photoshop execution stopped.`,
      ``,
      `Workflow:`,
      `1. DISCOVER/STATE — call \`photoshop_get_state\`; confirm document/layer, capture document.id as the working document latch, and create a dedicated drawing document/layer stack when needed.`,
      `2. PLAN — identify major forms, silhouette, focal area, approximate depth order, palette/values, and semantic passes. Do not hardcode object-specific protected-region coordinates before seeing the actual image unless the user supplied explicit geometry/masks.`,
      `3. BLOCK-IN — paint broad masses and silhouette first. Use a small heterogeneous batch or several homogeneous batches.`,
      `4. CHECKPOINT — obtain a visual preview after the block-in. Judge silhouette/readability before adding details. Infer provisional foreground/protected regions from what is actually visible in the preview.`,
      `5. CONSTRUCTION — add major internal forms and depth relationships. Avoid accidental intersections and tangencies.`,
      `6. CHECKPOINT — inspect again. Update depth/occlusion relationships and protected regions from the actual rendered forms. Record must-fix issues before the next pass.`,
      `7. VALUES/COLOR — establish large light/shadow or color masses before fine detail when the style requires them. For reference-driven work, sample a compact palette from the pinned reference with photoshop_sample_color rather than inventing colors blindly.`,
      `8. LINE/DETAIL — add contours and focal details with line-weight hierarchy. Long strokes are allowed only across verified clear space.`,
      `9. ACCENTS — add highlights, texture, hatching or expressive marks only after structure is stable.`,
      `10. CLEANUP — explicitly search for and repair accidental crossings, awkward tangencies, duplicated contours, floating line endings, broken silhouettes and inconsistent line weight. Use eraser/repainting when needed.`,
      `11. FINAL CHECK — inspect at overall, medium and detail scale before declaring completion.`,
      ``,
      `Batching and checkpoints:`,
      `- Do not use one huge blind batch for a complex drawing. Prefer semantic passes and visual checkpoints.`,
      `- photoshop_paint_strokes defaults to cost-aware AUTO batching. Let the tool split expensive heterogeneous passes into short Photoshop scripts instead of manually enforcing the old 6–8 mixed-stroke limit.`,
      `- AUTO may create multiple Photoshop history steps; use SINGLE_HISTORY only when one undo step is more important than timeout resilience.`,
      `- For directional tapering, use stroke dynamics ranges for size/opacity/flow. Dynamics is rendered as segmented path strokes rather than native continuous pen pressure, so strong tapers with hard brushes may need a higher step count for visual smoothness.`,
      `- A preview is mandatory after every major semantic pass and before the final cleanup pass.`,
      `- Required pacing loop: short semantic pass → wait for full terminal/MCP completion → preview → report the visible result to the user → only then begin the next pass.`,
      `- A returned background/session id is not completion. Poll/wait until the command has a final result before continuing.`,
      `- Do not queue multiple semantic passes as one long background chain.`,
      ``,
      `Definition of Done — stop because the image is visually complete, not because a stroke counter reached a number. All required gates should pass:`,
      `- The subject reads clearly at the intended viewing scale.`,
      `- Major forms, proportions and silhouette are coherent for the requested finish level.`,
      `- Depth/occlusion relationships are intentional; no obvious accidental cross-object strokes remain.`,
      `- Focal features are resolved enough for the requested style and finish level.`,
      `- Value/color hierarchy and line/edge hierarchy are sufficient to support readability.`,
      `- A cleanup pass has been completed.`,
      `- Final inspection reveals no must-fix structural, overlap, tangent or readability defect.`,
      `- Additional strokes would be optional refinement rather than necessary correction.`,
      `- All explicit user constraints are satisfied.`,
      ``,
      `If one of those gates fails, the drawing is not done even if the soft stroke budget has been reached. If all gates pass, stop even if the budget has unused capacity.`,
      ``,
      `End state: a visually inspected Photoshop painting whose completion is justified by the Definition of Done, with no unresolved must-fix issue hidden behind a numeric stroke target.`,
    ].join('\n');

    return userPrompt(
      `Digital painting control: ${subject} — ${finishLevel}${style !== 'unspecified style' ? `, ${style}` : ''}.`,
      text
    );
  },
};
