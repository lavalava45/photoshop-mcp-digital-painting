import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { ExecutionLease } from '../src/core/execution-lease.js';

it('serializes separate MCP servers and never silently steals an abandoned lock', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ps-lease-'));
  try {
    const first = new ExecutionLease(join(dir, 'execution.lock'));
    const second = new ExecutionLease(join(dir, 'execution.lock'));
    const release = first.acquire('photoshop_paint_dabs');
    expect(() => second.acquire('photoshop_paint_dabs')).toThrow('busy or interrupted');
    release();
    second.acquire('photoshop_get_state')();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
