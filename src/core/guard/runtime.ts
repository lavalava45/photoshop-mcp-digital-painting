import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { ToolResult, ToolRegistry } from '../tool-registry.js';
import { ExecutionLease } from '../execution-lease.js';
import { withToolExecutionContext } from '../execution-context.js';
import { DOCUMENT_ID_SCHEMA_EXCLUDES } from '../document-target.js';
import {
  cancelUxpStableCommandIfQueued,
  getUxpBridgeReadiness,
  invokeUxpGetState,
  probeUxpStableCommandReceipt,
} from '../../platform/uxp-bridge-client.js';
import {
  BOOTSTRAP_EXACT_OUTCOME_PROTOCOL,
  SessionStore,
  alive,
  isRead as isGuardReadTool,
  parseTexts,
  previewOf,
} from './session-store.js';
import { compactClosedPrevious, cycleEnvelope, executeLogicalOperation, preflightRejectionEnvelope } from './cycle.js';
import { compileGuardCycle } from './cycle-compiler.js';
import { guardCapabilities } from './guard-capabilities.js';
import type { GuardProjectionContext } from './projection-context.js';
import {
  collectOperationContractViolations,
} from './operation-contract.js';
import { guardExecutionPolicyError } from './execution-policy.js';
import {
  createJob,
  JOB_HEARTBEAT_INTERVAL_MS,
  readJob,
  updateJob,
  writeJobCompleted,
  writeJobHeartbeat,
  writeJobResult,
  writeJobStarted,
} from './async-job.js';
import { operationNarrative, shouldUseAsyncJob } from './operation-narrative.js';
import { paintingMethodCapabilities } from '../painting-method-palette.js';
import {
  COMPACT_GUARD_PROTOCOL_VERSION,
  RUNTIME_STATE_VERSION,
  UXP_BRIDGE_REVISION,
} from './protocol-version.js';

type GuardEnvelope = Record<string, unknown> & {
  preflight_rejection?: unknown;
  finalization_rejection?: unknown;
  cycle_latency?: unknown;
};

type GuardExecutionRun = {
  record?: Record<string, unknown> & { id?: string; visual?: boolean };
  replay?: boolean;
  timing?: {
    photoshop_dispatch_wall_ms?: number | null;
    preview_capture_materialization_ms?: number | null;
  };
};

const buildPreflightRejectionEnvelope = preflightRejectionEnvelope as unknown as (
  input: Record<string, unknown>,
  result: ToolResult,
  options?: { closed_previous?: Record<string, unknown> }
) => GuardEnvelope;

const buildCycleEnvelope = cycleEnvelope as unknown as (
  store: SessionStore,
  record: Record<string, unknown>,
  options?: { replay?: boolean; closed_previous?: Record<string, unknown> }
) => GuardEnvelope;

const runLogicalOperation = executeLogicalOperation as unknown as (input: {
  store: SessionStore;
  input: Record<string, unknown>;
  invoke: (name: string, args: Record<string, unknown>, timeout: number) => Promise<ToolResult>;
  materializeArguments: (tool: string, args: Record<string, unknown>, id: string) => Record<string, unknown>;
  onProgress?: ((state: string) => Promise<void> | void) | undefined;
  projectionContext?: GuardProjectionContext;
}) => Promise<GuardExecutionRun>;

const shouldRunAsyncJob = shouldUseAsyncJob as unknown as (
  operation: Record<string, unknown>,
  history: Array<Record<string, unknown>>
) => boolean;

export const EMBEDDED_GUARD_MODE = process.env.PHOTOSHOP_GUARD_MODE?.trim().toLowerCase() || 'compatible';
export const EMBEDDED_GUARD_REQUIRED = EMBEDDED_GUARD_MODE === 'required';

export { isGenerativeToolName } from './operation-contract.js';

class GuardContractError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'GuardContractError';
    this.code = code;
  }
}

function assertOperationContract(operation: Record<string, unknown>): void {
  const [violation] = collectOperationContractViolations(operation);
  if (violation) {
    throw new GuardContractError(
      violation.code,
      violation.message
    );
  }
}

export function guardRuntimeErrorCode(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) return code;
  }
  return fallback;
}

export function shouldBlockRawTool(toolName: string, mode = EMBEDDED_GUARD_MODE): boolean {
  return mode === 'required' && !toolName.startsWith('photoshop_guard_') && !isGuardReadTool(toolName);
}

export interface EmbeddedGuardRuntimeOptions {
  runtimeDirectory?: string;
  previewBarrierDirectory?: string;
  executionLeaseFile?: string;
  workspaceRoot?: string;
  uxpReadinessProbe?: typeof getUxpBridgeReadiness;
  uxpStateProbe?: typeof invokeUxpGetState;
  uxpCommandReceiptProbe?: typeof probeUxpStableCommandReceipt;
  uxpQueuedCommandCancel?: typeof cancelUxpStableCommandIfQueued;
}

function positiveDocumentId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function toolAcceptsDocumentId(registry: ToolRegistry, name: string): boolean {
  if (DOCUMENT_ID_SCHEMA_EXCLUDES.has(name)) return false;
  const definition = registry.get(name);
  const schema = definition?.tool.inputSchema as { properties?: Record<string, unknown> } | undefined;
  return !!schema?.properties && Object.prototype.hasOwnProperty.call(schema.properties, 'document_id');
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function jsonError(code: string, message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ ok: false, code, message }, null, 2) }],
  };
}

export class EmbeddedGuardRuntime {
  readonly runtimeDirectory: string;
  readonly previewBarrierDirectory: string;
  readonly executionLeaseFile: string;
  readonly store: SessionStore;
  private readonly executionLease: ExecutionLease;
  private readonly uxpReadinessProbe: typeof getUxpBridgeReadiness;
  private readonly uxpStateProbe: typeof invokeUxpGetState;
  private readonly uxpCommandReceiptProbe: typeof probeUxpStableCommandReceipt;
  private readonly uxpQueuedCommandCancel: typeof cancelUxpStableCommandIfQueued;
  private readonly capabilitySnapshotCache = new Map<number, {
    dependencyKey: string;
    snapshot: Record<string, unknown>;
  }>();

  constructor(
    private readonly registry: ToolRegistry,
    options: EmbeddedGuardRuntimeOptions = {}
  ) {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    this.runtimeDirectory = options.runtimeDirectory
      ?? process.env.PHOTOSHOP_CONTROLLER_RUNTIME_DIR?.trim()
      ?? path.join(root, '.photoshop-runtime', 'controller');
    this.previewBarrierDirectory = options.previewBarrierDirectory
      ?? process.env.PHOTOSHOP_PREVIEW_BARRIER_DIR?.trim()
      ?? path.join(root, '.photoshop-runtime', 'preview-barriers');
    this.executionLeaseFile = options.executionLeaseFile
      ?? path.join(root, '.photoshop-runtime', 'execution.lock');
    this.store = new SessionStore(this.runtimeDirectory, {
      visualBarrierDirectory: this.previewBarrierDirectory,
      workspaceRoot: options.workspaceRoot ?? root,
    });
    this.executionLease = new ExecutionLease(this.executionLeaseFile);
    this.uxpReadinessProbe = options.uxpReadinessProbe ?? getUxpBridgeReadiness;
    this.uxpStateProbe = options.uxpStateProbe ?? invokeUxpGetState;
    this.uxpCommandReceiptProbe = options.uxpCommandReceiptProbe ?? probeUxpStableCommandReceipt;
    this.uxpQueuedCommandCancel = options.uxpQueuedCommandCancel ?? cancelUxpStableCommandIfQueued;
  }

