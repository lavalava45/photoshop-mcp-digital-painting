import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { SessionStore } from '../src/core/guard/session-store.js';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import { analyzeLuminanceJpeg, isDetailStage } from '../src/core/value-check.js';
import { createValueCheckTools } from '../src/tools/value-check-tools.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempStore() {
  const dir = mkdtempSync(path.join(tmpdir(), 'value-check-'));
  dirs.push(dir);
  return new SessionStore(path.join(dir, 'controller'), {
    visualBarrierDirectory: path.join(dir, 'barriers'),
  });
}

function assessment() {
  return {
    composition: 'Stable portrait composition.',
    focal_hierarchy: 'Face is focal.',
    large_value_masses: 'Light face, dark coat, mid background.',
    lighting: 'Single coherent key light.',
    silhouette: 'Head separates from background.',
    depth: 'Face forward, background back.',
    likeness_main_shape: 'Main head shape stable.',
    overall_detail_level: 'Form modelling, before micro-detail.',
    mood: 'Calm restrained study with no unnecessary theatrical contrast.',
    color_relationships: 'Muted warm/cool balance supports the focal face.',
    shape_language: 'Naturalistic grouped masses with restrained small accents.',
    edge_hierarchy: 'Focal edges are selective; secondary transitions stay soft.',
    intentional_omission: 'Secondary texture remains suppressed until value structure is secure.',
    next_priority: 'Proceed only if values read in grayscale.',
  };
}

function criteria(overrides: Record<string, string> = {}) {
  const row = (key: string, note: string) => ({
    status: overrides[key] ?? 'pass',
    note,
  });
  return {
    large_value_grouping: row('large_value_grouping', 'Large light/mid/dark groups remain coherent.'),
    focal_hierarchy: row('focal_hierarchy', 'The focal face reads clearly in grayscale.'),
    silhouette_separation: row('silhouette_separation', 'Figure remains separated from the background.'),
    local_contrast_budget: row('local_contrast_budget', 'Secondary contrast stays below the focal area.'),
    detail_before_form: row('detail_before_form', 'Large form is stable enough for detail.'),
  };
}

function directive(valueCheck: Record<string, unknown>) {
  return {
    directive_id: 'value-directive',
    composition_freedom: 'fixed',
    goal: 'Advance form modelling only when value structure permits it.',
    artistic_evaluation_contract: {
      contract_id: 'value-directive-contract',
      revision: 1,
      positive_criteria: ['Large value groups and focal hierarchy remain readable before detail is admitted.'],
      failure_signals: ['Detail advances while value grouping, silhouette separation, or focal hierarchy remains unresolved.'],
      protected_qualities: ['large value grouping', 'focal hierarchy', 'silhouette separation'],
      stage_transition_expectations: ['Detail may begin only after the explicit value gate passes or a justified style-specific exception is recorded.'],
      final_evidence_requirements: ['Use current grayscale evidence tied to the active document frame.'],
      provenance: [{ source: 'test-directive', detail: 'Synthetic fixture derived from the directive value-gate criteria.' }],
    },
    style_contract: {
      realism_level: 'naturalistic study',
      edge_policy: 'selective focal edges with soft secondary transitions',
      color_policy: 'restrained warm/cool relationships',
      detail_density: 'detail subordinate to form and value grouping',
      primitive_footprint_tolerance: 'Synthetic value-gate fixture isolates grayscale admission; progressive-refinement evidence is outside this fixture.',
    },
    composition_exploration: { hypotheses: [] },
    assessment: assessment(),
    value_check: valueCheck,
    refinement_check: {
      status: 'style-not-applicable',
      observed: false,
      applicability_reason: 'This synthetic test isolates the independent grayscale Value Gate rather than Task 23 refinement evidence.',
      style_contract_basis: {
        field: 'primitive_footprint_tolerance',
        criterion: 'Synthetic value-gate fixture isolates grayscale admission; progressive-refinement evidence is outside this fixture.',
      },
      limitations: ['Task 23 refinement mechanics are covered by refinement-check.test.ts.'],
    },
    priorities: ['value readability'],
    review_after_microplans: 5,
    tasks: [
      {
        task_id: 'detail-pass',
        summary: 'Add restrained detail after value gate.',
        region: 'face',
        allowed_scales: ['detail', 'small'],
      },
    ],
  };
}

