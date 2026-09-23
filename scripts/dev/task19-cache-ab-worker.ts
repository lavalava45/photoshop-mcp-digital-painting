import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { ToolRegistry, type ToolDefinition } from '../../src/core/tool-registry.js';
import { withToolExecutionContext } from '../../src/core/execution-context.js';
import {
  createVisualMicroPlanTools,
  preflightVisualMicroPlanForExecution,
} from '../../src/tools/visual-microplan-tools.js';

const pair = Number(process.argv[2] ?? 1);
const PREP_DELAY_MS = 18;
const READ_DELAY_MS = 4;
const DISPATCH_DELAY_MS = 9;

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function json(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload) }] };
}

function tool(name: string, handler: ToolDefinition['handler'], properties: Record<string, unknown> = {}): ToolDefinition {
  return {
    tool: { name, description: name, inputSchema: { type: 'object', properties, additionalProperties: true } },
    handler,
  };
}

function plan(id: string, xOffset: number) {
  return {
    plan_id: id,
    summary: 'Task19 safe equivalent cache benchmark',
    stage: 'FORM_AND_LIGHT',
    scale: 'local',
    region: `benchmark-region-${xOffset}`,
    intent: 'measure preparation reuse with equivalent safe simulated work',
    method_class: 'paint',
    risk: 'low',
    expected_visual_delta: 'Synthetic benchmark only; no Photoshop mutation occurs.',
    verification_envelope: { mode: 'before_after', min_focus_dimension_px: 800 },
    layer_separation_check: {
      change_kind: 'continuation', substantial: false, rollback_value: 'low',
      independent_adjustment_expected: false, reasons: ['benchmark-only equivalent region'],
    },
    problem_id: 'task19-cache-benchmark',
    action_class: 'REFINE',
    expected_visual_result: 'Synthetic handler completes.',
    document_id: 42,
    steps: [
      { id: 'select', tool: 'photoshop_select_brush_preset', args: { name: 'Benchmark Brush' } },
      { id: 'settings', tool: 'photoshop_get_brush_settings', args: {} },
      { id: 'before', tool: 'photoshop_get_preview', args: { max_dimension_px: 800, focus_region: { left: xOffset, top: 0, right: xOffset + 900, bottom: 900 } } },
      { id: 'paint', tool: 'photoshop_paint_strokes', args: { layer_id: 7, strokes: [{ tool: 'BRUSH', points: [{ x: xOffset + 10, y: 10 }, { x: xOffset + 20, y: 20 }] }] } },
      { id: 'preview', tool: 'photoshop_get_preview', args: { max_dimension_px: 800, focus_region: { left: xOffset, top: 0, right: xOffset + 900, bottom: 900 } } },
    ],
  };
}

async function main() {
  const registry = new ToolRegistry();
  const counters = { prep_calls: 0, preview_calls: 0, dispatch_calls: 0, dispatch_ms: 0 };
  registry.register('photoshop_list_documents', tool('photoshop_list_documents', async () => {
    await sleep(READ_DELAY_MS);
    return json({ ok: true, details: { documents: [{ id: 42, width: 2400, height: 1600 }] } });
  }));
  registry.register('photoshop_select_brush_preset', tool('photoshop_select_brush_preset', async () => {
    counters.prep_calls++;
    await sleep(PREP_DELAY_MS);
    return json({ ok: true, selected: 'Benchmark Brush', size: 24, hardness: 80 });
  }, { name: { type: 'string' } }));
  registry.register('photoshop_get_brush_settings', tool('photoshop_get_brush_settings', async () => {
    counters.prep_calls++;
    await sleep(PREP_DELAY_MS);
    return json({ ok: true, size: 24, hardness: 80 });
  }));
  registry.register('photoshop_get_preview', tool('photoshop_get_preview', async () => {
    counters.preview_calls++;
    await sleep(READ_DELAY_MS);
    return json({ ok: true, sha256: 'a'.repeat(64) });
  }));
  registry.register('photoshop_paint_strokes', tool('photoshop_paint_strokes', async () => {
    counters.dispatch_calls++;
    const started = performance.now();
    await sleep(DISPATCH_DELAY_MS);
    counters.dispatch_ms += performance.now() - started;
    return json({ ok: true, synthetic_safe_dispatch: true });
  }, { layer_id: { type: 'number' }, strokes: { type: 'array' } }));

  const execute = createVisualMicroPlanTools(registry)[0]!.handler;
  const rows = [];
  for (const [condition, xOffset] of [['cold', 0], ['warm', 1000]] as const) {
    const input = plan(`task19-p${pair}-${condition}`, xOffset);
    const prepCallsBefore = counters.prep_calls;
    const dispatchMsBefore = counters.dispatch_ms;
    const wallStarted = performance.now();
    const preflightStarted = performance.now();
    const rejection = await preflightVisualMicroPlanForExecution(input, registry);
    const guardPreflightMs = performance.now() - preflightStarted;
    if (rejection) throw new Error(`preflight rejected ${condition}: ${JSON.stringify(rejection)}`);
    const result = await withToolExecutionContext({ guardOperationId: String(input.plan_id) }, () => execute(input));
    const wallMs = performance.now() - wallStarted;
    const text = result.content.find(item => item.type === 'text');
    const body = JSON.parse(text && 'text' in text ? text.text : '{}');
    if (!body.ok) throw new Error(`execution failed ${condition}: ${JSON.stringify(body)}`);
    rows.push({
      pair,
      condition,
      child_pid: process.pid,
      preparation_host_calls: counters.prep_calls - prepCallsBefore,
      preparation_cache_events: body.preparation_cache?.events ?? [],
      capability_cache: { process_cold_start: condition === 'cold', same_registry_runtime_revision: true },
      guard_preflight_ms: guardPreflightMs,
      photoshop_dispatch_ms: counters.dispatch_ms - dispatchMsBefore,
      semantic_cycle_wall_ms: wallMs,
      preview_sha256: body.preview?.sha256 ?? null,
      safety: { photoshop_invoked: false, synthetic_dispatch_only: true },
    });
  }
  process.stdout.write(JSON.stringify({ pair, rows }) + '\n');
}

main().catch(error => {
  process.stderr.write(String(error?.stack ?? error) + '\n');
  process.exitCode = 1;
});
