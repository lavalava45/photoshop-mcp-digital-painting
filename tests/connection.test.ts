import { describe, expect, it, vi } from 'vitest';

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, platform: () => 'darwin' };
});

vi.mock('../src/platform/detector.js', () => ({
  PhotoshopDetector: class {
    async detect() {
      return {
        version: '27.9.1',
        path: '/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app',
        isRunning: true,
        appName: 'Adobe Photoshop 2026',
      };
    }
  },
}));

import { PhotoshopConnection } from '../src/platform/connection.js';

describe('PhotoshopConnection pre-dispatch legacy fallback transport', () => {
  it('keeps detector/version access and executes through an explicitly selected legacy executor', async () => {
    const execute = vi.fn(async (script: string) => ({ script }));
    const isPhotoshopRunning = vi.fn(async () => true);
    const launchPhotoshop = vi.fn(async () => undefined);
    const connection = new PhotoshopConnection({
      executor: { execute, isPhotoshopRunning, launchPhotoshop },
      platformType: 'darwin',
    });

    await expect(connection.getVersion()).resolves.toBe('27.9.1');
    await expect(connection.executeScript('app.version')).resolves.toEqual({ script: 'app.version' });
    expect(isPhotoshopRunning).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith('app.version', undefined);
    expect(launchPhotoshop).not.toHaveBeenCalled();
  });

  it('launches Photoshop before legacy fallback dispatch when the selected executor reports it stopped', async () => {
    const execute = vi.fn(async () => undefined);
    const isPhotoshopRunning = vi.fn(async () => false);
    const launchPhotoshop = vi.fn(async () => undefined);
    const connection = new PhotoshopConnection({
      executor: { execute, isPhotoshopRunning, launchPhotoshop },
      platformType: 'darwin',
    });

    await expect(connection.ensurePhotoshopRunning()).resolves.toBeUndefined();
    expect(launchPhotoshop).toHaveBeenCalledWith(
      '/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app'
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
