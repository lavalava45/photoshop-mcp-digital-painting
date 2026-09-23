import { describe, expect, it } from 'vitest';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import {
  paintingMethodCapabilities,
  selectPaintingMethod,
} from '../src/core/painting-method-palette.js';
import { projectStyleMethodTraitEvidence } from '../src/core/style-contract-runtime.js';
import { createMethodPaletteTools } from '../src/tools/method-palette-tools.js';

function fakeTool(name: string): ToolDefinition {
  return {
    tool: { name, description: name, inputSchema: { type: 'object', properties: {} } },
    handler: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] }),
  };
}

function registryWithRuntimePalette(): ToolRegistry {
  const registry = new ToolRegistry();
  const names = [
    'photoshop_paint_strokes',
    'photoshop_paint_regions',
    'photoshop_paint_dabs',
    'photoshop_set_brush',
    'photoshop_list_brush_presets',
    'photoshop_select_brush_preset',
    'photoshop_apply_gradient_mask',
    'photoshop_create_layer_mask',
    'photoshop_select_rectangle',
    'photoshop_select_ellipse',
    'photoshop_select_subject',
    'photoshop_feather_selection',
    'photoshop_apply_gaussian_blur',
    'photoshop_apply_smart_blur',
    'photoshop_apply_sharpen',
    'photoshop_apply_high_pass',
    'photoshop_apply_noise',
    'photoshop_adjust_curves',
    'photoshop_auto_levels',
    'photoshop_recipe_dodge_burn',
    'photoshop_set_layer_blend_mode',
    'photoshop_move_layer',
    'photoshop_scale_layer',
    'photoshop_rotate_layer',
    'photoshop_content_aware_fill',
  ];
  for (const name of names) registry.register(name, fakeTool(name));
  return registry;
}

