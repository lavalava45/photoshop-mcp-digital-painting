import { beforeEach, describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import { withToolExecutionContext } from '../src/core/execution-context.js';
import {
  createVisualMicroPlanTools,
  invalidatePreparationCacheForReconciliation,
  preparationCacheDiagnosticsForTests,
  resetPreparationCacheForTests,
} from '../src/tools/visual-microplan-tools.js';

function tool(name: string, handler: ToolDefinition['handler'], properties: Record<string, unknown> = {}): ToolDefinition {
  return {
    tool: {
      name,
      description: name,
      inputSchema: { type: 'object', properties, additionalProperties: true },
    },
    handler,
  };
}

function registry() {
  const calls = { select: 0, settings: 0, paint: 0, preview: 0 };
  const r = new ToolRegistry();
  r.register('photoshop_select_brush_preset', tool('photoshop_select_brush_preset', async args => {
    calls.select++;
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, selected: args.name, size: 24, hardness: 80 }) }] };
  }, { name: { type: 'string' } }));
  r.register('photoshop_get_brush_settings', tool('photoshop_get_brush_settings', async () => {
    calls.settings++;
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, size: 24, hardness: 80 }) }] };
  }));
  r.register('photoshop_paint_strokes', tool('photoshop_paint_strokes', async () => {
    calls.paint++;
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
  }, { layer_id: { type: 'number' }, strokes: { type: 'array' } }));
  r.register('photoshop_get_preview', tool('photoshop_get_preview', async () => {
    calls.preview++;
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, sha256: 'a'.repeat(64) }) }] };
  }));
  return { r, calls };
}

function plan(id: string, overrides: Record<string, unknown> = {}) {
  const focus = { left: 0, top: 0, right: 900, bottom: 900 };
  return {
    plan_id: id,
    summary: 'Repeated local brush pass',
    stage: 'FORM_AND_LIGHT',
    scale: 'local',
    region: 'panel',
    intent: 'refine the same panel',
    method_class: 'paint',
    risk: 'low',
    expected_visual_delta: 'Local form improves.',
    verification_envelope: { mode: 'before_after', min_focus_dimension_px: 800 },
    layer_separation_check: {
      change_kind: 'continuation',
      substantial: false,
      rollback_value: 'low',
      independent_adjustment_expected: false,
      reasons: ['same local surface'],
    },
    problem_id: 'panel-form',
    action_class: 'REFINE',
    expected_visual_result: 'Panel reads more clearly.',
    document_id: 42,
    steps: [
      { id: 'select', tool: 'photoshop_select_brush_preset', args: { name: 'Dry Brush' } },
      { id: 'settings', tool: 'photoshop_get_brush_settings', args: {} },
      { id: 'before', tool: 'photoshop_get_preview', args: { max_dimension_px: 800, focus_region: focus } },
      {
        id: 'paint',
        tool: 'photoshop_paint_strokes',
        args: { layer_id: 7, strokes: [{ tool: 'BRUSH', points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }] },
      },
      { id: 'preview', tool: 'photoshop_get_preview', args: { max_dimension_px: 800, focus_region: focus } },
    ],
    ...overrides,
  };
}

function guardedRun(handler: ToolDefinition['handler'], args: Record<string, unknown>) {
  return withToolExecutionContext({ guardOperationId: String(args.plan_id) }, () => handler(args));
}

function body(result: Awaited<ReturnType<ToolDefinition['handler']>>) {
  const text = result.content.find(item => item.type === 'text');
  return JSON.parse(text && 'text' in text ? text.text : '{}');
}

