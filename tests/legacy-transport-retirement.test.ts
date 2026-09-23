import { describe, expect, it } from 'vitest';
import { PhotoshopConnection } from '../src/platform/connection.js';
import { PhotoshopBackendRouter } from '../src/platform/photoshop-backend.js';
import type { ScriptExecutor } from '../src/platform/script-executor.js';

describe('UXP-first / pre-dispatch COM fallback contract', () => {
  it('registers UXP first and ExtendScript second in the production semantic router', () => {
    const router = new PhotoshopBackendRouter(new PhotoshopConnection()) as any;
    expect(router.backends.map((backend: any) => backend.kind)).toEqual(['uxp', 'extendscript']);
  });

  it('keeps the legacy executor reachable only through the explicit connection path', async () => {
    let executions = 0;
    const executor: ScriptExecutor = {
      execute: async () => {
        executions++;
        return { ok: true };
      },
      isPhotoshopRunning: async () => true,
      launchPhotoshop: async () => undefined,
    };
    const connection = new PhotoshopConnection({
      executor,
      platformType: 'win32',
      detector: { detect: async () => ({ version: '2026', path: 'fixture', isRunning: true }) },
    });
    await expect(connection.executeScript('return 1;')).resolves.toEqual({ ok: true });
    expect(executions).toBe(1);
  });
});
