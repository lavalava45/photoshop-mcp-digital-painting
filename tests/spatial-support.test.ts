import { describe, expect, it } from 'vitest';
import { canvasToPreview, carryRelationsForward, mapRect, previewToCanvas, verifyRasterPlacement } from '../src/core/spatial-support.js';

const sha = 'a'.repeat(64);

describe('spatial support', () => {
  it('round-trips canvas and resized full-frame preview coordinates', () => {
    const transform = { documentId: 91, canvasWidth: 1200, canvasHeight: 800, outputWidth: 600, outputHeight: 400 };
    const source = { x: 873.25, y: 411.75 };
    expect(previewToCanvas(canvasToPreview(source, transform), transform)).toEqual(source);
  });

  it('maps a document-space region into a same-provenance focus crop', () => {
    const transform = {
      documentId: 91, canvasWidth: 1200, canvasHeight: 800, outputWidth: 400, outputHeight: 300,
      crop: { left: 200, top: 100, right: 1000, bottom: 700 },
    };
    expect(mapRect({ left: 400, top: 250, right: 800, bottom: 550 }, transform)).toEqual({
      left: 100, top: 75, right: 300, bottom: 225,
    });
  });

  it('checks placement from raster evidence instead of echoed command metadata', () => {
    const intended = {
      value: { left: 100, top: 100, right: 300, bottom: 300 },
      provenance: 'reference-derived' as const,
      uncertainty: { status: 'bounded' as const, radiusPx: 4 },
    };
    const observedElsewhere = {
      value: { left: 500, top: 100, right: 700, bottom: 300 },
      provenance: 'agent-estimated' as const,
      uncertainty: { status: 'bounded' as const, radiusPx: 6 },
      evidenceSha256: sha,
    };
    expect(verifyRasterPlacement({ intended, observedRaster: observedElsewhere }).status).toBe('conflict');
    expect(verifyRasterPlacement({
      intended,
      observedRaster: { ...observedElsewhere, value: { left: 110, top: 105, right: 295, bottom: 298 } },
    }).status).toBe('supported');
  });

  it('preserves relation provenance and uncertainty through continuation', () => {
    const relations = [{
      id: 'hand-supports-cup', type: 'support' as const, subjectId: 'hand', objectId: 'cup',
      provenance: 'agent-estimated' as const,
      uncertainty: { status: 'bounded' as const, radiusPx: 12, note: 'occluded contact' },
    }];
    expect(carryRelationsForward(relations, new Set(), new Set())[0]).toMatchObject({
      state: 'unobserved', provenance: 'agent-estimated',
      uncertainty: { status: 'bounded', radiusPx: 12, note: 'occluded contact' },
    });
  });

  it('questions contradicted relations without silently deleting them', () => {
    const relations = [{
      id: 'figure-overlap', type: 'overlap' as const, subjectId: 'figure', objectId: 'boat',
      provenance: 'reference-derived' as const, uncertainty: { status: 'bounded' as const, radiusPx: 2 },
    }];
    expect(carryRelationsForward(relations, new Set(), new Set(['figure-overlap']))[0].state).toBe('questioned');
  });

  it('keeps an unknown observed placement uncertain rather than certifying geometry', () => {
    expect(verifyRasterPlacement({
      intended: {
        value: { left: 100, top: 100, right: 300, bottom: 300 },
        provenance: '3d-projected', uncertainty: { status: 'bounded', radiusPx: 1 },
      },
      observedRaster: {
        value: { left: 105, top: 105, right: 295, bottom: 295 },
        provenance: 'agent-estimated', uncertainty: { status: 'unknown', note: 'segmentation boundary obscured' },
        evidenceSha256: sha,
      },
    }).status).toBe('uncertain');
  });
});