  capabilities(): Record<string, unknown> {
    return {
      ...guardCapabilities(),
      embedded: true,
      mode: EMBEDDED_GUARD_MODE,
      raw_mutation_bypass_blocked: EMBEDDED_GUARD_REQUIRED,
      runtime_directory: this.runtimeDirectory,
      compact_guard_protocol_version: COMPACT_GUARD_PROTOCOL_VERSION,
      runtime_state_version: RUNTIME_STATE_VERSION,
      expected_uxp_bridge_revision: UXP_BRIDGE_REVISION,
    };
  }

  async paintReadiness(documentId?: number): Promise<Record<string, unknown>> {
    const readiness = await this.uxpReadinessProbe({});
    const activeDocumentId = positiveDocumentId(readiness.active_document?.id)
      ? readiness.active_document!.id
      : null;
    const targetDocumentId = positiveDocumentId(documentId) ? documentId : activeDocumentId;
    const documentStatus = !readiness.ready || !readiness.revision_match
      ? 'unavailable'
      : !targetDocumentId
        ? 'missing'
        : activeDocumentId === targetDocumentId
          ? 'ready'
          : 'mismatch';
    const artRun = targetDocumentId
      ? this.store.artRunState(targetDocumentId, undefined)
      : undefined;
    const artRunBound = typeof artRun?.process_dir === 'string' && artRun.process_dir.length > 0;
    const paintingProfile = typeof artRun?.painting_profile === 'string'
      ? artRun.painting_profile
      : artRunBound ? 'nontrivial_painting' : null;
    const brushPreflightComplete = artRun?.brush_preflight?.completed === true;
    const brushRoleContractActive = paintingProfile === 'nontrivial_painting';
    const documentReady = documentStatus === 'ready';
    const canSubmitBrushIndependentVisualPass = documentReady && artRunBound;
    const canSubmitBrushDependentVisualPass = documentReady
      && artRunBound
      && (!brushRoleContractActive || brushPreflightComplete);

    let nextRequiredAction = 'photoshop_guard_cycle_auto';
    if (documentStatus === 'missing') {
      nextRequiredAction = 'photoshop_guard_cycle_auto setup pass with photoshop_create_document or photoshop_open_image';
    } else if (documentStatus === 'unavailable') {
      nextRequiredAction = 'restore matching UXP bridge readiness before any Photoshop mutation';
    } else if (documentStatus === 'mismatch') {
      nextRequiredAction = 'restore the pinned document as the active Photoshop document before mutation';
    } else if (!artRunBound) {
      nextRequiredAction = 'photoshop_guard_set_art_run';
    } else if (brushRoleContractActive && !brushPreflightComplete) {
      nextRequiredAction = 'submit a brush-independent visual pass if that matches the artistic need, or complete brush_preflight before photoshop_paint_strokes/photoshop_paint_dabs';
    }

    return {
      document: documentStatus,
      document_id: targetDocumentId,
      active_document_id: activeDocumentId,
      art_run: artRunBound ? 'ready' : 'missing',
      brush_preflight: brushRoleContractActive
        ? brushPreflightComplete ? 'ready' : 'missing'
        : artRunBound ? 'not_required' : 'missing',
      painting_profile: paintingProfile,
      can_submit_visual_pass: canSubmitBrushIndependentVisualPass,
      can_submit_brush_independent_visual_pass: canSubmitBrushIndependentVisualPass,
      can_submit_brush_dependent_visual_pass: canSubmitBrushDependentVisualPass,
      brush_preflight_dependency: {
        photoshop_paint_dabs: 'required',
        photoshop_paint_strokes: 'required_when_stroke_mechanism_is_BRUSH',
        non_brush_stroke_mechanisms: ['PENCIL', 'SMUDGE', 'ERASER'],
      },
      next_required_action: nextRequiredAction,
    };
  }

  private capabilitySnapshotDependencyKey(input: Record<string, unknown>): string {
    return createHash('sha256').update(JSON.stringify(input)).digest('hex');
  }

