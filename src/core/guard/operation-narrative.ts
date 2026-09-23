// @ts-nocheck
const LONG_RUNNING_TOOLS = [
  /^photoshop_execute_visual_microplan$/,
  /^photoshop_paint_(?:strokes|dabs|regions)$/,
  /^photoshop_neural_/,
  /^photoshop_recipe_/,
];

function isVisualTool(tool = '') {
  return /(?:paint|fill_layer|undo|visual_microplan|set_layer_opacity|transform|neural)/.test(tool);
}

function hasLocalFocus(operation = {}) {
  if (operation.preview_args?.focus_region) return true;
  if (operation.tool !== 'photoshop_execute_visual_microplan') return false;
  return Array.isArray(operation.args?.steps)
    && operation.args.steps.some(step => step?.tool === 'photoshop_get_preview' && step?.args?.focus_region);
}

function nextStep(operation = {}, state = 'running') {
  if (state === 'failed' || state === 'uncertain') return 'проверить состояние Photoshop и восстановить контекст без повторного запуска mutation';
  if (state === 'before_preview') return 'после фиксации исходной области выполнить запланированную mutation';
  if (state === 'after_preview') return hasLocalFocus(operation)
    ? 'сравнить локальный before/after и вынести визуальный verdict'
    : 'проверить итоговый preview и вынести визуальный verdict';
  if (state === 'completed') {
    return isVisualTool(operation.tool)
      ? 'визуально классифицировать результат и решить: принять, скорректировать или откатить'
      : 'использовать результат для следующего решения по задаче';
  }
  if (hasLocalFocus(operation)) return 'локальный before/after preview и визуальная проверка именно этой области';
  if (isVisualTool(operation.tool)) return 'preview результата и визуальный verdict перед следующей mutation';
  if (operation.tool === 'photoshop_get_preview') return 'визуально проверить полученный кадр';
  if (operation.tool === 'photoshop_save_document') return 'подтвердить checkpoint и продолжить с сохранённого состояния';
  return 'оценить результат и выбрать следующий осмысленный шаг';
}

function photoshopState(operation = {}, state = 'running') {
  const visual = isVisualTool(operation.tool);
  if (state === 'queued') return visual ? 'mutation поставлена в очередь' : 'операция поставлена в очередь';
  if (state === 'starting') return visual ? 'mutation запускается' : 'операция запускается';
  if (state === 'before_preview') return 'снимается исходный before preview';
  if (state === 'mutation') return visual ? 'mutation выполняется' : 'операция выполняется';
  if (state === 'after_preview') return 'снимается обязательный after preview';
  if (state === 'running') return visual ? 'mutation выполняется' : 'операция выполняется';
  if (state === 'awaiting_preview') return 'mutation завершена; захватывается проверочный preview';
  if (state === 'completed') return visual ? 'mutation и обязательная фиксация результата завершены' : 'операция завершена';
  if (state === 'failed') return 'операция завершилась ошибкой';
  if (state === 'uncertain') return 'результат выполнения не подтверждён';
  return String(state || 'операция выполняется');
}

export function operationNarrative(operation, state = 'running') {
  const summary = String(operation?.summary ?? '').trim() || 'выполняю следующий шаг в Photoshop';
  const purpose = String(operation?.purpose ?? '').trim() || 'продвинуть текущую визуальную задачу';
  const progressId = `photoshop-operation:${String(operation?.id ?? 'unknown')}`;
  const narrative = {
    progress_id: progressId,
    operation_id: operation?.id ?? null,
    state,
    now: summary,
    why: purpose,
    photoshop: photoshopState(operation, state),
    next: nextStep(operation, state),
  };
  return {
    ...narrative,
    text: [
      `Сейчас: ${narrative.now}`,
      `Почему: ${narrative.why}`,
      `Photoshop: ${narrative.photoshop}`,
      `Следом: ${narrative.next}`,
    ].join('\n'),
  };
}

function historicalDurationMs(record) {
  if (!record?.created_at || !record?.completed_at) return undefined;
  const started = Date.parse(record.created_at);
  const completed = Date.parse(record.completed_at);
  const duration = completed - started;
  return Number.isFinite(duration) && duration >= 0 ? duration : undefined;
}

export function shouldUseAsyncJob(operation, history = []) {
  if (!operation || typeof operation !== 'object') return false;
  const timeout = Number(operation.timeout_ms ?? 60_000);
  if (Number.isFinite(timeout) && timeout <= 10_000) return false;
  const tool = String(operation.tool ?? '');

  // Current work wins over historical timing. A few slow VisualMicroPlans must not
  // permanently push later tiny paint bundles into detached async execution.
  if (tool === 'photoshop_execute_visual_microplan' && Array.isArray(operation.args?.steps)) {
    const mutation = operation.args.steps.find(step => /photoshop_(?:paint_strokes|paint_dabs|paint_regions|fill_layer|undo)/.test(step?.tool ?? ''));
    if (mutation?.tool === 'photoshop_paint_dabs' && Array.isArray(mutation.args?.dabs) && mutation.args.dabs.length <= 24) return false;
    if (mutation?.tool === 'photoshop_paint_strokes' && Array.isArray(mutation.args?.strokes) && mutation.args.strokes.length <= 4) return false;
    if (mutation?.tool === 'photoshop_paint_regions' && Array.isArray(mutation.args?.regions) && mutation.args.regions.length <= 8) return false;
  }

  const sameToolDurations = Array.isArray(history)
    ? history
      .filter(record => record?.tool === operation.tool && record?.phase === 'completed')
      .map(historicalDurationMs)
      .filter(duration => Number.isFinite(duration))
      .slice(-5)
    : [];
  if (sameToolDurations.length) {
    const sorted = [...sameToolDurations].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (median >= 7_000 || sameToolDurations.at(-1) >= 10_000) return true;
  }
  if (!LONG_RUNNING_TOOLS.some(pattern => pattern.test(tool))) return false;

  // VisualMicroPlan setup-only/small paint bundles often finish quickly. Keep very
  // small explicit bundles synchronous; everything else in this class gets the UX
  // benefit of an immediate job handoff rather than a silent 10-60 second call.
  return true;
}

export function progressPayload(operation, state = 'running') {
  const narrative = operationNarrative(operation, state);
  return {
    protocol: 'operation.progress.v1',
    progress_id: narrative.progress_id,
    text: narrative.text,
    state: narrative.state,
    operation_id: narrative.operation_id,
  };
}

// Compatibility surface for COS builds that know how to promote this structured
// result into a native host progress row. Safety does not depend on this alias.
export function hostProgressPayload(operation, state = 'running') {
  const progress = progressPayload(operation, state);
  return { ...progress, protocol: 'cos.host_progress.v1' };
}
