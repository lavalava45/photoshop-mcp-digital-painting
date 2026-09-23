import type { UxpBridgeReadiness } from '../platform/uxp-bridge-client.js';

export interface PhotoshopPingPayload {
  ok: boolean;
  connected: boolean;
  ready: boolean;
  degraded: boolean;
  transport: 'uxp' | 'extendscript' | null;
  photoshopVersion: string | null;
  bridgeRevision: string | null;
  expectedBridgeRevision: string;
  revisionMatch: boolean;
  activeDocument: { id?: number; name?: string } | null;
  documentCount: number | null;
  readiness: UxpBridgeReadiness;
}

export function buildPhotoshopPingPayload(
  connected: boolean,
  uxp: UxpBridgeReadiness
): PhotoshopPingPayload {
  const ready = connected && uxp.ready;
  return {
    ok: connected,
    connected,
    ready,
    degraded: connected && !ready,
    transport: ready ? 'uxp' : connected ? 'extendscript' : null,
    photoshopVersion: uxp.photoshop_version,
    bridgeRevision: uxp.bridge_revision,
    expectedBridgeRevision: uxp.expected_bridge_revision,
    revisionMatch: uxp.revision_match,
    activeDocument: uxp.active_document,
    documentCount: uxp.document_count,
    readiness: uxp,
  };
}
