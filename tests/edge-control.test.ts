import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import {
  parseEdgeIntents,
  selectEdgeMethod,
  validateEdgeObservations,
} from '../src/core/edge-control.js';
import { parseVisualMicroPlan } from '../src/core/visual-microplan.js';
import { createVisualMicroPlanTools } from '../src/tools/visual-microplan-tools.js';

function fakeTool(name: string): ToolDefinition {
  return {
    tool: { name, description: name, inputSchema: { type: 'object', properties: {} } },
    handler: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }),
  };
}

function registry(): ToolRegistry {
  const r = new ToolRegistry();
  for (const name of [
    'photoshop_paint_strokes',
    'photoshop_paint_dabs',
    'photoshop_paint_regions',
    'photoshop_set_brush',
    'photoshop_list_brush_presets',
    'photoshop_select_brush_preset',
    'photoshop_apply_gradient_mask',
    'photoshop_create_layer_mask',
    'photoshop_apply_gaussian_blur',
    'photoshop_apply_smart_blur',
    'photoshop_apply_sharpen',
    'photoshop_apply_high_pass',
    'photoshop_apply_noise',
    'photoshop_set_layer_blend_mode',
  ]) r.register(name, fakeTool(name));
  return r;
}

function basePlan(overrides: Record<string, unknown> = {}) {
  return {
    plan_id: 'edge-plan',
    summary: 'Control one explicit boundary.',
    stage: 'FORM_AND_LIGHT',
    scale: 'medium',
    region: 'face',
    intent: 'control edge character',
    method_class: 'line',
    risk: 'low',
    expected_visual_delta: 'The target boundary changes edge character without moving the neighboring regions.',
    verification_envelope: { mode: 'after_only' },
    layer_separation_check: {
      change_kind: 'continuation',
      substantial: false,
      rollback_value: 'low',
      independent_adjustment_expected: false,
      reasons: ['This pass refines an existing boundary and does not introduce a new independent rollback unit.'],
    },
    problem_id: 'edge-problem',
    action_class: 'REFINE',
    expected_visual_result: 'Boundary character matches the declared edge intent.',
    document_id: 42,
    edges: [
      { boundary_id: 'cheek-bg', region_a: 'cheek', region_b: 'background', class: 'hard' },
    ],
    steps: [
      {
        id: 'edge',
        tool: 'photoshop_paint_strokes',
        method_id: 'pencil-line',
        edge_boundary_ids: ['cheek-bg'],
        args: { strokes: [{ tool: 'PENCIL', points: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }] },
      },
      { id: 'preview', tool: 'photoshop_get_preview', args: {} },
    ],
    ...overrides,
  };
}

