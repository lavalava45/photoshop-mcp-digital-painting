import { describe, expect, it } from 'vitest';
import {
  createWindowsForegroundGuardPowerShell,
  createWindowsPhotoshopVBSWrapper,
} from './windows-executor.js';

describe('Windows Photoshop COM background safety', () => {
  it('uses GetObject only in the default background-safe mode', () => {
    const script = createWindowsPhotoshopVBSWrapper('C:\\Temp\\probe.jsx');

    expect(script).toContain('GetObject(, "Photoshop.Application")');
    expect(script).not.toContain('CreateObject("Photoshop.Application")');
    expect(script).toContain('Refusing CreateObject');
  });

  it('keeps GetObject first when UI activation is explicitly allowed', () => {
    const script = createWindowsPhotoshopVBSWrapper('C:\\Temp\\probe.jsx', true);
    const getObjectIndex = script.indexOf('GetObject(, "Photoshop.Application")');
    const createObjectIndex = script.indexOf('CreateObject("Photoshop.Application")');

    expect(getObjectIndex).toBeGreaterThanOrEqual(0);
    expect(createObjectIndex).toBeGreaterThan(getObjectIndex);
  });

  it('ships a foreground guard for DoJavaScript focus takeovers', () => {
    const script = createWindowsForegroundGuardPowerShell();

    expect(script).toContain('GetForegroundWindow');
    expect(script).toContain('GetWindowThreadProcessId');
    expect(script).toContain('IsPhotoshopWindow');
    expect(script).toContain('SetForegroundWindow');
    expect(script).toContain('$lastUserWindow = $foreground');
    expect(script).toContain("Write-Output 'READY'");
    expect(script).toContain('RESTORES:');
  });
});
