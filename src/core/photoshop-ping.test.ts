import { describe, expect, it } from 'vitest';
import { buildPhotoshopPingPayload } from './photoshop-ping.js';
import type { UxpBridgeReadiness } from '../platform/uxp-bridge-client.js';

function readiness(overrides: Partial<UxpBridgeReadiness> = {}): UxpBridgeReadiness {
  return {
    ready: true,
    transport: 'uxp',
    bridge_transport: 'long-poll',
    bridge_revision: 'phase11-p0-unified-guard-readiness-20260920',
    expected_bridge_revision: 'phase11-p0-unified-guard-readiness-20260920',
    revision_match: true,
    photoshop_version: '27.0.1',
    document_count: 1,
    active_document: { id: 42, name: 'Ping.psd' },
    plugin_connected: true,
    reason: null,
    checked_at: '2026-09-20T08:00:00.000Z',
    cache: { hit: false, age_ms: 4, ttl_ms: 2000 },
    ...overrides,
  };
}

describe('structured Photoshop ping payload', () => {
  it('surfaces UXP transport, revision and active-document readiness', () => {
    const payload = buildPhotoshopPingPayload(true, readiness());
    expect(payload).toMatchObject({
      ok: true,
      connected: true,
      ready: true,
      degraded: false,
      transport: 'uxp',
      photoshopVersion: '27.0.1',
      bridgeRevision: 'phase11-p0-unified-guard-readiness-20260920',
      expectedBridgeRevision: 'phase11-p0-unified-guard-readiness-20260920',
      revisionMatch: true,
      activeDocument: { id: 42, name: 'Ping.psd' },
      documentCount: 1,
      readiness: { cache: { hit: false, ttl_ms: 2000 } },
    });
  });

  it('distinguishes legacy connectivity from preferred-route readiness', () => {
    const payload = buildPhotoshopPingPayload(true, readiness({
      ready: false,
      bridge_revision: 'stale-revision',
      revision_match: false,
      reason: 'uxp_bridge_revision_mismatch',
    }));
    expect(payload).toMatchObject({
      ok: true,
      connected: true,
      ready: false,
      degraded: true,
      transport: 'extendscript',
      bridgeRevision: 'stale-revision',
      revisionMatch: false,
    });
  });
});