describe('edge intent schema and method routing', () => {
  it('maps hard, soft and lost to different causal strategies', () => {
    const r = registry();
    expect(selectEdgeMethod(r, 'hard').selected.id).toBe('pencil-line');
    expect(selectEdgeMethod(r, 'soft').selected.id).toBe('smudge-shape');
    expect(selectEdgeMethod(r, 'lost').selected.id).toBe('smudge-shape');
    expect(selectEdgeMethod(r, 'hard').expectedBehavior).toMatch(/crisp/i);
    expect(selectEdgeMethod(r, 'soft').expectedBehavior).toMatch(/gradually/i);
    expect(selectEdgeMethod(r, 'lost').expectedBehavior).toMatch(/dissolves/i);
  });

  it('supports firm and broken without forcing them into hard/soft aliases', () => {
    const r = registry();
    expect(selectEdgeMethod(r, 'firm').selected.id).toBe('hard-brush-line');
    expect(selectEdgeMethod(r, 'broken').selected.id).toBe('installed-brush-preset');
  });

  it('falls back when an explicitly preferred edge method is unavailable', () => {
    const selection = selectEdgeMethod(registry(), 'soft', { preferredMethodId: 'radial-gradient' });
    expect(selection.selected.id).toBe('smudge-shape');
    expect(selection.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'radial-gradient' }),
    ]));
  });

  it('stores different edges for one object and different neighboring region pairs', () => {
    const edges = parseEdgeIntents([
      { boundary_id: 'cheek-bg', region_a: 'left-cheek', region_b: 'background', class: 'lost' },
      { boundary_id: 'cheek-nose', region_a: 'left-cheek', region_b: 'nose', class: 'soft' },
      { boundary_id: 'jaw-collar', region_a: 'jaw', region_b: 'collar', class: 'firm' },
      { boundary_id: 'beard-air', region_a: 'beard', region_b: 'background', class: 'broken' },
    ]);
    expect(edges.map(edge => edge.edgeClass)).toEqual(['lost', 'soft', 'firm', 'broken']);
    expect(edges.map(edge => `${edge.regionA}/${edge.regionB}`)).toEqual([
      'left-cheek/background',
      'left-cheek/nose',
      'jaw/collar',
      'beard/background',
    ]);
  });

  it('requires every edge intent to bind to a mutation method', () => {
    const parsed = parseVisualMicroPlan(basePlan());
    expect(parsed.edges[0].boundaryId).toBe('cheek-bg');
    expect(parsed.steps[0].methodId).toBe('pencil-line');
    expect(parsed.steps[0].edgeBoundaryIds).toEqual(['cheek-bg']);

    expect(() => parseVisualMicroPlan(basePlan({
      steps: [
        { id: 'edge', tool: 'photoshop_paint_strokes', args: { strokes: [{ tool: 'PENCIL', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }] } },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }))).toThrow(/every edge intent must bind/);
  });

  it('requires qualitative AFTER observations for every declared boundary', () => {
    const intents = parseEdgeIntents([
      { boundary_id: 'cheek-bg', region_a: 'cheek', region_b: 'background', class: 'lost' },
      { boundary_id: 'jaw-collar', region_a: 'jaw', region_b: 'collar', class: 'hard' },
    ]);
    const observations = validateEdgeObservations(intents, [
      { boundary_id: 'cheek-bg', observed_behavior: 'The cheek boundary dissolves into the background across the lower half.', target_met: 'yes' },
      { boundary_id: 'jaw-collar', observed_behavior: 'The jaw/collar separation remains crisp and clearly readable.', target_met: 'yes' },
    ]);
    expect(observations).toHaveLength(2);
    expect(() => validateEdgeObservations(intents, [
      { boundary_id: 'cheek-bg', observed_behavior: 'Observed.', target_met: 'yes' },
    ])).toThrow(/missing boundary_id/);
  });

  it('enforces edge method compatibility before visual dispatch and emits compiled edge control', async () => {
    const r = registry();
    let paintCalls = 0;
    r.register('photoshop_get_preview', {
      tool: {
        name: 'photoshop_get_preview',
        description: 'preview',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, sha256: 'abc123' }) }] }),
    });
    r.register('photoshop_paint_strokes', {
      tool: {
        name: 'photoshop_paint_strokes',
        description: 'paint',
        inputSchema: { type: 'object', properties: {} },
      },
      handler: async () => {
        paintCalls++;
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      },
    });
    const tool = createVisualMicroPlanTools(r)[0]!;

    const wrong = await tool.handler(basePlan({
      steps: [
        {
          id: 'edge',
          tool: 'photoshop_paint_strokes',
          method_id: 'smudge-shape',
          edge_boundary_ids: ['cheek-bg'],
          args: { strokes: [{ tool: 'PENCIL', points: [{ x: 1, y: 1 }, { x: 20, y: 20 }] }] },
        },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }));
    expect(wrong.isError).toBe(true);
    expect(paintCalls).toBe(0);
    const wrongText = wrong.content.find(item => item.type === 'text');
    expect(wrongText && 'text' in wrongText ? wrongText.text : '').toContain('method_execution_preflight_failed');

    const correct = await tool.handler(basePlan());
    expect(correct.isError).not.toBe(true);
    expect(paintCalls).toBe(1);
    const text = correct.content.find(item => item.type === 'text');
    const body = JSON.parse(text && 'text' in text ? text.text : '{}');
    expect(body.edge_control[0]).toEqual(expect.objectContaining({
      boundary_id: 'cheek-bg',
      class: 'hard',
    }));
    expect(body.edge_control[0].executions[0].method_id).toBe('pencil-line');
  });

  it('rejects hard-brush-line when the declared method is executed through paint_dabs', async () => {
    const r = registry();
    let brushCalls = 0;
    let dabCalls = 0;
    r.register('photoshop_set_brush', {
      tool: { name: 'photoshop_set_brush', description: 'brush', inputSchema: { type: 'object', properties: {} } },
      handler: async () => {
        brushCalls++;
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      },
    });
    r.register('photoshop_paint_dabs', {
      tool: { name: 'photoshop_paint_dabs', description: 'dabs', inputSchema: { type: 'object', properties: {} } },
      handler: async () => {
        dabCalls++;
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      },
    });
    r.register('photoshop_get_preview', {
      tool: { name: 'photoshop_get_preview', description: 'preview', inputSchema: { type: 'object', properties: {} } },
      handler: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, sha256: 'abc123' }) }] }),
    });
    const tool = createVisualMicroPlanTools(r)[0]!;

    const result = await tool.handler(basePlan({
      method_class: 'paint',
      edges: [{ boundary_id: 'cheek-bg', region_a: 'cheek', region_b: 'background', class: 'firm' }],
      steps: [
        { id: 'brush', tool: 'photoshop_set_brush', args: { hardness: 100 } },
        {
          id: 'edge',
          tool: 'photoshop_paint_dabs',
          method_id: 'hard-brush-line',
          edge_boundary_ids: ['cheek-bg'],
          args: { dabs: [{ x: 10, y: 10 }] },
        },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    }));

    expect(result.isError).toBe(true);
    const text = result.content.find(item => item.type === 'text');
    expect(text && 'text' in text ? text.text : '').toContain('method_execution_preflight_failed');
    expect(text && 'text' in text ? text.text : '').toContain('requires primary tool photoshop_paint_strokes');
    expect(brushCalls).toBe(0);
    expect(dabCalls).toBe(0);
  });

  it('requires soft-brush-build to set the declared soft brush hardness and low flow before dabs', async () => {
    const r = registry();
    let brushCalls = 0;
    let dabCalls = 0;
    r.register('photoshop_set_brush', {
      tool: { name: 'photoshop_set_brush', description: 'brush', inputSchema: { type: 'object', properties: {} } },
      handler: async () => {
        brushCalls++;
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      },
    });
    r.register('photoshop_paint_dabs', {
      tool: { name: 'photoshop_paint_dabs', description: 'dabs', inputSchema: { type: 'object', properties: {} } },
      handler: async () => {
        dabCalls++;
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
      },
    });
    r.register('photoshop_get_preview', {
      tool: { name: 'photoshop_get_preview', description: 'preview', inputSchema: { type: 'object', properties: {} } },
      handler: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true, sha256: 'abc123' }) }] }),
    });
    const tool = createVisualMicroPlanTools(r)[0]!;
    const softPlan = (brushArgs?: Record<string, unknown>) => basePlan({
      plan_id: brushArgs ? 'soft-correct' : 'soft-missing',
      method_class: 'paint',
      edges: [{
        boundary_id: 'cheek-bg',
        region_a: 'cheek',
        region_b: 'background',
        class: 'soft',
        preferred_method_id: 'soft-brush-build',
      }],
      steps: [
        ...(brushArgs ? [{ id: 'brush', tool: 'photoshop_set_brush', args: brushArgs }] : []),
        {
          id: 'edge',
          tool: 'photoshop_paint_dabs',
          method_id: 'soft-brush-build',
          edge_boundary_ids: ['cheek-bg'],
          args: { dabs: [{ x: 10, y: 10 }] },
        },
        { id: 'preview', tool: 'photoshop_get_preview', args: {} },
      ],
    });

    const missing = await tool.handler(softPlan());
    expect(missing.isError).toBe(true);
    let text = missing.content.find(item => item.type === 'text');
    expect(text && 'text' in text ? text.text : '').toContain('requires preparation step photoshop_set_brush');
    expect(brushCalls).toBe(0);
    expect(dabCalls).toBe(0);

    const wrong = await tool.handler(softPlan({ hardness: 0, flow: 25 }));
    expect(wrong.isError).toBe(true);
    text = wrong.content.find(item => item.type === 'text');
    expect(text && 'text' in text ? text.text : '').toContain('photoshop_set_brush.flow=10');
    expect(brushCalls).toBe(0);
    expect(dabCalls).toBe(0);

    const correct = await tool.handler(softPlan({ hardness: 0, flow: 10 }));
    expect(correct.isError).not.toBe(true);
    expect(brushCalls).toBe(1);
    expect(dabCalls).toBe(1);
  });
});