  private async capabilitySnapshot(documentId: number): Promise<Record<string, unknown>> {
    const artRun = this.store.artRunState(documentId, undefined) ?? {};
    const readiness = await this.uxpReadinessProbe({});
    const stateProbe: Awaited<ReturnType<typeof invokeUxpGetState>> = readiness.ready
      ? await this.uxpStateProbe().catch((error) => ({ ok: false, error: safeError(error) }))
      : { ok: false, error: readiness.reason ?? 'uxp_bridge_not_ready' };
    const stateData = stateProbe.ok && stateProbe.data && typeof stateProbe.data === 'object'
      ? stateProbe.data as Record<string, unknown>
      : {};
    const stateDocument = stateData.document && typeof stateData.document === 'object' && !Array.isArray(stateData.document)
      ? stateData.document as Record<string, unknown>
      : {};
    const stateLayer = stateData.activeLayer && typeof stateData.activeLayer === 'object' && !Array.isArray(stateData.activeLayer)
      ? stateData.activeLayer as Record<string, unknown>
      : {};
    const activeDocumentId = positiveDocumentId(stateDocument.id)
      ? stateDocument.id
      : positiveDocumentId(readiness.active_document?.id)
        ? readiness.active_document!.id
        : null;
    const activeLayerId = positiveDocumentId(stateLayer.id) ? stateLayer.id : null;
    const documentMatches = activeDocumentId === documentId;
    const brushPreflight = artRun.brush_preflight && typeof artRun.brush_preflight === 'object'
      ? artRun.brush_preflight as Record<string, unknown>
      : undefined;
    const profile = typeof artRun.painting_profile === 'string' ? artRun.painting_profile : null;
    const brushRoles = Array.isArray(brushPreflight?.roles)
      ? brushPreflight.roles.map((role) => {
          const row = role && typeof role === 'object' && !Array.isArray(role)
            ? role as Record<string, unknown>
            : {};
          return {
            role_id: row.role_id ?? null,
            purpose: row.purpose ?? null,
            material_roles: Array.isArray(row.material_roles) ? [...row.material_roles] : [],
            visual_intents: Array.isArray(row.visual_intents) ? [...row.visual_intents] : [],
            preferred_preset: row.preferred_preset ?? null,
            alternative_presets: Array.isArray(row.alternative_presets) ? [...row.alternative_presets] : [],
            effective_settings: row.effective_settings && typeof row.effective_settings === 'object'
              ? structuredClone(row.effective_settings)
              : null,
            working_scale: row.working_scale ?? null,
            pressure_policy: row.pressure_policy ?? null,
            probe_status: row.probe_status ?? null,
            caveat: row.caveat ?? null,
          };
        })
      : [];
    const methodCapabilities = paintingMethodCapabilities(this.registry);
    const bridgeBlocked = !readiness.ready || !readiness.revision_match || !documentMatches;
    const methodRow = (capability: ReturnType<typeof paintingMethodCapabilities>[number]) => ({
      id: capability.id,
      label: capability.label,
      method_class: capability.methodClass,
      visual_intents: [...capability.visualIntents],
      impact_classes: [...capability.impactClasses],
      primary_tool: capability.primaryTool ?? null,
      execution_tools: [...(capability.executionTools ?? [])],
      preparation_tools: [...(capability.preparationTools ?? [])],
    });
    const supportedMethods = bridgeBlocked
      ? []
      : methodCapabilities
          .filter(capability => capability.availability !== 'unavailable')
          .map(capability => ({
            ...methodRow(capability),
            availability: capability.availability,
            reason: capability.availabilityReason,
          }));
    const unavailableMethods = methodCapabilities
      .filter(capability => capability.availability === 'unavailable')
      .map(capability => ({ ...methodRow(capability), reason: capability.availabilityReason }));
    if (bridgeBlocked) {
      const reason = !readiness.ready
        ? readiness.reason ?? 'uxp_bridge_not_ready'
        : !readiness.revision_match
          ? 'uxp_bridge_revision_mismatch'
          : `active_document_mismatch:${String(activeDocumentId ?? 'none')}!=${documentId}`;
      for (const capability of methodCapabilities.filter(capability => capability.availability !== 'unavailable')) {
        unavailableMethods.push({ ...methodRow(capability), reason });
      }
    }
    const dependencyFacts = {
      compact_guard_protocol_version: COMPACT_GUARD_PROTOCOL_VERSION,
      runtime_state_version: RUNTIME_STATE_VERSION,
      expected_uxp_bridge_revision: UXP_BRIDGE_REVISION,
      actual_uxp_bridge_revision: readiness.bridge_revision,
      uxp_ready: readiness.ready,
      uxp_revision_match: readiness.revision_match,
      document_id: documentId,
      active_document_id: activeDocumentId,
      active_layer_id: activeLayerId,
      active_layer_name: typeof stateLayer.name === 'string' ? stateLayer.name : null,
      painting_profile: profile,
      brush_preflight: brushPreflight ?? null,
      profile_transition: artRun.profile_transition ?? null,
    };
    const dependencyKey = this.capabilitySnapshotDependencyKey(dependencyFacts);
    const cached = this.capabilitySnapshotCache.get(documentId);
    if (cached?.dependencyKey === dependencyKey) {
      return {
        ...structuredClone(cached.snapshot),
        cache: { reused: true, dependency_key: dependencyKey },
      };
    }
    const snapshot = {
      protocol: 'photoshop.guard.capability_snapshot.v1',
      snapshot_revision: `sha256:${dependencyKey}`,
      generated_at: new Date().toISOString(),
      compact_guard_protocol_version: COMPACT_GUARD_PROTOCOL_VERSION,
      runtime_state_version: RUNTIME_STATE_VERSION,
      uxp_bridge: {
        ready: readiness.ready,
        revision_match: readiness.revision_match,
        actual_revision: readiness.bridge_revision,
        expected_revision: readiness.expected_bridge_revision,
        reason: readiness.reason,
      },
      pinned_targets: {
        document_id: documentId,
        active_document_id: activeDocumentId,
        document_matches: documentMatches,
        active_layer_id: activeLayerId,
        active_layer_name: typeof stateLayer.name === 'string' ? stateLayer.name : null,
        layer_target_status: activeLayerId ? 'pinned' : 'unavailable',
        layer_target_reason: activeLayerId ? null : stateProbe.error ?? 'active_layer_identity_unavailable',
      },
      painting_profile: profile,
      supported_semantic_methods: supportedMethods,
      unavailable_methods: unavailableMethods,
      brush_roles: brushRoles,
      preparation_facts: {
        art_run_bound: typeof artRun.process_dir === 'string' && artRun.process_dir.length > 0,
        brush_preflight_completed: brushPreflight?.completed === true,
        brush_inventory_observed: brushPreflight?.inventory_observed === true,
        brush_inventory_total: typeof brushPreflight?.inventory_total === 'number' ? brushPreflight.inventory_total : null,
        profile_transition: artRun.profile_transition ?? null,
        uxp_state_readback_ok: stateProbe.ok === true,
        active_document_matches: documentMatches,
      },
      cache: { reused: false, dependency_key: dependencyKey },
    };
    this.capabilitySnapshotCache.set(documentId, { dependencyKey, snapshot: structuredClone(snapshot) });
    return snapshot;
  }

  async statusWithCapabilitySnapshots(): Promise<Record<string, unknown>> {
    const status = this.status();
    const documents = status.documents && typeof status.documents === 'object' && !Array.isArray(status.documents)
      ? status.documents as Record<string, unknown>
      : {};
    const snapshots: Record<string, unknown> = {};
    for (const key of Object.keys(documents)) {
      const documentId = Number(key);
      if (Number.isSafeInteger(documentId) && documentId > 0) {
        snapshots[key] = await this.capabilitySnapshot(documentId);
      }
    }
    return {
      ...status,
      paint_readiness: await this.paintReadiness(),
      capability_snapshots: snapshots,
    };
  }

  async artRunWithCapabilitySnapshot(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = this.artRun(input);
    const documentId = Number(input.document_id);
    return {
      ...response,
      paint_readiness: await this.paintReadiness(documentId),
      capability_snapshot: await this.capabilitySnapshot(documentId),
    };
  }

  status(): Record<string, unknown> {
    return {
      ...this.store.statusCompact(),
      guard_capabilities: this.capabilities(),
      public_mutation_mode: EMBEDDED_GUARD_MODE,
    };
  }

  resume(documentId?: number): Record<string, unknown> {
    return {
      ...this.store.resume(documentId),
      guard_capabilities: this.capabilities(),
      canonical_next_tool: 'photoshop_guard_cycle_auto',
    };
  }

  priorities(input: Record<string, unknown>): Record<string, unknown> {
    return {
      ok: true,
      document: this.store.setPriorityState(input),
      next: 'Use photoshop_guard_status or photoshop_guard_resume; stage priority remains fail-closed.',
    };
  }

  artRun(input: Record<string, unknown>): Record<string, unknown> {
    return {
      ok: true,
      art_run: this.store.setArtRunState(input),
      next: 'Use the returned project directory for frames/checkpoints/final. Visual art operations in artistic/mixed mode must carry the exact pre-operation artistic_commentary that was emitted as ordinary user-visible assistant prose.',
    };
  }

  artDirector(input: Record<string, unknown>): Record<string, unknown> {
    return {
      ok: true,
      document: this.store.setArtDirectorState(input),
      next: 'Use photoshop_guard_status/resume. Painter work is admitted only while the directive is active and bound to a permitted task.',
    };
  }

  report(input: Record<string, unknown>): Record<string, unknown> {
    return this.store.report(input);
  }

  ackOperation(input: Record<string, unknown>): Record<string, unknown> {
    return this.store.ackOperation(input);
  }

  verdict(input: Record<string, unknown>): Record<string, unknown> {
    return this.store.verdict(input);
  }

