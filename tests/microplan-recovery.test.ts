import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { PreviewBarriers } from '../src/core/preview-barriers.js';
import { ToolRegistry } from '../src/core/tool-registry.js';
import { createVisualMicroPlanTools } from '../src/tools/visual-microplan-tools.js';

it('writes the barrier before painting and enforces it in a newly created MCP handler', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-microplan-recovery-'));
  try {
    const registry = new ToolRegistry();
    let paints = 0;
    registry.register('photoshop_paint_dabs', {
      tool: { name: 'photoshop_paint_dabs', inputSchema: { type: 'object', properties: { document_id: { type: 'number' } } } },
      handler: async () => {
        expect(new PreviewBarriers(dir).get(42)?.requiresExternalPreview).toBe(true);
        paints++;
        return { content: [{ type: 'text', text: '{"ok":true}' }] };
      },
    });
    registry.register('photoshop_get_preview', {
      tool: { name: 'photoshop_get_preview', inputSchema: { type: 'object', properties: { document_id: { type: 'number' } } } },
      handler: async () => ({ content: [{ type: 'text', text: '{"sha256":"frame-one"}' }] }),
    });
    const plan = { plan_id: 'first', summary: 'Sky plane', stage: 'value', scale: 'medium', region: 'sky',
      intent: 'Separate the sky plane from the tower', method_class: 'paint', risk: 'low',
      expected_visual_delta: 'Sky separates more clearly from tower', verification_envelope: { mode: 'after_only' },
      layer_separation_check: { change_kind: 'continuation', substantial: true, rollback_value: 'low',
        independent_adjustment_expected: false, reasons: ['Continue the existing sky value unit without adding an independent layer.'] },
      action_class: 'REFINE', expected_visual_result: 'Sky separates from tower', document_id: 42,
      steps: [{ id: 'paint', tool: 'photoshop_paint_dabs', args: {} }, { id: 'preview', tool: 'photoshop_get_preview', args: {} }] };
    expect((await createVisualMicroPlanTools(registry, dir)[0]!.handler(plan)).isError).not.toBe(true);
    expect((await createVisualMicroPlanTools(registry, dir)[0]!.handler({ ...plan, plan_id: 'second' })).isError).toBe(true);
    expect(paints).toBe(1);
    expect((await createVisualMicroPlanTools(registry, dir)[0]!.handler({ ...plan, plan_id: 'second',
      previous_preview: {
        sha256: 'frame-one',
        observed_change: 'The sky separates more clearly from the tower.',
        target_resolved: 'yes',
        regressions: [],
        uncertainty: 'none observed',
        verdict: 'improvement',
        disposition: 'accept',
      } })).isError).not.toBe(true);
    expect(paints).toBe(2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('accepts the shared controller dispatch barrier for the same plan instead of treating it as stale work', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-microplan-shared-barrier-'));
  try {
    const registry = new ToolRegistry();
    registry.register('photoshop_paint_dabs', {
      tool: { name: 'photoshop_paint_dabs', inputSchema: { type: 'object', properties: { document_id: { type: 'number' } } } },
      handler: async () => ({ content: [{ type: 'text', text: '{"ok":true}' }] }),
    });
    registry.register('photoshop_get_preview', {
      tool: { name: 'photoshop_get_preview', inputSchema: { type: 'object', properties: { document_id: { type: 'number' } } } },
      handler: async () => ({ content: [{ type: 'text', text: '{"sha256":"shared-frame"}' }] }),
    });
    const plan = { plan_id: 'shared-plan', summary: 'Sky plane', stage: 'value', scale: 'medium', region: 'sky',
      intent: 'Separate the sky plane from the tower', method_class: 'paint', risk: 'low',
      expected_visual_delta: 'Sky separates more clearly from tower', verification_envelope: { mode: 'after_only' },
      layer_separation_check: { change_kind: 'continuation', substantial: true, rollback_value: 'low',
        independent_adjustment_expected: false, reasons: ['Continue the existing sky value unit without adding an independent layer.'] },
      action_class: 'REFINE', expected_visual_result: 'Sky separates from tower', document_id: 42,
      steps: [{ id: 'paint', tool: 'photoshop_paint_dabs', args: {} }, { id: 'preview', tool: 'photoshop_get_preview', args: {} }] };
    new PreviewBarriers(dir).set(42, { planId: 'shared-plan', requiresExternalPreview: true });
    const result = await createVisualMicroPlanTools(registry, dir)[0]!.handler(plan);
    expect(result.isError).not.toBe(true);
    expect(new PreviewBarriers(dir).get(42)?.sha256).toBe('shared-frame');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
