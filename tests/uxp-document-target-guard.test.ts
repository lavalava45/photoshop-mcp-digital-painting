import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../uxp-plugin/main.js', import.meta.url), 'utf8')
  .replace(/\npollLoop\(\);\s*$/, '\n');

function loadGuard(
  batchPlay: ReturnType<typeof vi.fn>,
  fetchImpl: ReturnType<typeof vi.fn> = vi.fn(async () => ({ ok: true }))
) {
  const photoshop = {
    action: { batchPlay },
    core: {},
    app: { documents: [] },
    constants: {},
  };
  const uxp = {
    entrypoints: { setup() {} },
    storage: { localFileSystem: {}, types: {} },
  };
  const handlerSpies = {
    tryHandleP1DocumentOperation: vi.fn(async () => ({ handled: false })),
    tryHandleP1SelectionOperation: vi.fn(async () => ({ handled: false })),
    tryHandleP1LayerOperation: vi.fn(async () => ({ handled: false })),
    tryHandleP2AdjustmentOperation: vi.fn(async () => ({ handled: false })),
    tryHandleP2FilterOperation: vi.fn(async () => ({ handled: false })),
    tryHandleP2TextExportOperation: vi.fn(async () => ({ handled: false })),
    tryHandleP3UtilityOperation: vi.fn(async () => ({ handled: false })),
    tryHandleP3DocumentDataOperation: vi.fn(async () => ({ handled: false })),
    tryHandleP3LayerAdvancedOperation: vi.fn(async () => ({ handled: false })),
  };
  const localHandlers: Record<string, Record<string, unknown>> = {
    './p1-document-ops': { tryHandleP1DocumentOperation: handlerSpies.tryHandleP1DocumentOperation },
    './p1-selection-ops': { tryHandleP1SelectionOperation: handlerSpies.tryHandleP1SelectionOperation },
    './p1-layer-ops': { tryHandleP1LayerOperation: handlerSpies.tryHandleP1LayerOperation },
    './p2-adjustment-ops': { tryHandleP2AdjustmentOperation: handlerSpies.tryHandleP2AdjustmentOperation },
    './p2-filter-ops': { tryHandleP2FilterOperation: handlerSpies.tryHandleP2FilterOperation },
    './p2-text-export-ops': { tryHandleP2TextExportOperation: handlerSpies.tryHandleP2TextExportOperation },
    './p3-utility-ops': { tryHandleP3UtilityOperation: handlerSpies.tryHandleP3UtilityOperation },
    './p3-document-data-ops': { tryHandleP3DocumentDataOperation: handlerSpies.tryHandleP3DocumentDataOperation },
    './p3-layer-advanced-ops': { tryHandleP3LayerAdvancedOperation: handlerSpies.tryHandleP3LayerAdvancedOperation },
  };

  const api = runInNewContext(
    source + '\n({ assertPinnedActiveDocument, handleCommand })',
    {
      require: (name: string) => {
        if (name === 'uxp') return uxp;
        if (name === 'photoshop') return photoshop;
        return localHandlers[name] ?? {};
      },
      fetch: fetchImpl,
      setTimeout,
      clearTimeout,
      console,
      Date,
      Map,
      Promise,
      encodeURIComponent,
    }
  ) as {
    assertPinnedActiveDocument: (
      actionName: string,
      params?: Record<string, unknown>
    ) => Promise<void>;
    handleCommand: (cmd: {
      id: string;
      action: string;
      params?: Record<string, unknown>;
    }) => Promise<void>;
  };

  return { ...api, handlerSpies, fetchImpl };
}

describe('UXP pinned-document dispatch guard', () => {
  it('accepts an already-active pinned document without navigation', async () => {
    const batchPlay = vi.fn()
      .mockResolvedValueOnce([{ numberOfDocuments: 1 }])
      .mockResolvedValueOnce([{ documentID: 42 }, {}]);
    const { assertPinnedActiveDocument } = loadGuard(batchPlay);

    await expect(
      assertPinnedActiveDocument('fill_layer', { document_id: 42 })
    ).resolves.toBeUndefined();
    expect(batchPlay).toHaveBeenCalledTimes(2);
  });

  it('fails closed before dispatch when the pinned document is open but inactive', async () => {
    const batchPlay = vi.fn()
      .mockResolvedValueOnce([{ numberOfDocuments: 2 }])
      .mockResolvedValueOnce([{ documentID: 84 }, {}])
      .mockResolvedValueOnce([{ numberOfDocuments: 2 }])
      .mockResolvedValueOnce([{ documentID: 84 }, {}])
      .mockResolvedValueOnce([
        { documentID: 42, title: 'Target.psd' },
        { documentID: 84, title: 'Active.psd' },
      ]);
    const { assertPinnedActiveDocument } = loadGuard(batchPlay);

    await expect(
      assertPinnedActiveDocument('fill_layer', { document_id: 42 })
    ).rejects.toThrow('document_not_active');
  });

  it('fails closed at handleCommand before any operation handler or mutation dispatch', async () => {
    const batchPlay = vi.fn()
      .mockResolvedValueOnce([{ numberOfDocuments: 2 }])
      .mockResolvedValueOnce([{ documentID: 84 }, {}])
      .mockResolvedValueOnce([{ numberOfDocuments: 2 }])
      .mockResolvedValueOnce([{ documentID: 84 }, {}])
      .mockResolvedValueOnce([
        { documentID: 42, title: 'Target.psd' },
        { documentID: 84, title: 'Active.psd' },
      ]);
    const fetchImpl = vi.fn(async () => ({ ok: true }));
    const { handleCommand, handlerSpies } = loadGuard(batchPlay, fetchImpl);

    await handleCommand({
      id: 'mismatch-command',
      action: 'fill_layer',
      params: { document_id: 42, color: '#ff00ff' },
    });

    for (const handler of Object.values(handlerSpies)) {
      expect(handler).not.toHaveBeenCalled();
    }
    expect(batchPlay).toHaveBeenCalledTimes(5);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const request = fetchImpl.mock.calls[0]?.[1] as { body?: string } | undefined;
    expect(request?.body).toContain('document_not_active');
  });

  it('distinguishes a closed/missing pinned document and exempts explicit navigation', async () => {
    const batchPlay = vi.fn()
      .mockResolvedValueOnce([{ numberOfDocuments: 1 }])
      .mockResolvedValueOnce([{ documentID: 84 }, {}])
      .mockResolvedValueOnce([{ numberOfDocuments: 1 }])
      .mockResolvedValueOnce([{ documentID: 84 }, {}])
      .mockResolvedValueOnce([{ documentID: 84, title: 'Active.psd' }]);
    const { assertPinnedActiveDocument } = loadGuard(batchPlay);

    await expect(
      assertPinnedActiveDocument('fill_layer', { document_id: 42 })
    ).rejects.toThrow('document_not_found');

    batchPlay.mockClear();
    await expect(
      assertPinnedActiveDocument('set_active_document', { document_id: 42 })
    ).resolves.toBeUndefined();
    expect(batchPlay).not.toHaveBeenCalled();
  });
});