  async reconcile(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    const startedAt = Date.now();
    const id = typeof input.id === 'string' ? input.id : undefined;
    const finish = (result: Record<string, unknown>) => {
      if (id) this.store.recordLatency(id, {
        recovery_reconciliation_ms: Date.now() - startedAt,
        unknown_components: [
          'recovery_reconciliation_ms includes durable UXP receipt inspection/reconstruction but excludes prior external host/model time',
        ],
      });
      return result;
    };

    const record = id ? this.store.read(id) : undefined;
    const bootstrap = record
      && (record.tool === 'photoshop_create_document' || record.tool === 'photoshop_open_image')
      && record.phase !== 'completed';
    if (!bootstrap || !id) return finish(this.store.reconcile(input));

    const probe = await this.uxpCommandReceiptProbe(id);
    let receipt = probe.status === 'receipt' ? probe.receipt : null;
    if (receipt?.state === 'queued') {
      // A durable queued command has not been claimed by Photoshop. Cancelling
      // that queue entry is not a replay or a mutation; it creates terminal
      // not-claimed proof so a later bootstrap may start cleanly.
      receipt = await this.uxpQueuedCommandCancel(id) ?? receipt;
    }

    if (receipt?.state === 'completed' && receipt.terminal === true) {
      // Re-enter the public tool only after the durable receipt proves completion.
      // Stable-command dispatch returns the stored result; it cannot execute the
      // Photoshop mutation a second time.
      const recoveredResult = await this.invoke(
        record.tool,
        this.materializeArguments(record.tool, record.args, id),
        5_000
      );
      const recovered = this.store.recoverDocumentBootstrap(id, receipt, recoveredResult);
      const documentId = recovered.bootstrap_outcome?.document_id;
      return finish({
        ok: true,
        recovery: 'completed',
        operation_id: id,
        command_id: id,
        document_id: documentId ?? null,
        operation_receipt: recovered.operation_receipt ?? null,
        next_required_action: Number.isSafeInteger(documentId) && documentId > 0
          ? `Continue with the next guarded operation pinned to document_id=${documentId}. If Guard asks for closure, close this recovered operation in the same cycle; do not create another document.`
          : 'Recovered completion lacks a usable document_id; stop and inspect the recovered public result without replaying create/open.',
      });
    }

    if (receipt?.state === 'failed' && receipt.terminal === true) {
      const recovered = this.store.recoverDocumentBootstrap(id, receipt, undefined);
      return finish({
        ok: false,
        recovery: 'failed',
        operation_id: id,
        command_id: id,
        terminal: true,
        execution: recovered.execution,
        next_required_action: 'The original bootstrap is terminal and non-replayable. Correct the cause, confirm UXP readiness, then submit a new guarded bootstrap operation.',
      });
    }

    if (receipt?.state === 'not-claimed' && receipt.terminal === true) {
      const recovered = this.store.recoverDocumentBootstrap(id, receipt, undefined);
      return finish({
        ok: true,
        recovery: 'not-executed',
        operation_id: id,
        command_id: id,
        terminal: true,
        execution: recovered.execution,
        next_required_action: 'Durable proof shows Photoshop never claimed this command. A new guarded bootstrap operation is allowed after UXP readiness is confirmed.',
      });
    }

    if (receipt?.state === 'claimed') {
      return finish({
        ok: true,
        recovery: 'running',
        operation_id: id,
        command_id: id,
        terminal: false,
        receipt,
        blind_replay_allowed: false,
        next_required_action: `Call photoshop_guard_reconcile once more with id="${id}" after the companion has had a chance to redeliver its durable result. Do not create/open another document and do not change operation_id.`,
      });
    }

    if (
      (probe.status === 'absent' || probe.status === 'corrupt')
      && input.outcome === 'abandoned'
      && input.document_closed_confirmed === true
    ) {
      const exactOutcomeProtocol =
        (record.bootstrap_exact_outcome as Record<string, unknown> | undefined)?.protocol
          === BOOTSTRAP_EXACT_OUTCOME_PROTOCOL;
      if (exactOutcomeProtocol) {
        return finish({
          ok: false,
          recovery: 'abandonment-rejected',
          operation_id: id,
          command_id: id,
          terminal: false,
          blind_replay_allowed: false,
          next_required_action:
            'This bootstrap used the exact-outcome UXP protocol. A missing or corrupt durable receipt can conceal a previously claimed command, so count=0 is not enough to make abandonment safe. Preserve the operation as uncertain and restore/reconcile the same command identity; do not create/open another document.',
        });
      }
      const originalPid = record.pid;
      const historicalOwnerDead =
        Number.isSafeInteger(originalPid)
        && Number(originalPid) > 0
        && !alive(Number(originalPid));
      if (!historicalOwnerDead) {
        return finish({
          ok: false,
          recovery: 'abandonment-rejected',
          operation_id: id,
          command_id: id,
          terminal: false,
          blind_replay_allowed: false,
          next_required_action:
            'Historical bootstrap abandonment is allowed only after its original MCP owner process is confirmed dead. A live or unverifiable owner could still dispatch late work, so keep this operation uncertain.',
        });
      }
      const documentsResult = await this.invoke('photoshop_list_documents', {}, 5_000);
      const documentsBody = parseTexts(documentsResult).find((body: Record<string, unknown>) =>
        typeof body?.count === 'number' || typeof (body?.details as Record<string, unknown> | undefined)?.count === 'number'
      ) as Record<string, unknown> | undefined;
      const details = documentsBody?.details && typeof documentsBody.details === 'object' && !Array.isArray(documentsBody.details)
        ? documentsBody.details as Record<string, unknown>
        : undefined;
      const count = typeof details?.count === 'number'
        ? details.count
        : typeof documentsBody?.count === 'number' ? documentsBody.count : undefined;
      if (count !== 0) {
        return finish({
          ok: false,
          recovery: 'abandonment-rejected',
          operation_id: id,
          command_id: id,
          terminal: false,
          blind_replay_allowed: false,
          next_required_action:
            'Bootstrap abandonment requires a fresh current documents read with count=0 plus explicit operator confirmation. A document is currently open, so do not start a replacement bootstrap.',
        });
      }
      const abandoned = this.store.abandonDocumentBootstrap(id, {
        current_document_absence_observed: true,
      });
      return finish({
        ok: true,
        recovery: 'abandoned',
        operation_id: id,
        command_id: id,
        terminal: true,
        execution: abandoned.execution,
        current_document_count: 0,
        original_execution_proven_not_executed: false,
        next_required_action:
          'The unknowable bootstrap is closed as abandoned, not as not-executed. A new guarded bootstrap operation may now be started; do not reuse the abandoned operation id.',
      });
    }

    return finish({
      ok: false,
      recovery: probe.status === 'corrupt' ? 'receipt-corrupt' : 'unknown',
      operation_id: id,
      command_id: id,
      terminal: false,
      blind_replay_allowed: false,
      next_required_action:
        probe.status === 'corrupt'
          ? 'A durable receipt file exists but is unreadable. Do not replay create/open. Preserve the receipt file and resolve the operation explicitly; a new command id is not safe.'
          : 'No durable receipt is currently available, which is not sufficient proof that the command never executed. Do not replay create/open. Restore the same MCP/UXP transport once and re-run reconciliation with this same operation id; if no receipt becomes available, leave this operation uncertain for explicit operator resolution.',
    });
  }

