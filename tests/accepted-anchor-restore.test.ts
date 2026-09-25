import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { ToolRegistry } from '../src/core/tool-registry.js';
import { EmbeddedGuardRuntime } from '../src/core/guard/runtime.js';
import { UXP_BRIDGE_REVISION } from '../src/core/guard/protocol-version.js';
import { createGuardTools } from '../src/tools/guard-tools.js';

const dirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function jpegFrame(dir: string, name: string, value: number) {
  const width = 32;
  const height = 32;
  const data = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    const offset = index * 4;
    data[offset] = value;
    data[offset + 1] = value;
    data[offset + 2] = value;
    data[offset + 3] = 255;
  }
  const bytes = jpeg.encode({ data, width, height }, 100).data;
  const file = path.join(dir, name);
  writeFileSync(file, bytes);
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    materialized_path: file,
    width,
    height,
    canvas_width: width,
    canvas_height: height,
    document_id: 42,
    mime_type: 'image/jpeg',
  };
}

function record(
  id: string,
  sequence: number,
  preview: Record<string, unknown>,
  historySteps: number
) {
  return {
    id,
    tool: 'photoshop_execute_visual_microplan',
    args: {
      document_id: 42,
      steps: [{
        id: 'guard_after_preview',
        tool: 'photoshop_get_preview',
        args: { max_dimension_px: 1000, quality: 8 },
      }],
    },
    summary: `Visual mutation ${id}`,
    purpose: 'Task 21a restore fixture.',
    hash: `hash-${id}`,
    sequence,
    created_at: new Date(sequence * 1000).toISOString(),
    completed_at: new Date(sequence * 1000 + 100).toISOString(),
    phase: 'completed',
    execution: 'completed',
    visual: true,
    failed: false,
    preview,
    report: {
      id,
      did: `Executed ${id}.`,
      why: 'Populate a fully closed historical visual record for anchor recovery.',
      result: 'The synthetic visual operation completed and was classified.',
      source: 'guard_execution',
      recorded_at: new Date(sequence * 1000 + 150).toISOString(),
      delivery: 'technical_execution_record',
    },
    result: {
      content: [{
        type: 'text',
        text: JSON.stringify({
          ok: true,
          history_steps: historySteps,
          mutation_results: {
            paint: { history_steps: historySteps },
          },
        }),
      }],
    },
    verdict: {
      verdict: 'improvement',
      disposition: 'accept',
      target_resolved: 'yes',
      significance: { execution_effect: 'material' },
      at: new Date(sequence * 1000 + 200).toISOString(),
    },
  };
}

function anchorSnapshot(witness: Record<string, unknown>) {
  return {
    protocol: 'photoshop.guard.anchor_restore_snapshot.v1',
    document_id: 42,
    captured_at: '2026-09-25T00:00:00.000Z',
    document_instance_witness: witness,
    layer_count: 2,
    layers: [
      { id: 11, name: 'Paint', path: 'Paint', depth: 0, kind: 'LayerKind.NORMAL', typename: 'ArtLayer', visible: true, opacity: 82, blend_mode: 'BlendMode.NORMAL' },
      { id: 10, name: 'Background', path: 'Background', depth: 0, kind: 'LayerKind.NORMAL', typename: 'ArtLayer', visible: true, opacity: 100, blend_mode: 'BlendMode.NORMAL' },
    ],
    active_layer: { id: 11, name: 'Paint', kind: 'LayerKind.NORMAL', visible: true, opacity: 82, blend_mode: 'BlendMode.NORMAL', locked: false, is_background: false },
    selection: { has_selection: true, bounds: { left: 5, top: 6, right: 24, bottom: 25 } },
  };
}

