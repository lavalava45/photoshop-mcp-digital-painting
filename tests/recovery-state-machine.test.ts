import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/core/guard/session-store.js';
import { createJob, updateJob, writeJobStarted } from '../src/core/guard/async-job.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function store() {
  const dir = mkdtempSync(path.join(tmpdir(), 'recovery-state-machine-'));
  dirs.push(dir);
  return {
    dir,
    controller: path.join(dir, 'controller'),
    store: new SessionStore(path.join(dir, 'controller'), {
      visualBarrierDirectory: path.join(dir, 'barriers'),
      workspaceRoot: dir,
    }),
  };
}

function record(id: string, patch: Record<string, unknown> = {}) {
  const sequence = Number(patch.sequence ?? 1);
  return {
    id,
    tool: 'photoshop_set_layer_opacity',
    args: { document_id: 42, opacity: 50 },
    summary: 'Recovery state fixture ' + id,
    purpose: 'Exercise one deterministic recovery state',
    hash: 'hash-' + id,
    sequence,
    created_at: new Date(1_800_000_000_000 + sequence * 1000).toISOString(),
    phase: 'uncertain',
    visual: false,
    failed: true,
    dispatched: true,
    ...patch,
  };
}

function successfulRead(
  id: string,
  tool: 'photoshop_get_state' | 'photoshop_get_preview' | 'photoshop_list_documents',
  sequence: number,
  body: Record<string, unknown>
) {
  return record(id, {
    tool,
    args: { document_id: 42 },
    sequence,
    phase: 'completed',
    visual: false,
    failed: false,
    dispatched: false,
    completed_at: new Date(1_800_000_000_000 + sequence * 1000 + 1).toISOString(),
    result: { content: [{ type: 'text', text: JSON.stringify(body) }] },
    ...(tool === 'photoshop_get_preview' ? {
      preview: {
        sha256: 'a'.repeat(64),
        materialized_path: '/tmp/recovery-preview.jpg',
        document_id: 42,
      },
    } : {}),
  });
}

function expectCanonicalAgreement(s: SessionStore, documentId: number | null = 42) {
  const first = s.statusCompact() as any;
  const resumed = s.resume(documentId ?? undefined) as any;
  expect(resumed.next_required_action).toBe(first.next_required_action);
  const second = s.statusCompact() as any;
  expect(second.next_required_action).toBe(first.next_required_action);
  return first.next_required_action as string;
}

function resolveWithFreshEvidence(s: SessionStore, id: string, outcome: 'completed' | 'partial' = 'completed') {
  s.write(successfulRead(id + '-state', 'photoshop_get_state', 20, {
    ok: true,
    document: { id: 42 },
  }));
  s.write(successfulRead(id + '-preview', 'photoshop_get_preview', 21, {
    ok: true,
    sha256: 'a'.repeat(64),
    materialized_path: '/tmp/recovery-preview.jpg',
  }));
  return s.reconcile({
    id,
    outcome,
    reason: 'Fresh state and preview evidence establish the bounded recovery outcome.',
    state_id: id + '-state',
    preview_id: id + '-preview',
  });
}