  recoverLocks(): Record<string, unknown> {
    const stalledJobs = this.store.activeJobs(undefined).filter((job: { state?: string }) => job.state === 'stalled');
    if (stalledJobs.length) {
      return {
        controller: {
          recovered: false,
          blocked: true,
          code: 'embedded_guard_job_stalled',
        },
        execution: {
          recovered: false,
          blocked: true,
          code: 'embedded_guard_job_stalled',
        },
        stalled_jobs: stalledJobs,
        warning: 'The Node process is alive but the Guard job lease is stalled. Do not clear live locks or replay the mutation.',
        next: 'Restart only the Photoshop MCP child process, then call photoshop_guard_recover_locks and reconcile the uncertain operation from fresh state/preview evidence.',
      };
    }
    return {
      controller: this.store.recoverLock(),
      execution: this.store.recoverLock(this.executionLeaseFile),
    };
  }

  private materializeArguments(tool: string, args: Record<string, unknown> | undefined, id: string): Record<string, unknown> {
    const result = structuredClone(args ?? {});
    if (tool === 'photoshop_create_document' || tool === 'photoshop_open_image') {
      // Internal-only idempotency key. The public tool schema intentionally does
      // not expose this field; Guard injects it only after deterministic schema
      // validation so UXP bootstrap commands can be recovered without ever
      // issuing a second create/open under a new identity.
      result._guard_operation_id = id;
    }
    if (tool === 'photoshop_get_preview') {
      result.materialize_path ??= path.join(this.runtimeDirectory, 'previews', `${id}.jpg`);
      result.include_image = false;
      result.max_dimension_px ??= 1000;
    }
    if (tool === 'photoshop_execute_visual_microplan' && Array.isArray(result.steps)) {
      result.steps = result.steps.map((step: unknown) => {
        if (!step || typeof step !== 'object' || Array.isArray(step)) return step;
        const row = step as Record<string, unknown>;
        return row.tool === 'photoshop_get_preview'
          ? {
              ...row,
              args: this.materializeArguments(
                'photoshop_get_preview',
                row.args as Record<string, unknown> | undefined,
                `${id}-${String(row.id ?? 'preview')}`
              ),
            }
          : step;
      });
    }
    return result;
  }

  private async invoke(
    name: string,
    args: Record<string, unknown>,
    timeoutMs: number,
    context: { guardOperationId?: string } = {}
  ): Promise<ToolResult> {
    const executionPolicyError = guardExecutionPolicyError(name);
    if (executionPolicyError) {
      throw new Error(`${executionPolicyError.code}: ${executionPolicyError.message}`);
    }
    const definition = this.registry.get(name);
    if (!definition) throw new Error(`Tool ${name} missing from this fork catalog`);
    if (name !== 'photoshop_get_state' && toolAcceptsDocumentId(this.registry, name) && !positiveDocumentId(args.document_id)) {
      throw new Error(`Pass a positive pinned document_id for ${name}; obtain it from photoshop_get_state/photoshop_list_documents first`);
    }
    const deadlineAt = Date.now() + timeoutMs;
    return withToolExecutionContext({ deadlineAt, ...context }, () => this.registry.execute(name, args));
  }

