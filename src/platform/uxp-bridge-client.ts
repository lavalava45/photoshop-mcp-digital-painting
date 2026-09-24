/**
 * Client for the MCP-hosted UXP bridge (health check + neural filter invoke).
 */
import {
  cancelUxpBridgeCommandIfQueued,
  ensureUxpBridgeServer,
  getUxpBridgeCommandReceipt,
  invokeUxpBridge as invokeRawUxpBridge,
  probeUxpBridgeCommandReceipt,
  type UxpBridgeCommandReceipt,
  type UxpBridgeCommandProbe,
} from './uxp-bridge-server.js';
import { UXP_BRIDGE_REVISION } from '../core/guard/protocol-version.js';
import { bindPinnedDocumentId } from '../core/document-target.js';

const HEALTH_TIMEOUT_MS = 800;
const READINESS_CACHE_TTL_MS = 2_000;
export const EXPECTED_UXP_BRIDGE_REVISION = UXP_BRIDGE_REVISION;

export interface UxpBridgeReadiness {
  ready: boolean;
  transport: 'uxp';
  bridge_transport: string | null;
  bridge_revision: string | null;
  expected_bridge_revision: string;
  revision_match: boolean;
  photoshop_version: string | null;
  document_count: number | null;
  active_document: { id?: number; name?: string } | null;
  plugin_connected: boolean;
  reason: string | null;
  checked_at: string;
  cache: {
    hit: boolean;
    age_ms: number;
    ttl_ms: number;
  };
}

let readinessCache: { checkedAtMs: number; value: Omit<UxpBridgeReadiness, 'cache'> } | undefined;

const UXP_DOCUMENT_TARGET_EXEMPT_ACTIONS = new Set([
  // These actions either create the target or explicitly navigate to another
  // document. Their document_id, when any, is not the request-scoped mutation
  // target enforced for ordinary document-bound operations.
  'create_document',
  'open_image',
  'set_active_document',
]);

async function invokeUxpBridge(
  action: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
  options?: Parameters<typeof invokeRawUxpBridge>[3]
) {
  const dispatchParams = UXP_DOCUMENT_TARGET_EXEMPT_ACTIONS.has(action)
    ? params
    : bindPinnedDocumentId(params);
  return invokeRawUxpBridge(action, dispatchParams, timeoutMs, options);
}

function withReadinessCacheMeta(
  value: Omit<UxpBridgeReadiness, 'cache'>,
  checkedAtMs: number,
  hit: boolean,
  now = Date.now()
): UxpBridgeReadiness {
  return {
    ...value,
    cache: {
      hit,
      age_ms: Math.max(0, now - checkedAtMs),
      ttl_ms: READINESS_CACHE_TTL_MS,
    },
  };
}

export function clearUxpBridgeReadinessCache(): void {
  readinessCache = undefined;
}

