import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import {
  compileArtisticOperation,
  validateArtisticOperationExecution,
} from '../src/core/artistic-operation-contract.js';

function fakeTool(name: string): ToolDefinition {
  return {
    tool: { name, description: name, inputSchema: { type: 'object', properties: {} } },
    handler: async () => ({ content: [{ type: 'text', text: '{}' }] }),
  };
}

function registry(names: string[]): ToolRegistry {
  const value = new ToolRegistry();
  for (const name of names) value.register(name, fakeTool(name));
  return value;
}

const runtimeRevision = 'uxp-current-test';

describe('unified artistic-operation execution contract', () => {
  it('binds declared tonal method to the actual Curves primitive', () => {
    const tools = registry(['photoshop_adjust_curves']);
    const plan = compileArtisticOperation(tools, {
      visualIntent: 'tonal-contrast',
      impactClass: 'tone',
      preferredMethodId: 'curves-tone',
      documentId: 42,
      layerId: 7,
      runtimeRevision,
    });
    expect(plan.method.id).toBe('curves-tone');
    expect(plan.allowedExecutionTools).toEqual(['photoshop_adjust_curves']);
    expect(() => validateArtisticOperationExecution({
      plan,
      preparationEvidence: [],
      executedTool: 'photoshop_adjust_curves',
    })).not.toThrow();
    expect(() => validateArtisticOperationExecution({
      plan,
      preparationEvidence: [],
      executedTool: 'photoshop_auto_levels',
    })).toThrow(/artistic_method_execution_mismatch/);
  });

  it('requires exact mask preparation state before gradient-mask mutation', () => {
    const tools = registry(['photoshop_apply_gradient_mask', 'photoshop_create_layer_mask']);
    const plan = compileArtisticOperation(tools, {
      visualIntent: 'mask-fade',
      impactClass: 'transition',
      preferredMethodId: 'gradient-mask',
      documentId: 42,
      layerId: 7,
      runtimeRevision,
    });
    expect(plan.requiredPreparationTools).toEqual(['photoshop_create_layer_mask']);
    expect(() => validateArtisticOperationExecution({
      plan,
      preparationEvidence: [],
      executedTool: 'photoshop_apply_gradient_mask',
    })).toThrow(/preparation_missing/);
    expect(() => validateArtisticOperationExecution({
      plan,
      preparationEvidence: [{
        tool: 'photoshop_create_layer_mask',
        ok: true,
        documentId: 42,
        layerId: 8,
        runtimeRevision,
      }],
      executedTool: 'photoshop_apply_gradient_mask',
    })).toThrow(/stale_layer/);
    expect(() => validateArtisticOperationExecution({
      plan,
      preparationEvidence: [{
        tool: 'photoshop_create_layer_mask',
        ok: true,
        documentId: 42,
        layerId: 7,
        runtimeRevision,
      }],
      executedTool: 'photoshop_apply_gradient_mask',
    })).not.toThrow();
  });

  it('rejects stale brush preparation without authoritative effective-state evidence', () => {
    const tools = registry(['photoshop_paint_dabs', 'photoshop_set_brush']);
    const plan = compileArtisticOperation(tools, {
      visualIntent: 'light-sculpt',
      impactClass: 'tone',
      preferredMethodId: 'soft-brush-build',
      documentId: 42,
      layerId: 7,
      runtimeRevision,
    });
    expect(() => validateArtisticOperationExecution({
      plan,
      preparationEvidence: [{
        tool: 'photoshop_set_brush',
        ok: true,
        documentId: 42,
        layerId: 7,
        runtimeRevision,
      }],
      executedTool: 'photoshop_paint_dabs',
    })).toThrow(/missing_effective_state/);
    expect(() => validateArtisticOperationExecution({
      plan,
      preparationEvidence: [{
        tool: 'photoshop_set_brush',
        ok: true,
        documentId: 42,
        layerId: 7,
        runtimeRevision: 'old-revision',
        effectiveStateFingerprint: 'brush-state-1',
      }],
      executedTool: 'photoshop_paint_dabs',
    })).toThrow(/stale_revision/);
  });

  it('chooses an explicit available fallback when the preferred method is unsupported', () => {
    const tools = registry(['photoshop_content_aware_fill', 'photoshop_select_rectangle', 'photoshop_select_ellipse']);
    const plan = compileArtisticOperation(tools, {
      visualIntent: 'remove-distraction',
      impactClass: 'cleanup',
      preferredMethodId: 'clone-stamp',
      documentId: 42,
      runtimeRevision,
    });
    expect(plan.fallbackFromMethodId).toBe('clone-stamp');
    expect(plan.method.id).toBe('content-aware-cleanup');
    expect(plan.allowedExecutionTools).toEqual(['photoshop_content_aware_fill']);
  });

  it('fails closed when neither preferred nor fallback method is executable', () => {
    const tools = registry([]);
    expect(() => compileArtisticOperation(tools, {
      visualIntent: 'move-scale-rotate',
      impactClass: 'transform',
      preferredMethodId: 'transform-layer',
      documentId: 42,
      runtimeRevision,
    })).toThrow(/No available method/);
  });

  it('accepts move, scale or rotate as actual execution for the transform method', () => {
    const tools = registry(['photoshop_move_layer', 'photoshop_scale_layer', 'photoshop_rotate_layer']);
    const plan = compileArtisticOperation(tools, {
      visualIntent: 'move-scale-rotate',
      impactClass: 'transform',
      preferredMethodId: 'transform-layer',
      documentId: 42,
      layerId: 7,
      runtimeRevision,
    });
    expect(plan.requiredPreparationTools).toEqual([]);
    expect(plan.allowedExecutionTools).toEqual([
      'photoshop_move_layer',
      'photoshop_scale_layer',
      'photoshop_rotate_layer',
    ]);
    for (const executedTool of plan.allowedExecutionTools) {
      expect(() => validateArtisticOperationExecution({
        plan,
        preparationEvidence: [],
        executedTool,
      })).not.toThrow();
    }
  });

  it('wires open-ended style evidence into actual operation method planning', () => {
    const tools = registry([
      'photoshop_paint_regions',
      'photoshop_paint_strokes',
      'photoshop_list_brush_presets',
      'photoshop_select_brush_preset',
    ]);
    const base = {
      visualIntent: 'mass' as const,
      impactClass: 'construct' as const,
      stage: 'GLOBAL_BLOCK_IN',
      documentId: 42,
      runtimeRevision,
      styleChangeDomains: ['shape'],
    };
    const visible = compileArtisticOperation(tools, {
      ...base,
      styleContract: { mark_visibility: 'visible directional brush marks should remain legible' },
    });
    const smooth = compileArtisticOperation(tools, {
      ...base,
      styleContract: { mark_visibility: 'smooth solid coverage; hide individual marks' },
    });
    expect(visible.method.id).toBe('installed-brush-preset');
    expect(smooth.method.id).toBe('region-block-in');
  });
});