  private async collectDynamicOperationViolations(operation: Record<string, unknown>) {
    const tool = String(operation.tool ?? '');
    if (tool === 'photoshop_create_document' || tool === 'photoshop_open_image') {
      const readiness = await this.uxpReadinessProbe({ forceRefresh: true });
      if (readiness.ready && readiness.revision_match && readiness.plugin_connected) return [];
      return [{
        scope: 'next_operation' as const,
        code: 'uxp_bootstrap_not_ready',
        message:
          `${tool} requires a ready matching UXP companion before dispatch ` +
          `(connected=${readiness.plugin_connected}, ready=${readiness.ready}, revision_match=${readiness.revision_match}, ` +
          `bridge_revision=${readiness.bridge_revision ?? 'unknown'}, expected=${readiness.expected_bridge_revision}, ` +
          `reason=${readiness.reason ?? 'unknown'}). No document creation command was dispatched.`,
      }];
    }

    if (isGuardReadTool(tool)) return [];
    const args = operation.args && typeof operation.args === 'object' && !Array.isArray(operation.args)
      ? operation.args as Record<string, unknown>
      : {};
    const documentId = Number(args.document_id);
    if (!positiveDocumentId(documentId)) return [];

    // The host-instance proof is available only on the matching UXP bridge.
    // Preserve the existing bounded COM fallback when UXP is not the selected
    // ready route, but never dispatch through a ready UXP route without proving
    // that the pinned numeric id still denotes the same live document object.
    const readiness = await this.uxpReadinessProbe({ forceRefresh: true });
    if (!(readiness.ready && readiness.revision_match && readiness.plugin_connected)) return [];

    const stateProbe = await this.uxpStateProbe();
    if (stateProbe.ok !== true) {
      return [{
        scope: 'next_operation' as const,
        code: 'document_instance_probe_failed',
        message: `Cannot prove live document incarnation for document_id=${documentId} before ${tool}; UXP state read failed. No mutation was dispatched.`,
      }];
    }
    const document = stateProbe.data?.document as Record<string, unknown> | undefined;
    const activeDocumentId = Number(document?.id);
    if (!positiveDocumentId(activeDocumentId) || activeDocumentId !== documentId) {
      return [{
        scope: 'next_operation' as const,
        code: 'document_instance_target_mismatch',
        message: `Pinned document_id=${documentId} is not the active UXP document (active=${String(document?.id ?? 'none')}). No mutation was dispatched.`,
      }];
    }
    const observation = this.store.observeDocumentInstance(
      documentId,
      document?.instanceWitness,
      { observed_at: new Date().toISOString(), tool }
    ) as Record<string, unknown>;
    if (observation.status === 'witness_missing') {
      return [{
        scope: 'next_operation' as const,
        code: 'document_instance_witness_missing',
        message:
          `The ready UXP bridge did not provide the required live document-instance witness for document_id=${documentId}. ` +
          'Reload the matching companion build before mutation; stale document state was not trusted.',
      }];
    }
    if (observation.status === 'reincarnated') {
      this.capabilitySnapshotCache.delete(documentId);
      return [{
        scope: 'next_operation' as const,
        code: 'document_reincarnated',
        message:
          `Photoshop recycled document_id=${documentId} for a different live document instance. Guard reset stale document-scoped state and blocked ${tool} before dispatch. ` +
          'Bind a new art run/current evidence for this document instance before continuing.',
      }];
    }
    return [];
  }
  async cycle(
    input: Record<string, unknown>,
    owningJobId?: string,
    options: {
      dispatchMode?: 'sync' | 'auto' | 'async';
      prepared?: {
        operation: Record<string, unknown>;
        guardPreflightMs: number;
        cycleReceivedAt: string;
        cycleStartedAt: number;
        requestJsonBytes: number;
        closedPrevious?: Record<string, unknown>;
      };
    } = {}
  ): Promise<Record<string, unknown>> {
    const cycleReceivedAt = options.prepared?.cycleReceivedAt ?? new Date().toISOString();
    const cycleStartedAt = options.prepared?.cycleStartedAt ?? Date.now();
    const requestJsonBytes = options.prepared?.requestJsonBytes
      ?? Buffer.byteLength(JSON.stringify(input), 'utf8');
    let cycleInput = structuredClone(input) as Record<string, unknown>;
    let nextOperation = options.prepared?.operation;
    let guardPreflightMs = options.prepared?.guardPreflightMs ?? 0;
    let compilerNormalizations: Array<{ code: string; message: string }> = [];

    const releaseController = this.store.lock();
    let releaseExecution: (() => void) | undefined;
    try {
      // The active-job check belongs inside the same cross-process controller
      // lock used by startJob(). Otherwise a synchronous cycle can observe no
      // jobs, lose the race to an async reservation, and still execute later.
      const projectionCapturedAt = Date.now();
      const activeJobSnapshotStartedAt = Date.now();
      const activeJobSnapshot = this.store.activeJobs(undefined, undefined, projectionCapturedAt);
      const activeJobSnapshotMs = Date.now() - activeJobSnapshotStartedAt;
      const activeJobs = activeJobSnapshot.filter((job: { job_id?: string }) => job.job_id !== owningJobId);
      if (activeJobs.length) {
        throw new Error(`Guard job ${activeJobs.at(-1)?.job_id ?? 'unknown'} is already active; poll it instead of starting replacement work`);
      }
      let closedPrevious: Record<string, unknown> = options.prepared?.closedPrevious ?? { closed: false };
      let closureGuardMs = 0;
      let cycleProjection = this.store.captureProjectionContext({
        activeJobs: activeJobSnapshot,
        capturedAt: projectionCapturedAt,
      });

      if (!options.prepared) {
        const preflightStartedAt = Date.now();
        const compiledCycle = await compileGuardCycle(cycleInput, this.store, this.registry, {
          collectDynamicOperationViolations: (operation) => this.collectDynamicOperationViolations(operation),
          projectionContext: cycleProjection,
        });
        guardPreflightMs = Date.now() - preflightStartedAt;
        cycleInput = compiledCycle.input;
        nextOperation = compiledCycle.nextOperation;
        compilerNormalizations = compiledCycle.normalizations;

        if (compiledCycle.rejection) {
          const envelope: GuardEnvelope = nextOperation
            ? buildPreflightRejectionEnvelope(nextOperation, compiledCycle.rejection, {
                closed_previous: { closed: false },
              })
            : {
                mode: 'photoshop-mcp-cycle',
                closed_previous: { closed: false },
                execution: null,
                preflight_rejection: (() => {
                  const textItem = compiledCycle.rejection?.content?.find((item) => item.type === 'text');
                  const text = textItem?.type === 'text' ? textItem.text : undefined;
                  try { return text ? JSON.parse(String(text)) : {}; } catch { return { message: String(text ?? '') }; }
                })(),
                preview: null,
                significance: undefined,
                operation_receipt: null,
                required_user_report: null,
                required_operation_ack: null,
                next_state: 'terminal_not_executed',
                next_required_action: 'Correct all listed deterministic cycle errors together and retry the same semantic Guard cycle.',
              };
          if (compiledCycle.violations.some((item) => item.scope === 'finalization')) {
            envelope.finalization_rejection = envelope.preflight_rejection;
          }
          envelope.cycle_latency = {
            protocol: 'photoshop.guard.cycle_latency.v1',
            inter_call_unattributed_gap_ms: null,
            decision_model_gap_ms: null,
            guard_preflight_ms: guardPreflightMs,
            photoshop_dispatch_wall_ms: null,
            photoshop_reported_execution_ms: null,
            preview_capture_materialization_ms: null,
            visual_evaluation_verdict_gap_ms: null,
            report_ack_closure_ms: null,
            recovery_reconciliation_ms: null,
            guard_cycle_total_ms: Date.now() - cycleStartedAt,
            semantic_cycle_wall_ms: null,
            request_json_bytes: requestJsonBytes,
            closure_request_json_bytes: null,
            guard_invocation_count_observed: 1,
            model_call_count: null,
            unknown_components: [
              'decision/model/host time before this Guard invocation is not observable for a rejected cycle',
            ],
          };
          return {
            ...envelope,
            ...(compilerNormalizations.length ? { compiler_normalizations: compilerNormalizations } : {}),
            guard_transport: 'embedded_mcp',
          };
        }

        const previousOperationId = typeof cycleInput.previous_operation_id === 'string'
          ? cycleInput.previous_operation_id
          : undefined;
        const previousRecordBeforeClosure = previousOperationId
          ? this.store.read(previousOperationId)
          : undefined;
        const reviewFindings: unknown[] = cycleInput.previous_visual_verdict
          && typeof cycleInput.previous_visual_verdict === 'object'
          && !Array.isArray(cycleInput.previous_visual_verdict)
          && Array.isArray((cycleInput.previous_visual_verdict as Record<string, unknown>).review_findings)
          ? (cycleInput.previous_visual_verdict as Record<string, unknown>).review_findings as unknown[]
          : [];
        const reviewEscalation: any = previousOperationId
          && previousRecordBeforeClosure?.visual
          && !previousRecordBeforeClosure?.verdict
          ? (this.store.planReviewEscalation as any)(previousOperationId, reviewFindings, { persist: false })
          : null;
        if (reviewEscalation?.required && previousOperationId) {
          const persistedPlan: any = (this.store.planReviewEscalation as any)(previousOperationId, reviewFindings, { persist: true });
          const wholeLongEdge = Math.max(
            Number(previousRecordBeforeClosure?.preview?.width) || 0,
            Number(previousRecordBeforeClosure?.preview?.height) || 0
          ) || Number(previousRecordBeforeClosure?.visual_review_profile?.whole_max_dimension_px) || 1600;
          for (const capture of persistedPlan.captures) {
            const previewArgs = this.materializeArguments(
              'photoshop_get_preview',
              {
                document_id: persistedPlan.document_id,
                max_dimension_px: wholeLongEdge,
                quality: 8,
                focus_region: capture.effective_region,
                focus_max_dimension_px: capture.focus_max_dimension_px,
              },
              `${previousOperationId}-review-${capture.role}`
            );
            const result = await this.invoke('photoshop_get_preview', previewArgs, 60_000, {
              guardOperationId: previousOperationId,
            });
            const rawPreview = previewOf(result);
            if (!rawPreview) throw new Error('Read-only review escalation did not return materialized preview evidence');
            this.store.attachReviewEvidence(previousOperationId, capture, {
              ...rawPreview,
              document_id: persistedPlan.document_id,
            });
          }
          const refreshed = this.store.read(previousOperationId);
          const envelope = buildCycleEnvelope(this.store, refreshed, {
            replay: false,
            closed_previous: { closed: false },
          });
          return {
            ...envelope,
            review_escalation: {
              protocol: 'photoshop.guard.review_escalation.v1',
              operation_id: previousOperationId,
              read_only: true,
              mutation_replayed: false,
              next_mutation_dispatched: false,
              captured_roles: persistedPlan.captures.map((capture: { role: string }) => capture.role),
              remaining_after_round: persistedPlan.remaining_after_round,
              bound_whole_sha256: persistedPlan.bound_whole_sha256,
            },
            guard_transport: 'embedded_mcp',
          };
        }
        const closureSnapshot = previousOperationId
          ? this.store.snapshotClosureState(previousOperationId)
          : undefined;
        const closureStartedAt = Date.now();
        try {
          closedPrevious = this.store.closePreviousCycle(cycleInput);
          if (!nextOperation && closedPrevious.closed && !isGuardReadTool(previousRecordBeforeClosure?.tool)) {
            const documentId = previousRecordBeforeClosure?.args?.document_id;
            if (Number.isSafeInteger(documentId) && documentId > 0) {
              this.store.setWorkflowLifecycle(
                documentId,
                'stopped',
                'close_only_finalization',
                previousOperationId
              );
            }
          }
        } catch (error) {
          if (closureSnapshot) this.store.restoreClosureState(closureSnapshot);
          throw error;
        }
        closureGuardMs = Date.now() - closureStartedAt;

        if (nextOperation && closedPrevious.closed && closureSnapshot) {
          const refreshedPrevious = previousOperationId ? this.store.read(previousOperationId) : undefined;
          const refreshedRecords = refreshedPrevious
            ? cycleProjection.records.map((record) => record.id === previousOperationId ? refreshedPrevious : record)
            : cycleProjection.records;
          cycleProjection = this.store.captureProjectionContext({
            records: refreshedRecords as GuardProjectionContext['records'],
            activeJobs: cycleProjection.activeJobs,
            capturedAt: Date.now(),
          });
          const postClosureStartedAt = Date.now();
          const postClosureCheck = await compileGuardCycle(
            { next_operation: nextOperation },
            this.store,
            this.registry,
            {
              projectionContext: cycleProjection,
              nextOperationValidation: 'state-only',
            }
          );
          guardPreflightMs += Date.now() - postClosureStartedAt;
          if (postClosureCheck.rejection) {
            this.store.restoreClosureState(closureSnapshot);
            const envelope = buildPreflightRejectionEnvelope(
              postClosureCheck.nextOperation ?? nextOperation,
              postClosureCheck.rejection,
              { closed_previous: { closed: false } }
            );
            const body = envelope.preflight_rejection;
            envelope.preflight_rejection = body && typeof body === 'object'
              ? { ...body as Record<string, unknown>, post_closure_semantic_revalidation: true }
              : body;
            envelope.cycle_latency = {
              protocol: 'photoshop.guard.cycle_latency.v1',
              inter_call_unattributed_gap_ms: null,
              decision_model_gap_ms: null,
              guard_preflight_ms: guardPreflightMs,
              photoshop_dispatch_wall_ms: null,
              photoshop_reported_execution_ms: null,
              preview_capture_materialization_ms: null,
              visual_evaluation_verdict_gap_ms: null,
              report_ack_closure_ms: null,
              recovery_reconciliation_ms: null,
              guard_cycle_total_ms: Date.now() - cycleStartedAt,
              semantic_cycle_wall_ms: null,
              request_json_bytes: requestJsonBytes,
              closure_request_json_bytes: null,
              guard_invocation_count_observed: 1,
              model_call_count: null,
              unknown_components: [],
            };
            return { ...envelope, guard_transport: 'embedded_mcp' };
          }
          nextOperation = postClosureCheck.nextOperation ?? nextOperation;
        }

        if (!nextOperation) {
          try {
            if (closedPrevious.closed && previousOperationId) {
              this.store.closeLatency(previousOperationId, cycleReceivedAt, closureGuardMs, requestJsonBytes);
            }
            const closureWriteMs = Date.now() - closureStartedAt;
            const responseConstructionStartedAt = Date.now();
            const previousRecord = previousOperationId ? this.store.read(previousOperationId) : undefined;
            const documentId = previousRecordBeforeClosure?.args?.document_id;
            const response = {
              mode: 'photoshop-mcp-cycle-finalization',
              closed_previous: compactClosedPrevious(closedPrevious),
              cycle_latency: previousRecord?.latency ?? null,
              next_state: 'closed',
              next_required_action: this.store.closeOnlyNextRequiredAction(documentId),
              guard_transport: 'embedded_mcp',
              ...(compilerNormalizations.length ? { compiler_normalizations: compilerNormalizations } : {}),
            };
            const responseConstructionMs = Date.now() - responseConstructionStartedAt;
            const finalizationTotalMs = Date.now() - cycleStartedAt;
            return {
              ...response,
              finalization_latency: {
                protocol: 'photoshop.guard.finalization_latency.v1',
                guard_preflight_ms: guardPreflightMs,
                active_job_snapshot_ms: activeJobSnapshotMs,
                closure_write_ms: closureWriteMs,
                status_projection_ms: 0,
                response_construction_ms: responseConstructionMs,
                finalization_total_ms: finalizationTotalMs,
              },
            };
          } catch (error) {
            if (closureSnapshot) this.store.restoreClosureState(closureSnapshot);
            throw error;
          }
        }
        if (closedPrevious.closed && previousOperationId) {
          this.store.closeLatency(previousOperationId, cycleReceivedAt, closureGuardMs, requestJsonBytes);
        }
      } else {
        cycleInput = { next_operation: options.prepared.operation };
      }

      if (!nextOperation) {
        throw new Error('Guard compiler invariant violated: executable cycle has no next operation');
      }

      const dispatchMode = options.dispatchMode ?? 'sync';
      const useAsyncJob = !options.prepared && (
        dispatchMode === 'async'
        || (dispatchMode === 'auto' && shouldRunAsyncJob(nextOperation, this.store.records()))
      );
      if (useAsyncJob) {
        const preparedInput = { next_operation: nextOperation };
        return this.reservePreparedJob(preparedInput, nextOperation, {
          operation: nextOperation,
          guardPreflightMs,
          cycleReceivedAt,
          cycleStartedAt,
          requestJsonBytes,
          closedPrevious,
        });
      }

      releaseExecution = this.executionLease.acquire('photoshop_guard_cycle');
      const executionOperation = nextOperation;

      const run = await runLogicalOperation({
        store: this.store,
        input: executionOperation,
        invoke: (name: string, args: Record<string, unknown>, timeout: number) => this.invoke(name, args, timeout, {
          guardOperationId: typeof executionOperation.id === 'string' ? executionOperation.id : undefined,
        }),
        materializeArguments: (tool: string, args: Record<string, unknown>, id: string) => this.materializeArguments(tool, args, id),
        onProgress: undefined,
        projectionContext: cycleProjection,
      });
      if (run.record?.id) {
        const previewTimingUnknown = run.record?.visual && run.timing?.preview_capture_materialization_ms == null
          ? ['preview capture/materialization is embedded inside the dispatched operation and cannot be separated from photoshop_dispatch_wall_ms']
          : [];
        this.store.recordLatency(run.record.id, {
          cycle_received_at: cycleReceivedAt,
          guard_preflight_ms: guardPreflightMs,
          photoshop_dispatch_wall_ms: run.timing?.photoshop_dispatch_wall_ms ?? null,
          preview_capture_materialization_ms: run.timing?.preview_capture_materialization_ms ?? null,
          request_json_bytes: requestJsonBytes,
          guard_invocation_count_observed: 1,
          model_call_count: null,
          unknown_components: previewTimingUnknown,
        });
      }
      const refreshedRecord = run.record?.id ? this.store.read(run.record.id) : run.record;
      const envelope = buildCycleEnvelope(this.store, refreshedRecord, {
        replay: run.replay,
        closed_previous: closedPrevious,
      });
      if (run.record?.id) {
        const responseReadyAt = new Date().toISOString();
        const latency = this.store.recordLatency(run.record.id, {
          response_ready_at: responseReadyAt,
          guard_cycle_total_ms: Date.now() - cycleStartedAt,
        });
        envelope.cycle_latency = latency ?? envelope.cycle_latency ?? null;
      }
      return {
        ...envelope,
        ...(compilerNormalizations.length ? { compiler_normalizations: compilerNormalizations } : {}),
        guard_transport: 'embedded_mcp',
      };
    } finally {
      releaseExecution?.();
      releaseController();
    }
  }