export async function getUxpBridgeReadiness(
  options: { forceRefresh?: boolean } = {}
): Promise<UxpBridgeReadiness> {
  const now = Date.now();
  if (!options.forceRefresh && readinessCache && now - readinessCache.checkedAtMs <= READINESS_CACHE_TTL_MS) {
    return withReadinessCacheMeta(readinessCache.value, readinessCache.checkedAtMs, true, now);
  }

  const checkedAtMs = now;
  const checkedAt = new Date(checkedAtMs).toISOString();
  const base = {
    ready: false,
    transport: 'uxp' as const,
    bridge_transport: null,
    bridge_revision: null,
    expected_bridge_revision: EXPECTED_UXP_BRIDGE_REVISION,
    revision_match: false,
    photoshop_version: null,
    document_count: null,
    active_document: null,
    plugin_connected: false,
    reason: 'uxp_bridge_unreachable',
    checked_at: checkedAt,
  };

  try {
    const port = await ensureUxpBridgeServer();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    let health: {
      ok?: boolean;
      plugin_connected?: boolean;
      transport?: string;
      bridge_revision?: string | null;
      photoshop_version?: string | null;
      document_count?: number | null;
      active_document?: { id?: number; name?: string } | null;
    } = {};
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
      if (res.ok) health = await res.json() as typeof health;
    } finally {
      clearTimeout(timer);
    }

    if (health.ok !== true || health.plugin_connected !== true) {
      const announcedRevision = typeof health.bridge_revision === 'string' && health.bridge_revision
        ? health.bridge_revision
        : null;
      const revisionReason = announcedRevision && announcedRevision !== EXPECTED_UXP_BRIDGE_REVISION
        ? 'uxp_bridge_revision_mismatch'
        : !announcedRevision && health.ok === true
          ? 'uxp_bridge_revision_missing'
          : null;
      const value = {
        ...base,
        bridge_transport: typeof health.transport === 'string' ? health.transport : null,
        bridge_revision: announcedRevision,
        plugin_connected: health.plugin_connected === true,
        reason: revisionReason ?? (health.ok === true ? 'uxp_plugin_not_connected' : 'uxp_bridge_health_failed'),
      };
      readinessCache = { checkedAtMs, value };
      return withReadinessCacheMeta(value, checkedAtMs, false, Date.now());
    }

    const bridgeRevision = typeof health.bridge_revision === 'string' && health.bridge_revision
      ? health.bridge_revision
      : null;
    const revisionMatch = bridgeRevision === EXPECTED_UXP_BRIDGE_REVISION;
    const value: Omit<UxpBridgeReadiness, 'cache'> = {
      ready: revisionMatch,
      transport: 'uxp',
      bridge_transport: typeof health.transport === 'string' ? health.transport : null,
      bridge_revision: bridgeRevision,
      expected_bridge_revision: EXPECTED_UXP_BRIDGE_REVISION,
      revision_match: revisionMatch,
      photoshop_version: typeof health.photoshop_version === 'string' ? health.photoshop_version : null,
      document_count: typeof health.document_count === 'number' && Number.isFinite(health.document_count)
        ? health.document_count
        : null,
      active_document: health.active_document && typeof health.active_document === 'object'
        ? health.active_document
        : null,
      plugin_connected: true,
      reason: revisionMatch ? null : bridgeRevision ? 'uxp_bridge_revision_mismatch' : 'uxp_bridge_revision_missing',
      checked_at: checkedAt,
    };
    readinessCache = { checkedAtMs, value };
    return withReadinessCacheMeta(value, checkedAtMs, false, Date.now());
  } catch (error) {
    const value: Omit<UxpBridgeReadiness, 'cache'> = {
      ...base,
      reason: error instanceof Error ? error.message : String(error),
    };
    readinessCache = { checkedAtMs, value };
    return withReadinessCacheMeta(value, checkedAtMs, false, Date.now());
  }
}