function painterDetailRequest() {
  return {
    id: 'detail-pass-1',
    tool: 'photoshop_execute_visual_microplan',
    args: {
      document_id: 42,
      planner_directive_id: 'value-directive',
      planner_task_id: 'detail-pass',
      painter_scope: 'local',
      change_domains: ['local-texture'],
      stage: 'DETAIL',
      scale: 'detail',
      region: 'face',
      problem_id: 'detail-pass',
    },
    summary: 'Detail pass after value gate.',
    purpose: 'Verify stage-aware value gate.',
    problem_id: 'detail-pass',
    stage: 'DETAIL',
    scale: 'detail',
  };
}

function seedValueEvidence(store: SessionStore, documentId = 42, id = 'value-evidence') {
  const root = path.dirname((store as any).directory);
  const grayscalePath = path.join(root, id + '.jpg');
  const bytes = Buffer.from('real-grayscale-evidence-' + id);
  writeFileSync(grayscalePath, bytes);
  const grayscaleSha = createHash('sha256').update(bytes).digest('hex');
  const sourceSha = createHash('sha256').update('source-preview-' + id).digest('hex');
  const begun = store.begin({
    id,
    tool: 'photoshop_analyze_value_structure',
    args: { document_id: documentId, materialize_path: grayscalePath },
    summary: 'Analyze the pinned document value structure',
    purpose: 'Create durable grayscale evidence for the DETAIL value gate',
  });
  store.markDispatched(begun.record);
  store.complete(begun.record, {
    content: [{
      type: 'text',
      text: JSON.stringify({
        ok: true,
        observed: true,
        source_preview_sha256: sourceSha,
        grayscale_sha256: grayscaleSha,
        materialized_path: grayscalePath,
      }),
    }],
  });
  return { id, sourceSha, grayscaleSha, grayscalePath };
}

describe('luminance preview analysis', () => {
  it('derives a real grayscale JPEG and descriptive luminance evidence without an artistic score', () => {
    const width = 12;
    const height = 8;
    const rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const v = x < 4 ? 30 : x < 8 ? 125 : 235;
        rgba[i] = v;
        rgba[i + 1] = v;
        rgba[i + 2] = v;
        rgba[i + 3] = 255;
      }
    }
    const encoded = jpeg.encode({ data: rgba, width, height }, 90).data;
    const result = analyzeLuminanceJpeg(encoded);
    expect(result.width).toBe(width);
    expect(result.height).toBe(height);
    expect(result.p10_luma).toBeLessThan(result.p50_luma);
    expect(result.p50_luma).toBeLessThan(result.p90_luma);
    expect(result.dark_ratio).toBeGreaterThan(0.2);
    expect(result.light_ratio).toBeGreaterThan(0.2);
    expect(result.grayscale_jpeg.byteLength).toBeGreaterThan(100);
  });

  it('exposes the analyzer as a read-only tool over the existing preview pipeline', async () => {
    const registry = new ToolRegistry();
    const width = 8;
    const height = 8;
    const rgba = Buffer.alloc(width * height * 4, 255);
    for (let i = 0; i < rgba.length; i += 4) {
      rgba[i] = i % 16 === 0 ? 20 : 220;
      rgba[i + 1] = rgba[i];
      rgba[i + 2] = rgba[i];
      rgba[i + 3] = 255;
    }
    const preview = jpeg.encode({ data: rgba, width, height }, 90).data;
    let previewArgs: Record<string, unknown> | undefined;
    const fake: ToolDefinition = {
      tool: { name: 'photoshop_get_preview', description: 'preview', inputSchema: { type: 'object', properties: {} } },
      handler: async (args) => {
        previewArgs = args;
        return {
          content: [
            { type: 'image', data: preview.toString('base64'), mimeType: 'image/jpeg' },
            { type: 'text', text: JSON.stringify({ ok: true, sha256: 'source-preview-sha' }) },
          ],
        };
      },
    };
    registry.register('photoshop_get_preview', fake);
    const tool = createValueCheckTools(registry)[0]!;
    const output = await tool.handler({ document_id: 42 });
    expect(output.isError).not.toBe(true);
    expect(output.content.some(item => item.type === 'image')).toBe(true);
    const text = output.content.find(item => item.type === 'text');
    const body = JSON.parse(text && 'text' in text ? text.text : '{}');
    expect(body.observed).toBe(true);
    expect(body.source_preview_sha256).toBe('source-preview-sha');
    expect(body.interpretation_note).toMatch(/not an artistic score/i);
    expect(previewArgs).toMatchObject({ document_id: 42, max_dimension_px: 1000, quality: 8, include_image: true });
    expect((tool.tool.inputSchema as any).required).toContain('document_id');
  });
});

