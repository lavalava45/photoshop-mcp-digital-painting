import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhotoshopConnection } from '../platform/connection.js';
import type { PhotoshopBackendRouter, PhotoshopPrimitive } from '../platform/photoshop-backend.js';

const bridge = vi.hoisted(() => ({
  createMask: vi.fn(),
  gradientMask: vi.fn(),
  selectRectangle: vi.fn(),
  selectEllipse: vi.fn(),
  featherSelection: vi.fn(),
  selectSubject: vi.fn(),
}));

vi.mock('../platform/uxp-bridge-client.js', () => ({
  invokeUxpCreateLayerMask: bridge.createMask,
  invokeUxpApplyGradientMask: bridge.gradientMask,
  invokeUxpSelectRectangle: bridge.selectRectangle,
  invokeUxpSelectEllipse: bridge.selectEllipse,
  invokeUxpFeatherSelection: bridge.featherSelection,
  invokeUxpSelectSubject: bridge.selectSubject,
}));

import { createSelectionTools } from './selection-tools.js';
import { createMaskTools } from './mask-tools.js';

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find((item) => item.type === 'text')?.text ?? '';
}

function fixture() {
  const executeScript = vi.fn(async (): Promise<unknown> => {
    throw new Error('legacy_dispatch_must_not_run');
  });
  const connection = {
    getPhotoshopInfo: () => ({ version: '2026', path: 'test', isRunning: true }),
    ping: vi.fn(async () => true),
    executeScript,
  } as unknown as PhotoshopConnection;
  const backendFor = vi.fn(async (
    _primitive: PhotoshopPrimitive
  ): Promise<{ kind: 'uxp' | 'extendscript' }> => ({ kind: 'uxp' }));
  const router = { backendFor } as unknown as PhotoshopBackendRouter;
  return { connection, router, executeScript, backendFor };
}