describe('painting method capability map', () => {
  it('reports unsupported methods explicitly instead of inventing runtime support', () => {
    const registry = registryWithRuntimePalette();
    const capabilities = paintingMethodCapabilities(registry);
    const clone = capabilities.find(capability => capability.id === 'clone-stamp');
    const mixer = capabilities.find(capability => capability.id === 'mixer-brush');
    const radial = capabilities.find(capability => capability.id === 'radial-gradient');
    expect(clone?.availability).toBe('unavailable');
    expect(mixer?.availability).toBe('unavailable');
    expect(radial?.availability).toBe('unavailable');
    expect(clone?.availabilityReason).toMatch(/No dedicated Clone Stamp/);
  });

  it('reports every generative painting method as explicitly unavailable by contract', () => {
    const registry = registryWithRuntimePalette();
    const generative = paintingMethodCapabilities(registry)
      .filter(capability => capability.methodClass === 'generative');

    expect(generative.map(capability => capability.id).sort()).toEqual([
      'generate-image',
      'generative-expand',
      'generative-fill',
      'generative-remove',
      'generative-upscale',
    ]);
    expect(generative).toHaveLength(5);
    for (const capability of generative) {
      expect(capability.availability).toBe('unavailable');
      expect(capability.availabilityReason).toMatch(/Disabled by contract/);
    }

    const nonGenerative = paintingMethodCapabilities(registry)
      .filter(capability => capability.methodClass !== 'generative');
    expect(nonGenerative.find(capability => capability.id === 'pencil-line')?.availability).toBe('available');
    expect(nonGenerative.find(capability => capability.id === 'region-block-in')?.availability).toBe('available');
    expect(nonGenerative.find(capability => capability.id === 'smudge-shape')?.availability).toBe('available');
  });

  it('marks installed textured brush selection conditional rather than guaranteed', () => {
    const registry = registryWithRuntimePalette();
    const capability = paintingMethodCapabilities(registry)
      .find(item => item.id === 'installed-brush-preset');
    expect(capability?.availability).toBe('conditional');
    expect(capability?.preparationTools).toEqual(['photoshop_select_brush_preset']);
    expect(capability?.conditionalTools).toContain('photoshop_list_brush_presets');
  });

  it('routes different artistic tasks to different executable methods', () => {
    const registry = registryWithRuntimePalette();
    expect(selectPaintingMethod(registry, 'line', 'construct').selected.id).toBe('pencil-line');
    expect(selectPaintingMethod(registry, 'mass', 'construct').selected.id).toBe('installed-brush-preset');
    expect(selectPaintingMethod(registry, 'mass', 'construct', [], { stage: 'RECOGNITION_BLOCK_IN' }).selected.id).toBe('region-block-in');
    expect(selectPaintingMethod(registry, 'painted-mass', 'construct').selected.id).toBe('installed-brush-preset');
    expect(selectPaintingMethod(registry, 'broken-mass', 'construct').selected.id).toBe('installed-brush-preset');
    expect(selectPaintingMethod(registry, 'smooth', 'transition').selected.id).toBe('smudge-shape');
    expect(selectPaintingMethod(registry, 'sharpen', 'edge').selected.id).toBe('unsharp-sharpen');
    expect(selectPaintingMethod(registry, 'light-sculpt', 'tone').selected.id).toBe('dodge-burn-layer');
    expect(selectPaintingMethod(registry, 'tonal-contrast', 'tone').selected.id).toBe('curves-tone');
    expect(selectPaintingMethod(registry, 'move-scale-rotate', 'transform').selected.id).toBe('transform-layer');
    expect(selectPaintingMethod(registry, 'remove-distraction', 'cleanup').selected.id).toBe('content-aware-cleanup');
  });

  it('keeps verification expectations in the same authoritative intent-to-method map', () => {
    const registry = registryWithRuntimePalette();
    const capabilities = paintingMethodCapabilities(registry);
    expect(capabilities.every(capability => capability.verificationExpectation.evidence === 'before-after-preview')).toBe(true);
    expect(capabilities.every(capability => capability.verificationExpectation.expectedSignals.length > 0)).toBe(true);

    const brush = capabilities.find(capability => capability.id === 'hard-brush-line');
    const mask = capabilities.find(capability => capability.id === 'gradient-mask');
    const transform = capabilities.find(capability => capability.id === 'transform-layer');
    const curves = capabilities.find(capability => capability.id === 'curves-tone');

    expect(brush?.verificationExpectation.stateReadback?.join(' ')).toMatch(/effective brush settings/i);
    expect(mask?.verificationExpectation.stateReadback?.join(' ')).toMatch(/layer\/mask identity/i);
    expect(transform?.verificationExpectation.scope).toBe('whole-frame');
    expect(transform?.verificationExpectation.stateReadback?.join(' ')).toMatch(/document\/layer identity/i);
    expect(curves?.verificationExpectation.expectedSignals.join(' ')).toMatch(/tonal\/light relationship/i);
  });

  it('covers the roadmap artistic-operation families with executable methods or explicit fallbacks', () => {
    const registry = registryWithRuntimePalette();
    const capabilities = paintingMethodCapabilities(registry);
    const available = (id: string) => capabilities.find(capability => capability.id === id);

    expect(available('curves-tone')).toMatchObject({
      primaryTool: 'photoshop_adjust_curves',
      availability: 'available',
    });
    expect(available('gradient-mask')).toMatchObject({
      primaryTool: 'photoshop_apply_gradient_mask',
      preparationTools: ['photoshop_create_layer_mask'],
      availability: 'available',
    });
    expect(available('blend-mode')).toMatchObject({
      primaryTool: 'photoshop_set_layer_blend_mode',
      availability: 'available',
    });
    expect(available('transform-layer')).toMatchObject({
      primaryTool: 'photoshop_move_layer',
      executionTools: ['photoshop_move_layer', 'photoshop_scale_layer', 'photoshop_rotate_layer'],
      availability: 'available',
    });
    expect(available('soft-brush-build')?.visualIntents).toContain('light-sculpt');
    expect(available('selection-mask')?.visualIntents).toContain('isolate-region');
    expect(available('smudge-shape')?.visualIntents).toContain('soft-transition');
  });

  it('does not fall back to a round/soft brush unconditionally', () => {
    const registry = registryWithRuntimePalette();
    const selections = [
      selectPaintingMethod(registry, 'line', 'construct'),
      selectPaintingMethod(registry, 'mass', 'construct'),
      selectPaintingMethod(registry, 'mask-fade', 'transition'),
      selectPaintingMethod(registry, 'tonal-contrast', 'tone'),
      selectPaintingMethod(registry, 'move-scale-rotate', 'transform'),
    ];
    expect(selections.map(value => value.selected.id)).toEqual([
      'pencil-line',
      'installed-brush-preset',
      'gradient-mask',
      'curves-tone',
      'transform-layer',
    ]);
    expect(selections.filter(value => value.selected.id === 'soft-brush-build')).toHaveLength(0);
  });

  it('uses explicit fallback when a preferred method is avoided', () => {
    const registry = registryWithRuntimePalette();
    const selection = selectPaintingMethod(registry, 'line', 'construct', ['pencil-line']);
    expect(selection.selected.id).toBe('hard-brush-line');
    expect(selection.rejected).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pencil-line', reason: 'explicitly avoided by caller' }),
    ]));
  });

  it('same mass task selects different executable methods under contrasting open-ended mark evidence', () => {
    const registry = registryWithRuntimePalette();
    const visibleMarks = projectStyleMethodTraitEvidence({
      mark_visibility: 'retain visible directional brush marks',
    }, { stage: 'GLOBAL_BLOCK_IN', changeDomains: ['shape'], methodClass: 'paint' });
    const solidCoverage = projectStyleMethodTraitEvidence({
      mark_visibility: 'smooth continuous solid coverage with hidden individual marks',
    }, { stage: 'GLOBAL_BLOCK_IN', changeDomains: ['shape'], methodClass: 'paint' });

    const painterly = selectPaintingMethod(registry, 'mass', 'construct', [], {
      stage: 'GLOBAL_BLOCK_IN', styleTraitEvidence: visibleMarks,
    });
    const flat = selectPaintingMethod(registry, 'mass', 'construct', [], {
      stage: 'GLOBAL_BLOCK_IN', styleTraitEvidence: solidCoverage,
    });

    expect(painterly.selected.id).toBe('installed-brush-preset');
    expect(flat.selected.id).toBe('region-block-in');
  });

  it('irrelevant/unknown style evidence does not perturb default method ordering', () => {
    const registry = registryWithRuntimePalette();
    const noEvidence = projectStyleMethodTraitEvidence({
      custom_unseen_style_field: 'visible painterly named-style bait',
      finish_criteria: 'retain brush marks at final review',
    }, { stage: 'GLOBAL_BLOCK_IN', changeDomains: ['layout'] });
    expect(noEvidence).toEqual([]);
    expect(selectPaintingMethod(registry, 'mass', 'construct', [], {
      stage: 'GLOBAL_BLOCK_IN', styleTraitEvidence: noEvidence,
    }).selected.id).toBe('region-block-in');
  });

  it('exposes capability and selection as read-only MCP tools', async () => {
    const registry = registryWithRuntimePalette();
    const tools = createMethodPaletteTools(registry);
    const get = tools.find(tool => tool.tool.name === 'photoshop_get_painting_method_capabilities');
    const select = tools.find(tool => tool.tool.name === 'photoshop_select_painting_method');
    expect(get && select).toBeTruthy();

    const selected = await select!.handler({ visual_intent: 'line', impact_class: 'construct' });
    const text = selected.content.find(item => item.type === 'text');
    const body = JSON.parse(text && 'text' in text ? text.text : '{}');
    expect(body.ok).toBe(true);
    expect(body.selection.selected.id).toBe('pencil-line');
    expect(body.selection.selected.primaryTool).toBe('photoshop_paint_strokes');
    expect(body.selection.selected.executionHints.stroke_tool).toBe('PENCIL');
    expect(body.selection.selected.verificationExpectation.evidence).toBe('before-after-preview');
  });
});
