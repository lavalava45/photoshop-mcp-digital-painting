import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/core/guard/session-store.js';
import { RUNTIME_STATE_VERSION } from '../src/core/guard/protocol-version.js';
import {
  createRuntimeStateArchive,
  cutoverRuntimeStateV2,
} from '../src/core/guard/runtime-state.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

describe('runtime-state v2 boundary and archive cutover', () => {
  it('initializes a genuinely empty runtime as v2 with zero inherited Guard debt', () => {
    const root = tempRoot('runtime-v2-clean-');
    const controller = path.join(root, 'controller');
    const barriers = path.join(root, 'preview-barriers');
    const store = new SessionStore(controller, { visualBarrierDirectory: barriers, workspaceRoot: root });

    const manifest = JSON.parse(readFileSync(path.join(controller, 'runtime-state.json'), 'utf8'));
    const painting = store.paintingState();
    const status = store.statusCompact();

    expect(manifest.schema_version).toBe(RUNTIME_STATE_VERSION);
    expect(painting).toMatchObject({ schema_version: RUNTIME_STATE_VERSION, version: 2, revision: 0, documents: {} });
    expect(status.pending_reports).toEqual([]);
    expect(status.pending_operation_acks).toEqual([]);
    expect(status.pending_visual_verdicts).toEqual([]);
    expect(status.uncertain).toEqual([]);
    expect(status.documents).toEqual({});
  });

  it('rejects an old active-state directory instead of inferring or upgrading it', () => {
    const root = tempRoot('runtime-v1-reject-');
    const controller = path.join(root, 'controller');
    mkdirSync(controller, { recursive: true });
    writeFileSync(path.join(controller, 'painting-state.json'), JSON.stringify({ version: 1, revision: 8, documents: {} }));

    expect(() => new SessionStore(controller, { workspaceRoot: root }))
      .toThrow(/runtime_state_schema_mismatch.*received missing/);
    expect(JSON.parse(readFileSync(path.join(controller, 'painting-state.json'), 'utf8')).version).toBe(1);
    expect(existsSync(path.join(controller, 'runtime-state.json'))).toBe(false);
  });

  it('rejects mismatched painting state and versionless journal records deterministically', () => {
    const root = tempRoot('runtime-v2-mismatch-');
    const controller = path.join(root, 'controller');
    const store = new SessionStore(controller, { workspaceRoot: root });
    writeFileSync(store.paintingStateFile(), JSON.stringify({ schema_version: 'photoshop.guard.runtime-state.v1', version: 1, revision: 1, documents: {} }));
    expect(() => store.paintingState()).toThrow(/runtime_state_schema_mismatch.*runtime-state\.v1/);

    writeFileSync(store.paintingStateFile(), JSON.stringify({ schema_version: RUNTIME_STATE_VERSION, version: 2, revision: 0, documents: {} }));
    mkdirSync(path.dirname(store.file('old-op')), { recursive: true });
    writeFileSync(store.file('old-op'), JSON.stringify({
      id: 'old-op', phase: 'completed', created_at: new Date().toISOString(), tool: 'photoshop_get_state', args: {},
    }));
    expect(() => store.read('old-op')).toThrow(/runtime_state_schema_mismatch/);
    expect(() => store.records()).toThrow(/runtime_state_schema_mismatch/);
  });

  it('archives bytes, line counts and hashes without mutating the source', () => {
    const root = tempRoot('runtime-archive-');
    const runtimeRoot = path.join(root, '.photoshop-runtime');
    const controller = path.join(runtimeRoot, 'controller');
    const store = new SessionStore(controller, { workspaceRoot: root });
    store.write({
      id: 'archived-op', phase: 'completed', created_at: new Date().toISOString(), tool: 'photoshop_get_state', args: {},
    });
    const runState = path.join(root, 'processes', 'archive-process', 'run-01', 'painting-state.json');
    mkdirSync(path.dirname(runState), { recursive: true });
    writeFileSync(runState, '{\n  "diagnostic": true\n}\n');
    const sourceBefore = readFileSync(store.file('archived-op'));
    const archiveDirectory = path.join(root, 'archives', 'before-v2');

    const manifest = createRuntimeStateArchive({ runtimeRoot, archiveDirectory, runStateFiles: [runState] });

    expect(manifest.verified).toBe(true);
    expect(manifest.totals.files).toBeGreaterThanOrEqual(4);
    expect(manifest.totals.bytes).toBeGreaterThan(0);
    expect(manifest.totals.lines).toBeGreaterThan(0);
    expect(manifest.runtime.every(row => /^[a-f0-9]{64}$/.test(row.sha256))).toBe(true);
    expect(manifest.run_state).toHaveLength(1);
    expect(readFileSync(store.file('archived-op'))).toEqual(sourceBefore);
    expect(existsSync(path.join(archiveDirectory, 'archive-manifest.json'))).toBe(true);
  });

  it('cuts over only after a verified archive and starts a debt-free v2 runtime while preserving old state', () => {
    const root = tempRoot('runtime-cutover-');
    const runtimeRoot = path.join(root, '.photoshop-runtime');
    const oldController = path.join(runtimeRoot, 'controller');
    mkdirSync(path.join(oldController, 'operations'), { recursive: true });
    writeFileSync(path.join(oldController, 'painting-state.json'), JSON.stringify({ version: 1, revision: 3, documents: { '42': { document_id: 42 } } }));
    writeFileSync(path.join(oldController, 'operations', 'legacy.json'), JSON.stringify({ id: 'legacy', phase: 'uncertain', created_at: new Date().toISOString() }));
    mkdirSync(path.join(runtimeRoot, 'preview-barriers'), { recursive: true });
    writeFileSync(path.join(runtimeRoot, 'preview-barriers', '42.json'), '{"planId":"legacy","requiresExternalPreview":true}\n');
    writeFileSync(path.join(runtimeRoot, 'execution.lock'), '{"legacy":true}\n');
    const archiveDirectory = path.join(root, 'archives', 'cutover');

    const manifest = cutoverRuntimeStateV2({ runtimeRoot, archiveDirectory });
    expect(manifest.verified).toBe(true);
    expect(manifest.source_runtime_state_version).toBe('missing');
    expect(existsSync(path.join(archiveDirectory, 'runtime', 'controller', 'operations', 'legacy.json'))).toBe(true);
    expect(existsSync(path.join(archiveDirectory, 'retired-active-runtime', 'controller', 'operations', 'legacy.json'))).toBe(true);

    const current = new SessionStore(path.join(runtimeRoot, 'controller'), {
      visualBarrierDirectory: path.join(runtimeRoot, 'preview-barriers'),
      workspaceRoot: root,
    });
    const status = current.statusCompact();
    expect(current.records()).toEqual([]);
    expect(current.paintingState()).toMatchObject({ schema_version: RUNTIME_STATE_VERSION, version: 2, revision: 0, documents: {} });
    expect(status.pending_reports).toEqual([]);
    expect(status.pending_operation_acks).toEqual([]);
    expect(status.pending_visual_verdicts).toEqual([]);
    expect(status.uncertain).toEqual([]);
    expect(existsSync(path.join(runtimeRoot, 'execution.lock'))).toBe(false);
    expect(existsSync(path.join(runtimeRoot, 'preview-barriers', '42.json'))).toBe(false);
  });
});