function restoreFixture(options: { staleAnchor?: boolean; parityMismatch?: boolean } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'accepted-anchor-restore-'));
  dirs.push(dir);
  const anchor = jpegFrame(dir, 'anchor.jpg', 70);
  const degraded = jpegFrame(dir, 'degraded.jpg', 190);
  const witness = {
    protocol: 'photoshop.uxp.document_instance_witness.v1',
    session_id: 'restore-test-session',
    token: 'restore-test-session:1',
  };
  const snapshot = anchorSnapshot(witness);
  const registry = new ToolRegistry();
  const undoCalls: Array<Record<string, unknown>> = [];
  const previewCalls: Array<Record<string, unknown>> = [];

  registry.register('photoshop_get_preview', {
    tool: {
      name: 'photoshop_get_preview',
      description: 'restore fixture preview',
      inputSchema: { type: 'object', properties: { document_id: { type: 'number' }, materialize_path: { type: 'string' }, include_image: { type: 'boolean' }, max_dimension_px: { type: 'number' }, quality: { type: 'number' } } },
    },
    handler: async (args) => {
      previewCalls.push(structuredClone(args));
      const target = typeof args.materialize_path === 'string'
        ? args.materialize_path
        : path.join(dir, 'fallback-preview.jpg');
      const source = /-after\.jpg$/i.test(String(target)) ? anchor : degraded;
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source.bytes);
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...source, materialized_path: target }) }],
      };
    },
  });
  registry.register('photoshop_undo', {
    tool: {
      name: 'photoshop_undo',
      description: 'restore fixture undo',
      inputSchema: { type: 'object', properties: { document_id: { type: 'number' }, steps: { type: 'number', minimum: 1 } } },
    },
    handler: async (args) => {
      undoCalls.push(structuredClone(args));
      return {
        content: [{ type: 'text', text: JSON.stringify({ ok: true, summary: 'Undo applied', undo_history_states_consumed: args.steps }) }],
      };
    },
  });
  registry.register('photoshop_get_state', {
    tool: { name: 'photoshop_get_state', description: 'restore fixture state', inputSchema: { type: 'object', properties: { document_id: { type: 'number' } } } },
    handler: async () => ({
      content: [{ type: 'text', text: JSON.stringify({
        ok: true,
        hasDocument: true,
        document: { id: 42, instanceWitness: witness, hasSelection: true },
        activeLayer: options.parityMismatch
          ? { id: 99, name: 'Wrong', kind: 'LayerKind.NORMAL', visible: true, opacity: 100, blendMode: 'BlendMode.NORMAL', locked: false, isBackground: false }
          : { id: 11, name: 'Paint', kind: 'LayerKind.NORMAL', visible: true, opacity: 82, blendMode: 'BlendMode.NORMAL', locked: false, isBackground: false },
      }) }],
    }),
  });
  registry.register('photoshop_get_layers', {
    tool: { name: 'photoshop_get_layers', description: 'restore fixture layers', inputSchema: { type: 'object', properties: { document_id: { type: 'number' } } } },
    handler: async () => ({
      content: [{ type: 'text', text: JSON.stringify({
        ok: true,
        summary: 'Listed 2 layers',
        details: {
          layerCount: 2,
          layers: [
            { id: 11, name: 'Paint', path: 'Paint', depth: 0, kind: 'LayerKind.NORMAL', typename: 'ArtLayer', visible: true, opacity: 82, blendMode: 'BlendMode.NORMAL' },
            { id: 10, name: 'Background', path: 'Background', depth: 0, kind: 'LayerKind.NORMAL', typename: 'ArtLayer', visible: true, opacity: 100, blendMode: 'BlendMode.NORMAL' },
          ],
          context: { document: { id: 42 } },
        },
      }) }],
    }),
  });
  registry.register('photoshop_get_selection_bounds', {
    tool: { name: 'photoshop_get_selection_bounds', description: 'restore fixture selection', inputSchema: { type: 'object', properties: { document_id: { type: 'number' } } } },
    handler: async () => ({
      content: [{ type: 'text', text: JSON.stringify({
        ok: true,
        summary: 'Selection present',
        details: {
          has_selection: true,
          bounds: { left: 5, top: 6, right: 24, bottom: 25 },
          context: { document: { id: 42 } },
        },
      }) }],
    }),
  });

  const runtime = new EmbeddedGuardRuntime(registry, {
    runtimeDirectory: path.join(dir, 'controller'),
    previewBarrierDirectory: path.join(dir, 'barriers'),
    executionLeaseFile: path.join(dir, 'execution.lock'),
    workspaceRoot: dir,
    uxpReadinessProbe: async () => ({
      ready: true,
      transport: 'uxp',
      bridge_transport: 'long-poll',
      bridge_revision: UXP_BRIDGE_REVISION,
      expected_bridge_revision: UXP_BRIDGE_REVISION,
      revision_match: true,
      photoshop_version: '27.0.1',
      document_count: 1,
      active_document: { id: 42, name: 'Restore.psd' },
      plugin_connected: true,
      reason: null,
      checked_at: new Date().toISOString(),
      cache: { hit: false, age_ms: 0, ttl_ms: 2000 },
    }),
    uxpStateProbe: async () => ({
      ok: true,
      data: { document: { id: 42, instanceWitness: witness } },
    }),
  });

  runtime.store.write(record('anchor-op', 1, anchor, 1));
  runtime.store.updatePaintingState(42, current => ({
    ...current,
    document_id: 42,
    document_instance: { protocol: 'photoshop.guard.document_instance.v1', host_witness: witness },
    current_frame: { operation_id: 'anchor-op', sha256: anchor.sha256, path: anchor.materialized_path, accepted: true },
    accepted_frame: { operation_id: 'anchor-op', sha256: anchor.sha256, path: anchor.materialized_path, accepted: true },
    primary_artistic_anchor: { operation_id: 'anchor-op', sha256: anchor.sha256, path: anchor.materialized_path },
  }));
  runtime.store.attachAnchorRestoreSnapshot(42, 'anchor-op', snapshot);
  runtime.store.write(record('later-multi-history', 2, degraded, 3));
  runtime.store.write(record('later-second-pass', 3, degraded, 2));
  runtime.store.updatePaintingState(42, current => ({
    ...current,
    current_frame: { operation_id: 'later-second-pass', sha256: degraded.sha256, path: degraded.materialized_path, accepted: false },
  }));
  if (options.staleAnchor) writeFileSync(anchor.materialized_path, degraded.bytes);

  return { dir, runtime, anchor, degraded, undoCalls, previewCalls };
}

