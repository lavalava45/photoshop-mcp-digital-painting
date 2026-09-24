import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const BACKEND_ROUTE_TRACE_PROTOCOL = 'photoshop.backend.route.v1' as const;
const DEFAULT_TRACE_FILE = fileURLToPath(
  new URL('../../.photoshop-runtime/backend-route.ndjson', import.meta.url)
);
const MAX_TRACE_BYTES = 2 * 1024 * 1024;

export interface BackendRouteTraceEvent {
  protocol: typeof BACKEND_ROUTE_TRACE_PROTOCOL;
  at: string;
  pid: number;
  primitive: string;
  selection_phase: 'pre-dispatch';
  selected_backend: 'uxp' | 'extendscript' | null;
  uxp_supported: boolean;
  uxp_available: boolean | null;
  legacy_supported: boolean;
  legacy_available: boolean | null;
  fallback_used: boolean;
  reason: string;
}

export type BackendRouteTraceInput = Omit<
  BackendRouteTraceEvent,
  'protocol' | 'at' | 'pid' | 'selection_phase'
>;

export function backendRouteTraceFile(): string {
  return process.env.PHOTOSHOP_BACKEND_ROUTE_TRACE_FILE?.trim() || DEFAULT_TRACE_FILE;
}

export function recordBackendRouteSelection(input: BackendRouteTraceInput): void {
  const file = backendRouteTraceFile();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file) && statSync(file).size >= MAX_TRACE_BYTES) {
      const rotated = `${file}.1`;
      try {
        if (existsSync(rotated)) {
          // renameSync on Windows cannot replace an existing destination. A
          // timestamped fallback preserves the current trace without making
          // routing depend on telemetry maintenance.
          renameSync(file, `${file}.${Date.now()}.1`);
        } else {
          renameSync(file, rotated);
        }
      } catch {
        // Route tracing is observational only. Backend selection must not fail
        // because evidence rotation could not be completed.
      }
    }
    const event: BackendRouteTraceEvent = {
      protocol: BACKEND_ROUTE_TRACE_PROTOCOL,
      at: new Date().toISOString(),
      pid: process.pid,
      primitive: input.primitive,
      selection_phase: 'pre-dispatch',
      selected_backend: input.selected_backend,
      uxp_supported: input.uxp_supported,
      uxp_available: input.uxp_available,
      legacy_supported: input.legacy_supported,
      legacy_available: input.legacy_available,
      fallback_used: input.fallback_used,
      reason: input.reason,
    };
    appendFileSync(file, `${JSON.stringify(event)}\n`, 'utf8');
  } catch {
    // Evidence collection is deliberately fail-open. The acceptance harness
    // detects a missing trace and refuses to claim live route evidence.
  }
}