describe('session preparation cache', () => {
  let setup: ReturnType<typeof registry>;

  beforeEach(() => {
    setup = registry();
    resetPreparationCacheForTests(setup.r);
  });

  it('reuses exact proven preparation across repeated local passes and reduces preparation call-count latency proxy', async () => {
    const execute = createVisualMicroPlanTools(setup.r)[0]!.handler;

    const first = body(await guardedRun(execute, plan('cache-pass-1')));
    expect(first).toMatchObject({ ok: true });
    // Baseline without reuse is two preparation round-trips per pass: select + settings.
    expect(setup.calls.select + setup.calls.settings).toBe(2);

    const second = body(await guardedRun(execute, plan('cache-pass-2')));
    expect(second.ok).toBe(true);
    // Cache path performs zero preparation round-trips on pass 2: 2 -> 0 call-count latency proxy.
    expect(setup.calls.select + setup.calls.settings).toBe(2);
    expect(second.preparation_cache.events).toEqual([
      expect.objectContaining({ reason: 'hit', tool: 'photoshop_select_brush_preset' }),
      expect.objectContaining({ reason: 'hit', tool: 'photoshop_get_brush_settings' }),
    ]);
    expect(setup.calls.paint).toBe(2);
    expect(setup.calls.preview).toBe(4);
  });

  it('invalidates when preset preparation changes', async () => {
    const execute = createVisualMicroPlanTools(setup.r)[0]!.handler;
    await guardedRun(execute, plan('preset-a'));
    const changed = plan('preset-b', {
      steps: [
        { id: 'select', tool: 'photoshop_select_brush_preset', args: { name: 'Other Brush' } },
        { id: 'settings', tool: 'photoshop_get_brush_settings', args: {} },
        { id: 'before', tool: 'photoshop_get_preview', args: { max_dimension_px: 800, focus_region: { left: 0, top: 0, right: 900, bottom: 900 } } },
        { id: 'paint', tool: 'photoshop_paint_strokes', args: { layer_id: 7, strokes: [{ tool: 'BRUSH', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: { max_dimension_px: 800, focus_region: { left: 0, top: 0, right: 900, bottom: 900 } } },
      ],
    });
    const result = body(await guardedRun(execute, changed));
    expect(setup.calls.select).toBe(2);
    expect(result.preparation_cache.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'miss_signature', tool: 'photoshop_select_brush_preset' }),
      expect.objectContaining({ reason: 'invalidate_preparation_mutation' }),
    ]));
  });

  it('invalidates on document or explicit layer provenance mismatch', async () => {
    const execute = createVisualMicroPlanTools(setup.r)[0]!.handler;
    await guardedRun(execute, plan('base'));
    await guardedRun(execute, plan('layer-change', {
      steps: [
        { id: 'select', tool: 'photoshop_select_brush_preset', args: { name: 'Dry Brush' } },
        { id: 'settings', tool: 'photoshop_get_brush_settings', args: {} },
        { id: 'before', tool: 'photoshop_get_preview', args: { max_dimension_px: 800, focus_region: { left: 0, top: 0, right: 900, bottom: 900 } } },
        { id: 'paint', tool: 'photoshop_paint_strokes', args: { layer_id: 8, strokes: [{ tool: 'BRUSH', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: { max_dimension_px: 800, focus_region: { left: 0, top: 0, right: 900, bottom: 900 } } },
      ],
    }));
    await guardedRun(execute, plan('doc-change', { document_id: 43 }));
    const reasons = preparationCacheDiagnosticsForTests(setup.r).map(row => row.reason);
    expect(reasons).toContain('invalidate_layer');
    expect(reasons).toContain('invalidate_document');
    expect(setup.calls.select).toBe(3);
  });

  it('fails closed when layer provenance is not explicit', async () => {
    const execute = createVisualMicroPlanTools(setup.r)[0]!.handler;
    const noLayer = (id: string) => plan(id, {
      steps: [
        { id: 'select', tool: 'photoshop_select_brush_preset', args: { name: 'Dry Brush' } },
        { id: 'settings', tool: 'photoshop_get_brush_settings', args: {} },
        { id: 'before', tool: 'photoshop_get_preview', args: { max_dimension_px: 800, focus_region: { left: 0, top: 0, right: 900, bottom: 900 } } },
        { id: 'paint', tool: 'photoshop_paint_strokes', args: { strokes: [{ tool: 'BRUSH', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: { max_dimension_px: 800, focus_region: { left: 0, top: 0, right: 900, bottom: 900 } } },
      ],
    });
    await guardedRun(execute, noLayer('unproven-1'));
    await guardedRun(execute, noLayer('unproven-2'));
    expect(setup.calls.select).toBe(2);
    expect(preparationCacheDiagnosticsForTests(setup.r).map(row => row.reason)).toContain('miss_unproven_layer');
  });

  it('invalidates explicit uncertainty and never caches/reuses preview results', async () => {
    const execute = createVisualMicroPlanTools(setup.r)[0]!.handler;
    await guardedRun(execute, plan('certain'));
    const uncertain = body(await guardedRun(execute, plan('uncertain', {
      previous_preview: {
        sha256: 'a'.repeat(64),
        observed_change: 'The local change is visible but support remains unclear.',
        target_resolved: 'uncertain',
        regressions: [],
        uncertainty: 'Layer state may have changed during reconciliation.',
        verdict: 'neutral',
        disposition: 'correct',
      },
    })));
    expect(uncertain.preparation_cache.reusable).toBe(false);
    expect(preparationCacheDiagnosticsForTests(setup.r).map(row => row.reason)).toContain('invalidate_uncertainty');
    expect(setup.calls.preview).toBe(4);
  });

  it('supports explicit reconciliation invalidation without a host/model round-trip', async () => {
    const execute = createVisualMicroPlanTools(setup.r)[0]!.handler;
    await guardedRun(execute, plan('before-reconcile'));
    invalidatePreparationCacheForReconciliation(setup.r);
    await guardedRun(execute, plan('after-reconcile'));
    expect(setup.calls.select).toBe(2);
    expect(preparationCacheDiagnosticsForTests(setup.r).map(row => row.reason)).toContain('invalidate_reconciliation');
  });

  it('invalidates when the observable runtime tool declaration revision changes', async () => {
    const execute = createVisualMicroPlanTools(setup.r)[0]!.handler;
    await guardedRun(execute, plan('runtime-1'));
    setup.r.register('runtime_revision_marker', tool('runtime_revision_marker', async () => ({
      content: [{ type: 'text', text: '{}' }],
    })));
    await guardedRun(execute, plan('runtime-2'));
    expect(setup.calls.select).toBe(2);
    expect(preparationCacheDiagnosticsForTests(setup.r).map(row => row.reason)).toContain('invalidate_runtime_revision');
  });
});
