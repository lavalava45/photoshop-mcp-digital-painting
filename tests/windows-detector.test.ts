import { afterEach, expect, it, vi } from 'vitest';
vi.mock('child_process', () => ({ exec: vi.fn((_command, callback) => callback(null, { stdout: '', stderr: '' })) }));
vi.mock('fs/promises', () => ({
  constants: { F_OK: 0 },
  readdir: vi.fn(async () => [{ name: 'Adobe Photoshop 2026', isDirectory: () => true }, { name: 'Adobe Photoshop 2030', isDirectory: () => true }]),
  access: vi.fn(async (file: string) => { if (!file.endsWith('Adobe Photoshop 2030\\Photoshop.exe')) throw new Error('ENOENT'); }),
}));
import { WindowsDetector } from '../src/platform/windows-detector.js';
afterEach(() => vi.unstubAllEnvs());
it('discovers future installed releases without a hardcoded last year or PHOTOSHOP_PATH', async () => {
  vi.stubEnv('PHOTOSHOP_PATH', '');
  const info = await new WindowsDetector().detect();
  expect(info.path).toContain('Adobe Photoshop 2030');
});
