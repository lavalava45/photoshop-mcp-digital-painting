import { describe, expect, it } from 'vitest';
import {
  dedupeRegions,
  normalizeRegion,
  padRegion,
  regionContains,
  regionsOverlap,
} from '../src/core/guard/visual-review-region.js';

describe('visual review region helpers', () => {
  it('normalizes to deterministic integer pixel coverage without converting coordinate space', () => {
    expect(normalizeRegion({ left: 10.8, top: 20.2, right: 99.1, bottom: 120.01 })).toEqual({
      left: 10,
      top: 20,
      right: 100,
      bottom: 121,
    });
  });

  it('rejects non-finite and empty regions', () => {
    expect(() => normalizeRegion({ left: Number.NaN, top: 0, right: 10, bottom: 10 })).toThrow(/finite/);
    expect(() => normalizeRegion({ left: 10, top: 0, right: 10, bottom: 10 })).toThrow(/positive area/);
    expect(() => normalizeRegion({ left: 11, top: 0, right: 10, bottom: 10 })).toThrow(/positive area/);
  });

  it('preserves requested coordinates and applies OBJECT padding deterministically', () => {
    expect(padRegion(
      { left: 100, top: 200, right: 300, bottom: 400 },
      { width: 1000, height: 800 },
      'object'
    )).toEqual({
      requested_region: { left: 100, top: 200, right: 300, bottom: 400 },
      effective_region: { left: 76, top: 176, right: 324, bottom: 424 },
    });
  });

  it('uses the MICRO minimum padding and clamps only the effective crop at canvas edges', () => {
    expect(padRegion(
      { left: 2, top: 3, right: 52, bottom: 43 },
      { width: 100, height: 80 },
      'micro'
    )).toEqual({
      requested_region: { left: 2, top: 3, right: 52, bottom: 43 },
      effective_region: { left: 0, top: 0, right: 64, bottom: 55 },
    });
  });

  it.each([
    [{ left: -50, top: 20, right: -10, bottom: 40 }],
    [{ left: 120, top: 20, right: 180, bottom: 40 }],
    [{ left: 20, top: -50, right: 40, bottom: -10 }],
    [{ left: 20, top: 90, right: 40, bottom: 120 }],
  ])('rejects a requested box fully outside the canvas: %o', region => {
    expect(() => padRegion(region, { width: 100, height: 80 }, 'object')).toThrow(/does not intersect/);
  });

  it('retains a partially out-of-canvas requested box while reporting the actual effective crop', () => {
    expect(padRegion(
      { left: -10, top: 10, right: 30, bottom: 50 },
      { width: 100, height: 80 },
      'object'
    )).toEqual({
      requested_region: { left: -10, top: 10, right: 30, bottom: 50 },
      effective_region: { left: 0, top: 0, right: 54, bottom: 74 },
    });
  });

  it('reports overlap/containment in source document coordinates', () => {
    const outer = { left: 10, top: 10, right: 100, bottom: 100 };
    const inner = { left: 20, top: 20, right: 40, bottom: 40 };
    const separate = { left: 110, top: 10, right: 130, bottom: 30 };
    expect(regionsOverlap(outer, inner)).toBe(true);
    expect(regionContains(outer, inner)).toBe(true);
    expect(regionsOverlap(outer, separate)).toBe(false);
  });

  it('deduplicates substantially overlapping regions while preserving stable input order', () => {
    expect(dedupeRegions([
      { left: 0, top: 0, right: 100, bottom: 100 },
      { left: 10, top: 10, right: 90, bottom: 90 },
      { left: 200, top: 200, right: 260, bottom: 260 },
    ])).toEqual([
      { left: 0, top: 0, right: 100, bottom: 100 },
      { left: 200, top: 200, right: 260, bottom: 260 },
    ]);
  });
});
