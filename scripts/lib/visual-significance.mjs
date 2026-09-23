import fs from 'node:fs';
import jpeg from 'jpeg-js';

export const VISUAL_SIGNIFICANCE_MODES = ['normal', 'subtle_local'];

export const VISUAL_SIGNIFICANCE_THRESHOLDS = Object.freeze({
  normal: Object.freeze({
    global: Object.freeze({
      mean_abs_rgb_delta: 0.05,
      p95_abs_rgb_delta: 2,
      changed_ratio_delta_ge_6: 0.0005,
    }),
    local: Object.freeze({
      mean_abs_rgb_delta: 0.25,
      p95_abs_rgb_delta: 2,
      changed_ratio_delta_ge_6: 0.002,
    }),
  }),
  subtle_local: Object.freeze({
    local: Object.freeze({
      mean_abs_rgb_delta: 0.08,
      p95_abs_rgb_delta: 1,
      changed_ratio_delta_ge_6: 0.0001,
    }),
  }),
});

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function decodePreview(file) {
  if (typeof file !== 'string' || !file || !fs.existsSync(file)) return undefined;
  try {
    const decoded = jpeg.decode(fs.readFileSync(file), { useTArray: true });
    if (!decoded?.data || !decoded.width || !decoded.height) return undefined;
    return decoded;
  } catch {
    return undefined;
  }
}

function pixelDelta(before, after, bx, by, ax, ay) {
  const bi = (by * before.width + bx) * 4;
  const ai = (ay * after.width + ax) * 4;
  return (
    Math.abs(before.data[bi] - after.data[ai]) +
    Math.abs(before.data[bi + 1] - after.data[ai + 1]) +
    Math.abs(before.data[bi + 2] - after.data[ai + 2])
  ) / 3;
}

export function comparePreviewFiles(beforeFile, afterFile, maxSamples = 240_000) {
  const before = decodePreview(beforeFile);
  const after = decodePreview(afterFile);
  if (!before || !after) return undefined;

  // Significance is a gate, not an image-registration algorithm. Comparing two
  // differently sized exports can create interpolation deltas even when the
  // Photoshop pixels are unchanged. Require the same capture geometry instead
  // of manufacturing a "meaningful" change by resampling here.
  if (before.width !== after.width || before.height !== after.height) return undefined;

  const width = before.width;
  const height = before.height;
  const total = width * height;
  const step = Math.max(1, Math.ceil(Math.sqrt(total / maxSamples)));
  const histogram = new Array(256).fill(0);
  let sampled = 0;
  let sum = 0;
  let changed2 = 0;
  let changed6 = 0;
  let changed12 = 0;

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const delta = pixelDelta(before, after, x, y, x, y);
      sum += delta;
      sampled++;
      histogram[Math.min(255, Math.round(delta))]++;
      if (delta >= 2) changed2++;
      if (delta >= 6) changed6++;
      if (delta >= 12) changed12++;
    }
  }

  const target95 = sampled * 0.95;
  let accumulated = 0;
  let p95 = 0;
  for (let value = 0; value < histogram.length; value++) {
    accumulated += histogram[value];
    if (accumulated >= target95) {
      p95 = value;
      break;
    }
  }

  return {
    before_width: before.width,
    before_height: before.height,
    after_width: after.width,
    after_height: after.height,
    sampled_pixels: sampled,
    mean_abs_rgb_delta: sampled ? sum / sampled : 0,
    p95_abs_rgb_delta: p95,
    changed_ratio_delta_ge_2: sampled ? changed2 / sampled : 0,
    changed_ratio_delta_ge_6: sampled ? changed6 / sampled : 0,
    changed_ratio_delta_ge_12: sampled ? changed12 / sampled : 0,
  };
}

function regionOf(preview) {
  const region = preview?.focus?.region;
  if (!region || typeof region !== 'object') return undefined;
  const normalized = {
    left: Number(region.left),
    top: Number(region.top),
    right: Number(region.right),
    bottom: Number(region.bottom),
  };
  return Object.values(normalized).every(finite) ? normalized : undefined;
}

export function sameFocusRegion(before, after, epsilon = 0.01) {
  const a = regionOf(before);
  const b = regionOf(after);
  if (!a || !b) return false;
  return ['left', 'top', 'right', 'bottom'].every(key => Math.abs(a[key] - b[key]) <= epsilon);
}

function passes(metrics, thresholds) {
  if (!metrics) return false;
  return metrics.mean_abs_rgb_delta >= thresholds.mean_abs_rgb_delta
    || metrics.p95_abs_rgb_delta >= thresholds.p95_abs_rgb_delta
    || metrics.changed_ratio_delta_ge_6 >= thresholds.changed_ratio_delta_ge_6;
}

function localMetrics(before, after) {
  if (!sameFocusRegion(before, after)) return undefined;
  return comparePreviewFiles(before?.focus?.materialized_path, after?.focus?.materialized_path);
}

export function assessVisualSignificance({ before, after, mode = 'normal' }) {
  if (!VISUAL_SIGNIFICANCE_MODES.includes(mode)) {
    throw new Error(`Unknown visual significance mode: ${mode}`);
  }
  const global = comparePreviewFiles(before?.materialized_path, after?.materialized_path);
  const local = localMetrics(before, after);
  const focus_matched = !!local;
  const normalGlobal = passes(global, VISUAL_SIGNIFICANCE_THRESHOLDS.normal.global);
  const normalLocal = passes(local, VISUAL_SIGNIFICANCE_THRESHOLDS.normal.local);
  const subtleLocal = passes(local, VISUAL_SIGNIFICANCE_THRESHOLDS.subtle_local.local);

  let execution_effect = 'unknown';
  let reason = 'No comparable materialized before/after preview was available.';

  if (mode === 'subtle_local') {
    if (!focus_matched) {
      reason = 'subtle_local requires matching materialized before/after focus previews.';
    } else if (subtleLocal || normalGlobal) {
      execution_effect = 'meaningful';
      reason = subtleLocal
        ? 'Local focus delta clears the subtle-local significance floor.'
        : 'Whole-frame delta is already large enough for normal significance.';
    } else {
      execution_effect = 'insufficient';
      reason = 'Matching local focus exists, but the decoded pixel delta is below the subtle-local floor.';
    }
  } else if (global || local) {
    if (normalGlobal || normalLocal) {
      execution_effect = 'meaningful';
      reason = normalLocal && !normalGlobal
        ? 'A localized focus change clears the normal local significance floor.'
        : 'Whole-frame decoded delta clears the normal significance floor.';
    } else {
      execution_effect = 'insufficient';
      reason = 'Decoded before/after delta is below both normal whole-frame and local significance floors.';
    }
  }

  return {
    mode,
    execution_effect,
    reason,
    focus_matched,
    global,
    local,
    thresholds: mode === 'subtle_local'
      ? VISUAL_SIGNIFICANCE_THRESHOLDS.subtle_local
      : VISUAL_SIGNIFICANCE_THRESHOLDS.normal,
  };
}