describe('recovery state machine repository harness', () => {
  const uncertainCases = [
    {
      name: 'uncertain dispatched mutation',
      id: 'uncertain-dispatched',
      patch: { phase: 'uncertain', dispatched: true, visual: false },
    },
    {
      name: 'timeout after possible partial execution',
      id: 'timeout-after-possible-partial',
      patch: {
        phase: 'uncertain',
        dispatched: true,
        visual: false,
        error: 'timeout after dispatch; execution outcome unknown',
      },
      outcome: 'partial' as const,
    },
    {
      name: 'failed checkpoint',
      id: 'failed-checkpoint',
      patch: {
        tool: 'photoshop_save_document',
        args: { document_id: 42, path: '/missing/checkpoint.psd', format: 'PSD' },
        phase: 'uncertain',
        failed: true,
        checkpoint_error: 'PSD file was not verified on disk',
      },
    },
  ];

  for (const scenario of uncertainCases) {
    it(scenario.name + ' has one reconcile action and terminates uncertainty with obtainable evidence', () => {
      const { store: s } = store();
      s.write(record(scenario.id, scenario.patch));
      expect(expectCanonicalAgreement(s)).toBe('reconcile uncertain operation ' + scenario.id);

      resolveWithFreshEvidence(s, scenario.id, scenario.outcome ?? 'completed');
      const compact = s.statusCompact() as any;
      expect(compact.uncertain).not.toContain(scenario.id);
      expect(s.read(scenario.id)?.resolved?.outcome).toBe(scenario.outcome ?? 'completed');
      expect(expectCanonicalAgreement(s)).not.toBe('reconcile uncertain operation ' + scenario.id);
    });
  }

  it('timeout before dispatch uses durable not-executed proof and never becomes false uncertainty', () => {
    const { store: s } = store();
    s.write(record('timeout-before-dispatch', {
      dispatched: false,
      phase: 'uncertain',
      result: {
        isError: true,
        content: [{
          type: 'text',
          text: JSON.stringify({
            ok: false,
            code: 'method_execution_preflight_failed',
            execution: 'not-executed',
            visual_mutation_started: false,
          }),
        }],
      },
    }));

    const action = expectCanonicalAgreement(s);
    expect(action).toBe('ready');
    const terminal = s.read('timeout-before-dispatch')!;
    expect(terminal).toMatchObject({
      phase: 'completed',
      visual: false,
      execution: 'not-executed',
    });
    expect((s.statusCompact() as any).uncertain).not.toContain('timeout-before-dispatch');
  });

  it('successful non-visual lifecycle completion never becomes false uncertainty', () => {
    const { store: s } = store();
    const pending = record('successful-close', {
      tool: 'photoshop_close_document',
      args: { document_id: 42, save: false },
      phase: 'dispatched',
      visual: false,
      failed: false,
    });
    s.write(pending);
    const completed = s.complete(pending, {
      content: [{
        type: 'text',
        text: JSON.stringify({ ok: true, summary: 'document closed successfully' }),
      }],
    });
    expect(completed).toMatchObject({
      phase: 'completed',
      failed: false,
      visual: false,
    });
    expect(completed.execution).not.toBe('uncertain');
    expect((s.statusCompact() as any).uncertain).not.toContain('successful-close');
  });

  it('recovery preview unavailable yields exactly preview acquisition debt rather than replay', () => {
    const { store: s } = store();
    s.write(record('preview-unavailable', {
      phase: 'completed',
      failed: false,
      visual: true,
      result: { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] },
      operation_receipt: {
        protocol: 'photoshop.guard.operation_receipt.v1',
        operation_id: 'preview-unavailable',
        token: 'receipt-preview-unavailable',
        issued_at: new Date().toISOString(),
      },
    }));
    expect(expectCanonicalAgreement(s)).toBe(
      'obtain recovery/required preview for preview-unavailable before compact finalization'
    );
    expect((s.statusCompact() as any).uncertain).not.toContain('preview-unavailable');
  });

  for (const mode of ['intentional', 'unexpected'] as const) {
    it(mode + ' document disappearance terminates only from fresh absence evidence plus explicit confirmation', () => {
      const { store: s } = store();
      const id = mode + '-document-disappearance';
      s.write(record(id, { phase: 'uncertain', visual: true }));
      s.write(record(id + '-documents', {
        ...successfulRead(id + '-documents', 'photoshop_list_documents', 10, {
          ok: true,
          documents: [],
        }),
        args: {},
      }));
      expect(expectCanonicalAgreement(s)).toBe('reconcile uncertain operation ' + id);

      s.reconcile({
        id,
        outcome: 'abandoned',
        reason: mode === 'intentional'
          ? 'The user explicitly confirmed the target document was intentionally closed.'
          : 'The target disappeared unexpectedly and the user confirmed it is no longer open.',
        document_closed_confirmed: true,
        documents_id: id + '-documents',
      });
      expect((s.statusCompact() as any).uncertain).not.toContain(id);
      expect(s.read(id)?.resolved).toMatchObject({
        outcome: 'abandoned',
        evidence_mode: 'document_absent',
      });
      expect(expectCanonicalAgreement(s)).toBe('ready');
    });
  }

  it('stale or missing recovery evidence cannot invent an outcome and does not oscillate', () => {
    const { store: s } = store();
    s.write(record('stale-evidence', { sequence: 10 }));
    s.write(successfulRead('stale-state', 'photoshop_get_state', 2, { ok: true, document: { id: 42 } }));
    s.write(successfulRead('stale-preview', 'photoshop_get_preview', 3, {
      ok: true,
      sha256: 'a'.repeat(64),
      materialized_path: '/tmp/stale.jpg',
    }));

    expect(() => s.reconcile({
      id: 'stale-evidence',
      outcome: 'completed',
      reason: 'Attempting recovery with deliberately stale evidence for the repository harness.',
      state_id: 'stale-state',
      preview_id: 'stale-preview',
    })).toThrow(/Fresh successful state and preview records|required.*follow/i);
    expect(() => s.reconcile({
      id: 'stale-evidence',
      outcome: 'completed',
      reason: 'Attempting recovery with deliberately missing evidence for the repository harness.',
      state_id: 'missing-state',
      preview_id: 'missing-preview',
    })).toThrow(/Fresh successful state and preview records/);
    expect(expectCanonicalAgreement(s)).toBe('reconcile uncertain operation stale-evidence');
    expect(expectCanonicalAgreement(s)).toBe('reconcile uncertain operation stale-evidence');
  });

  it('restart with closure debt has one compact finalization action and no uncertainty', () => {
    const { dir, controller, store: first } = store();
    first.write(record('closure-debt', {
      phase: 'completed',
      failed: false,
      visual: false,
      result: { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] },
      operation_receipt: {
        protocol: 'photoshop.guard.operation_receipt.v1',
        operation_id: 'closure-debt',
        token: 'closure-token',
        issued_at: new Date().toISOString(),
      },
    }));
    const restarted = new SessionStore(controller, {
      visualBarrierDirectory: path.join(dir, 'barriers'),
      workspaceRoot: dir,
    });
    const action = expectCanonicalAgreement(restarted);
    expect(action).toContain('previous_operation_id=closure-debt');
    expect(action).toContain('previous_observation');
    expect(action).not.toContain('previous_report');
    expect(action).not.toContain('previous_operation_ack');
    expect((restarted.statusCompact() as any).uncertain).not.toContain('closure-debt');
  });

  for (const jobState of ['running', 'stalled', 'uncertain'] as const) {
    it('restart with ' + jobState + ' async job yields only the durable poll action', () => {
      const { controller, store: s } = store();
      const created = createJob(controller, {
        next_operation: {
          id: 'job-operation-' + jobState,
          tool: 'photoshop_set_layer_opacity',
          args: { document_id: 42, opacity: 50 },
          summary: 'Async ' + jobState,
          purpose: 'Recovery harness async state',
          timeout_ms: 60_000,
        },
      }, { text: 'recovery harness' });

      if (jobState === 'running') {
        writeJobStarted(created.dir, { pid: process.pid });
      } else if (jobState === 'stalled') {
        writeJobStarted(created.dir, { pid: process.pid });
        updateJob(created.dir, {
          deadline_at: new Date(Date.now() - 10_000).toISOString(),
        });
      } else {
        writeFileSync(path.join(created.dir, 'started.json'), JSON.stringify({
          pid: 2_147_483_647,
          at: new Date().toISOString(),
        }));
        updateJob(created.dir, { pid: 2_147_483_647, state: 'running' });
      }

      s.updatePaintingState(42, current => ({ ...current, document_id: 42 }));
      const compact = s.statusCompact() as any;
      const active = compact.active_jobs.find((job: any) => job.operation_id === 'job-operation-' + jobState);
      expect(active?.state).toBe(jobState);
      expect(compact.next_required_action).toBe(active.poll_command);
      expect((s.resume(42) as any).next_required_action).toBe(active.poll_command);
    });
  }

  it('post-closure semantic revalidation rollback restores controller and mirror bytes exactly', () => {
    const { dir, store: s } = store();
    const processDir = path.join(dir, 'processes', 'fixture-process', 'run');
    const mirror = path.join(processDir, 'painting-state.json');
    mkdirSync(processDir, { recursive: true });
    writeFileSync(mirror, JSON.stringify({ mirror: 'before' }));
    s.write(record('closure-snapshot', {
      phase: 'completed',
      failed: false,
      visual: false,
      report: { did: 'x', why: 'x', result: 'x' },
    }));
    s.updatePaintingState(42, current => ({
      ...current,
      process_dir: 'processes/fixture-process/run',
      marker: 'before',
    }));
    const mirrorBefore = readFileSync(mirror, 'utf8');
    const snapshot = s.snapshotClosureState('closure-snapshot');

    s.updatePaintingState(42, current => ({ ...current, marker: 'after-invalid-revalidation' }));
    writeFileSync(mirror, JSON.stringify({ mirror: 'after-invalid-revalidation' }));
    const changed = s.read('closure-snapshot')!;
    changed.report = { did: 'changed', why: 'changed', result: 'changed' };
    s.write(changed);

    expect(s.restoreClosureState(snapshot)).toBe(true);
    expect(s.paintingState().documents['42'].marker).toBe('before');
    expect(s.read('closure-snapshot')?.report).toEqual({ did: 'x', why: 'x', result: 'x' });
    expect(readFileSync(mirror, 'utf8')).toBe(mirrorBefore);
  });

  it('bootstrap timeout before claim terminalizes from a durable not-claimed receipt without false uncertainty', () => {
    const { store: s } = store();
    s.write(record('bootstrap-before-claim', {
      tool: 'photoshop_create_document',
      args: { width: 1000, height: 700 },
      phase: 'uncertain',
      visual: false,
      bootstrap_exact_outcome: { protocol: 'photoshop.guard.bootstrap_exact_outcome.v1' },
    }));
    s.recoverDocumentBootstrap('bootstrap-before-claim', {
      state: 'not-claimed',
      command_id: 'bootstrap-before-claim',
    });
    expect(s.read('bootstrap-before-claim')).toMatchObject({
      phase: 'completed',
      execution: 'not-executed',
      resolved: { outcome: 'not-executed', evidence_mode: 'uxp_command_receipt' },
    });
    expect((s.statusCompact() as any).uncertain).not.toContain('bootstrap-before-claim');
  });

  it('bootstrap timeout after claim terminalizes only when delayed terminal receipt arrives', () => {
    const { store: s } = store();
    s.write(record('bootstrap-after-claim', {
      tool: 'photoshop_create_document',
      args: { width: 1000, height: 700 },
      phase: 'uncertain',
      visual: false,
      bootstrap_exact_outcome: { protocol: 'photoshop.guard.bootstrap_exact_outcome.v1' },
    }));
    expect(expectCanonicalAgreement(s, null)).toBe('reconcile uncertain operation bootstrap-after-claim');
    s.recoverDocumentBootstrap('bootstrap-after-claim', {
      state: 'failed',
      command_id: 'bootstrap-after-claim',
      result: { error: 'delayed UXP failure after claim' },
    });
    expect(s.read('bootstrap-after-claim')).toMatchObject({
      phase: 'completed',
      execution: 'failed',
      resolved: { outcome: 'failed', evidence_mode: 'uxp_command_receipt' },
    });
    expect((s.statusCompact() as any).uncertain).not.toContain('bootstrap-after-claim');
  });

  for (const receiptState of ['missing', 'corrupt'] as const) {
    it('bootstrap ' + receiptState + ' receipt remains explicitly unresolved and non-replayable', () => {
      const { store: s } = store();
      const id = 'bootstrap-receipt-' + receiptState;
      s.write(record(id, {
        tool: 'photoshop_create_document',
        args: { width: 1000, height: 700 },
        phase: 'uncertain',
        visual: false,
        bootstrap_exact_outcome: {
          protocol: 'photoshop.guard.bootstrap_exact_outcome.v1',
          probe_status: receiptState,
        },
      }));
      expect(expectCanonicalAgreement(s, null)).toBe('reconcile uncertain operation ' + id);
      expect(() => s.abandonDocumentBootstrap(id, {
        current_document_absence_observed: true,
      })).toThrow(/Exact-outcome bootstrap cannot be abandoned/);
      expect(s.read(id)).toMatchObject({
        phase: 'uncertain',
      });
      expect((s.statusCompact() as any).uncertain).toContain(id);
      expect(expectCanonicalAgreement(s, null)).toBe('reconcile uncertain operation ' + id);
    });
  }

  it('explicitly abandoned unknowable bootstrap terminates without claiming not-executed', () => {
    const { store: s } = store();
    s.write(record('bootstrap-unknowable', {
      tool: 'photoshop_create_document',
      args: { width: 1000, height: 700 },
      phase: 'uncertain',
      visual: false,
    }));
    s.abandonDocumentBootstrap('bootstrap-unknowable', {
      current_document_absence_observed: true,
    });
    const final = s.read('bootstrap-unknowable')!;
    expect(final.execution).toBe('abandoned');
    expect(final.execution).not.toBe('not-executed');
    expect(final.resolved).toMatchObject({
      outcome: 'abandoned',
      evidence_mode: 'explicit_operator_abandonment_after_current_document_absence',
    });
    expect((s.statusCompact() as any).uncertain).not.toContain('bootstrap-unknowable');
  });
});