export async function isUxpBridgeReachable(): Promise<boolean> {
  try {
    const port = await ensureUxpBridgeServer();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
      if (!res.ok) return false;
      const body = await res.json() as {
        ok?: boolean;
        plugin_connected?: boolean;
        bridge_revision?: string | null;
      };
      if (body.ok !== true || body.plugin_connected !== true) return false;
      return body.bridge_revision === EXPECTED_UXP_BRIDGE_REVISION;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

export type NeuralFilterKind =
  'skin_smoothing' | 'harmonize' | 'depth_blur' | 'super_zoom' | 'colorize';

export interface NeuralFilterParams {
  smoothness?: number;
  blur?: number;
  reference_layer_id?: number;
  document_id?: number;
}

export type UxpSaveFormat = 'PSD' | 'JPEG' | 'PNG';

export interface UxpSaveDocumentParams {
  path: string;
  format: UxpSaveFormat;
  quality?: number;
  document_id?: number;
}

export interface UxpSaveInvariantProbe {
  active_document_unchanged?: boolean;
  working_path_unchanged?: boolean;
  active_layers_unchanged?: boolean;
  active_tool_unchanged?: boolean;
  selection_unchanged?: boolean;
}

export interface UxpSaveDocumentData {
  transport?: string;
  path?: string;
  format?: UxpSaveFormat;
  as_copy?: boolean;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  invariants?: UxpSaveInvariantProbe;
  invariants_ok?: boolean;
}

export interface UxpStableCommandResult<T = Record<string, unknown>> {
  ok: boolean;
  command_id: string;
  data?: T;
  error?: string;
  receipt: UxpBridgeCommandReceipt | null;
  pre_dispatch_rejected: boolean;
}

export interface UxpCreateDocumentParams {
  width: number;
  height: number;
  resolution: number;
  colorMode: 'RGB' | 'CMYK' | 'Grayscale';
}

export interface UxpOpenImageParams {
  filePath: string;
}

export async function getUxpStableCommandReceipt(
  commandId: string
): Promise<UxpBridgeCommandReceipt | null> {
  await ensureUxpBridgeServer();
  return getUxpBridgeCommandReceipt(commandId);
}

export async function probeUxpStableCommandReceipt(
  commandId: string
): Promise<UxpBridgeCommandProbe> {
  return probeUxpBridgeCommandReceipt(commandId);
}

export async function cancelUxpStableCommandIfQueued(
  commandId: string
): Promise<UxpBridgeCommandReceipt | null> {
  return cancelUxpBridgeCommandIfQueued(commandId);
}

async function invokeUxpStableCommand<T extends Record<string, unknown>>(
  action:
    | 'create_document'
    | 'open_image'
    | 'set_brush'
    | 'select_brush_preset'
    | 'set_foreground_color',
  params: Record<string, unknown>,
  commandId: string,
  timeoutMs: number
): Promise<UxpStableCommandResult<T>> {
  const normalizedCommandId = commandId.trim();
  if (!normalizedCommandId) {
    return {
      ok: false,
      command_id: commandId,
      error: 'uxp_bridge_command_id_required',
      receipt: null,
      pre_dispatch_rejected: true,
    };
  }

  await ensureUxpBridgeServer();
  const before = getUxpBridgeCommandReceipt(normalizedCommandId);
  const canDispatch = before === null || before.state === 'not-claimed' || before.state === 'queued';
  if (canDispatch) {
    const readiness = await getUxpBridgeReadiness({ forceRefresh: true });
    if (!readiness.ready) {
      return {
        ok: false,
        command_id: normalizedCommandId,
        error: readiness.reason ?? 'uxp_bridge_unavailable',
        receipt: before,
        pre_dispatch_rejected: before === null || before.state === 'not-claimed',
      };
    }
  }

  const result = await invokeUxpBridge(action, params, timeoutMs, {
    commandId: normalizedCommandId,
    requireConnected: canDispatch,
    expectedBridgeRevision: canDispatch ? EXPECTED_UXP_BRIDGE_REVISION : undefined,
  });
  const receipt = getUxpBridgeCommandReceipt(normalizedCommandId) ?? result.receipt ?? null;
  return {
    ok: result.ok,
    command_id: normalizedCommandId,
    ...(result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? { data: result.data as T }
      : {}),
    ...(result.error ? { error: result.error } : {}),
    receipt,
    pre_dispatch_rejected: receipt === null,
  };
}

export async function invokeUxpCreateDocument(
  params: UxpCreateDocumentParams,
  commandId: string
): Promise<UxpStableCommandResult> {
  return invokeUxpStableCommand('create_document', { ...params }, commandId, 30_000);
}

export async function invokeUxpOpenImage(
  params: UxpOpenImageParams,
  commandId: string
): Promise<UxpStableCommandResult> {
  return invokeUxpStableCommand('open_image', { ...params }, commandId, 60_000);
}

export async function invokeUxpGetState(): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}> {
  const result = await invokeUxpBridge('get_state', {}, 5_000);
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'uxp_get_state_failed' };
  }
  return {
    ok: true,
    data: result.data && typeof result.data === 'object'
      ? result.data as Record<string, unknown>
      : undefined,
  };
}

