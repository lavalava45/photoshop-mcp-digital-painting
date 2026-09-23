import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withToolExecutionContext } from '../core/execution-context.js';
import { UXP_BRIDGE_REVISION } from '../core/guard/protocol-version.js';

const TEST_BRIDGE_REVISION = UXP_BRIDGE_REVISION;
const TEST_REGISTRATION_PROTOCOL = 'photoshop.uxp.registration.v1';
const TEST_COMMAND_PROTOCOL = 'photoshop.uxp.command.v1';
const TEST_RESULT_PROTOCOL = 'photoshop.uxp.command_result.v1';
const nativeFetch = globalThis.fetch;

function pluginPoll(base: string, init?: RequestInit, includeMetadata = true): Promise<Response> {
  const suffix = includeMetadata
    ? `?protocol=${encodeURIComponent(TEST_REGISTRATION_PROTOCOL)}&revision=${encodeURIComponent(TEST_BRIDGE_REVISION)}&photoshopVersion=27.0.1&documentCount=1&activeDocumentId=42&activeDocumentName=Parity.psd`
    : '';
  return fetch(`${base}/poll${suffix}`, init);
}

async function waitForPendingPoll(base: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await fetch(`${base}/health`);
    const body = (await health.json()) as { waiting_long_polls?: number };
    if ((body.waiting_long_polls ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for UXP test long-poll registration');
}

async function waitForPendingCommand(base: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const health = await fetch(`${base}/health`);
    const body = (await health.json()) as { pending?: number };
    if ((body.pending ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for queued UXP test command');
}

describe('UXP bridge long-poll transport', () => {
  let bridge: typeof import('./uxp-bridge-server.js');
  let base = '';
  let receiptDirectory = '';

  beforeAll(async () => {
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith('/result') && init?.body) {
        try {
          const parsed = JSON.parse(String(init.body)) as { id?: string; protocol?: string };
          if (parsed.id) {
            await nativeFetch(url.replace(/\/result$/, '/claim'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: parsed.id }),
            });
          }
          if (parsed.protocol === undefined) {
            init = {
              ...init,
              body: JSON.stringify({ protocol: TEST_RESULT_PROTOCOL, ...parsed }),
            };
          }
        } catch {
          // Preserve invalid-json behavior under test.
        }
      }
      return nativeFetch(input instanceof Request ? input : String(input), init);
    }) as typeof fetch;
    process.env.PHOTOSHOP_UXP_BRIDGE_PORT = '39452';
    receiptDirectory = mkdtempSync(path.join(tmpdir(), 'photoshop-uxp-receipts-'));
    process.env.PHOTOSHOP_UXP_RECEIPT_DIR = receiptDirectory;
    bridge = await import('./uxp-bridge-server.js');
    const port = await bridge.ensureUxpBridgeServer();
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    globalThis.fetch = nativeFetch;
    await bridge.shutdownUxpBridgeServer();
    delete process.env.PHOTOSHOP_UXP_RECEIPT_DIR;
    rmSync(receiptDirectory, { recursive: true, force: true });
  });

  it('holds /poll until a command exists and resolves the caller immediately on /result', async () => {
    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);

    const started = performance.now();
    const invokePromise = bridge.invokeUxpBridge('diagnostic_ping', {}, 2_000);
    const pollResponse = await pollPromise;
    expect(pollResponse.status).toBe(200);
    const command = (await pollResponse.json()) as { id: string; action: string };
    expect(command.action).toBe('diagnostic_ping');

    const resultPayload = { protocol: TEST_RESULT_PROTOCOL, id: command.id, ok: true, data: { transport: 'uxp-test' } };
    const post = await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resultPayload),
    });
    expect(post.status).toBe(200);

    await expect(invokePromise).resolves.toEqual(resultPayload);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('does not dispatch a UXP command after the shared logical deadline has expired', async () => {
    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);

    await expect(
      withToolExecutionContext(
        { deadlineAt: Date.now() - 1 },
        () => bridge.invokeUxpBridge('paint_strokes', { strokes: [] }, 60_000)
      )
    ).rejects.toThrow(/deadline exhausted.*not executed/i);

    const liveInvoke = bridge.invokeUxpBridge('diagnostic_ping', {}, 2_000);
    const pollResponse = await pollPromise;
    const command = (await pollResponse.json()) as { id: string; action: string };
    expect(command.action).toBe('diagnostic_ping');

    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: command.id, ok: true, data: { transport: 'uxp-test' } }),
    });
    await expect(liveInvoke).resolves.toMatchObject({ ok: true });
  });

  it('reports long-poll transport and connected plugin state after a poll', async () => {
    const pendingPoll = pluginPoll(base);
    await waitForPendingPoll(base);

    const health = await fetch(`${base}/health`);
    const body = (await health.json()) as {
      ok: boolean;
      plugin_connected: boolean;
      waiting_long_polls: number;
      transport: string;
    };

    expect(body.ok).toBe(true);
    expect(body.plugin_connected).toBe(true);
    expect(body.waiting_long_polls).toBeGreaterThanOrEqual(1);
    expect(body.transport).toBe('long-poll');

    const cleanupInvoke = bridge.invokeUxpBridge('diagnostic_ping', {}, 2_000);
    const cleanupResponse = await pendingPoll;
    const cleanupCommand = await cleanupResponse.json() as { id: string };
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cleanupCommand.id, ok: true, data: { transport: 'uxp-test' } }),
    });
    await expect(cleanupInvoke).resolves.toMatchObject({ ok: true });
  });

  it('builds and caches structured UXP readiness with exact bridge revision and active document', async () => {
    const client = await import('./uxp-bridge-client.js');
    client.clearUxpBridgeReadinessCache();

    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);
    const first = await client.getUxpBridgeReadiness({ forceRefresh: true });
    expect(first).toMatchObject({
      ready: true,
      transport: 'uxp',
      bridge_transport: 'long-poll',
      bridge_revision: client.EXPECTED_UXP_BRIDGE_REVISION,
      expected_bridge_revision: client.EXPECTED_UXP_BRIDGE_REVISION,
      revision_match: true,
      photoshop_version: '27.0.1',
      document_count: 1,
      active_document: { id: 42, name: 'Parity.psd' },
      plugin_connected: true,
      reason: null,
      cache: { hit: false },
    });

    const cached = await client.getUxpBridgeReadiness();
    expect(cached.ready).toBe(true);
    expect(cached.cache.hit).toBe(true);
    expect(cached.cache.age_ms).toBeGreaterThanOrEqual(0);
    const cleanupInvoke = bridge.invokeUxpBridge('diagnostic_ping', {}, 2_000);
    const cleanupCommand = await (await pollPromise).json() as { id: string };
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cleanupCommand.id, ok: true, data: { transport: 'uxp-test' } }),
    });
    await expect(cleanupInvoke).resolves.toMatchObject({ ok: true });
  });

  it('uses long-poll registration metadata for readiness without an extra diagnostic command', async () => {
    const client = await import('./uxp-bridge-client.js');
    client.clearUxpBridgeReadinessCache();

    const pendingPoll = fetch(
      `${base}/poll?protocol=${encodeURIComponent(TEST_REGISTRATION_PROTOCOL)}&revision=${encodeURIComponent(client.EXPECTED_UXP_BRIDGE_REVISION)}`
        + '&photoshopVersion=27.0.1&documentCount=1&activeDocumentId=77&activeDocumentName=Metadata.psd'
    );
    await waitForPendingPoll(base);

    const readiness = await client.getUxpBridgeReadiness({ forceRefresh: true });
    expect(readiness).toMatchObject({
      ready: true,
      bridge_revision: client.EXPECTED_UXP_BRIDGE_REVISION,
      revision_match: true,
      photoshop_version: '27.0.1',
      document_count: 1,
      active_document: { id: 77, name: 'Metadata.psd' },
      cache: { hit: false },
    });
    await expect(client.isUxpBridgeReachable()).resolves.toBe(true);

    const health = await fetch(`${base}/health`);
    const healthBody = await health.json() as { pending?: number };
    expect(healthBody.pending ?? 0).toBe(0);

    const cleanupInvoke = bridge.invokeUxpBridge('diagnostic_ping', {}, 2_000);
    const cleanupResponse = await pendingPoll;
    const cleanupCommand = await cleanupResponse.json() as { id: string };
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: cleanupCommand.id, ok: true, data: { transport: 'uxp-test' } }),
    });
    await expect(cleanupInvoke).resolves.toMatchObject({ ok: true });
    client.clearUxpBridgeReadinessCache();
  });

  it('rejects missing and stale UXP revisions before registering the companion as connected', async () => {
    const client = await import('./uxp-bridge-client.js');
    client.clearUxpBridgeReadinessCache();

    const missingResponse = await nativeFetch(
      `${base}/poll?protocol=${encodeURIComponent(TEST_REGISTRATION_PROTOCOL)}`
    );
    expect(missingResponse.status).toBe(409);
    await expect(missingResponse.json()).resolves.toMatchObject({
      error: 'uxp_bridge_revision_missing',
      bridge_revision: null,
      expected_bridge_revision: client.EXPECTED_UXP_BRIDGE_REVISION,
    });

    const staleResponse = await nativeFetch(
      `${base}/poll?protocol=${encodeURIComponent(TEST_REGISTRATION_PROTOCOL)}&revision=stale-test-revision`
    );
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toMatchObject({
      error: 'uxp_bridge_revision_mismatch',
      bridge_revision: 'stale-test-revision',
      expected_bridge_revision: client.EXPECTED_UXP_BRIDGE_REVISION,
    });

    const stale = await client.getUxpBridgeReadiness({ forceRefresh: true });
    expect(stale.ready).toBe(false);
    expect(stale.plugin_connected).toBe(false);
    expect(stale.revision_match).toBe(false);
    expect(stale.reason).not.toBeNull();
    await expect(client.isUxpBridgeReachable()).resolves.toBe(false);
    client.clearUxpBridgeReadinessCache();
  });

  it('rejects obsolete registration shapes even when they announce the current bridge revision', async () => {
    const client = await import('./uxp-bridge-client.js');
    client.clearUxpBridgeReadinessCache();

    const legacyRegistration = await nativeFetch(
      `${base}/poll?revision=${encodeURIComponent(client.EXPECTED_UXP_BRIDGE_REVISION)}&photoshopVersion=27.0.1&documentCount=1`
    );
    expect(legacyRegistration.status).toBe(409);
    await expect(legacyRegistration.json()).resolves.toMatchObject({
      error: 'uxp_bridge_registration_protocol_missing',
      registration_protocol: null,
      expected_registration_protocol: TEST_REGISTRATION_PROTOCOL,
    });

    const readiness = await client.getUxpBridgeReadiness({ forceRefresh: true });
    expect(readiness.ready).toBe(false);
    expect(readiness.plugin_connected).toBe(false);
    client.clearUxpBridgeReadinessCache();
  });

  it('current companion source emits the current registration/request/result protocol only', () => {
    const companionSource = readFileSync(path.join(process.cwd(), 'uxp-plugin', 'main.js'), 'utf8');
    expect(companionSource).toContain(`const REGISTRATION_PROTOCOL = '${TEST_REGISTRATION_PROTOCOL}'`);
    expect(companionSource).toContain(`const COMMAND_PROTOCOL = '${TEST_COMMAND_PROTOCOL}'`);
    expect(companionSource).toContain(`const RESULT_PROTOCOL = '${TEST_RESULT_PROTOCOL}'`);
    expect(companionSource).toContain('protocol=${encodeURIComponent(REGISTRATION_PROTOCOL)}');
    expect(companionSource).toContain('cmd?.protocol !== COMMAND_PROTOCOL');
    expect(companionSource).toContain('protocol: RESULT_PROTOCOL');
  });

  it('rejects direct /result for a queued command until the current companion claims it', async () => {
    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);
    const invokePromise = bridge.invokeUxpBridge('diagnostic_ping', {}, 2_000);
    const command = await (await pollPromise).json() as { id: string };

    const directResult = await nativeFetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: command.id, ok: true, data: { transport: 'old-shape' } }),
    });
    expect(directResult.status).toBe(409);
    await expect(directResult.json()).resolves.toMatchObject({ error: 'command_result_protocol_missing' });

    await nativeFetch(`${base}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: command.id }),
    });
    await nativeFetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: TEST_RESULT_PROTOCOL,
        id: command.id,
        ok: true,
        data: { transport: 'current-shape' },
      }),
    });
    await expect(invokePromise).resolves.toMatchObject({ ok: true });
  });

  it('rejects stale result protocol instead of adapting it to the current receipt/result contour', async () => {
    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);
    const invokePromise = bridge.invokeUxpBridge('diagnostic_ping', {}, 2_000);
    const command = await (await pollPromise).json() as { id: string };
    await nativeFetch(`${base}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: command.id }),
    });

    const staleResult = await nativeFetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: 'photoshop.uxp.command_result.v0',
        id: command.id,
        ok: true,
        data: { transport: 'obsolete' },
      }),
    });
    expect(staleResult.status).toBe(409);
    await expect(staleResult.json()).resolves.toMatchObject({
      error: 'command_result_protocol_mismatch',
      result_protocol: 'photoshop.uxp.command_result.v0',
      expected_result_protocol: TEST_RESULT_PROTOCOL,
    });

    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: TEST_RESULT_PROTOCOL,
        id: command.id,
        ok: true,
        data: { transport: 'current' },
      }),
    });
    await expect(invokePromise).resolves.toMatchObject({
      protocol: TEST_RESULT_PROTOCOL,
      ok: true,
      data: { transport: 'current' },
    });
  });

  it('dispatches non-interfering save_document requests through the UXP bridge', async () => {
    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);

    const { invokeUxpSaveDocument } = await import('./uxp-bridge-client.js');
    const savePromise = invokeUxpSaveDocument({
      path: 'C:\\Temp\\checkpoint.psd',
      format: 'PSD',
      document_id: 42,
    });

    const pollResponse = await pollPromise;
    expect(pollResponse.status).toBe(200);
    const command = (await pollResponse.json()) as {
      id: string;
      action: string;
      params: Record<string, unknown>;
    };
    expect(command.action).toBe('save_document');
    expect(command.params).toMatchObject({
      path: 'C:\\Temp\\checkpoint.psd',
      format: 'PSD',
      document_id: 42,
    });

    const resultPayload = {
      id: command.id,
      ok: true,
      data: {
        transport: 'uxp-test',
        path: command.params.path,
        format: 'PSD',
        as_copy: true,
        invariants: {
          active_document_unchanged: true,
          working_path_unchanged: true,
          active_layers_unchanged: true,
          active_tool_unchanged: true,
          selection_unchanged: true,
        },
        invariants_ok: true,
      },
    };
    const post = await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resultPayload),
    });
    expect(post.status).toBe(200);
    await expect(savePromise).resolves.toEqual({ ok: true, data: resultPayload.data });
  });

  it('dispatches semantic get_state reads through the UXP bridge', async () => {
    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);

    const { invokeUxpGetState } = await import('./uxp-bridge-client.js');
    const statePromise = invokeUxpGetState();

    const pollResponse = await pollPromise;
    const command = (await pollResponse.json()) as {
      id: string;
      action: string;
      params: Record<string, unknown>;
    };
    expect(command.action).toBe('get_state');
    expect(command.params).toEqual({});

    const state = {
      hasDocument: true,
      document: { id: 42, name: 'Parity.psd', width: 1024, height: 768 },
      activeLayer: { name: 'Layer 1', kind: 'LayerKind.NORMAL' },
    };
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: command.id, ok: true, data: state }),
    });

    await expect(statePromise).resolves.toEqual({ ok: true, data: state });
  });

  it('exposes semantic get_state as a read-only diagnostic endpoint', async () => {
    const requestPromise = fetch(`${base}/diagnostic/state`, { method: 'POST' });

    const pollResponse = await pluginPoll(base);
    const command = (await pollResponse.json()) as {
      id: string;
      action: string;
      params: Record<string, unknown>;
    };
    expect(command.action).toBe('get_state');
    expect(command.params).toEqual({});

    const state = { hasDocument: false };
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: command.id, ok: true, data: state }),
    });

    const response = await requestPromise;
    expect(response.status).toBe(200);
    const payload = await response.json() as {
      ok: boolean;
      data: typeof state;
      round_trip_ms: number;
    };
    expect(payload.ok).toBe(true);
    expect(payload.data).toEqual(state);
    expect(payload.round_trip_ms).toBeGreaterThanOrEqual(0);
  });

  it.each([
    ['/diagnostic/list-documents', 'list_documents', { ok: true, count: 0, documents: [] }],
    [
      '/diagnostic/selection-bounds',
      'get_selection_bounds',
      { ok: true, has_selection: false, context: { hasDocument: true } },
    ],
    [
      '/diagnostic/layers',
      'list_layers',
      { layerCount: 1, layers: [{ id: 1, name: 'Background' }], context: { hasDocument: true } },
    ],
    [
      '/diagnostic/brush-presets',
      'list_brush_presets',
      { ok: true, total: 1, matched: 1, truncated: false, presets: ['Soft Round'] },
    ],
    [
      '/diagnostic/brush-settings',
      'get_brush_settings',
      { ok: true, settings: { size: 80, hardness: 0, opacity: 100, flow: 100 } },
    ],
    [
      '/diagnostic/history',
      'get_history',
      {
        totalStates: 2,
        currentIndex: 1,
        currentState: 'New',
        canUndo: true,
        canRedo: false,
        states: [{ name: 'New Document', snapshot: true }, { name: 'New', snapshot: false }],
      },
    ],
  ])('exposes %s through the read-only diagnostic lane', async (path, action, data) => {
    const requestPromise = fetch(`${base}${path}`, { method: 'POST' });

    const pollResponse = await pluginPoll(base);
    const command = (await pollResponse.json()) as {
      id: string;
      action: string;
      params: Record<string, unknown>;
    };
    expect(command.action).toBe(action);
    expect(command.params).toEqual({});

    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: command.id, ok: true, data }),
    });

    const response = await requestPromise;
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      data: typeof data;
      round_trip_ms: number;
    };
    expect(payload.ok).toBe(true);
    expect(payload.data).toEqual(data);
    expect(payload.round_trip_ms).toBeGreaterThanOrEqual(0);
  });

  it('exposes preview capture through the read-only diagnostic lane', async () => {
    const requestPromise = fetch(`${base}/diagnostic/preview`, { method: 'POST' });

    const pollResponse = await pluginPoll(base);
    const command = (await pollResponse.json()) as {
      id: string;
      action: string;
      params: Record<string, unknown>;
    };
    expect(command.action).toBe('capture_preview');
    expect(command.params).toEqual({ max_dimension_px: 1024 });

    const data = {
      transport: 'uxp',
      whole: { width: 64, height: 48, mimeType: 'image/jpeg', base64: 'AA==' },
    };
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: command.id, ok: true, data }),
    });

    const response = await requestPromise;
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      data: typeof data;
      round_trip_ms: number;
    };
    expect(payload.ok).toBe(true);
    expect(payload.data).toEqual(data);
    expect(payload.round_trip_ms).toBeGreaterThanOrEqual(0);
  });

  it.each([
    [
      '/diagnostic/sample-color',
      'sample_color',
      { x: 0, y: 0, radius: 0 },
      { ok: true, point: { x: 0, y: 0 }, hex: '#FFFFFF' },
    ],
    [
      '/diagnostic/sample-colors',
      'sample_colors',
      { points: [{ id: 'origin', x: 0, y: 0 }] },
      { ok: true, count: 1, samples: [{ id: 'origin', hex: '#FFFFFF' }] },
    ],
  ])('exposes %s through the imaging diagnostic lane', async (path, action, params, data) => {
    const requestPromise = fetch(`${base}${path}`, { method: 'POST' });
    const pollResponse = await pluginPoll(base);
    const command = (await pollResponse.json()) as {
      id: string;
      action: string;
      params: Record<string, unknown>;
    };
    expect(command.action).toBe(action);
    expect(command.params).toEqual(params);
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: command.id, ok: true, data }),
    });
    const response = await requestPromise;
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      ok: boolean;
      data: typeof data;
      round_trip_ms: number;
    };
    expect(payload.ok).toBe(true);
    expect(payload.data).toEqual(data);
    expect(payload.round_trip_ms).toBeGreaterThanOrEqual(0);
  });

  it('durably proves queued commands not-claimed and permits one intentional retry under the same id', async () => {
    const commandId = 'guard-create-not-claimed-retry';
    const params = { width: 640, height: 480, resolution: 72, colorMode: 'RGB' };
    const first = bridge.invokeUxpBridge('create_document', params, 40, { commandId });
    await waitForPendingCommand(base);
    await expect(first).resolves.toMatchObject({
      id: commandId,
      ok: false,
      error: 'uxp_bridge_not_claimed',
    });
    expect(bridge.getUxpBridgeCommandReceipt(commandId)).toMatchObject({
      command_id: commandId,
      state: 'not-claimed',
      terminal: true,
    });

    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);
    const retry = bridge.invokeUxpBridge('create_document', params, 2_000, { commandId });
    const command = await (await pollPromise).json() as { id: string; action: string };
    expect(command).toMatchObject({ id: commandId, action: 'create_document' });

    const claim = await fetch(`${base}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: commandId }),
    });
    expect(await claim.json()).toMatchObject({ ok: true, execute: true, receipt: { state: 'claimed' } });

    const resultPayload = {
      protocol: TEST_RESULT_PROTOCOL,
      id: commandId,
      ok: true,
      data: { transport: 'uxp-test', document: { id: 901, name: 'Recovered.psd' } },
    };
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resultPayload),
    });
    await expect(retry).resolves.toEqual(resultPayload);

    await expect(
      bridge.invokeUxpBridge('create_document', params, 100, { commandId })
    ).resolves.toEqual(resultPayload);
    const secondClaim = await fetch(`${base}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: commandId }),
    });
    expect(await secondClaim.json()).toMatchObject({ ok: true, execute: false, receipt: { state: 'completed' } });
  });

  it('never redispatches a claimed stable command while a result is uncertain', async () => {
    const commandId = 'guard-open-claimed-timeout';
    const params = { filePath: 'C:\\Temp\\source.png' };
    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);
    const first = bridge.invokeUxpBridge('open_image', params, 50, { commandId });
    const command = await (await pollPromise).json() as { id: string; action: string };
    expect(command).toMatchObject({ id: commandId, action: 'open_image' });
    const claim = await fetch(`${base}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: commandId }),
    });
    expect(await claim.json()).toMatchObject({ ok: true, execute: true });
    await expect(first).resolves.toMatchObject({
      id: commandId,
      ok: false,
      error: 'uxp_bridge_claimed_timeout',
      receipt: { state: 'claimed' },
    });

    const recovery = bridge.invokeUxpBridge('open_image', params, 2_000, { commandId });
    const health = await fetch(`${base}/health`);
    expect(await health.json()).toMatchObject({ pending: 0 });
    const resultPayload = {
      protocol: TEST_RESULT_PROTOCOL,
      id: commandId,
      ok: true,
      data: { transport: 'uxp-test', document: { id: 902, name: 'source.png' } },
    };
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(resultPayload),
    });
    await expect(recovery).resolves.toEqual(resultPayload);
  });

  it('recovers a lost brush-preset setter response from the same durable command with exactly one setter delivery', async () => {
    const client = await import('./uxp-bridge-client.js');
    client.clearUxpBridgeReadinessCache();
    const commandId = 'guard-brush-preset-lost-response';
    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);

    const setter = client.invokeUxpSelectBrushPreset('Round', commandId, {
      initialTimeoutMs: 35,
      recoveryTimeoutMs: 500,
    });
    const command = await (await pollPromise).json() as { id: string; action: string; params: Record<string, unknown> };
    let setterDeliveries = 0;
    if (command.action === 'select_brush_preset') setterDeliveries += 1;
    expect(command).toMatchObject({
      id: commandId,
      action: 'select_brush_preset',
      params: { name: 'Round' },
    });
    const claim = await fetch(`${base}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: commandId }),
    });
    expect(await claim.json()).toMatchObject({ execute: true, receipt: { state: 'claimed' } });

    await new Promise((resolve) => setTimeout(resolve, 70));
    const health = await fetch(`${base}/health`);
    expect(await health.json()).toMatchObject({ pending: 0 });
    expect(bridge.getUxpBridgeCommandReceipt(commandId)).toMatchObject({ state: 'claimed' });

    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: TEST_RESULT_PROTOCOL,
        id: commandId,
        ok: true,
        data: { preset: 'Round', settings: { size: 36, hardness: 80 } },
      }),
    });
    await expect(setter).resolves.toMatchObject({
      ok: true,
      command_id: commandId,
      data: { preset: 'Round', settings: { size: 36, hardness: 80 } },
      receipt: { state: 'completed', terminal: true },
    });
    expect(setterDeliveries).toBe(1);
    const terminal = bridge.getUxpBridgeCommandReceipt(commandId);
    expect(terminal).toMatchObject({ state: 'completed', result: { ok: true } });
  });

  it('uses authoritative brush readback after a claimed lost response without dispatching the setter twice', async () => {
    const client = await import('./uxp-bridge-client.js');
    client.clearUxpBridgeReadinessCache();
    const commandId = 'guard-set-brush-readback-recovery';
    const setterPoll = pluginPoll(base);
    await waitForPendingPoll(base);

    const setter = client.invokeUxpSetBrush({ hardness: 70, opacity: 82 }, commandId, {
      initialTimeoutMs: 30,
      recoveryTimeoutMs: 30,
    });
    const setterCommand = await (await setterPoll).json() as { id: string; action: string };
    let setterDeliveries = 0;
    if (setterCommand.action === 'set_brush') setterDeliveries += 1;
    expect(setterCommand).toMatchObject({ id: commandId, action: 'set_brush' });
    await fetch(`${base}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: commandId }),
    });

    const readbackPoll = pluginPoll(base);
    const readbackCommand = await (await readbackPoll).json() as { id: string; action: string };
    expect(readbackCommand.action).toBe('get_brush_settings');
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: TEST_RESULT_PROTOCOL,
        id: readbackCommand.id,
        ok: true,
        data: { settings: { hardness: 70, opacity: 82 } },
      }),
    });

    await expect(setter).resolves.toMatchObject({
      ok: true,
      command_id: commandId,
      data: {
        settings: { hardness: 70, opacity: 82 },
        setter_recovery: {
          protocol: 'photoshop.uxp.setter_recovery.v1',
          mode: 'authoritative-readback',
          command_id: commandId,
          receipt_state: 'claimed',
        },
      },
      receipt: { state: 'claimed', terminal: false },
    });
    expect(setterDeliveries).toBe(1);
    expect(bridge.getUxpBridgeCommandReceipt(commandId)).toMatchObject({ state: 'claimed' });
    const health = await fetch(`${base}/health`);
    expect(await health.json()).toMatchObject({ pending: 0 });
  });

  it('can atomically cancel a durable queued command as not-claimed', async () => {
    const commandId = 'guard-cancel-queued';
    const invoke = bridge.invokeUxpBridge(
      'create_document',
      { width: 320, height: 240, resolution: 72, colorMode: 'RGB' },
      2_000,
      { commandId }
    );
    await waitForPendingCommand(base);
    const receipt = await bridge.cancelUxpBridgeCommandIfQueued(commandId);
    expect(receipt).toMatchObject({ state: 'not-claimed', terminal: true });
    await expect(invoke).resolves.toMatchObject({ error: 'uxp_bridge_not_claimed' });
    const health = await fetch(`${base}/health`);
    expect(await health.json()).toMatchObject({ pending: 0 });
  });

  it('probes durable receipt, absent, and corrupt journal states without dispatch', async () => {
    const receiptId = 'guard-probe-not-claimed';
    const invoke = bridge.invokeUxpBridge(
      'create_document',
      { width: 200, height: 120, resolution: 72, colorMode: 'RGB' },
      2_000,
      { commandId: receiptId }
    );
    await waitForPendingCommand(base);
    await bridge.cancelUxpBridgeCommandIfQueued(receiptId);
    await expect(invoke).resolves.toMatchObject({ error: 'uxp_bridge_not_claimed' });
    await expect(bridge.probeUxpBridgeCommandReceipt(receiptId)).resolves.toMatchObject({
      status: 'receipt',
      receipt: { command_id: receiptId, state: 'not-claimed', terminal: true },
    });

    const client = await import('./uxp-bridge-client.js');
    await expect(client.probeUxpStableCommandReceipt(receiptId)).resolves.toMatchObject({
      status: 'receipt',
      receipt: { state: 'not-claimed' },
    });
    await expect(bridge.probeUxpBridgeCommandReceipt('guard-probe-absent')).resolves.toEqual({
      status: 'absent',
    });

    const corruptId = 'guard-probe-corrupt';
    const corruptDigest = createHash('sha256').update(corruptId).digest('hex');
    writeFileSync(path.join(receiptDirectory, `${corruptDigest}.json`), '{broken-json', 'utf8');
    await expect(bridge.probeUxpBridgeCommandReceipt(corruptId)).resolves.toEqual({
      status: 'corrupt',
    });
    await expect(client.probeUxpStableCommandReceipt(corruptId)).resolves.toEqual({
      status: 'corrupt',
    });
  });

  it('rejects a stale UXP revision before stable bootstrap dispatch', async () => {
    const client = await import('./uxp-bridge-client.js');
    client.clearUxpBridgeReadinessCache();
    const stalePoll = await nativeFetch(
      `${base}/poll?protocol=${encodeURIComponent(TEST_REGISTRATION_PROTOCOL)}&revision=stale-bootstrap-revision&photoshopVersion=27.0.1&documentCount=0`
    );
    expect(stalePoll.status).toBe(409);
    await expect(stalePoll.json()).resolves.toMatchObject({
      error: 'uxp_bridge_revision_mismatch',
      bridge_revision: 'stale-bootstrap-revision',
      expected_bridge_revision: client.EXPECTED_UXP_BRIDGE_REVISION,
    });

    await expect(
      client.invokeUxpCreateDocument(
        { width: 320, height: 240, resolution: 72, colorMode: 'RGB' },
        'guard-stale-revision-create'
      )
    ).resolves.toMatchObject({
      ok: false,
      error: 'uxp_bridge_revision_mismatch',
      receipt: null,
      pre_dispatch_rejected: true,
    });
    expect(bridge.getUxpBridgeCommandReceipt('guard-stale-revision-create')).toBeNull();
    client.clearUxpBridgeReadinessCache();
  });

  it('routes photoshop_create_document through the stable UXP command identity without exposing it in schema', async () => {
    const client = await import('./uxp-bridge-client.js');
    client.clearUxpBridgeReadinessCache();
    const { createDocumentTools } = await import('../tools/document-tools.js');
    const tool = createDocumentTools({} as never).find(
      (definition) => definition.tool.name === 'photoshop_create_document'
    );
    expect(tool).toBeDefined();
    const schema = tool!.tool.inputSchema as { properties?: Record<string, unknown> };
    expect(schema.properties?._guard_operation_id).toBeUndefined();

    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);
    const toolPromise = tool!.handler({
      _guard_operation_id: 'guard-tool-create-route',
      width: 800,
      height: 600,
      resolution: 144,
      colorMode: 'RGB',
    });
    const command = await (await pollPromise).json() as {
      id: string;
      action: string;
      params: Record<string, unknown>;
    };
    expect(command).toEqual({
      protocol: TEST_COMMAND_PROTOCOL,
      id: 'guard-tool-create-route',
      action: 'create_document',
      params: { width: 800, height: 600, resolution: 144, colorMode: 'RGB' },
    });
    await fetch(`${base}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: command.id }),
    });
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: command.id,
        ok: true,
        data: {
          transport: 'uxp',
          operation: 'create_document',
          document: { id: 910, name: 'Untitled-1', width: 800, height: 600, resolution: 144 },
          active_document_id: 910,
        },
      }),
    });
    const result = await toolPromise;
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({
      ok: true,
      details: {
        transport: 'uxp',
        command_id: 'guard-tool-create-route',
        document: { id: 910, name: 'Untitled-1' },
        uxp_command_receipt: { state: 'completed' },
      },
    });
  });

  it('routes photoshop_open_image through the same stable UXP receipt contour while place_image remains separate', async () => {
    const client = await import('./uxp-bridge-client.js');
    client.clearUxpBridgeReadinessCache();
    const { createImagePlacementTools } = await import('../tools/image-placement-tools.js');
    const tools = createImagePlacementTools({} as never);
    const openTool = tools.find((definition) => definition.tool.name === 'photoshop_open_image');
    const placeTool = tools.find((definition) => definition.tool.name === 'photoshop_place_image');
    expect(openTool).toBeDefined();
    expect(placeTool).toBeDefined();
    const schema = openTool!.tool.inputSchema as { properties?: Record<string, unknown> };
    expect(schema.properties?._guard_operation_id).toBeUndefined();

    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);
    const toolPromise = openTool!.handler({
      _guard_operation_id: 'guard-tool-open-route',
      filePath: 'C:\\Temp\\bootstrap.png',
    });
    const command = await (await pollPromise).json() as {
      id: string;
      action: string;
      params: Record<string, unknown>;
    };
    expect(command).toEqual({
      protocol: TEST_COMMAND_PROTOCOL,
      id: 'guard-tool-open-route',
      action: 'open_image',
      params: { filePath: 'C:\\Temp\\bootstrap.png' },
    });
    await fetch(`${base}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: command.id }),
    });
    await fetch(`${base}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: command.id,
        ok: true,
        data: {
          transport: 'uxp',
          operation: 'open_image',
          path: 'C:\\Temp\\bootstrap.png',
          document: { id: 911, name: 'bootstrap.png', width: 1024, height: 768, resolution: 72 },
          active_document_id: 911,
        },
      }),
    });
    const result = await toolPromise;
    expect(result.isError).not.toBe(true);
    const body = JSON.parse((result.content[0] as { text: string }).text);
    expect(body).toMatchObject({
      ok: true,
      details: {
        transport: 'uxp',
        command_id: 'guard-tool-open-route',
        document: { id: 911, name: 'bootstrap.png' },
        uxp_command_receipt: { state: 'completed' },
      },
    });
  });

  it('reloads a claimed durable receipt after child restart and accepts the original delayed result', async () => {
    const commandId = 'guard-claimed-child-restart';
    const params = { filePath: 'C:\\Temp\\claimed.png' };
    const pollPromise = pluginPoll(base);
    await waitForPendingPoll(base);
    const first = bridge.invokeUxpBridge('open_image', params, 50, { commandId });
    await (await pollPromise).json();
    const claim = await fetch(`${base}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: commandId }),
    });
    expect(await claim.json()).toMatchObject({ execute: true, receipt: { state: 'claimed' } });
    await expect(first).resolves.toMatchObject({ error: 'uxp_bridge_claimed_timeout' });

    await bridge.shutdownUxpBridgeServer();
    const restartedPort = await bridge.ensureUxpBridgeServer();
    base = `http://127.0.0.1:${restartedPort}`;
    expect(bridge.getUxpBridgeCommandReceipt(commandId)).toMatchObject({ state: 'claimed' });

    const recovery = bridge.invokeUxpBridge('open_image', params, 2_000, { commandId });
    const resultPayload = {
      protocol: TEST_RESULT_PROTOCOL,
      id: commandId,
      ok: true,
      data: { transport: 'uxp-test', document: { id: 912, name: 'claimed.png' } },
    };
    let posted = false;
    for (let attempt = 0; attempt < 4 && !posted; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 300);
      try {
        const response = await nativeFetch(`${base}/result`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(resultPayload),
          signal: controller.signal,
        });
        posted = response.ok;
      } catch {
        // A just-closed keep-alive socket can be reused by Node's test client.
      } finally {
        clearTimeout(timer);
      }
      if (!posted) await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(posted).toBe(true);
    await expect(recovery).resolves.toEqual(resultPayload);
    expect(bridge.getUxpBridgeCommandReceipt(commandId)).toMatchObject({
      state: 'completed',
      result: resultPayload,
    });

    await bridge.shutdownUxpBridgeServer();
    const terminalRestartedPort = await bridge.ensureUxpBridgeServer();
    base = `http://127.0.0.1:${terminalRestartedPort}`;
    expect(bridge.getUxpBridgeCommandReceipt(commandId)).toMatchObject({
      state: 'completed',
      result: resultPayload,
    });
    await expect(bridge.probeUxpBridgeCommandReceipt('guard-probe-not-claimed')).resolves.toMatchObject({
      status: 'receipt',
      receipt: { state: 'not-claimed', terminal: true },
    });
    await expect(bridge.probeUxpBridgeCommandReceipt('guard-probe-corrupt')).resolves.toEqual({
      status: 'corrupt',
    });
    await expect(bridge.probeUxpBridgeCommandReceipt('guard-probe-absent-after-reload')).resolves.toEqual({
      status: 'absent',
    });
    await expect(
      bridge.invokeUxpBridge('open_image', params, 100, { commandId })
    ).resolves.toEqual(resultPayload);
  });

});