describe('canonical selection/mask lane uses UXP-first routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.createMask.mockResolvedValue({
      ok: true,
      data: { maskCreated: true, fromSelection: true },
    });
    bridge.gradientMask.mockResolvedValue({
      ok: true,
      data: {
        applied: true,
        direction: 'bottom_to_top',
        angle: 90,
        mask_auto_created: false,
      },
    });
    bridge.selectRectangle.mockResolvedValue({ ok: true, data: { shape: 'rectangle', bounds: { left: 1, top: 2, right: 11, bottom: 12 } } });
    bridge.selectEllipse.mockResolvedValue({ ok: true, data: { shape: 'ellipse', bounds: { left: 1, top: 2, right: 11, bottom: 12 } } });
    bridge.featherSelection.mockResolvedValue({ ok: true, data: { pixels: 3, bounds: { left: 1, top: 2, right: 11, bottom: 12 } } });
    bridge.selectSubject.mockResolvedValue({ ok: true, data: { method: 'selectSubject', bounds: { left: 1, top: 2, right: 11, bottom: 12 } } });
  });

  it('routes the painting-method selection-mask preparation path through UXP only', async () => {
    const { connection, router, executeScript, backendFor } = fixture();
    const tools = createSelectionTools(connection, router);
    const byName = (name: string) => tools.find((tool) => tool.tool.name === name)!;

    await byName('photoshop_select_rectangle').handler({ left: 1, top: 2, right: 11, bottom: 12 });
    await byName('photoshop_select_ellipse').handler({ left: 1, top: 2, right: 11, bottom: 12 });
    await byName('photoshop_feather_selection').handler({ pixels: 3 });
    await byName('photoshop_select_subject').handler({ sample_all_layers: true });

    expect(backendFor.mock.calls.map(([primitive]) => primitive)).toEqual([
      'selection.rectangle',
      'selection.ellipse',
      'selection.feather',
      'selection.subject',
    ]);
    expect(bridge.selectRectangle).toHaveBeenCalledTimes(1);
    expect(bridge.selectEllipse).toHaveBeenCalledTimes(1);
    expect(bridge.featherSelection).toHaveBeenCalledTimes(1);
    expect(bridge.selectSubject).toHaveBeenCalledWith({ sample_all_layers: true });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('routes layer-mask create and gradient-mask through UXP with zero legacy calls', async () => {
    const { connection, router, executeScript, backendFor } = fixture();
    const createMask = createSelectionTools(connection, router)
      .find((tool) => tool.tool.name === 'photoshop_create_layer_mask')!;
    const gradientMask = createMaskTools(connection, router)
      .find((tool) => tool.tool.name === 'photoshop_apply_gradient_mask')!;

    expect((await createMask.handler({ document_id: 42 })).isError).not.toBe(true);
    expect((await gradientMask.handler({
      document_id: 42,
      direction: 'bottom_to_top',
      start_pct: 10,
      end_pct: 90,
    })).isError).not.toBe(true);

    expect(backendFor.mock.calls.map(([primitive]) => primitive)).toEqual([
      'layer.mask.create',
      'layer.mask.gradient',
    ]);
    expect(bridge.createMask).toHaveBeenCalledWith({ document_id: 42 });
    expect(bridge.gradientMask).toHaveBeenCalledWith({
      document_id: 42,
      direction: 'bottom_to_top',
      start_pct: 10,
      end_pct: 90,
    });
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('never replays through ExtendScript after a possibly dispatched UXP mutation fails', async () => {
    bridge.createMask.mockResolvedValueOnce({ ok: false, error: 'uxp_mask_failed_after_dispatch' });
    bridge.gradientMask.mockResolvedValueOnce({ ok: false, error: 'uxp_gradient_failed_after_dispatch' });
    bridge.selectRectangle.mockResolvedValueOnce({ ok: false, error: 'uxp_rectangle_failed_after_dispatch' });
    bridge.selectEllipse.mockResolvedValueOnce({ ok: false, error: 'uxp_ellipse_failed_after_dispatch' });
    bridge.featherSelection.mockResolvedValueOnce({ ok: false, error: 'uxp_feather_failed_after_dispatch' });
    bridge.selectSubject.mockResolvedValueOnce({ ok: false, error: 'uxp_subject_failed_after_dispatch' });
    const { connection, router, executeScript } = fixture();

    const results = [
      await createSelectionTools(connection, router)
        .find((tool) => tool.tool.name === 'photoshop_create_layer_mask')!.handler({}),
      await createMaskTools(connection, router)
        .find((tool) => tool.tool.name === 'photoshop_apply_gradient_mask')!.handler({}),
      await createSelectionTools(connection, router)
        .find((tool) => tool.tool.name === 'photoshop_select_rectangle')!.handler({ left: 1, top: 1, right: 10, bottom: 10 }),
      await createSelectionTools(connection, router)
        .find((tool) => tool.tool.name === 'photoshop_select_ellipse')!.handler({ left: 1, top: 1, right: 10, bottom: 10 }),
      await createSelectionTools(connection, router)
        .find((tool) => tool.tool.name === 'photoshop_feather_selection')!.handler({ pixels: 2 }),
      await createSelectionTools(connection, router)
        .find((tool) => tool.tool.name === 'photoshop_select_subject')!.handler({}),
    ];

    for (const result of results) expect(result.isError).toBe(true);
    expect(textOf(results[0])).toContain('uxp_mask_failed_after_dispatch');
    expect(textOf(results[1])).toContain('uxp_gradient_failed_after_dispatch');
    expect(textOf(results[2])).toContain('uxp_rectangle_failed_after_dispatch');
    expect(textOf(results[3])).toContain('uxp_ellipse_failed_after_dispatch');
    expect(textOf(results[4])).toContain('uxp_feather_failed_after_dispatch');
    expect(textOf(results[5])).toContain('uxp_subject_failed_after_dispatch');
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('uses ExtendScript when routing selects legacy before any UXP dispatch', async () => {
    const { connection, router, executeScript, backendFor } = fixture();
    backendFor.mockResolvedValue({ kind: 'extendscript' as const });
    executeScript
      .mockResolvedValueOnce('({maskCreated:true,fromSelection:true})')
      .mockResolvedValueOnce('({applied:true,direction:"bottom_to_top",mask_auto_created:false})')
      .mockResolvedValueOnce('({shape:"rectangle",bounds:{left:1,top:1,right:10,bottom:10}})')
      .mockResolvedValueOnce('({shape:"ellipse",bounds:{left:1,top:1,right:10,bottom:10}})')
      .mockResolvedValueOnce('({pixels:2,bounds:{left:1,top:1,right:10,bottom:10}})')
      .mockResolvedValueOnce('({method:"selectSubject",bounds:{left:1,top:1,right:10,bottom:10}})');

    const selection = createSelectionTools(connection, router);
    const masks = createMaskTools(connection, router);
    const results = [
      await selection.find((tool) => tool.tool.name === 'photoshop_create_layer_mask')!.handler({}),
      await masks.find((tool) => tool.tool.name === 'photoshop_apply_gradient_mask')!.handler({}),
      await selection.find((tool) => tool.tool.name === 'photoshop_select_rectangle')!
        .handler({ left: 1, top: 1, right: 10, bottom: 10 }),
      await selection.find((tool) => tool.tool.name === 'photoshop_select_ellipse')!
        .handler({ left: 1, top: 1, right: 10, bottom: 10 }),
      await selection.find((tool) => tool.tool.name === 'photoshop_feather_selection')!.handler({ pixels: 2 }),
      await selection.find((tool) => tool.tool.name === 'photoshop_select_subject')!.handler({}),
    ];

    for (const result of results) expect(result.isError).not.toBe(true);
    expect(backendFor.mock.calls.map(([primitive]) => primitive)).toEqual([
      'layer.mask.create',
      'layer.mask.gradient',
      'selection.rectangle',
      'selection.ellipse',
      'selection.feather',
      'selection.subject',
    ]);
    expect(bridge.createMask).not.toHaveBeenCalled();
    expect(bridge.gradientMask).not.toHaveBeenCalled();
    expect(bridge.selectRectangle).not.toHaveBeenCalled();
    expect(bridge.selectEllipse).not.toHaveBeenCalled();
    expect(bridge.featherSelection).not.toHaveBeenCalled();
    expect(bridge.selectSubject).not.toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledTimes(6);
  });
});