async function invokeUxpRecord(
  action: string,
  errorCode: string
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await invokeUxpBridge(action, {}, 5_000);
  if (!result.ok) {
    return { ok: false, error: result.error ?? errorCode };
  }
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

async function invokeUxpRecordWithParams(
  action: string,
  params: Record<string, unknown>,
  errorCode: string,
  timeoutMs = 10_000
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await invokeUxpBridge(action, params, timeoutMs);
  if (!result.ok) {
    return { ok: false, error: result.error ?? errorCode };
  }
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

/**
 * Internal allow-listed UXP semantic operation entry point used by migrated
 * Photoshop tool handlers. This is not registered as a public MCP tool and
 * therefore cannot be used to bypass Guard/tool-level policy. Routing remains
 * pre-dispatch and UXP-only; a claimed command is never replayed through a
 * different backend.
 */
export async function invokeUxpOperation(
  action: string,
  params: Record<string, unknown> = {},
  errorCode = `uxp_${action}_failed`,
  timeoutMs = 30_000
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  return invokeUxpRecordWithParams(action, params, errorCode, timeoutMs);
}

export async function invokeUxpCreateLayer(params: {
  document_id?: number;
  name?: string;
  above_layer_id?: number;
  below_layer_id?: number;
}) {
  return invokeUxpRecordWithParams('create_layer', params, 'uxp_create_layer_failed');
}

export async function invokeUxpDeleteLayer(params: {
  document_id?: number;
  layer_id?: number;
}) {
  return invokeUxpRecordWithParams('delete_layer', params, 'uxp_delete_layer_failed');
}

export async function invokeUxpSelectLayerByName(params: {
  document_id?: number;
  name: string;
}) {
  return invokeUxpRecordWithParams('select_layer_by_name', params, 'uxp_select_layer_by_name_failed');
}

export async function invokeUxpUndo(params: {
  document_id?: number;
  steps: number;
}) {
  return invokeUxpRecordWithParams('undo', params, 'uxp_undo_failed');
}

export async function invokeUxpCreateLayerMask(params: {
  document_id?: number;
}) {
  return invokeUxpRecordWithParams('create_layer_mask', params, 'uxp_create_layer_mask_failed');
}

export async function invokeUxpApplyGradientMask(params: {
  document_id?: number;
  direction: 'top_to_bottom' | 'bottom_to_top' | 'left_to_right' | 'right_to_left';
  start_pct: number;
  end_pct: number;
  angle_deg?: number;
}) {
  return invokeUxpRecordWithParams('apply_gradient_mask', params, 'uxp_apply_gradient_mask_failed');
}

export async function invokeUxpSelectRectangle(params: {
  document_id?: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}) {
  return invokeUxpRecordWithParams('select_rectangle', params, 'uxp_select_rectangle_failed');
}

export async function invokeUxpSelectEllipse(params: {
  document_id?: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}) {
  return invokeUxpRecordWithParams('select_ellipse', params, 'uxp_select_ellipse_failed');
}

export async function invokeUxpFeatherSelection(params: {
  document_id?: number;
  pixels: number;
}) {
  return invokeUxpRecordWithParams('feather_selection', params, 'uxp_feather_selection_failed');
}

export async function invokeUxpSelectSubject(params: {
  document_id?: number;
  sample_all_layers?: boolean;
}) {
  return invokeUxpRecordWithParams('select_subject', params, 'uxp_select_subject_failed', 30_000);
}

export async function invokeUxpSetLayerOpacity(params: {
  document_id?: number;
  opacity: number;
}) {
  return invokeUxpRecordWithParams('set_layer_opacity', params, 'uxp_set_layer_opacity_failed');
}

export async function invokeUxpSetLayerBlendMode(params: {
  document_id?: number;
  blendMode: string;
}) {
  return invokeUxpRecordWithParams('set_layer_blend_mode', params, 'uxp_set_layer_blend_mode_failed');
}

export async function invokeUxpSetLayerVisibility(params: {
  document_id?: number;
  visible: boolean;
}) {
  return invokeUxpRecordWithParams('set_layer_visibility', params, 'uxp_set_layer_visibility_failed');
}

export async function invokeUxpSetLayerLocked(params: {
  document_id?: number;
  locked: boolean;
}) {
  return invokeUxpRecordWithParams('set_layer_locked', params, 'uxp_set_layer_locked_failed');
}

export async function invokeUxpRenameLayer(params: {
  document_id?: number;
  name: string;
}) {
  return invokeUxpRecordWithParams('rename_layer', params, 'uxp_rename_layer_failed');
}

export async function invokeUxpDuplicateLayer(params: {
  document_id?: number;
  newName?: string;
}) {
  return invokeUxpRecordWithParams('duplicate_layer', params, 'uxp_duplicate_layer_failed');
}

export async function invokeUxpMoveLayer(params: {
  document_id?: number;
  position: 'ABOVE' | 'BELOW' | 'TOP' | 'BOTTOM' | 'UP' | 'DOWN';
  targetLayerId?: number;
  targetLayerName?: string;
}) {
  return invokeUxpRecordWithParams('move_layer', params, 'uxp_move_layer_failed');
}

export async function invokeUxpListDocuments(): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}> {
  return invokeUxpRecord('list_documents', 'uxp_list_documents_failed');
}

export async function invokeUxpGetSelectionBounds(): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}> {
  return invokeUxpRecord('get_selection_bounds', 'uxp_get_selection_bounds_failed');
}

