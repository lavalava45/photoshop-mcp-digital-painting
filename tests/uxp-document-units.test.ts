import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../uxp-plugin/main.js', import.meta.url), 'utf8')
  .replace(/\npollLoop\(\);\s*$/, '\n');
function bridgeFunctions(descriptor: Record<string, unknown> = {}) {
  return runInNewContext(source + '\n({ documentPixelDimension, readPreviewDocumentDescriptor, assertCanvasPoint })', {
    require: (name: string) => name === 'uxp'
      ? { entrypoints: { setup() {} }, storage: {} }
      : { action: { batchPlay: async () => [descriptor] }, app: {}, core: {}, constants: {} },
  });
}

describe('UXP document dimensions use canvas pixels', () => {
  it.each([72, 144, 300])('converts Action Manager points at %i dpi without rescaling pixel descriptors', async dpi => {
    const descriptor = {
      documentID: 42, resolution: dpi,
      width: { _unit: 'pointsUnit', _value: 1400 * 72 / dpi },
      height: { _unit: 'pointsUnit', _value: 1750 * 72 / dpi },
    };
    const bridge = bridgeFunctions(descriptor);
    const info = await bridge.readPreviewDocumentDescriptor(42);
    expect(info.width).toBeCloseTo(1400);
    expect(info.height).toBeCloseTo(1750);
    expect(bridge.documentPixelDimension({ _unit: 'pixelsUnit', _value: 1400 }, dpi)).toBe(1400);
    expect(bridge.documentPixelDimension(1400, dpi)).toBe(1400);
    expect(() => bridge.assertCanvasPoint({ x: 730, y: 600 }, 'car', info.width, info.height)).not.toThrow();
    expect(() => bridge.assertCanvasPoint({ x: 1500, y: 600 }, 'car', info.width, info.height)).toThrow(/outside/);
  });

  it('converts Photoshop distanceUnit descriptors from points to pixels', () => {
    const bridge = bridgeFunctions();
    expect(bridge.documentPixelDimension({ _unit: 'distanceUnit', _value: 700 }, 144)).toBe(1400);
    expect(bridge.documentPixelDimension({ _unit: 'distanceUnit', _value: 875 }, 144)).toBe(1750);
  });

  it('fails closed on unknown units or missing resolution for physical units', () => {
    const bridge = bridgeFunctions();
    expect(() => bridge.documentPixelDimension({ _unit: 'pointsUnit', _value: 700 })).toThrow(/resolution/);
    expect(() => bridge.documentPixelDimension({ _unit: 'unknown', _value: 700 }, 144)).toThrow(/unit/);
  });
});
