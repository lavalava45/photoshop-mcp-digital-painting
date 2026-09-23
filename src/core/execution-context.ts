import { AsyncLocalStorage } from 'node:async_hooks';

export interface ToolExecutionContext {
  /** Absolute epoch deadline supplied by the controller/daemon. */
  deadlineAt?: number;
  /** Guard-owned logical operation id; absent for raw/direct MCP execution. */
  guardOperationId?: string;
}

const storage = new AsyncLocalStorage<ToolExecutionContext>();

export function withToolExecutionContext<T>(context: ToolExecutionContext, run: () => Promise<T>): Promise<T> {
  return storage.run(context, run);
}

export function currentToolExecutionContext(): ToolExecutionContext | undefined {
  return storage.getStore();
}

/**
 * Returns the maximum safe timeout for the next Photoshop-side operation.
 *
 * When a controller deadline exists it is authoritative across nested tool calls
 * (including VisualMicroPlan steps). A small reserve remains for result transport,
 * cleanup and durable journal writes. Without a controller deadline we preserve the
 * historical per-script timeout.
 */
export function executionTimeoutMs(requestedMs?: number, fallbackMs = 30_000, reserveMs = 350): number {
  const requested = requestedMs === undefined ? undefined : Number(requestedMs);
  if (requested !== undefined && (!Number.isFinite(requested) || requested <= 0)) {
    throw new Error('Invalid script timeout');
  }

  const deadlineAt = storage.getStore()?.deadlineAt;
  if (!deadlineAt) return Math.max(1, Math.floor(requested ?? fallbackMs));

  const remaining = Math.floor(deadlineAt - Date.now() - reserveMs);
  if (remaining <= 0) {
    throw new Error('Logical operation deadline exhausted before Photoshop script dispatch; script not executed.');
  }

  return Math.max(1, Math.min(Math.floor(requested ?? remaining), remaining));
}
