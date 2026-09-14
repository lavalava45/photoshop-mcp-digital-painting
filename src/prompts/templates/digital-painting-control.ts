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
      `Core discipline:`,
      `- Treat painting as an iterative perceive → plan → paint → inspect → correct loop.`,
      `- Technical tool success is not visual success. A stroke that executes without error may still be compositionally wrong.`,
      `- New strokes must account for existing forms, depth order and occlusion. Do not draw through foreground forms unless the overlap is intentional.`,
      `- Prefer short, intentional strokes over long blind strokes when a path crosses complex geometry. Split strokes around protected/foreground regions.`,
      `- Do not continue detailing on top of a visible structural error. Correct the error first.`,
      `- When this is a fresh-composition skill test, do not reuse coordinates, stroke lists, object proportions or precomputed object-specific occlusion geometry from earlier artistic demos unless the user explicitly asks for a variation/refinement of an existing image. Generic helpers and brush infrastructure may be reused.`,
      ``,
      `Workflow:`,
      `1. DISCOVER/STATE — call \`photoshop_get_state\`; confirm document/layer and create a dedicated drawing document/layer stack when needed.`,
      `2. PLAN — identify major forms, silhouette, focal area, approximate depth order, palette/values, and semantic passes. Do not hardcode object-specific protected-region coordinates before seeing the actual image unless the user supplied explicit geometry/masks.`,
      `3. BLOCK-IN — paint broad masses and silhouette first. Use a small heterogeneous batch or several homogeneous batches.`,
      `4. CHECKPOINT — obtain a visual preview after the block-in. Judge silhouette/readability before adding details. Infer provisional foreground/protected regions from what is actually visible in the preview.`,
      `5. CONSTRUCTION — add major internal forms and depth relationships. Avoid accidental intersections and tangencies.`,
      `6. CHECKPOINT — inspect again. Update depth/occlusion relationships and protected regions from the actual rendered forms. Record must-fix issues before the next pass.`,
      `7. VALUES/COLOR — establish large light/shadow or color masses before fine detail when the style requires them.`,
      `8. LINE/DETAIL — add contours and focal details with line-weight hierarchy. Long strokes are allowed only across verified clear space.`,
      `9. ACCENTS — add highlights, texture, hatching or expressive marks only after structure is stable.`,
      `10. CLEANUP — explicitly search for and repair accidental crossings, awkward tangencies, duplicated contours, floating line endings, broken silhouettes and inconsistent line weight. Use eraser/repainting when needed.`,
      `11. FINAL CHECK — inspect at overall, medium and detail scale before declaring completion.`,
      ``,
      `Batching and checkpoints:`,
      `- Do not use one huge blind batch for a complex drawing. Prefer semantic passes and visual checkpoints.`,
      `- With many per-stroke color/size/opacity changes, keep heterogeneous batches small enough to avoid Photoshop script timeout; current live tests found roughly 6–8 mixed strokes reliable.`,
      `- A preview is mandatory after every major semantic pass and before the final cleanup pass.`,
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