export async function invokeUxpListLayers(): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}> {
  return invokeUxpRecord('list_layers', 'uxp_list_layers_failed');
}

export async function invokeUxpListBrushPresets(
  query: string,
  limit: number
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await invokeUxpBridge('list_brush_presets', { query, limit }, 5_000);
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'uxp_list_brush_presets_failed' };
  }
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

export async function invokeUxpGetBrushSettings(): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}> {
  return invokeUxpRecord('get_brush_settings', 'uxp_get_brush_settings_failed');
}

export async function invokeUxpGetHistory(): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
}> {
  return invokeUxpRecord('get_history', 'uxp_get_history_failed');
}

export interface UxpBrushSettingsWrite {
  size?: number;
  hardness?: number;
  opacity?: number;
  flow?: number;
  spacing?: number;
  angle?: number;
  roundness?: number;
  flip_x?: boolean;
  flip_y?: boolean;
  use_pressure_size?: boolean;
  use_pressure_opacity?: boolean;
  airbrush?: boolean;
  smoothing_enabled?: boolean;
  smoothing?: number;
}

export interface UxpStableSetterRecoveryOptions {
  initialTimeoutMs?: number;
  recoveryTimeoutMs?: number;
}

type UxpStableSetterAction = 'set_brush' | 'select_brush_preset';

function stableResultFromReceipt<T extends Record<string, unknown>>(
  commandId: string,
  receipt: UxpBridgeCommandReceipt
): UxpStableCommandResult<T> | null {
  const result = receipt.result;
  if (!result || (receipt.state !== 'completed' && receipt.state !== 'failed')) return null;
  return {
    ok: result.ok,
    command_id: commandId,
    ...(result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? { data: result.data as T }
      : {}),
    ...(result.error ? { error: result.error } : {}),
    receipt,
    pre_dispatch_rejected: false,
  };
}

