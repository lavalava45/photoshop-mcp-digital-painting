import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { ToolRegistry, type ToolDefinition } from '../src/core/tool-registry.js';
import { withOptionalDocumentId } from '../src/core/document-target.js';
import { PhotoshopConnection } from '../src/platform/connection.js';
import { createPaintingTools } from '../src/tools/painting-tools.js';
import { createLayerTools } from '../src/tools/layer-tools.js';
import { createStateTools } from '../src/tools/state-tools.js';
import { createVisualMicroPlanTools } from '../src/tools/visual-microplan-tools.js';
import { createGuardTools } from '../src/tools/guard-tools.js';
import { EmbeddedGuardRuntime } from '../src/core/guard/runtime.js';
import { UXP_BRIDGE_REVISION } from '../src/core/guard/protocol-version.js';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function jpegMeta(dir: string, name: string, value: number) {
  const width = 64;
  const height = 64;
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  const bytes = jpeg.encode({ data, width, height }, 100).data;
  const file = path.join(dir, name);
  writeFileSync(file, bytes);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    materialized_path: file,
    width,
    height,
    mime_type: 'image/jpeg',
  };
}

function realDefinition(name: string): ToolDefinition {
  const connection = new PhotoshopConnection({
    detector: { detect: async () => ({ version: 'test', path: 'test', isRunning: true }) },
    platformType: 'win32',
  });
  const definitions = [
    ...createPaintingTools(connection),
    ...createLayerTools(connection),
    ...createStateTools(connection),
  ];
  const found = definitions.find(definition => definition.tool.name === name);
  if (!found) throw new Error(`missing real tool definition for ${name}`);
  return { ...found, tool: withOptionalDocumentId(found.tool) };
}

function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'compact-contract-regression-'));
  dirs.push(dir);
  const registry = new ToolRegistry();
  const dark = jpegMeta(dir, 'dark.jpg', 30);
  const light = jpegMeta(dir, 'light.jpg', 210);
  let previewCalls = 0;
  let regionCalls = 0;
  let strokeCalls = 0;

  const registerReal = (name: string, handler: ToolDefinition['handler']) => {
    const definition = realDefinition(name);
    registry.register(name, { ...definition, handler });
  };

  registerReal('photoshop_get_preview', async () => ({
    content: [{ type: 'text', text: JSON.stringify((previewCalls++ % 2) === 0 ? dark : light) }],
  }));
  registerReal('photoshop_get_state', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true, document: { id: 42 } }) }],
  }));
  registerReal('photoshop_get_layers', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true, layers: [{ id: 7, name: 'Paint' }] }) }],
  }));
  registerReal('photoshop_select_layer_by_name', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true, layer: { id: 7, name: 'Paint' } }) }],
  }));
  registerReal('photoshop_paint_regions', async () => {
    regionCalls += 1;
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, summary: 'regions painted' }) }] };
  });
  registerReal('photoshop_paint_strokes', async () => {
    strokeCalls += 1;
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, summary: 'strokes painted' }) }] };
  });
  registerReal('photoshop_set_brush', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
  }));
  registerReal('photoshop_select_brush_preset', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
  }));
  registerReal('photoshop_create_layer', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true, details: { layerId: 9, layerName: 'New' } }) }],
  }));
  registerReal('photoshop_fill_layer', async () => ({
    content: [{ type: 'text', text: JSON.stringify({ ok: true }) }],
  }));

  const visualMicroPlan = createVisualMicroPlanTools(registry, path.join(dir, 'barriers'))[0]!;
  registry.register(visualMicroPlan.tool.name, visualMicroPlan);

  const readiness = {
    ready: true,
    transport: 'uxp' as const,
    bridge_transport: 'long-poll',
    bridge_revision: UXP_BRIDGE_REVISION,
    expected_bridge_revision: UXP_BRIDGE_REVISION,
    revision_match: true,
    photoshop_version: '27.8',
    document_count: 1,
    active_document: { id: 42, name: 'Test.psd' },
    plugin_connected: true,
    reason: null,
    checked_at: '2026-09-23T00:00:00.000Z',
    cache: { hit: false, age_ms: 0, ttl_ms: 2000 },
  };
  const runtime = new EmbeddedGuardRuntime(registry, {
    runtimeDirectory: path.join(dir, 'controller'),
    previewBarrierDirectory: path.join(dir, 'barriers'),
    executionLeaseFile: path.join(dir, 'execution.lock'),
    workspaceRoot: dir,
    uxpReadinessProbe: async () => structuredClone(readiness),
    uxpStateProbe: async () => ({
      ok: true,
      data: { document: { id: 42 }, activeLayer: { id: 7, name: 'Paint' } },
    }),
  });
  const guard = createGuardTools(runtime);
  const cycle = guard.find(definition => definition.tool.name === 'photoshop_guard_cycle_auto')!;
  const setArtRun = guard.find(definition => definition.tool.name === 'photoshop_guard_set_art_run')!;
  return {
    runtime,
    cycle,
    setArtRun,
    counts: () => ({ previewCalls, regionCalls, strokeCalls }),
  };
}

