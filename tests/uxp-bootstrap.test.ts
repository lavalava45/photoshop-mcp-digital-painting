import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../uxp-plugin/main.js', import.meta.url), 'utf8')
  .replace(/\npollLoop\(\);\s*$/, '\n');

function bootstrapHarness() {
  const calls: Array<{ kind: string; value?: unknown }> = [];
  let modalDepth = 0;
  const inertDispatcher = async () => ({ handled: false });
  const phaseDispatchers: Record<string, Record<string, typeof inertDispatcher>> = {
    './p1-document-ops': { tryHandleP1DocumentOperation: inertDispatcher },
    './p1-selection-ops': { tryHandleP1SelectionOperation: inertDispatcher },
    './p1-layer-ops': { tryHandleP1LayerOperation: inertDispatcher },
    './p2-adjustment-ops': { tryHandleP2AdjustmentOperation: inertDispatcher },
    './p2-filter-ops': { tryHandleP2FilterOperation: inertDispatcher },
    './p2-text-export-ops': { tryHandleP2TextExportOperation: inertDispatcher },
    './p3-utility-ops': { tryHandleP3UtilityOperation: inertDispatcher },
    './p3-document-data-ops': { tryHandleP3DocumentDataOperation: inertDispatcher },
    './p3-layer-advanced-ops': { tryHandleP3LayerAdvancedOperation: inertDispatcher },
  };
  const app: Record<string, any> = {
    activeDocument: null,
    documents: {
      length: 0,
      async add(options: Record<string, unknown>) {
        if (modalDepth < 1) throw new Error('document add must run inside executeAsModal');
        calls.push({ kind: 'add', value: options });
        const document = {
          id: 41,
          name: 'Untitled-1',
          width: options.width,
          height: options.height,
          resolution: options.resolution,
        };
        app.activeDocument = document;
        return document;
      },
    },
    async open(entry: unknown) {
      if (modalDepth < 1) throw new Error('open must run inside executeAsModal');
      calls.push({ kind: 'open', value: entry });
      const document = {
        id: 84,
        name: 'source image.png',
        width: 1920,
        height: 1080,
        resolution: 72,
      };
      app.activeDocument = document;
      return document;
    },
  };
  const localFileSystem = {
    async getEntryWithUrl(url: string) {
      calls.push({ kind: 'getEntryWithUrl', value: url });
      return { isFile: true, nativePath: 'C:\\Users\\Test\\source image.png' };
    },
  };
  const core = {
    async executeAsModal(fn: () => Promise<unknown>, options: unknown) {
      calls.push({ kind: 'modal', value: options });
      modalDepth += 1;
      try {
        return await fn();
      } finally {
        modalDepth -= 1;
      }
    },
  };
  const functions = runInNewContext(
    source + '\n({ createDocumentMutation, openImageMutation })',
    {
      require: (name: string) => {
        if (name === 'uxp') {
          return {
            entrypoints: { setup() {} },
            storage: { localFileSystem, types: { file: Symbol('file') } },
          };
        }
        if (name === 'photoshop') {
          return {
            action: { batchPlay: async () => [] },
            core,
            app,
            constants: {
              NewDocumentMode: {
                RGB: 'RGBColorMode',
                CMYK: 'CMYKColorMode',
                GRAYSCALE: 'GrayscaleMode',
              },
              DocumentFill: { WHITE: 'white' },
            },
          };
        }
        if (phaseDispatchers[name]) return phaseDispatchers[name];
        throw new Error(`Unexpected require: ${name}`);
      },
      fetch: async () => ({ ok: true, status: 204 }),
      setTimeout,
      clearTimeout,
    }
  ) as {
    createDocumentMutation(params: Record<string, unknown>): Promise<Record<string, any>>;
    openImageMutation(params: Record<string, unknown>): Promise<Record<string, any>>;
  };
  return { ...functions, calls };
}

describe('UXP bootstrap mutations', () => {
  it('keeps selection post-mutation readback modal-safe inside executeAsModal', () => {
    for (const functionName of ['selectShapeMutation', 'featherSelectionMutation', 'selectSubjectMutation']) {
      const start = source.indexOf(`async function ${functionName}`);
      expect(start, `${functionName} must exist`).toBeGreaterThanOrEqual(0);
      const nextFunction = source.indexOf('\nasync function ', start + 1);
      const body = source.slice(start, nextFunction >= 0 ? nextFunction : source.length);
      expect(body).toContain('snapshotSelectionBounds({ synchronousExecution: true })');
      expect(body).not.toContain('snapshotSelectionBounds()');
    }
  });

  it('creates a document inside executeAsModal and returns the real Photoshop document id', async () => {
    const harness = bootstrapHarness();
    const result = await harness.createDocumentMutation({
      width: 1400,
      height: 1750,
      resolution: 144,
      colorMode: 'CMYK',
    });

    expect(harness.calls.find((call) => call.kind === 'add')?.value).toEqual({
      width: 1400,
      height: 1750,
      resolution: 144,
      mode: 'CMYKColorMode',
      fill: 'white',
    });
    expect(result).toMatchObject({
      transport: 'uxp',
      operation: 'create_document',
      document: { id: 41, name: 'Untitled-1', width: 1400, height: 1750, resolution: 144 },
      active_document_id: 41,
    });
  });

  it('opens an arbitrary fullAccess file entry inside executeAsModal and returns its real document id', async () => {
    const harness = bootstrapHarness();
    const result = await harness.openImageMutation({
      filePath: 'C:\\Users\\Test\\source image.png',
    });

    expect(harness.calls.find((call) => call.kind === 'getEntryWithUrl')?.value)
      .toBe('file:/C:/Users/Test/source%20image.png');
    expect(harness.calls.some((call) => call.kind === 'open')).toBe(true);
    expect(result).toMatchObject({
      transport: 'uxp',
      operation: 'open_image',
      path: 'C:\\Users\\Test\\source image.png',
      document: { id: 84, name: 'source image.png', width: 1920, height: 1080, resolution: 72 },
      active_document_id: 84,
    });
  });
});