async function invokeUxpStableSetterCommand<T extends Record<string, unknown>>(
  action: UxpStableSetterAction,
  params: Record<string, unknown>,
  commandId: string,
  options: UxpStableSetterRecoveryOptions = {}
): Promise<UxpStableCommandResult<T>> {
  const initialTimeoutMs = options.initialTimeoutMs ?? 10_000;
  const recoveryTimeoutMs = options.recoveryTimeoutMs ?? 2_000;
  const first = await invokeUxpStableCommand<T>(action, params, commandId, initialTimeoutMs);
  if (first.ok || first.pre_dispatch_rejected || first.receipt?.state !== 'claimed') return first;

  const probed = await probeUxpStableCommandReceipt(commandId);
  if (probed.status === 'receipt') {
    const exact = stableResultFromReceipt<T>(commandId, probed.receipt);
    if (exact) return exact;
  }

  // A claimed stable command may only be awaited/recovered under the same id.
  // invokeUxpBridge detects the existing claimed receipt and waits for its
  // original result without enqueueing or dispatching a second setter.
  const recovered = await invokeUxpStableCommand<T>(action, params, commandId, recoveryTimeoutMs);
  if (recovered.ok || recovered.pre_dispatch_rejected || recovered.receipt?.state !== 'claimed') {
    return recovered;
  }

  const reprobed = await probeUxpStableCommandReceipt(commandId);
  if (reprobed.status === 'receipt') {
    const exact = stableResultFromReceipt<T>(commandId, reprobed.receipt);
    if (exact) return exact;
  }
  return recovered;
}

export async function invokeUxpSetBrush(
  settings: UxpBrushSettingsWrite,
  commandId?: string,
  recoveryOptions: UxpStableSetterRecoveryOptions = {}
): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  command_id?: string;
  receipt?: UxpBridgeCommandReceipt | null;
  pre_dispatch_rejected?: boolean;
}> {
  if (commandId?.trim()) {
    const result = await invokeUxpStableSetterCommand<Record<string, unknown>>(
      'set_brush',
      { settings },
      commandId,
      recoveryOptions
    );
    if (result.ok || result.pre_dispatch_rejected || result.receipt?.state !== 'claimed') return result;

    const readback = await invokeUxpGetBrushSettings();
    if (!readback.ok || !readback.data) return result;
    return {
      ok: true,
      command_id: commandId,
      data: {
        ...readback.data,
        setter_recovery: {
          protocol: 'photoshop.uxp.setter_recovery.v1',
          mode: 'authoritative-readback',
          command_id: commandId,
          receipt_state: result.receipt?.state ?? 'claimed',
          original_error: result.error ?? 'uxp_bridge_claimed_timeout',
        },
      },
      receipt: result.receipt ?? null,
      pre_dispatch_rejected: false,
    };
  }
  const result = await invokeUxpBridge('set_brush', { settings }, 10_000);
  if (!result.ok) return { ok: false, error: result.error ?? 'uxp_set_brush_failed' };
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

export async function invokeUxpSelectBrushPreset(
  name: string,
  commandId?: string,
  recoveryOptions: UxpStableSetterRecoveryOptions = {}
): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  command_id?: string;
  receipt?: UxpBridgeCommandReceipt | null;
  pre_dispatch_rejected?: boolean;
}> {
  if (commandId?.trim()) {
    const result = await invokeUxpStableSetterCommand<Record<string, unknown>>(
      'select_brush_preset',
      { name },
      commandId,
      recoveryOptions
    );
    if (result.ok || result.pre_dispatch_rejected || result.receipt?.state !== 'claimed') return result;

    const readback = await invokeUxpGetBrushSettings();
    const effectivePreset = readback.ok && readback.data && typeof readback.data.preset === 'string'
      ? readback.data.preset.trim()
      : '';
    if (!effectivePreset) return result;
    return {
      ok: true,
      command_id: commandId,
      data: {
        ...readback.data,
        preset: effectivePreset,
        setter_recovery: {
          protocol: 'photoshop.uxp.setter_recovery.v1',
          mode: 'authoritative-readback',
          command_id: commandId,
          receipt_state: result.receipt?.state ?? 'claimed',
          original_error: result.error ?? 'uxp_bridge_claimed_timeout',
        },
      },
      receipt: result.receipt ?? null,
      pre_dispatch_rejected: false,
    };
  }
  const result = await invokeUxpBridge('select_brush_preset', { name }, 10_000);
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'uxp_select_brush_preset_failed' };
  }
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