  async cycleAuto(input: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.cycle(input, undefined, { dispatchMode: 'auto' });
  }

  private reservePreparedJob(
    input: Record<string, unknown>,
    operation: Record<string, unknown>,
    prepared?: {
      operation: Record<string, unknown>;
      guardPreflightMs: number;
      cycleReceivedAt: string;
      cycleStartedAt: number;
      requestJsonBytes: number;
      closedPrevious?: Record<string, unknown>;
    }
  ): Record<string, unknown> {
    const narrative = operationNarrative(operation, 'starting');
    const created = createJob(this.runtimeDirectory, input, narrative);
    updateJob(created.dir, {
      state: 'starting',
      pid: process.pid,
      embedded_guard: true,
      progress_state: 'starting',
    });

    setTimeout(() => {
      void (async () => {
        writeJobStarted(created.dir, {
          command: 'embedded_guard_cycle',
          operation_id: operation.id ?? null,
          progress_state: 'running',
          embedded_guard: true,
        });
        const heartbeatTimer = setInterval(() => {
          try {
            writeJobHeartbeat(created.dir, { progress_state: 'running' });
          } catch {
            // Heartbeat failure must not interrupt the Photoshop operation itself.
          }
        }, JOB_HEARTBEAT_INTERVAL_MS);
        heartbeatTimer.unref?.();
        try {
          const result = await this.cycle(input, created.jobId, prepared ? { dispatchMode: 'sync', prepared } : {});
          writeJobResult(created.dir, result);
          writeJobCompleted(created.dir, 0, { embedded_guard: true, has_result: true });
        } catch (error) {
          const result = {
            ok: false,
            code: 'embedded_guard_job_failed',
            message: safeError(error),
            next: 'Inspect photoshop_guard_status/resume and reconcile any uncertain dispatched operation; never replay blindly.',
          };
          writeJobResult(created.dir, result);
          writeJobCompleted(created.dir, 1, { embedded_guard: true, has_result: true });
        } finally {
          clearInterval(heartbeatTimer);
        }
      })();
    }, 0);

    return {
      ok: true,
      mode: 'photoshop-guard-async',
      job_id: created.jobId,
      operation_id: operation.id ?? null,
      state: 'starting',
      narrative,
      ...(prepared ? {
        cycle_latency: {
          protocol: 'photoshop.guard.cycle_latency.v1',
          inter_call_unattributed_gap_ms: null,
          decision_model_gap_ms: null,
          guard_preflight_ms: prepared.guardPreflightMs,
          photoshop_dispatch_wall_ms: null,
          photoshop_reported_execution_ms: null,
          preview_capture_materialization_ms: null,
          visual_evaluation_verdict_gap_ms: null,
          report_ack_closure_ms: null,
          recovery_reconciliation_ms: null,
          guard_cycle_total_ms: null,
          semantic_cycle_wall_ms: null,
          request_json_bytes: prepared.requestJsonBytes,
          closure_request_json_bytes: null,
          guard_invocation_count_observed: 1,
          model_call_count: null,
          note: 'Execution continues in the durable job; total cycle latency is finalized with the job result.',
        },
      } : {}),
      next: `Poll with photoshop_guard_job_poll(job_id="${created.jobId}")`,
    };
  }

