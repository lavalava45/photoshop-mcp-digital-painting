import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyzeMechanicalPatterning } from '../src/core/guard/mechanical-patterning.js';
import { SessionStore } from '../src/core/guard/session-store.js';

type Point = { x: number; y: number };
type Bounds = { left: number; top: number; right: number; bottom: number };

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function transform(
  points: Point[],
  { tx = 0, ty = 0, scale = 1, degrees = 0, jitter = 0 } = {}
): Point[] {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return points.map((point, index) => {
    const x = point.x * scale;
    const y = point.y * scale;
    const dx = jitter ? (index % 2 === 0 ? jitter : -jitter) : 0;
    const dy = jitter ? (index % 3 === 0 ? -jitter : jitter) : 0;
    return {
      x: x * cos - y * sin + tx + dx,
      y: x * sin + y * cos + ty + dy,
    };
  });
}

function bounds(points: Point[], pad = 4): Bounds {
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  return {
    left: Math.min(...xs) - pad,
    top: Math.min(...ys) - pad,
    right: Math.max(...xs) + pad,
    bottom: Math.max(...ys) + pad,
  };
}

function requestForStrokes(
  strokes: Array<{ points: Point[]; color?: Record<string, number>; size?: number }>,
  motifBounds: Bounds[],
  patternIntent: 'organic_instances' | 'intentional_regular' = 'organic_instances',
  category = 'bird'
) {
  return {
    id: 'mechanical-pattern-pass',
    tool: 'photoshop_execute_visual_microplan',
    args: {
      document_id: 42,
      summary: 'Add several visible bird instances with independent construction.',
      intent: 'Add readable bird silhouettes without copy-pasted geometry.',
      region: 'sky',
      pattern_intent: patternIntent,
      motif_instances: motifBounds.map((region_bounds, index) => ({
        id: `${category}-${index + 1}`,
        category,
        region_bounds,
      })),
      steps: [{
        id: 'paint-motifs',
        tool: 'photoshop_paint_strokes',
        args: { strokes },
      }],
    },
    summary: 'Add several visible bird instances with independent construction.',
    purpose: 'Exercise repeated-instance review.',
  };
}

function fixtureWithRecord(request: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'mechanical-patterning-review-'));
  dirs.push(dir);
  const controller = path.join(dir, 'controller');
  const store = new SessionStore(controller, {
    visualBarrierDirectory: path.join(dir, 'barriers'),
    workspaceRoot: dir,
  });
  const wholeBytes = Buffer.from('mechanical-whole-frame');
  const wholePath = path.join(dir, 'whole.jpg');
  writeFileSync(wholePath, wholeBytes);
  store.write({
    ...request,
    hash: 'mechanical-pattern-record',
    sequence: 1,
    created_at: '2026-09-25T00:00:00.000Z',
    completed_at: '2026-09-25T00:00:01.000Z',
    phase: 'completed',
    execution: 'completed',
    visual: true,
    failed: false,
    preview: {
      sha256: createHash('sha256').update(wholeBytes).digest('hex'),
      materialized_path: wholePath,
      document_id: 42,
      width: 600,
      height: 400,
      canvas_width: 600,
      canvas_height: 400,
      scale_x: 1,
      scale_y: 1,
    },
  });
  return { dir, controller, store };
}

function cropPreview(dir: string, wholeSha: string, capture: Record<string, any>) {
  const cropBytes = Buffer.from(`crop:${String(capture.role)}`);
  const cropPath = path.join(dir, `${String(capture.role)}.jpg`);
  writeFileSync(cropPath, cropBytes);
  return {
    sha256: wholeSha,
    document_id: 42,
    width: 600,
    height: 400,
    canvas_width: 600,
    canvas_height: 400,
    focus: {
      sha256: createHash('sha256').update(cropBytes).digest('hex'),
      materialized_path: cropPath,
      region: capture.effective_region,
      width: capture.effective_region.right - capture.effective_region.left,
      height: capture.effective_region.bottom - capture.effective_region.top,
      scale_x: 1,
      scale_y: 1,
    },
  };
}