export async function invokeUxpSetForegroundColor(params: {
  red: number;
  green: number;
  blue: number;
}, commandId?: string): Promise<{
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  command_id?: string;
  receipt?: UxpBridgeCommandReceipt | null;
  pre_dispatch_rejected?: boolean;
}> {
  if (commandId?.trim()) {
    return invokeUxpStableCommand('set_foreground_color', params, commandId, 10_000);
  }
  const result = await invokeUxpBridge('set_foreground_color', params, 10_000);
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'uxp_set_foreground_color_failed' };
  }
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

export async function invokeUxpFillLayer(params: {
  document_id?: number;
  layer_id?: number;
  red: number;
  green: number;
  blue: number;
}): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await invokeUxpBridge('fill_layer', params, 15_000);
  if (!result.ok) return { ok: false, error: result.error ?? 'uxp_fill_layer_failed' };
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

export async function invokeUxpPaintRegions(params: {
  document_id?: number;
  regions: unknown[];
  clip_bounds?: { left: number; top: number; right: number; bottom: number };
}): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await invokeUxpBridge('paint_regions', params, 30_000);
  if (!result.ok) return { ok: false, error: result.error ?? 'uxp_paint_regions_failed' };
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

export async function invokeUxpPaintStrokes(params: {
  document_id?: number;
  layer_id?: number;
  strokes: unknown[];
}): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await invokeUxpBridge('paint_strokes', params, 60_000);
  if (!result.ok) return { ok: false, error: result.error ?? 'uxp_paint_strokes_failed' };
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

export async function invokeUxpPaintDabs(params: {
  document_id?: number;
  layer_id?: number;
  groups: unknown[];
}): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await invokeUxpBridge('paint_dabs', params, 60_000);
  if (!result.ok) return { ok: false, error: result.error ?? 'uxp_paint_dabs_failed' };
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

export interface UxpPreviewRequest {
  document_id?: number;
  max_dimension_px: number;
  focus_region?: { left: number; top: number; right: number; bottom: number };
  focus_max_dimension_px?: number;
}

export async function invokeUxpCapturePreview(
  params: UxpPreviewRequest
): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await invokeUxpBridge('capture_preview', { ...params }, 30_000);
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'uxp_capture_preview_failed' };
  }
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

export async function invokeUxpSampleColor(params: {
  document_id?: number;
  x: number;
  y: number;
  radius: number;
}): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await invokeUxpBridge('sample_color', { ...params }, 10_000);
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'uxp_sample_color_failed' };
  }
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

export async function invokeUxpSampleColors(params: {
  document_id?: number;
  points: Array<{ id?: string; x: number; y: number }>;
}): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  const result = await invokeUxpBridge('sample_colors', { ...params }, 30_000);
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'uxp_sample_colors_failed' };
  }
  return {
    ok: true,
    data:
      result.data && typeof result.data === 'object' && !Array.isArray(result.data)
        ? (result.data as Record<string, unknown>)
        : undefined,
  };
}

export async function invokeNeuralFilter(
  filter: NeuralFilterKind,
  params: NeuralFilterParams = {}
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const result = await invokeUxpBridge('neural_filter', { filter, ...params }, 90_000);
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'neural_filter_failed' };
  }
  return { ok: true, data: result.data };
}

export async function invokeUxpSaveDocument(
  params: UxpSaveDocumentParams
): Promise<{ ok: boolean; data?: UxpSaveDocumentData; error?: string }> {
  if (!(await isUxpBridgeReachable())) {
    return { ok: false, error: 'uxp_bridge_unavailable' };
  }
  const result = await invokeUxpBridge('save_document', { ...params }, 120_000);
  if (!result.ok) {
    return { ok: false, error: result.error ?? 'uxp_save_failed' };
  }
  return { ok: true, data: result.data as UxpSaveDocumentData };
}