describe('stage-aware value gate', () => {
  it('recognizes detail stages without treating ordinary form stages as detail', () => {
    expect(isDetailStage('DETAIL')).toBe(true);
    expect(isDetailStage('MICRO_DETAIL')).toBe(true);
    expect(isDetailStage('FORM_AND_LIGHT')).toBe(false);
  });

  it('PASS permits detailing', () => {
    const store = tempStore();
    const evidence = seedValueEvidence(store);
    store.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive({
        status: 'pass', observed: true, preview_sha256: evidence.sourceSha, evidence_operation_id: evidence.id, confidence: 0.9,
        limitations: [], criteria: criteria(),
      }),
    });
    expect(() => store.plannerGate(42, painterDetailRequest())).not.toThrow();
  });

  it('FAIL blocks detailing', () => {
    const store = tempStore();
    const evidence = seedValueEvidence(store);
    store.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive({
        status: 'fail', observed: true, preview_sha256: evidence.sourceSha, evidence_operation_id: evidence.id, confidence: 0.85,
        limitations: [], criteria: criteria({ focal_hierarchy: 'fail' }),
      }),
    });
    expect(() => store.plannerGate(42, painterDetailRequest())).toThrow(/value_structure_unstable/);
  });

  it('explicit justified override permits detailing', () => {
    const store = tempStore();
    const evidence = seedValueEvidence(store);
    store.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive({
        status: 'override', observed: true, preview_sha256: evidence.sourceSha, evidence_operation_id: evidence.id, confidence: 0.7,
        limitations: ['Color relationships are intentionally dominant in this stylized treatment.'],
        override_reason: 'The requested style intentionally subordinates luminance separation to color-shape relationships.',
        criteria: criteria({ silhouette_separation: 'uncertain' }),
      }),
    });
    expect(() => store.plannerGate(42, painterDetailRequest())).not.toThrow();
  });

  it('style-not-applicable permits detailing only with an explicit applicability reason', () => {
    const store = tempStore();
    store.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive({
        status: 'style-not-applicable',
        observed: false,
        applicability_reason: 'The workflow is intentionally chromatic/graphic and luminance hierarchy is not the governing representation constraint.',
        limitations: [],
      }),
    });
    expect(() => store.plannerGate(42, painterDetailRequest())).not.toThrow();

    expect(() => store.setArtDirectorState({
      document_id: 43,
      action: 'review',
      directive: directive({ status: 'style-not-applicable', observed: false, applicability_reason: 'irrelevant' }),
    })).toThrow(/applicability_reason/);
  });

  it('does not allow an unobserved PASS', () => {
    const store = tempStore();
    expect(() => store.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive({
        status: 'pass', observed: false, preview_sha256: 'made-up', criteria: criteria(),
      }),
    })).toThrow(/observed=true/);
  });

  it('rejects a fabricated value-check hash with no real evidence operation or file', () => {
    const store = tempStore();
    expect(() => store.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive({
        status: 'pass',
        observed: true,
        preview_sha256: 'NOT-A-HASH-NO-FILE',
        evidence_operation_id: 'fake-value-evidence',
        criteria: criteria(),
      }),
    })).toThrow(/64-hex preview_sha256/);
  });

  it('rejects stale grayscale evidence after the document current frame changes', () => {
    const store = tempStore();
    const evidence = seedValueEvidence(store);
    const framePath = path.join(path.dirname((store as any).directory), 'new-current-frame.jpg');
    const frameBytes = Buffer.from('new-current-frame');
    writeFileSync(framePath, frameBytes);
    const frameSha = createHash('sha256').update(frameBytes).digest('hex');
    store.updatePaintingState(42, current => ({
      ...current,
      current_frame: {
        operation_id: 'new-frame',
        sha256: frameSha,
        path: framePath,
        at: new Date(Date.now() + 1000).toISOString(),
        accepted: false,
      },
    }));
    expect(() => store.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive({
        status: 'pass',
        observed: true,
        preview_sha256: evidence.sourceSha,
        evidence_operation_id: evidence.id,
        criteria: criteria(),
      }),
    })).toThrow(/stale/);
  });

  it('rejects grayscale evidence when the materialized file no longer matches its analyzer hash', () => {
    const store = tempStore();
    const evidence = seedValueEvidence(store);
    writeFileSync(evidence.grayscalePath, Buffer.from('tampered'));
    expect(() => store.setArtDirectorState({
      document_id: 42,
      action: 'review',
      directive: directive({
        status: 'pass',
        observed: true,
        preview_sha256: evidence.sourceSha,
        evidence_operation_id: evidence.id,
        criteria: criteria(),
      }),
    })).toThrow(/grayscale evidence file SHA mismatch/);
  });
});
