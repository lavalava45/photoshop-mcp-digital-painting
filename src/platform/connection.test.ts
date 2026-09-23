import { describe, expect, it } from 'vitest';
import { PhotoshopConnection, type PhotoshopInfo } from './connection.js';
import type { ScriptExecutor } from './script-executor.js';

function fixture(platformType: NodeJS.Platform, running = true) {
  let detects = 0;
  let probes = 0;
  let executions = 0;
  const info: PhotoshopInfo = {
    version: '2026',
    path: 'C:\\Program Files\\Adobe\\Adobe Photoshop 2026\\Photoshop.exe',
    isRunning: true,
  };
  const detector = {
    detect: async () => {
      detects++;
      return info;
    },
  };
  const executor: ScriptExecutor = {
    execute: async () => {
      executions++;
      return { ok: true };
    },
    isPhotoshopRunning: async () => {
      probes++;
      return running;
    },
    launchPhotoshop: async () => undefined,
  };
  const connection = new PhotoshopConnection({ detector, executor, platformType });
  return { connection, counts: () => ({ detects, probes, executions }) };
}

describe('PhotoshopConnection pre-dispatch legacy fallback', () => {
  it('executes through an injected Windows fallback executor', async () => {
    const { connection, counts } = fixture('win32');
    await expect(connection.executeScript('return 1;')).resolves.toEqual({ ok: true });
    await expect(connection.executeScript('return 2;')).resolves.toEqual({ ok: true });
    expect(counts()).toEqual({ detects: 1, probes: 2, executions: 2 });
  });

  it('executes and probes through an injected macOS fallback executor', async () => {
    const { connection, counts } = fixture('darwin');
    await expect(connection.executeScript('return 1;')).resolves.toEqual({ ok: true });
    await expect(connection.ensurePhotoshopRunning()).resolves.toBeUndefined();
    expect(counts()).toEqual({ detects: 1, probes: 2, executions: 1 });
  });
});
