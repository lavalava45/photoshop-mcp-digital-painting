import jpeg from 'jpeg-js';

export const VALUE_CHECK_STATUSES = ['pass', 'fail', 'override', 'style-not-applicable'] as const;
export type ValueCheckStatus = (typeof VALUE_CHECK_STATUSES)[number];

export const VALUE_CHECK_CRITERIA = [
  'large_value_grouping',
  'focal_hierarchy',
  'silhouette_separation',
  'local_contrast_budget',
  'detail_before_form',
] as const;
export type ValueCheckCriterion = (typeof VALUE_CHECK_CRITERIA)[number];

export const VALUE_CRITERION_STATUSES = ['pass', 'fail', 'uncertain', 'not-applicable'] as const;
export type ValueCriterionStatus = (typeof VALUE_CRITERION_STATUSES)[number];

export interface LuminanceEvidence {
  width: number;
  height: number;
  sampled_pixels: number;
  p10_luma: number;
  p50_luma: number;
  p90_luma: number;
  dark_ratio: number;
  midtone_ratio: number;
  light_ratio: number;
  center_mean_luma: number;
  border_mean_luma: number;
  center_border_abs_delta: number;
  grayscale_jpeg: Buffer;
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function percentile(histogram: number[], total: number, p: number): number {
  const target = Math.max(1, Math.ceil(total * p));
  let accumulated = 0;
  for (let i = 0; i < histogram.length; i++) {
    accumulated += histogram[i] ?? 0;
    if (accumulated >= target) return i;
  }
  return 255;
}

export function analyzeLuminanceJpeg(buffer: Buffer, maxSamples = 240_000): LuminanceEvidence {
  const decoded = jpeg.decode(buffer, { useTArray: true });
  if (!decoded?.data || !decoded.width || !decoded.height) throw new Error('Unable to decode JPEG preview for value check');
  const { width, height, data } = decoded;
  const total = width * height;
  const step = Math.max(1, Math.ceil(Math.sqrt(total / maxSamples)));
  const histogram = new Array(256).fill(0);
  let sampled = 0;
  let dark = 0;
  let mid = 0;
  let light = 0;
  let centerSum = 0;
  let centerCount = 0;
  let borderSum = 0;
  let borderCount = 0;
  const x0 = width * 0.25;
  const x1 = width * 0.75;
  const y0 = height * 0.25;
  const y1 = height * 0.75;

  const gray = Buffer.alloc(data.length);
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4;
    const y = clampByte(0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]);
    gray[offset] = y;
    gray[offset + 1] = y;
    gray[offset + 2] = y;
    gray[offset + 3] = 255;
  }

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const offset = (y * width + x) * 4;
      const luma = gray[offset];
      histogram[luma]++;
      sampled++;
      if (luma < 85) dark++;
      else if (luma < 170) mid++;
      else light++;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) {
        centerSum += luma;
        centerCount++;
      } else {
        borderSum += luma;
        borderCount++;
      }
    }
  }
  const centerMean = centerCount ? centerSum / centerCount : 0;
  const borderMean = borderCount ? borderSum / borderCount : 0;
  const grayscaleJpeg = jpeg.encode({ data: gray, width, height }, 82).data;
  return {
    width,
    height,
    sampled_pixels: sampled,
    p10_luma: percentile(histogram, sampled, 0.10),
    p50_luma: percentile(histogram, sampled, 0.50),
    p90_luma: percentile(histogram, sampled, 0.90),
    dark_ratio: sampled ? dark / sampled : 0,
    midtone_ratio: sampled ? mid / sampled : 0,
    light_ratio: sampled ? light / sampled : 0,
    center_mean_luma: centerMean,
    border_mean_luma: borderMean,
    center_border_abs_delta: Math.abs(centerMean - borderMean),
    grayscale_jpeg: grayscaleJpeg,
  };
}

export function isDetailStage(stage: unknown): boolean {
  if (typeof stage !== 'string') return false;
  return /(?:^|[_\s-])(detail|details|detailing|micro|micro-detail)(?:$|[_\s-])/i.test(stage.trim());
}\n