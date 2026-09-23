import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PhotoshopConnection } from '../platform/connection.js';
import type { PhotoshopBackendRouter } from '../platform/photoshop-backend.js';
const bridge = vi.hoisted(() => ({
  create: vi.fn(), remove: vi.fn(), opacity: vi.fn(), blend: vi.fn(),
  visibility: vi.fn(), locked: vi.fn(), rename: vi.fn(), duplicate: vi.fn(), move: vi.fn(), fill: vi.fn(),
}));
vi.mock('../platform/uxp-bridge-client.js', () => ({
  invokeUxpCreateLayer: bridge.create, invokeUxpDeleteLayer: bridge.remove,
  invokeUxpSetLayerOpacity: bridge.opacity, invokeUxpSetLayerBlendMode: bridge.blend,
  invokeUxpSetLayerVisibility: bridge.visibility, invokeUxpSetLayerLocked: bridge.locked,
  invokeUxpRenameLayer: bridge.rename, invokeUxpDuplicateLayer: bridge.duplicate,
  invokeUxpMoveLayer: bridge.move,
  invokeUxpFillLayer: bridge.fill,
}));
import { createLayerTools } from './layer-tools.js';
import { createLayerPropertiesTools } from './layer-properties-tools.js';
import { createLayerOrderingTools } from './layer-ordering-tools.js';
function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
  return result.content?.find((item) => item.type === 'text')?.text ?? '';
}
function structured(result: { content?: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>;
}
function fixture() {
  const executeScript = vi.fn(async () => { throw new Error('legacy_dispatch_must_not_run'); });
  const connection = {
    getPhotoshopInfo: () => ({ version: '2026', path: 'test', isRunning: true }), executeScript,
  } as unknown as PhotoshopConnection;
  const backendFor = vi.fn(async () => ({ kind: 'uxp' as const }));
  const router = { backendFor } as unknown as PhotoshopBackendRouter;
  return { connection, router, executeScript };
}
describe('basic layer tools UXP routing', () => {
  beforeEach(() => vi.clearAllMocks());
  it('routes create/delete through UXP and preserves atomic details', async () => {
    bridge.create.mockResolvedValueOnce({ ok: true, data: { created: true, layerName: 'Placed', layerId: 77, actualIndex: 1, relativeToId: 22 } });
    bridge.remove.mockResolvedValueOnce({ ok: true, data: { deleted: true, layerName: 'Placed', layerId: 77, requestedLayerId: 77, originalActiveLayerId: 11, activeLayerRestored: true } });
    const { connection, router, executeScript } = fixture();
    const tools = createLayerTools(connection, router);
    const create = tools.find((tool) => tool.tool.name === 'photoshop_create_layer')!;
    const remove = tools.find((tool) => tool.tool.name === 'photoshop_delete_layer')!;
    const created = structured(await create.handler({ document_id: 91, name: 'Placed', above_layer_id: 22 }));
    expect(bridge.create).toHaveBeenCalledWith({ document_id: 91, name: 'Placed', above_layer_id: 22 });
    expect(created.details).toMatchObject({ layerId: 77, actualIndex: 1, relativeToId: 22 });
    const deleted = structured(await remove.handler({ document_id: 91, layer_id: 77 }));
    expect(bridge.remove).toHaveBeenCalledWith({ document_id: 91, layer_id: 77 });
    expect(deleted.details).toMatchObject({ layerId: 77, activeLayerRestored: true });
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('keeps exact public property texts while dispatching UXP', async () => {
    for (const mock of [bridge.opacity, bridge.blend, bridge.visibility, bridge.locked]) mock.mockResolvedValueOnce({ ok: true, data: {} });
    const { connection, router, executeScript } = fixture();
    const tools = createLayerPropertiesTools(connection, router);
    const byName = (name: string) => tools.find((tool) => tool.tool.name === name)!;
    expect(textOf(await byName('photoshop_set_layer_opacity').handler({ document_id: 91, opacity: 42 }))).toBe('Layer opacity set to 42%');
    expect(bridge.opacity).toHaveBeenCalledWith({ document_id: 91, opacity: 42 });
    expect(textOf(await byName('photoshop_set_layer_blend_mode').handler({ document_id: 91, blendMode: 'COLOR' }))).toBe('Layer blend mode set to COLOR');
    expect(bridge.blend).toHaveBeenCalledWith({ document_id: 91, blendMode: 'COLOR' });
    expect(textOf(await byName('photoshop_set_layer_visibility').handler({ document_id: 91, visible: false }))).toBe('Layer hidden');
    expect(textOf(await byName('photoshop_set_layer_locked').handler({ document_id: 91, locked: true }))).toBe('Layer locked');
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('preserves rename/duplicate text+JSON shape on UXP', async () => {
    bridge.rename.mockResolvedValueOnce({ ok: true, data: { oldName: 'Base', newName: 'Renamed' } });
    bridge.duplicate.mockResolvedValueOnce({ ok: true, data: { originalName: 'Renamed', newName: 'Copy', activated: true, newLayerId: 88 } });
    const { connection, router } = fixture();
    const tools = createLayerPropertiesTools(connection, router);
    const byName = (name: string) => tools.find((tool) => tool.tool.name === name)!;
    expect(textOf(await byName('photoshop_rename_layer').handler({ document_id: 91, name: 'Renamed' }))).toBe('Layer renamed to: Renamed\nResult: {"oldName":"Base","newName":"Renamed"}');
    expect(textOf(await byName('photoshop_duplicate_layer').handler({ document_id: 91, newName: 'Copy' }))).toBe('Layer duplicated\nResult: {"originalName":"Renamed","newName":"Copy","activated":true,"newLayerId":88}');
  });
  it('does not replay a failed UXP mutation through legacy', async () => {
    bridge.create.mockResolvedValueOnce({ ok: false, error: 'uxp_failed_after_dispatch' });
    const { connection, router, executeScript } = fixture();
    const create = createLayerTools(connection, router).find((tool) => tool.tool.name === 'photoshop_create_layer')!;
    const result = await create.handler({ name: 'No Replay' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('uxp_failed_after_dispatch');
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('routes layer ordering through one UXP primitive and preserves public envelopes', async () => {
    bridge.move
      .mockResolvedValueOnce({ ok: true, data: { moved: true, layerName: 'Mover', layerId: 12, position: 'BELOW', relativeToId: 77, relativeTo: 'Target', relativeToPath: 'Group/Target' } })
      .mockResolvedValueOnce({ ok: true, data: { moved: true, layerName: 'Mover', layerId: 12, parentName: 'Group', position: 'top', context: { hasDocument: true } } })
      .mockResolvedValueOnce({ ok: true, data: { moved: false, message: 'Layer is already at the bottom' } });
    const { connection, router, executeScript } = fixture();
    const tools = createLayerOrderingTools(connection, router);
    const byName = (name: string) => tools.find((tool) => tool.tool.name === name)!;

    const relative = structured(await byName('photoshop_move_layer_to_position').handler({
      document_id: 91, position: 'BELOW', targetLayerId: 77,
    }));
    expect(bridge.move).toHaveBeenNthCalledWith(1, { document_id: 91, position: 'BELOW', targetLayerId: 77 });
    expect(relative).toMatchObject({ ok: true, summary: 'Layer moved BELOW', details: { relativeToId: 77 } });

    const top = structured(await byName('photoshop_move_layer_to_top').handler({ document_id: 91 }));
    expect(bridge.move).toHaveBeenNthCalledWith(2, { document_id: 91, position: 'TOP' });
    expect(top).toMatchObject({ ok: true, summary: 'Layer moved to top', details: { parentName: 'Group', position: 'top' } });

    const down = structured(await byName('photoshop_move_layer_down').handler({ document_id: 91 }));
    expect(bridge.move).toHaveBeenNthCalledWith(3, { document_id: 91, position: 'DOWN' });
    expect(down).toMatchObject({ ok: true, summary: 'Layer moved down', details: { moved: false, message: 'Layer is already at the bottom' } });
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('keeps the generic TOP result shape distinct from the dedicated top tool', async () => {
    bridge.move.mockResolvedValueOnce({
      ok: true,
      data: {
        moved: true, layerName: 'Mover', layerId: 12, parentName: 'Group',
        position: 'top', context: { hasDocument: true },
      },
    });
    const { connection, router } = fixture();
    const move = createLayerOrderingTools(connection, router)
      .find((tool) => tool.tool.name === 'photoshop_move_layer_to_position')!;
    const result = structured(await move.handler({ document_id: 91, position: 'TOP' }));
    expect(bridge.move).toHaveBeenCalledWith({ document_id: 91, position: 'TOP' });
    expect(result.details).toEqual({
      moved: true,
      layerName: 'Mover',
      layerId: 12,
      position: 'TOP',
      context: { hasDocument: true },
    });
  });
  it('keeps the generic BOTTOM result shape distinct from the dedicated bottom tool', async () => {
    bridge.move.mockResolvedValueOnce({
      ok: true,
      data: {
        moved: true, layerName: 'Mover', layerId: 12, parentName: 'Group',
        position: 'bottom', context: { hasDocument: true },
      },
    });
    const { connection, router } = fixture();
    const move = createLayerOrderingTools(connection, router)
      .find((tool) => tool.tool.name === 'photoshop_move_layer_to_position')!;
    const result = structured(await move.handler({ document_id: 91, position: 'BOTTOM' }));
    expect(result.details).toEqual({
      moved: true, layerName: 'Mover', layerId: 12, position: 'BOTTOM',
      context: { hasDocument: true },
    });
  });
  it('preserves supplied targetLayerId precedence over targetLayerName even for zero', async () => {
    bridge.move.mockResolvedValueOnce({ ok: false, error: 'Layer not found: id=0' });
    const { connection, router, executeScript } = fixture();
    const move = createLayerOrderingTools(connection, router)
      .find((tool) => tool.tool.name === 'photoshop_move_layer_to_position')!;
    const result = await move.handler({ position: 'ABOVE', targetLayerId: 0, targetLayerName: 'Valid Name' });
    expect(bridge.move).toHaveBeenCalledWith({
      position: 'ABOVE', targetLayerId: 0, targetLayerName: 'Valid Name',
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Layer not found: id=0');
    expect(executeScript).not.toHaveBeenCalled();
  });
  it('does not replay a failed UXP layer-order mutation through legacy', async () => {
    bridge.move.mockResolvedValueOnce({ ok: false, error: 'uxp_order_failed_after_dispatch' });
    const { connection, router, executeScript } = fixture();
    const move = createLayerOrderingTools(connection, router).find((tool) => tool.tool.name === 'photoshop_move_layer_up')!;
    const result = await move.handler({ document_id: 91 });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('uxp_order_failed_after_dispatch');
    expect(executeScript).not.toHaveBeenCalled();
  });
});