function regionAction(id = 'region') {
  return {
    id,
    tool: 'photoshop_paint_regions',
    args: {
      regions: [{
        id: `${id}-shape`,
        color: { red: 120, green: 90, blue: 60 },
        contours: [{ points: [{ x: 20, y: 20 }, { x: 120, y: 20 }, { x: 120, y: 120 }] }],
        layer_id: 7,
      }],
    },
  };
}

function strokeAction(id = 'stroke', layerId = 7, tool = 'BRUSH') {
  return {
    id,
    tool: 'photoshop_paint_strokes',
    args: {
      layer_id: layerId,
      strokes: [{
        points: [{ x: 20, y: 20 }, { x: 100, y: 100 }],
        tool,
        color: { red: 120, green: 90, blue: 60 },
        size: 20,
      }],
    },
  };
}

async function body(result: Awaited<ReturnType<ToolDefinition['handler']>>) {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
}

describe('public compact Guard contract regressions', () => {
  it('does not require brush preflight for an early region pass merely because it selects a layer first', async () => {
    const { cycle, setArtRun, counts } = fixture();
    await setArtRun.handler({
      document_id: 42,
      process_dir: 'processes/brush-independent-region-process/run-01',
      painting_profile: 'nontrivial_painting',
      commentary_mode: 'technical',
    });

    const result = await body(await cycle.handler({
      next_pass: {
        request_key: 'region-with-layer-select',
        problem_id: 'initial-mass-layout',
        document_id: 42,
        goal: 'Block the first broad mass on the intended paint layer',
        stage: 'GLOBAL_BLOCK_IN',
        scale: 'global',
        region: 'whole-canvas',
        actions: [
          { id: 'select-paint', tool: 'photoshop_select_layer_by_name', args: { name: 'Paint' } },
          regionAction(),
        ],
      },
    }));

    expect(result.preflight_rejection).toBeUndefined();
    expect(result.execution).toMatchObject({ phase: 'completed', failed: false });
    expect(counts().regionCalls).toBe(1);
  });

  it('still blocks brush-dependent painting until brush preflight exists', async () => {
    const { cycle, setArtRun, counts } = fixture();
    await setArtRun.handler({
      document_id: 42,
      process_dir: 'processes/brush-required-process/run-01',
      painting_profile: 'nontrivial_painting',
      commentary_mode: 'technical',
    });

    const result = await body(await cycle.handler({
      next_pass: {
        request_key: 'brush-without-preflight',
        problem_id: 'model-form',
        document_id: 42,
        goal: 'Model the form with a brush stroke',
        stage: 'FORM',
        scale: 'medium',
        region: 'subject',
        actions: [strokeAction()],
      },
    }));

    expect(result.preflight_rejection?.errors.join('\n')).toMatch(/brush_preflight_required/);
    expect(counts().strokeCalls).toBe(0);
  });

  it('does not require installed-brush preflight for a non-BRUSH stroke mechanism', async () => {
    const { cycle, setArtRun, counts } = fixture();
    await setArtRun.handler({
      document_id: 42,
      process_dir: 'processes/pencil-without-brush-preflight-process/run-01',
      painting_profile: 'nontrivial_painting',
      commentary_mode: 'technical',
    });

    const result = await body(await cycle.handler({
      next_pass: {
        request_key: 'pencil-without-brush-preflight',
        problem_id: 'pencil-edge',
        document_id: 42,
        goal: 'Draw a hard pencil edge without depending on an installed brush role',
        stage: 'EDGE',
        scale: 'medium',
        region: 'subject-edge',
        actions: [strokeAction('pencil-stroke', 7, 'PENCIL')],
      },
    }));

    expect(result.preflight_rejection).toBeUndefined();
    expect(result.execution).toMatchObject({ phase: 'completed', failed: false });
    expect(counts().strokeCalls).toBe(1);
  });

  it('compiles an ordinary local pass with matching BEFORE/AFTER focus previews without subtle_local', async () => {
    const { cycle, setArtRun, counts } = fixture();
    await setArtRun.handler({
      document_id: 42,
      process_dir: 'processes/local-normal-process/run-01',
      painting_profile: 'simple_graphic',
      commentary_mode: 'technical',
    });

    const result = await body(await cycle.handler({
      next_pass: {
        request_key: 'local-normal-pass',
        problem_id: 'silhouette-corner',
        document_id: 42,
        goal: 'Correct one local silhouette corner',
        stage: 'SHAPE',
        scale: 'local',
        significance_mode: 'normal',
        region: 'silhouette-corner',
        region_bounds: { left: 0, top: 0, right: 180, bottom: 180 },
        actions: [regionAction()],
      },
    }));

    expect(result.preflight_rejection).toBeUndefined();
    expect(result.execution).toMatchObject({ phase: 'completed', failed: false });
    expect(result.visual_review?.before).toBeTruthy();
    expect(result.visual_review?.after).toBeTruthy();
    expect(counts().previewCalls).toBe(2);
  });

  it('allows explicit REPLACE of the exact protected target but keeps ADD blocked', async () => {
    const { cycle, setArtRun, counts } = fixture();
    await setArtRun.handler({
      document_id: 42,
      process_dir: 'processes/protected-replace-process/run-01',
      painting_profile: 'simple_graphic',
      commentary_mode: 'technical',
    });

    const replaceResult = await body(await cycle.handler({
      next_pass: {
        request_key: 'protected-replace',
        problem_id: 'protected-silhouette',
        document_id: 42,
        goal: 'Intentionally repaint the protected silhouette layer',
        stage: 'FORM',
        scale: 'medium',
        region: 'subject',
        action_class: 'REPLACE',
        protected_layer_ids: [7],
        replace_protected_layer_ids: [7],
        actions: [strokeAction()],
      },
    }));
    expect(replaceResult.preflight_rejection).toBeUndefined();
    expect(replaceResult.execution).toMatchObject({ phase: 'completed', failed: false });
    expect(counts().strokeCalls).toBe(1);

    const addFixture = fixture();
    await addFixture.setArtRun.handler({
      document_id: 42,
      process_dir: 'processes/protected-add-process/run-01',
      painting_profile: 'simple_graphic',
      commentary_mode: 'technical',
    });
    const addResult = await body(await addFixture.cycle.handler({
      next_pass: {
        request_key: 'protected-add',
        problem_id: 'protected-silhouette',
        document_id: 42,
        goal: 'Ordinary add must not repaint protected content',
        stage: 'FORM',
        scale: 'medium',
        region: 'subject',
        action_class: 'ADD',
        protected_layer_ids: [7],
        replace_protected_layer_ids: [7],
        actions: [strokeAction()],
      },
    }));
    expect(addResult.preflight_rejection?.errors.join('\n')).toMatch(/action_class=REPLACE or ERASE/);
    expect(addFixture.counts().strokeCalls).toBe(0);
  });

  it('keeps request idempotency separate from stable problem identity across attempts', async () => {
    const { cycle, setArtRun, runtime, counts } = fixture();
    await setArtRun.handler({
      document_id: 42,
      process_dir: 'processes/problem-identity-process/run-01',
      painting_profile: 'simple_graphic',
      commentary_mode: 'technical',
    });
    const firstPass = {
      request_key: 'silhouette-attempt-001',
      problem_id: 'main-silhouette',
      document_id: 42,
      goal: 'Repair the main silhouette',
      stage: 'SHAPE',
      scale: 'medium',
      region: 'subject',
      actions: [regionAction('attempt-one')],
    };
    const first = await body(await cycle.handler({ next_pass: firstPass }));
    expect(first.execution).toMatchObject({ phase: 'completed', failed: false });
    const callsAfterFirst = counts().regionCalls;

    await body(await cycle.handler({ next_pass: firstPass }));
    expect(counts().regionCalls).toBe(callsAfterFirst);
    expect(runtime.store.records().filter(record => record.id === 'silhouette-attempt-001')).toHaveLength(1);

    const second = await body(await cycle.handler({
      previous_operation_id: 'silhouette-attempt-001',
      previous_observation: { observed: 'The silhouette changed but remains unresolved.', target: 'unresolved' },
      next_pass: {
        ...firstPass,
        request_key: 'silhouette-attempt-002',
        actions: [regionAction('attempt-two')],
      },
    }));
    expect(second.execution).toMatchObject({ phase: 'completed', failed: false });

    const records = runtime.store.records().filter(record => record.id.startsWith('silhouette-attempt-'));
    expect(records.map(record => record.id)).toEqual(['silhouette-attempt-001', 'silhouette-attempt-002']);
    expect(records.map(record => record.problem_id)).toEqual(['main-silhouette', 'main-silhouette']);
    expect(records[0]?.verdict).toMatchObject({ target_resolved: 'no' });
  });

  it('allows a bounded explicitly targeted late-stage region replacement but still rejects late ADD scaffolding', async () => {
    const { cycle, setArtRun } = fixture();
    await setArtRun.handler({
      document_id: 42,
      process_dir: 'processes/late-region-replace-process/run-01',
      painting_profile: 'simple_graphic',
      commentary_mode: 'technical',
    });
    const corrective = regionAction('late-replace');
    corrective.args.clip_bounds = { left: 0, top: 0, right: 180, bottom: 180 };
    const replaceResult = await body(await cycle.handler({
      next_pass: {
        request_key: 'late-region-replace',
        problem_id: 'silhouette-late-fix',
        document_id: 42,
        goal: 'Replace a bounded silhouette patch without reopening block-in',
        stage: 'FORM',
        scale: 'medium',
        region: 'silhouette',
        action_class: 'REPLACE',
        actions: [corrective],
      },
    }));
    expect(replaceResult.preflight_rejection).toBeUndefined();

    const blockedFixture = fixture();
    await blockedFixture.setArtRun.handler({
      document_id: 42,
      process_dir: 'processes/late-region-add-process/run-01',
      painting_profile: 'simple_graphic',
      commentary_mode: 'technical',
    });
    const lateAdd = regionAction('late-add');
    lateAdd.args.clip_bounds = { left: 0, top: 0, right: 180, bottom: 180 };
    const addResult = await body(await blockedFixture.cycle.handler({
      next_pass: {
        request_key: 'late-region-add',
        problem_id: 'late-block-in',
        document_id: 42,
        goal: 'Do more broad block-in at FORM',
        stage: 'FORM',
        scale: 'medium',
        region: 'subject',
        action_class: 'ADD',
        actions: [lateAdd],
      },
    }));
    expect(addResult.preflight_rejection?.errors.join('\n')).toMatch(/paint_regions.*block-in|late-stage/i);
  });
});
