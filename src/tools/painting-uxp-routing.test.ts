import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhotoshopConnection } from '../platform/connection.js';
import type { PhotoshopBackendRouter, PhotoshopPrimitive } from '../platform/photoshop-backend.js';

const bridge = vi.hoisted(() => ({
  selectPreset: vi.fn(),
  setBrush: vi.fn(),
  setForeground: vi.fn(),
  paintRegions: vi.fn(),
  paintStrokes: vi.fn(),
  paintDabs: vi.fn(),
}));

vi.mock('../platform/uxp-bridge-client.js', () => ({
  invokeUxpSelectBrushPreset: bridge.selectPreset,
  invokeUxpSetBrush: bridge.setBrush,
  invokeUxpSetForegroundColor: bridge.setForeground,
  invokeUxpPaintRegions: bridge.paintRegions,
  invokeUxpPaintStrokes: bridge.paintStrokes,
  invokeUxpPaintDabs: bridge.paintDabs,
}));

import { createPaintingTools } from './painting-tools.js';

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find((item) => item.type === 'text')?.text ?? '';
}

function fixture() {
  const executeScript = vi.fn(async (): Promise<unknown> => {
    throw new Error('legacy_dispatch_must_not_run');
  });
  const connection = {
    getPhotoshopInfo: () => ({ version: '2026', path: 'test', isRunning: true }),
    executeScript,
  } as unknown as PhotoshopConnection;
  const backendFor = vi.fn(async (
    _primitive: PhotoshopPrimitive
  ): Promise<{ kind: 'uxp' | 'extendscript' }> => ({ kind: 'uxp' }));
  const readBrushSettings = vi.fn(async () => ({ settings: { size: 24 } }));
  const listBrushPresets = vi.fn(async () => ({
    total: 1,
    matched: 1,
    truncated: false,
    presets: ['Round'],
  }));
  const router = {
    backendFor,
    readBrushSettings,
    listBrushPresets,
  } as unknown as PhotoshopBackendRouter;
  return { connection, router, executeScript, backendFor, readBrushSettings, listBrushPresets };
}