  startJob(input: Record<string, unknown>): Record<string, unknown> {
    const operation = (input as { next_operation?: Record<string, unknown> }).next_operation;
    if (!operation) throw new Error('runtime.startJob requires internal next_operation');
    assertOperationContract(operation);
    const releaseController = this.store.lock();
    try {
      // Reserve the singleton async-job slot atomically across MCP/Node
      // processes. Without this lock, two callers can both observe [] and both
      // return { state: "starting" } for jobs that immediately compete/fail.
      const activeJobs = this.store.activeJobs(undefined);
      if (activeJobs.length) {
        throw new Error(`Guard job ${activeJobs.at(-1)?.job_id ?? 'unknown'} is already active; poll it instead of starting replacement work`);
      }
      const cycleStartedAt = Date.now();
      return this.reservePreparedJob(input, operation, {
        operation,
        guardPreflightMs: 0,
        cycleReceivedAt: new Date().toISOString(),
        cycleStartedAt,
        requestJsonBytes: Buffer.byteLength(JSON.stringify(input), 'utf8'),
        closedPrevious: { closed: false },
      });
    } finally {
      // cycle() acquires the same controller lock, so release immediately after
      // the durable reservation is visible and before scheduling execution.
      releaseController();
    }
  }

  pollJob(jobId: string): Record<string, unknown> {
    const job = readJob(this.runtimeDirectory, jobId);
    const result = job.result as Record<string, unknown> | undefined;
    return {
      ok: job.state !== 'failed' && job.state !== 'stalled',
      mode: 'photoshop-guard-async',
      job_id: job.meta?.job_id ?? jobId,
      state: job.state,
      pid: job.pid ?? null,
      started_at: job.started?.at ?? job.meta?.started_at ?? null,
      completed_at: job.completed?.at ?? null,
      heartbeat_age_ms: job.heartbeat_age_ms ?? null,
      deadline_at: job.deadline_at ?? null,
      stall_reason: job.stall_reason ?? null,
      ...(result ? { result } : {}),
      next: job.state === 'running' || job.state === 'starting'
        ? 'Poll this job again; do not launch replacement mutation work.'
        : job.state === 'stalled'
          ? 'The job lease is stalled. Do not clear live locks or replay. Restart only the Photoshop MCP child process, then recover locks and reconcile from fresh evidence.'
          : job.state === 'failed' && !job.started
            ? 'This job never entered execution and no longer holds the async-job slot. Start replacement guarded work normally.'
        : job.state === 'completed'
          ? 'Inspect the completed result, then continue through photoshop_guard_cycle_auto with previous_operation_id + previous_observation and optional next_pass.'
          : 'Inspect photoshop_guard_status/resume and reconcile uncertain execution before any retry.',
    };
  }

  rawMutationBlocked(toolName: string): ToolResult {
    return jsonError(
      'guard_required',
      `${toolName} is a mutating Photoshop tool and PHOTOSHOP_GUARD_MODE=required. Use photoshop_guard_cycle_auto so intent, receipt/ack, recovery and preview/verdict barriers remain durable.`
    );
  }

  ensureRuntimeDirectories(): void {
    fs.mkdirSync(this.runtimeDirectory, { recursive: true });
    fs.mkdirSync(this.previewBarrierDirectory, { recursive: true });
  }
}