describe('Task 21a one-action accepted-anchor recovery', () => {
  it('exposes restore and restore-snapshot registration on the compact public Guard schema', () => {
    const f = restoreFixture();
    const tools = createGuardTools(f.runtime);
    const cycle = tools.find(definition => definition.tool.name === 'photoshop_guard_cycle_auto')!.tool as any;
    const artDirector = tools.find(definition => definition.tool.name === 'photoshop_guard_art_director')!.tool as any;
    expect(cycle.inputSchema.properties.next_pass.properties.restore_anchor_operation_id).toBeTruthy();
    expect(cycle.inputSchema.properties.next_pass.required).not.toContain('actions');
    expect(artDirector.inputSchema.properties.anchor_decision.properties.capture_restore_state).toBeTruthy();
  });

  it('captures normalized pinned layer/active-layer/selection state through the runtime read path', async () => {
    const f = restoreFixture();
    const snapshot = await (f.runtime as any).captureAnchorRestoreSnapshot(42);
    expect(snapshot).toMatchObject({
      protocol: 'photoshop.guard.anchor_restore_snapshot.v1',
      document_id: 42,
      layer_count: 2,
      active_layer: { id: 11, name: 'Paint', opacity: 82 },
      selection: {
        has_selection: true,
        bounds: { left: 5, top: 6, right: 24, bottom: 25 },
      },
    });
    expect(snapshot.layers.map((layer: any) => layer.id)).toEqual([11, 10]);
  });

  it('restores an older accepted anchor in one compact Guard request with internal history arithmetic and exact state verification', async () => {
    const f = restoreFixture();
    const response = await f.runtime.cycle({
      next_pass: {
        request_key: 'restore-anchor-request-01',
        document_id: 42,
        goal: 'Restore the last registered accepted artistic anchor exactly.',
        restore_anchor_operation_id: 'anchor-op',
      },
    });

    expect(f.undoCalls).toHaveLength(1);
    expect(f.undoCalls[0]).toMatchObject({ document_id: 42, steps: 5 });
    expect(f.previewCalls.at(-1)).toMatchObject({
      document_id: 42,
      max_dimension_px: 1000,
      quality: 8,
    });
    expect(response.accepted_anchor_restore).toMatchObject({
      completed: true,
      anchor_operation_id: 'anchor-op',
      anchor_sha256: f.anchor.sha256,
      exact_preview_sha_restored: true,
      mutation_replayed: false,
      model_supplied_undo_steps: false,
      state_verification: {
        matches: true,
        layer_state_matches: true,
        active_layer_matches: true,
        selection_matches: true,
      },
    });
    const restoreRecord = f.runtime.store.read('restore-anchor-request-01')!;
    expect(restoreRecord.preview_args).toEqual({ max_dimension_px: 1000, quality: 8 });
    expect(restoreRecord.preview.sha256).toBe(f.anchor.sha256);
    expect(restoreRecord.report).toBeTruthy();
    expect(restoreRecord.operation_ack).toBeTruthy();
    expect(restoreRecord.verdict?.recovery).toMatchObject({
      anchor_operation_id: 'anchor-op',
      anchor_sha256: f.anchor.sha256,
    });
    expect(f.runtime.store.artRunState(42, undefined)?.last_anchor_restore).toMatchObject({
      restore_operation_id: 'restore-anchor-request-01',
      anchor_operation_id: 'anchor-op',
      anchor_sha256: f.anchor.sha256,
    });
    const status = f.runtime.status() as any;
    expect(status.pending_reports).toEqual([]);
    expect(status.pending_operation_acks).toEqual([]);
    expect(status.pending_visual_verdicts).toEqual([]);
    expect(status.uncertain).toEqual([]);
    expect(status.documents['42'].visual_barrier).toBeNull();
  });

  it('rejects a missing or stale anchor before any Photoshop undo dispatch', async () => {
    const missing = restoreFixture();
    const missingResponse = await missing.runtime.cycle({
      next_pass: {
        request_key: 'restore-missing-anchor',
        document_id: 42,
        goal: 'Restore a missing anchor.',
        restore_anchor_operation_id: 'not-an-anchor',
      },
    });
    expect(missing.undoCalls).toHaveLength(0);
    expect(JSON.stringify(missingResponse)).toMatch(/accepted_anchor_restore_unknown_anchor/);

    const stale = restoreFixture({ staleAnchor: true });
    const staleResponse = await stale.runtime.cycle({
      next_pass: {
        request_key: 'restore-stale-anchor',
        document_id: 42,
        goal: 'Restore a stale anchor.',
        restore_anchor_operation_id: 'anchor-op',
      },
    });
    expect(stale.undoCalls).toHaveLength(0);
    expect(JSON.stringify(staleResponse)).toMatch(/accepted_anchor_restore_stale_anchor/);
  });

  it('rejects ambiguous later undo history and rejects restore requests mixed with new actions before dispatch', async () => {
    const ambiguous = restoreFixture();
    ambiguous.runtime.store.write({
      id: 'manual-later-undo',
      tool: 'photoshop_undo',
      args: { document_id: 42, steps: 1 },
      summary: 'Later undo makes history ambiguous.',
      purpose: 'Task 21a ambiguity fixture.',
      hash: 'manual-later-undo',
      sequence: 4,
      created_at: '2026-09-25T00:00:04.000Z',
      completed_at: '2026-09-25T00:00:04.100Z',
      phase: 'completed',
      execution: 'completed',
      visual: true,
      failed: false,
      report: {
        did: 'Executed a later undo.',
        why: 'Create an ambiguous history branch for the restore test.',
        result: 'History no longer has a simple forward-only journal suffix.',
      },
      verdict: {
        verdict: 'neutral',
        disposition: 'accept',
        target_resolved: 'yes',
        significance: { execution_effect: 'material' },
      },
    });
    const ambiguousResponse = await ambiguous.runtime.cycle({
      next_pass: {
        request_key: 'restore-ambiguous-history',
        document_id: 42,
        goal: 'Restore without guessing across an existing undo branch.',
        restore_anchor_operation_id: 'anchor-op',
      },
    });
    expect(ambiguous.undoCalls).toHaveLength(0);
    expect(JSON.stringify(ambiguousResponse)).toMatch(/accepted_anchor_restore_ambiguous_history/);

    const mixed = restoreFixture();
    const mixedResponse = await mixed.runtime.cycle({
      next_pass: {
        request_key: 'restore-with-extra-action',
        document_id: 42,
        goal: 'Restore only; no new mutation may be bundled into this recovery.',
        restore_anchor_operation_id: 'anchor-op',
        actions: [{ id: 'extra', tool: 'photoshop_undo', args: { steps: 1 } }],
      },
    });
    expect(mixed.undoCalls).toHaveLength(0);
    expect(JSON.stringify(mixedResponse)).toMatch(/accepted_anchor_restore_actions_forbidden/);
  });

  it('does not declare recovery complete when post-undo layered state differs from the registered snapshot', async () => {
    const f = restoreFixture({ parityMismatch: true });
    await expect(f.runtime.cycle({
      next_pass: {
        request_key: 'restore-parity-mismatch',
        document_id: 42,
        goal: 'Restore anchor but reject wrong active-layer state.',
        restore_anchor_operation_id: 'anchor-op',
      },
    })).rejects.toThrow(/accepted_anchor_restore_state_mismatch/);
    expect(f.undoCalls).toHaveLength(1);
    const recordAfter = f.runtime.store.read('restore-parity-mismatch')!;
    expect(recordAfter.verdict).toBeUndefined();
    expect(recordAfter.operation_receipt).toBeTruthy();
  });

  it('derives the same restore depth from the same degraded fixture after Guard restart', () => {
    const f = restoreFixture();
    const before = f.runtime.store.planAcceptedAnchorRestore(42, 'anchor-op', undefined, undefined);
    const restarted = new EmbeddedGuardRuntime((f.runtime as any).registry ?? new ToolRegistry(), {
      runtimeDirectory: path.join(f.dir, 'controller'),
      previewBarrierDirectory: path.join(f.dir, 'barriers'),
      executionLeaseFile: path.join(f.dir, 'execution.lock'),
      workspaceRoot: f.dir,
    });
    const after = restarted.store.planAcceptedAnchorRestore(42, 'anchor-op', undefined, undefined);
    expect(after.required_undo_steps).toBe(before.required_undo_steps);
    expect(after.history_operation_ids).toEqual(before.history_operation_ids);
  });
});
