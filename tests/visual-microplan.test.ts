import { describe, expect, it } from 'vitest';
import {
  parseVisualMicroPlan,
  resolveVisualMicroPlanArgs,
} from '../src/core/visual-microplan.js';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import { createVisualMicroPlanTools } from '../src/tools/visual-microplan-tools.js';

function basePlan(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    plan_id: 'p1',
    summary: 'Refine one tower plane',
    stage: 'MEDIUM_FORM',
    scale: 'medium',
    region: 'tower-upper',
    action_class: 'REFINE',
    expected_visual_result: 'The upper tower reads as a cleaner planar form.',
    protected_regions: ['lantern', 'sky silhouette'],
    document_id: 42,
    steps: [
      {
        id: 'paint',
        tool: 'photoshop_paint_dabs',
        args: { dabs: [{ x: 10, y: 20 }] },
      },
      {
        id: 'preview',
        tool: 'photoshop_get_preview',
        args: { max_dimension_px: 800 },
      },
    ],
    ...overrides,
  };
}

describe('parseVisualMicroPlan', () => {
  it('accepts preparation + exactly one mutation + final preview', () => {
    const parsed = parseVisualMicroPlan(
      basePlan({
        steps: [
          { id: 'select', tool: 'photoshop_select_brush_preset', args: { name: 'Hard Round' } },
          { id: 'settings', tool: 'photoshop_get_brush_settings', args: {} },
          { id: 'paint', tool: 'photoshop_paint_strokes', args: { strokes: [] } },
          { id: 'preview', tool: 'photoshop_get_preview', args: {} },
        ],
      })
    );
    expect(parsed.mutationIndex).toBe(2);
    expect(parsed.captureIndex).toBe(3);
  });

  it('rejects zero or multiple visual mutations', () => {
    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          steps: [
            { id: 'state', tool: 'photoshop_get_state', args: {} },
            { id: 'preview', tool: 'photoshop_get_preview', args: {} },
          ],
        })
      )
    ).toThrow(/exactly one visual mutation/);

    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          steps: [
            { id: 'p1', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
            { id: 'p2', tool: 'photoshop_paint_strokes', args: { strokes: [] } },
            { id: 'preview', tool: 'photoshop_get_preview', args: {} },
          ],
        })
      )
    ).toThrow(/exactly one visual mutation/);
  });

  it('requires the preview immediately after the mutation', () => {
    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          steps: [
            { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
            { id: 'state', tool: 'photoshop_get_state', args: {} },
            { id: 'preview', tool: 'photoshop_get_preview', args: {} },
          ],
        })
      )
    ).toThrow(/immediately followed/);
  });

  it('requires brush settings after selecting a preset', () => {
    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          steps: [
            { id: 'select', tool: 'photoshop_select_brush_preset', args: { name: 'Charcoal' } },
            { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
            { id: 'preview', tool: 'photoshop_get_preview', args: {} },
          ],
        })
      )
    ).toThrow(/get_brush_settings/);
  });

  it('rejects forward and unknown step references', () => {
    expect(() =>
      parseVisualMicroPlan(
        basePlan({
          steps: [
            { id: 'state', tool: 'photoshop_get_state', args: { x: '$steps.paint.details.x' } },
            { id: 'paint', tool: 'photoshop_paint_dabs', args: { dabs: [{ x: 1, y: 1 }] } },
            { id: 'preview', tool: 'photoshop_get_preview', args: {} },
          ],
        })
      )
    ).toThrow(/earlier step/);
  });

  it('resolves normalized earlier-step placeholders', () => {
    const resolved = resolveVisualMicroPlanArgs(
      { document_id: '$steps.state.document.id', value: '$steps.sample.rgb.red' },
      {
        state: { document: { id: 77 } },
        sample: { rgb: { red: 123 } },
      }
    );
    expect(resolved).toEqual({ document_id: 77, value: 123 });
  });
});

function definition(
  name: string,
  handler: ToolDefinition['handler'],
  documentBound = false
): ToolDefinition {
  return {
    tool: {
      name,
      description: 'test',
      inputSchema: {
        type: 'object',
        properties: documentBound ? { document_id: { type: 'number' } } : {},
      },
    },
    handler,
  };
}

describe('photoshop_execute_visual_microplan', () => {
  it('packs one mutation + preview into one call and blocks the next call until verdict', async () => {
    const registry = new ToolRegistry();
    const paintArgs: Record<string, unknown>[] = [];
    registry.register(
      'photoshop_paint_dabs',
      definition(
        'photoshop_paint_dabs',
        async (args) => {
          paintArgs.push(args);
          return { content: [{ type: 'text', text: '{"ok":true,"details":{"dab_count":1}}' }] };
        },
        true
      )
    );
    registry.register(
      'photoshop_get_preview',
      definition(
        'photoshop_get_preview',
        async () => ({
          content: [
            { type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' },
            { type: 'text', text: '{"ok":true,"sha256":"sha-one","width":100,"height":100}' },
          ],
        }),
        true
      )
    );

    const tool = createVisualMicroPlanTools(registry)[0]!;
    const first = await tool.handler(basePlan());
    expect(first.isError).not.toBe(true);
    expect(first.content.some((item) => item.type === 'image')).toBe(true);
    expect(paintArgs).toHaveLength(1);
    expect(paintArgs[0]!.document_id).toBe(42);

    const blocked = await tool.handler(basePlan({ plan_id: 'p2' }));
    expect(blocked.isError).toBe(true);
    expect(paintArgs).toHaveLength(1);
    const blockedText = blocked.content.find((item) => item.type === 'text');
    expect(blockedText && 'text' in blockedText ? blockedText.text : '').toContain(
      'preview_verdict_required'
    );

    const second = await tool.handler(
      basePlan({
        plan_id: 'p2',
        previous_preview: {
          sha256: 'sha-one',
          verdict: 'improvement',
          disposition: 'accept',
        },
      })
    );
    expect(second.isError).not.toBe(true);
    expect(paintArgs).toHaveLength(2);
  });

  it('still captures a preview after a mutation error instead of retrying', async () => {
    const registry = new ToolRegistry();
    let paintCalls = 0;
    let previewCalls = 0;
    registry.register(
      'photoshop_paint_dabs',
      definition(
        'photoshop_paint_dabs',
        async () => {
          paintCalls++;
          return {
            content: [{ type: 'text', text: '{"ok":false,"code":"unknown","message":"partial"}' }],
            isError: true,
          };
        },
        true
      )
    );
    registry.register(
      'photoshop_get_preview',
      definition(
        'photoshop_get_preview',
        async () => {
          previewCalls++;
          return {
            content: [
              { type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' },
              { type: 'text', text: '{"ok":true,"sha256":"sha-partial"}' },
            ],
          };
        },
        true
      )
    );

    const result = await createVisualMicroPlanTools(registry)[0]!.handler(basePlan());
    expect(result.isError).toBe(true);
    expect(paintCalls).toBe(1);
    expect(previewCalls).toBe(1);
    expect(result.content.some((item) => item.type === 'image')).toBe(true);
  });
});