describe('canonical painting tools UXP routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.selectPreset.mockResolvedValue({ ok: true, data: { preset: 'Round', settings: { size: 24 } } });
    bridge.setBrush.mockResolvedValue({ ok: true, data: { settings: { size: 32, opacity: 80 } } });
    bridge.setForeground.mockResolvedValue({ ok: true, data: { red: 1, green: 2, blue: 3 } });
    bridge.paintStrokes.mockResolvedValue({
      ok: true,
      data: { layer_name: 'Paint', coordinate_space: 'canvas_pixels' },
    });
    bridge.paintRegions.mockResolvedValue({
      ok: true,
      data: { region_count: 1, painted_regions: ['r1'], coordinate_space: 'canvas_pixels' },
    });
    bridge.paintDabs.mockResolvedValue({
      ok: true,
      data: { layer_name: 'Paint', coordinate_space: 'canvas_pixels' },
    });
  });

  it('routes brush preset/settings/color and paint regions/strokes/dabs through UXP with zero legacy calls', async () => {
    const { connection, router, executeScript, backendFor } = fixture();
    const tools = createPaintingTools(connection, router);
    const byName = (name: string) => tools.find((tool) => tool.tool.name === name)!;

    await byName('photoshop_select_brush_preset').handler({ name: 'Round' });
    await byName('photoshop_set_brush').handler({ size: 32, opacity: 80 });
    await byName('photoshop_set_foreground_color').handler({ red: 1, green: 2, blue: 3 });
    await byName('photoshop_paint_strokes').handler({
      document_id: 42,
      strokes: [{ points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }],
    });
    await byName('photoshop_paint_regions').handler({
      document_id: 42,
      regions: [{
        id: 'r1',
        color: { red: 10, green: 20, blue: 30 },
        contours: [{
          points: [{ x: 1, y: 1 }, { x: 10, y: 1 }, { x: 10, y: 10 }],
        }],
      }],
    });
    await byName('photoshop_paint_dabs').handler({
      document_id: 42,
      dabs: [{ x: 5, y: 6, size: 20 }],
    });

    expect(backendFor.mock.calls.map(([primitive]) => primitive)).toEqual([
      'brush.presets.select',
      'brush.settings.write',
      'foreground.write',
      'painting.strokes',
      'painting.regions',
      'painting.dabs',
    ]);
    expect(bridge.selectPreset).toHaveBeenCalledTimes(1);
    expect(bridge.setBrush).toHaveBeenCalledTimes(1);
    expect(bridge.setForeground).toHaveBeenCalledTimes(1);
    expect(bridge.paintStrokes).toHaveBeenCalledTimes(1);
    expect(bridge.paintRegions).toHaveBeenCalledTimes(1);
    expect(bridge.paintDabs).toHaveBeenCalledTimes(1);
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('does not fall through to ExtendScript after a possibly dispatched UXP painting mutation fails', async () => {
    bridge.paintStrokes.mockResolvedValueOnce({ ok: false, error: 'uxp_failed_after_possible_dispatch' });
    const { connection, router, executeScript } = fixture();
    const paint = createPaintingTools(connection, router)
      .find((tool) => tool.tool.name === 'photoshop_paint_strokes')!;

    const result = await paint.handler({
      document_id: 42,
      strokes: [{ points: [{ x: 10, y: 10 }, { x: 20, y: 20 }] }],
    });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('uxp_failed_after_possible_dispatch');
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('reports authoritative brush setter outcome from effective readback instead of assuming requested values applied', async () => {
    const { connection, router } = fixture();
    const setBrush = createPaintingTools(connection, router)
      .find((tool) => tool.tool.name === 'photoshop_set_brush')!;

    bridge.setBrush.mockResolvedValueOnce({
      ok: true,
      data: { settings: { size: 48, hardness: 100, opacity: 82 } },
    });
    const mismatch = await setBrush.handler({ size: 48, hardness: 70, opacity: 82 });
    const mismatchPayload = JSON.parse(textOf(mismatch));
    expect(mismatchPayload.details.setter_outcome).toBe('not-applied');
    expect(mismatchPayload.details.requested_settings).toMatchObject({ size: 48, hardness: 70, opacity: 82 });
    expect(mismatchPayload.details.effective_settings).toMatchObject({ size: 48, hardness: 100, opacity: 82 });
    expect(mismatchPayload.details.mismatches).toEqual([
      { key: 'hardness', expected: 70, actual: 100 },
    ]);

    bridge.setBrush.mockResolvedValueOnce({
      ok: true,
      data: { settings: { size: 48, hardness: 70, opacity: 82 } },
    });
    const applied = await setBrush.handler({ size: 48, hardness: 70, opacity: 82 });
    const appliedPayload = JSON.parse(textOf(applied));
    expect(appliedPayload.details.setter_outcome).toBe('applied');
    expect(appliedPayload.details.mismatches).toEqual([]);
  });

  it('reports preset setter outcome and preserves exact-recovery metadata', async () => {
    const { connection, router } = fixture();
    const selectPreset = createPaintingTools(connection, router)
      .find((tool) => tool.tool.name === 'photoshop_select_brush_preset')!;

    bridge.selectPreset.mockResolvedValueOnce({
      ok: true,
      data: {
        preset: 'Round',
        settings: { size: 36 },
        setter_recovery: {
          protocol: 'photoshop.uxp.setter_recovery.v1',
          mode: 'authoritative-readback',
          command_id: 'guard-preset-recovery',
          receipt_state: 'claimed',
        },
      },
    });
    const applied = JSON.parse(textOf(await selectPreset.handler({ name: 'Round' })));
    expect(applied.details).toMatchObject({
      setter_outcome: 'applied',
      requested_preset: 'Round',
      effective_preset: 'Round',
      setter_recovery: {
        protocol: 'photoshop.uxp.setter_recovery.v1',
        mode: 'authoritative-readback',
      },
    });

    bridge.selectPreset.mockResolvedValueOnce({
      ok: true,
      data: { preset: 'Other Brush', settings: { size: 36 } },
    });
    const mismatch = JSON.parse(textOf(await selectPreset.handler({ name: 'Round' })));
    expect(mismatch.details).toMatchObject({
      setter_outcome: 'not-applied',
      requested_preset: 'Round',
      effective_preset: 'Other Brush',
    });
  });

  it('uses ExtendScript when routing selects legacy before any canonical painting UXP dispatch', async () => {
    const { connection, router, executeScript, backendFor } = fixture();
    backendFor.mockResolvedValue({ kind: 'extendscript' as const });
    executeScript
      .mockResolvedValueOnce('({preset:"Round",settings:{size:24}})')
      .mockResolvedValueOnce('({settings:{size:32}})')
      .mockResolvedValueOnce('({red:1,green:2,blue:3})')
      .mockResolvedValueOnce('({layer_name:"Paint",coordinate_space:"canvas_pixels"})')
      .mockResolvedValueOnce('({region_count:1,painted_regions:["r1"],coordinate_space:"canvas_pixels"})')
      .mockResolvedValueOnce('({layer_name:"Paint",coordinate_space:"canvas_pixels"})');
    const tools = createPaintingTools(connection, router);
    const byName = (name: string) => tools.find((tool) => tool.tool.name === name)!;
    const results = [
      await byName('photoshop_select_brush_preset').handler({ name: 'Round' }),
      await byName('photoshop_set_brush').handler({ size: 32 }),
      await byName('photoshop_set_foreground_color').handler({ red: 1, green: 2, blue: 3 }),
      await byName('photoshop_paint_strokes').handler({
        strokes: [{ points: [{ x: 1, y: 1 }] }],
      }),
      await byName('photoshop_paint_regions').handler({
        regions: [{
          id: 'r1',
          color: { red: 1, green: 2, blue: 3 },
          contours: [{ points: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }] }],
        }],
      }),
      await byName('photoshop_paint_dabs').handler({ dabs: [{ x: 1, y: 1 }] }),
    ];

    for (const result of results) expect(result.isError).not.toBe(true);
    expect(backendFor.mock.calls.map(([primitive]) => primitive)).toEqual([
      'brush.presets.select',
      'brush.settings.write',
      'foreground.write',
      'painting.strokes',
      'painting.regions',
      'painting.dabs',
    ]);
    expect(executeScript).toHaveBeenCalledTimes(6);
    expect(bridge.selectPreset).not.toHaveBeenCalled();
    expect(bridge.setBrush).not.toHaveBeenCalled();
    expect(bridge.setForeground).not.toHaveBeenCalled();
    expect(bridge.paintStrokes).not.toHaveBeenCalled();
    expect(bridge.paintRegions).not.toHaveBeenCalled();
    expect(bridge.paintDabs).not.toHaveBeenCalled();
  });
});
