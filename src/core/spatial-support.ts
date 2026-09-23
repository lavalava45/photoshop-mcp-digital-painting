export type SpatialProvenance = 'reference-derived' | '3d-projected' | 'agent-estimated';

export interface PixelPoint { x: number; y: number; }
export interface PixelRect { left: number; top: number; right: number; bottom: number; }

export interface PreviewTransform {
  documentId: number;
  canvasWidth: number;
  canvasHeight: number;
  outputWidth: number;
  outputHeight: number;
  crop?: PixelRect;
}

export interface SpatialEvidence<T> {
  value: T;
  provenance: SpatialProvenance;
  uncertainty: { status: 'bounded' | 'unknown'; radiusPx?: number; note?: string; };
}

export interface SpatialRelation {
  id: string;
  type: 'support' | 'overlap' | 'containment' | 'depth-order' | 'attachment';
  subjectId: string;
  objectId: string;
  provenance: SpatialProvenance;
  uncertainty: SpatialEvidence<unknown>['uncertainty'];
}

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(label + ' must be a finite positive number');
}

function assertRect(rect: PixelRect, label = 'rect'): void {
  if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
    || rect.right <= rect.left || rect.bottom <= rect.top) {
    throw new Error(label + ' must have finite positive-area bounds');
  }
}

function sourceRect(transform: PreviewTransform): PixelRect {
  assertFinitePositive(transform.canvasWidth, 'canvasWidth');
  assertFinitePositive(transform.canvasHeight, 'canvasHeight');
  assertFinitePositive(transform.outputWidth, 'outputWidth');
  assertFinitePositive(transform.outputHeight, 'outputHeight');
  const crop = transform.crop ?? { left: 0, top: 0, right: transform.canvasWidth, bottom: transform.canvasHeight };
  assertRect(crop, 'crop');
  if (crop.left < 0 || crop.top < 0 || crop.right > transform.canvasWidth || crop.bottom > transform.canvasHeight) {
    throw new Error('crop must remain inside the pinned canvas');
  }
  return crop;
}

export function canvasToPreview(point: PixelPoint, transform: PreviewTransform): PixelPoint {
  const crop = sourceRect(transform);
  return {
    x: (point.x - crop.left) * transform.outputWidth / (crop.right - crop.left),
    y: (point.y - crop.top) * transform.outputHeight / (crop.bottom - crop.top),
  };
}

export function previewToCanvas(point: PixelPoint, transform: PreviewTransform): PixelPoint {
  const crop = sourceRect(transform);
  return {
    x: crop.left + point.x * (crop.right - crop.left) / transform.outputWidth,
    y: crop.top + point.y * (crop.bottom - crop.top) / transform.outputHeight,
  };
}

export function mapRect(rect: PixelRect, transform: PreviewTransform): PixelRect {
  assertRect(rect);
  const tl = canvasToPreview({ x: rect.left, y: rect.top }, transform);
  const br = canvasToPreview({ x: rect.right, y: rect.bottom }, transform);
  return { left: tl.x, top: tl.y, right: br.x, bottom: br.y };
}

function area(rect: PixelRect): number {
  return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
}

function intersection(a: PixelRect, b: PixelRect): PixelRect | null {
  const rect = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return rect.right > rect.left && rect.bottom > rect.top ? rect : null;
}

export function verifyRasterPlacement(input: {
  intended: SpatialEvidence<PixelRect>;
  observedRaster: SpatialEvidence<PixelRect> & { evidenceSha256: string };
  minIntersectionOverObserved?: number;
}): {
  status: 'supported' | 'conflict' | 'uncertain';
  intersectionOverObserved: number;
  evidenceSha256: string;
  uncertainty: SpatialEvidence<unknown>['uncertainty'];
} {
  assertRect(input.intended.value, 'intended');
  assertRect(input.observedRaster.value, 'observedRaster');
  if (!/^[a-f0-9]{64}$/i.test(input.observedRaster.evidenceSha256)) {
    throw new Error('observed raster placement requires a 64-hex evidence SHA');
  }
  const overlap = intersection(input.intended.value, input.observedRaster.value);
  const ratio = overlap ? area(overlap) / area(input.observedRaster.value) : 0;
  const threshold = input.minIntersectionOverObserved ?? 0.7;
  const uncertainty = input.observedRaster.uncertainty.status === 'unknown'
    ? input.observedRaster.uncertainty
    : input.intended.uncertainty.status === 'unknown'
      ? input.intended.uncertainty
      : input.observedRaster.uncertainty;
  return {
    status: uncertainty.status === 'unknown' ? 'uncertain' : ratio >= threshold ? 'supported' : 'conflict',
    intersectionOverObserved: ratio,
    evidenceSha256: input.observedRaster.evidenceSha256,
    uncertainty,
  };
}

export function carryRelationsForward(
  relations: SpatialRelation[],
  observedRelationIds: Set<string>,
  contradictedRelationIds: Set<string>,
): Array<SpatialRelation & { state: 'preserved' | 'questioned' | 'unobserved' }> {
  return relations.map(relation => ({
    ...relation,
    uncertainty: { ...relation.uncertainty },
    state: contradictedRelationIds.has(relation.id)
      ? 'questioned'
      : observedRelationIds.has(relation.id) ? 'preserved' : 'unobserved',
  }));
}