describe('mechanical-patterning review gate', () => {
  const bird = [
    { x: 0, y: 4 },
    { x: 8, y: 0 },
    { x: 16, y: 5 },
    { x: 10, y: 3 },
  ];

  it('flags four exact translated bird glyphs as repeated organic geometry', () => {
    const shapes = [
      transform(bird, { tx: 40, ty: 70 }),
      transform(bird, { tx: 120, ty: 90 }),
      transform(bird, { tx: 220, ty: 65 }),
      transform(bird, { tx: 330, ty: 105 }),
    ];
    const result = analyzeMechanicalPatterning(requestForStrokes(
      shapes.map(points => ({ points })),
      shapes.map(points => bounds(points))
    ));

    expect(result).toMatchObject({
      triggered: true,
      classification: 'organic_instances',
      instance_count: 4,
      repeated_cluster_size: 4,
    });
    expect(result.findings.every(finding => finding.kind === 'mechanical_patterning')).toBe(true);
    expect(result.representative_regions.length).toBeGreaterThanOrEqual(2);
  });

  it('still flags transform/color/scale and small coordinate-jitter variants', () => {
    const shapes = [
      transform(bird, { tx: 50, ty: 70, scale: 1 }),
      transform(bird, { tx: 150, ty: 80, scale: 1.6, degrees: 24 }),
      transform(bird, { tx: 280, ty: 100, scale: 0.8, degrees: -18, jitter: 0.15 }),
      transform(bird, { tx: 390, ty: 75, scale: 1.25, degrees: 47, jitter: 0.1 }),
    ];
    const colors = [
      { red: 20, green: 20, blue: 20 },
      { red: 220, green: 60, blue: 90 },
      { red: 70, green: 150, blue: 230 },
      { red: 180, green: 120, blue: 40 },
    ];
    const result = analyzeMechanicalPatterning(requestForStrokes(
      shapes.map((points, index) => ({ points, color: colors[index], size: 2 + index })),
      shapes.map(points => bounds(points))
    ));

    expect(result.triggered).toBe(true);
    expect(result.repeated_cluster_size).toBe(4);
    expect(result.most_similar_pair?.normalized_error).toBeLessThanOrEqual(0.08);
  });

  it('does not fail structurally different birds merely because they share one semantic class', () => {
    const shapes = [
      transform([{ x: 0, y: 3 }, { x: 8, y: 0 }, { x: 16, y: 4 }], { tx: 50, ty: 70 }),
      transform([{ x: 0, y: 5 }, { x: 5, y: 0 }, { x: 12, y: 2 }, { x: 18, y: 8 }], { tx: 150, ty: 85 }),
      transform([{ x: 0, y: 2 }, { x: 4, y: 7 }, { x: 10, y: 0 }, { x: 15, y: 8 }, { x: 21, y: 4 }], { tx: 270, ty: 70 }),
      transform([{ x: 0, y: 8 }, { x: 3, y: 2 }, { x: 9, y: 0 }, { x: 15, y: 3 }, { x: 18, y: 9 }, { x: 11, y: 6 }], { tx: 390, ty: 95 }),
    ];
    const result = analyzeMechanicalPatterning(requestForStrokes(
      shapes.map(points => ({ points })),
      shapes.map(points => bounds(points))
    ));

    expect(result.triggered).toBe(false);
    expect(result.repeated_cluster_size).toBeLessThan(3);
  });

  it('allows an explicitly classified regular architectural rhythm', () => {
    const modules = [
      transform(bird, { tx: 50, ty: 70 }),
      transform(bird, { tx: 100, ty: 70 }),
      transform(bird, { tx: 150, ty: 70 }),
      transform(bird, { tx: 200, ty: 70 }),
    ];
    const result = analyzeMechanicalPatterning(requestForStrokes(
      modules.map(points => ({ points })),
      modules.map(points => bounds(points)),
      'intentional_regular',
      'railing-post'
    ));

    expect(result).toMatchObject({
      triggered: false,
      classification: 'intentional_regular',
    });
  });

  it('forces representative instance-scale crop debt for repeated block-character skeletons and cannot close from whole-frame evidence alone', () => {
    const offsets = [60, 170, 290, 420];
    const strokes: Array<{ points: Point[] }> = [];
    const motifBounds: Bounds[] = [];
    for (const tx of offsets) {
      const head = transform([{ x: 4, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 4, y: 6 }], { tx, ty: 180 });
      const body = transform([{ x: 7, y: 6 }, { x: 7, y: 25 }], { tx, ty: 180 });
      const arms = transform([{ x: 0, y: 12 }, { x: 7, y: 9 }, { x: 14, y: 12 }], { tx, ty: 180 });
      const all = [...head, ...body, ...arms];
      strokes.push({ points: head }, { points: body }, { points: arms });
      motifBounds.push(bounds(all, 5));
    }
    const request = requestForStrokes(strokes, motifBounds, 'organic_instances', 'ninja-character');
    const { dir, controller, store } = fixtureWithRecord(request);
    const record = store.read('mechanical-pattern-pass')!;
    const wholeSha = record.preview.sha256;

    let plan = store.planReviewEscalation('mechanical-pattern-pass', [], { persist: true }) as any;
    expect(plan.required).toBe(true);
    expect(plan.captures.length).toBeGreaterThan(0);
    expect(plan.captures.length).toBeLessThanOrEqual(2);
    expect(plan.captures.every((capture: any) => capture.level === 'object')).toBe(true);
    expect(plan.captures.every((capture: any) => capture.kind === 'mechanical_patterning')).toBe(true);
    expect(store.read('mechanical-pattern-pass')?.mechanical_patterning).toMatchObject({ triggered: true });

    for (const capture of plan.captures) {
      store.attachReviewEvidence('mechanical-pattern-pass', capture, cropPreview(dir, wholeSha, capture));
    }
    plan = store.planReviewEscalation('mechanical-pattern-pass', [], { persist: true }) as any;
    for (const capture of plan.captures) {
      store.attachReviewEvidence('mechanical-pattern-pass', capture, cropPreview(dir, wholeSha, capture));
    }
    expect((store.planReviewEscalation as any)('mechanical-pattern-pass', [], { persist: false }).required).toBe(false);

    const restarted = new SessionStore(controller, {
      visualBarrierDirectory: path.join(dir, 'barriers'),
      workspaceRoot: dir,
    });
    expect((restarted.planReviewEscalation as any)('mechanical-pattern-pass', [], { persist: false }).required).toBe(false);
  });
});
