export interface VisualReviewRegion {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface VisualReviewCanvas {
  width: number;
  height: number;
}

export interface VisualReviewRegionPair {
  requested_region: VisualReviewRegion;
  effective_region: VisualReviewRegion;
}

export type VisualReviewRegionLevel = 'object' | 'micro';

const PADDING_RULES: Record<VisualReviewRegionLevel, { ratio: number; minimum: number }> = {
  object: { ratio: 0.12, minimum: 24 },
  micro: { ratio: 0.06, minimum: 12 },
};

function finite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
  return value;
}

function validateCanvas(canvas: VisualReviewCanvas): VisualReviewCanvas {
  const width = finite(canvas.width, 'canvas.width');
  const height = finite(canvas.height, 'canvas.height');
  if (width <= 0 || height <= 0) throw new Error('canvas width/height must be positive');
  return { width, height };
}

export function normalizeRegion(region: VisualReviewRegion): VisualReviewRegion {
  const left = Math.floor(finite(region.left, 'region.left'));
  const top = Math.floor(finite(region.top, 'region.top'));
  const right = Math.ceil(finite(region.right, 'region.right'));
  const bottom = Math.ceil(finite(region.bottom, 'region.bottom'));
  if (right <= left || bottom <= top) throw new Error('region must have positive area');
  return { left, top, right, bottom };
}

export function regionIntersectsCanvas(region: VisualReviewRegion, canvas: VisualReviewCanvas): boolean {
  const normalized = normalizeRegion(region);
  const checkedCanvas = validateCanvas(canvas);
  return normalized.right > 0
    && normalized.bottom > 0
    && normalized.left < checkedCanvas.width
    && normalized.top < checkedCanvas.height;
}

export function padRegion(
  region: VisualReviewRegion,
  canvas: VisualReviewCanvas,
  level: VisualReviewRegionLevel
): VisualReviewRegionPair {
  const requested = normalizeRegion(region);
  const checkedCanvas = validateCanvas(canvas);
  if (!regionIntersectsCanvas(requested, checkedCanvas)) {
    throw new Error('requested region does not intersect the current canvas');
  }
  const width = requested.right - requested.left;
  const height = requested.bottom - requested.top;
  const rule = PADDING_RULES[level];
  const padX = Math.ceil(Math.max(rule.minimum, width * rule.ratio));
  const padY = Math.ceil(Math.max(rule.minimum, height * rule.ratio));
  const effective = {
    left: Math.max(0, Math.floor(requested.left - padX)),
    top: Math.max(0, Math.floor(requested.top - padY)),
    right: Math.min(checkedCanvas.width, Math.ceil(requested.right + padX)),
    bottom: Math.min(checkedCanvas.height, Math.ceil(requested.bottom + padY)),
  };
  if (effective.right <= effective.left || effective.bottom <= effective.top) {
    throw new Error('effective region has no drawable canvas area');
  }
  return { requested_region: requested, effective_region: effective };
}

export function intersectionArea(a: VisualReviewRegion, b: VisualReviewRegion): number {
  const first = normalizeRegion(a);
  const second = normalizeRegion(b);
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  return width * height;
}

export function regionsOverlap(a: VisualReviewRegion, b: VisualReviewRegion): boolean {
  return intersectionArea(a, b) > 0;
}

export function regionContains(container: VisualReviewRegion, candidate: VisualReviewRegion): boolean {
  const outer = normalizeRegion(container);
  const inner = normalizeRegion(candidate);
  return outer.left <= inner.left
    && outer.top <= inner.top
    && outer.right >= inner.right
    && outer.bottom >= inner.bottom;
}

function regionArea(region: VisualReviewRegion): number {
  const normalized = normalizeRegion(region);
  return (normalized.right - normalized.left) * (normalized.bottom - normalized.top);
}

export function overlapRatioAgainstSmaller(a: VisualReviewRegion, b: VisualReviewRegion): number {
  const overlap = intersectionArea(a, b);
  if (overlap <= 0) return 0;
  return overlap / Math.min(regionArea(a), regionArea(b));
}

export function dedupeRegions(
  regions: VisualReviewRegion[],
  substantialOverlapRatio = 0.6
): VisualReviewRegion[] {
  if (!Number.isFinite(substantialOverlapRatio)
    || substantialOverlapRatio < 0
    || substantialOverlapRatio > 1) {
    throw new Error('substantialOverlapRatio must be between 0 and 1');
  }
  const result: VisualReviewRegion[] = [];
  for (const region of regions) {
    const normalized = normalizeRegion(region);
    if (result.some(existing => overlapRatioAgainstSmaller(existing, normalized) >= substantialOverlapRatio)) {
      continue;
    }
    result.push(normalized);
  }
  return result;
}
