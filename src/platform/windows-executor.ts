import { exec, execFile, spawn } from 'child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { prefixExtendScriptBom } from '../utils/extendscript-file.js';
import { parseExtendScriptPayload } from '../utils/extendscript-result.js';
import { Logger } from '../utils/logger.js';
import { ScriptExecutor } from './script-executor.js';
import { ScriptQueue } from './script-queue.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const FOREGROUND_GUARD_READY_TIMEOUT_MS = 2500;
const FOREGROUND_GUARD_STOP_TIMEOUT_MS = 1000;

/**
 * Windows/Photoshop can foreground the application from inside DoJavaScript even
 * when the COM client attached with GetObject instead of CreateObject. The COM
 * transport therefore needs a second protection layer: while one JSX call is in
 * flight, keep the most recently foregrounded non-Photoshop window in front if
 * Photoshop raises itself without the user explicitly interacting with it.
 *
 * The helper runs hidden and is deliberately scoped to one executor call. It does
 * not pin one application forever: whenever the user moves to another non-Photoshop
 * window, that window becomes the new restore target. A direct mouse/Alt-Tab style
 * interaction with Photoshop suspends restoration until the user leaves Photoshop.
 */
export function createWindowsForegroundGuardPowerShell(): string {
  return `
param([Parameter(Mandatory=$true)][string]$StopFile)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class PhotoshopMcpForegroundGuard {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool BringWindowToTop(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern IntPtr SetFocus(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr ignored);

    [DllImport("kernel32.dll")]
    public static extern uint GetCurrentThreadId();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);

    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int virtualKey);

    private static bool IsKeyDown(int virtualKey) {
        return (GetAsyncKeyState(virtualKey) & 0x8000) != 0;
    }

    public static bool IsPhotoshopWindow(IntPtr hWnd) {
        if (hWnd == IntPtr.Zero) return false;
        uint processId;
        GetWindowThreadProcessId(hWnd, out processId);
        if (processId == 0) return false;
        try {
            return String.Equals(
                Process.GetProcessById((int)processId).ProcessName,
                "Photoshop",
                StringComparison.OrdinalIgnoreCase
            );
        }
        catch {
            return false;
        }
    }

    public static bool UserIsSwitchingWindows() {
        // Mouse buttons, Alt/Tab, and Windows keys cover the normal intentional
        // ways a user brings Photoshop to the foreground while a call is running.
        return IsKeyDown(0x01) || IsKeyDown(0x02) || IsKeyDown(0x04) ||
               IsKeyDown(0x09) || IsKeyDown(0x12) ||
               IsKeyDown(0x5B) || IsKeyDown(0x5C);
    }

    public static bool Restore(IntPtr target) {
        if (target == IntPtr.Zero || !IsWindow(target)) return false;

        IntPtr foreground = GetForegroundWindow();
        uint currentThread = GetCurrentThreadId();
        uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, IntPtr.Zero);
        uint targetThread = GetWindowThreadProcessId(target, IntPtr.Zero);

        bool attachedForeground = false;
        bool attachedTarget = false;
        try {
            if (foregroundThread != 0 && foregroundThread != currentThread) {
                attachedForeground = AttachThreadInput(currentThread, foregroundThread, true);
            }
            if (targetThread != 0 && targetThread != currentThread && targetThread != foregroundThread) {
                attachedTarget = AttachThreadInput(currentThread, targetThread, true);
            }

            BringWindowToTop(target);
            SetForegroundWindow(target);
            SetFocus(target);
            return GetForegroundWindow() == target;
        }
        finally {
            if (attachedTarget) AttachThreadInput(currentThread, targetThread, false);
            if (attachedForeground) AttachThreadInput(currentThread, foregroundThread, false);
        }
    }
}
"@

$lastUserWindow = [PhotoshopMcpForegroundGuard]::GetForegroundWindow()
if ([PhotoshopMcpForegroundGuard]::IsPhotoshopWindow($lastUserWindow)) {
    $lastUserWindow = [IntPtr]::Zero
}
$userChosePhotoshop = $false
$restoreCount = 0

Write-Output 'READY'
[Console]::Out.Flush()

while (-not (Test-Path -LiteralPath $StopFile)) {
    $foreground = [PhotoshopMcpForegroundGuard]::GetForegroundWindow()

    if ([PhotoshopMcpForegroundGuard]::IsPhotoshopWindow($foreground)) {
        if ([PhotoshopMcpForegroundGuard]::UserIsSwitchingWindows()) {
            $userChosePhotoshop = $true
        }
        elseif (-not $userChosePhotoshop -and $lastUserWindow -ne [IntPtr]::Zero) {
            if ([PhotoshopMcpForegroundGuard]::Restore($lastUserWindow)) {
                $restoreCount++
            }
        }
    }
    elseif ($foreground -ne [IntPtr]::Zero) {
        $lastUserWindow = $foreground
        $userChosePhotoshop = $false
    }

    Start-Sleep -Milliseconds 16
}

Write-Output ("RESTORES:" + $restoreCount)
[Console]::Out.Flush()
`.trim();
}

export function createWindowsPhotoshopVBSWrapper(
  jsxPath: string,
  allowUiActivation: boolean = false
): string {
  const activationFallback = allowUiActivation
    ? `
    Err.Clear
    Set photoshopApp = CreateObject("Photoshop.Application")
    If Err.Number <> 0 Then
        WScript.Echo "ERROR: Failed to connect to Photoshop - " & Err.Description
        WScript.Quit 1
    End If`
    : `
    WScript.Echo "ERROR: Background-safe attach to the running Photoshop COM object failed. Refusing CreateObject because it may activate/foreground Photoshop. Set PHOTOSHOP_MCP_ALLOW_UI_ACTIVATION=1 only when foreground activation is explicitly allowed."
    WScript.Quit 1`;

  return `
On Error Resume Next
Dim photoshopApp

' Background-safe default: attach to the already-running COM application.
' CreateObject is intentionally forbidden unless UI activation was explicitly
' opted into because repeatedly creating/activating the Photoshop COM server can
' bring Photoshop to the foreground on Windows.
Set photoshopApp = GetObject(, "Photoshop.Application")

If Err.Number <> 0 Then${activationFallback}
End If

' Execute the JSX script
Dim result
result = photoshopApp.DoJavaScript("$.evalFile('" & Replace("${jsxPath}", "\\", "\\\\") & "')")

If Err.Number <> 0 Then
    WScript.Echo "ERROR: " & Err.Description
    WScript.Quit 1
Else
    WScript.Echo result
End If
`.trim();
}

export class WindowsExecutor implements ScriptExecutor {
  private logger: Logger;
  private scriptQueue = new ScriptQueue();

  constructor() {
    this.logger = new Logger('WindowsExecutor');
  }

  async execute(script: string, timeout: number = 30000): Promise<unknown> {
    return this.scriptQueue.execute((remaining) => this.executeScript(script, remaining), timeout);
  }

  private async executeScript(script: string, timeout: number): Promise<unknown> {
    // For Windows, we'll use a combination of VBScript/JScript to communicate with Photoshop via COM
    // Write script to temporary file
    const id = randomUUID();
    const tempScriptPath = join(tmpdir(), `photoshop-script-${id}.jsx`);
    const protectForeground = process.env.PHOTOSHOP_MCP_ALLOW_UI_ACTIVATION !== '1';
    const focusGuardPath = join(tmpdir(), `photoshop-focus-guard-${id}.ps1`);
    const focusGuardStopPath = join(tmpdir(), `photoshop-focus-guard-${id}.stop`);
    
    try {
      await writeFile(tempScriptPath, prefixExtendScriptBom(script), 'utf8');

      // Use VBScript to execute the JSX script via COM
      const vbsScript = createWindowsPhotoshopVBSWrapper(
        tempScriptPath,
        process.env.PHOTOSHOP_MCP_ALLOW_UI_ACTIVATION === '1'
      );
      const vbsPath = join(tmpdir(), `photoshop-vbs-${id}.vbs`);
      
      await writeFile(vbsPath, vbsScript, 'utf8');

      try {
        let focusGuard: ReturnType<typeof spawn> | null = null;
        let focusGuardOutput = '';

        if (protectForeground) {
          await unlink(focusGuardStopPath).catch(() => {});
          await writeFile(focusGuardPath, createWindowsForegroundGuardPowerShell(), 'utf8');

          focusGuard = spawn(
            'powershell.exe',
            [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              focusGuardPath,
              '-StopFile',
              focusGuardStopPath,
            ],
            {
              windowsHide: true,
              stdio: ['ignore', 'pipe', 'pipe'],
            }
          );

          focusGuard.stdout?.on('data', (chunk: Buffer | string) => {
            focusGuardOutput += chunk.toString();
          });
          focusGuard.stderr?.on('data', (chunk: Buffer | string) => {
            focusGuardOutput += chunk.toString();
          });

          await new Promise<void>((resolve, reject) => {
            let settled = false;
            const finish = (error?: Error) => {
              if (settled) return;
              settled = true;
              clearInterval(probe);
              clearTimeout(timer);
              focusGuard?.off('error', onError);
              focusGuard?.off('exit', onExit);
              if (error) reject(error);
              else resolve();
            };
            const onError = (error: Error) => finish(error);
            const onExit = (code: number | null) =>
              finish(new Error(`Foreground guard exited before READY (code ${code ?? 'unknown'}): ${focusGuardOutput.trim()}`));
            const probe = setInterval(() => {
              if (focusGuardOutput.includes('READY')) finish();
            }, 10);
            const timer = setTimeout(
              () => finish(new Error(`Foreground guard did not become ready within ${FOREGROUND_GUARD_READY_TIMEOUT_MS}ms: ${focusGuardOutput.trim()}`)),
              FOREGROUND_GUARD_READY_TIMEOUT_MS
            );
            focusGuard?.once('error', onError);
            focusGuard?.once('exit', onExit);
          });
        }

        // Execute VBScript
        try {
          const { stdout, stderr } = await execFileAsync('cscript.exe', ['//nologo', vbsPath], {
            timeout,
            windowsHide: true,
            maxBuffer: 4 * 1024 * 1024,
          });

          if (stderr) {
            this.logger.warn('Script execution warning:', stderr);
          }

          // Parse result
          return this.parseResult(stdout);
        } finally {
          if (focusGuard) {
            await writeFile(focusGuardStopPath, 'stop', 'utf8').catch(() => {});
            await new Promise<void>((resolve) => {
              if (focusGuard!.exitCode !== null) {
                resolve();
                return;
              }
              const timer = setTimeout(() => {
                focusGuard!.kill();
                resolve();
              }, FOREGROUND_GUARD_STOP_TIMEOUT_MS);
              focusGuard!.once('exit', () => {
                clearTimeout(timer);
                resolve();
              });
            });

            const restoreMatch = focusGuardOutput.match(/RESTORES:(\d+)/);
            const restoreCount = restoreMatch ? Number.parseInt(restoreMatch[1], 10) : 0;
            if (restoreCount > 0) {
              this.logger.debug(`Foreground guard prevented ${restoreCount} Photoshop focus takeover(s)`);
            }
          }
        }
      } finally {
        // Cleanup VBS file
        await unlink(vbsPath).catch(() => {});
        await unlink(focusGuardStopPath).catch(() => {});
        await unlink(focusGuardPath).catch(() => {});
      }
    } finally {
      // Cleanup JSX file
      await unlink(tempScriptPath).catch(() => {});
    }
  }

  private parseResult(output: string): unknown {
    const trimmed = output.trim();
    
    // Check for error
    if (trimmed.startsWith('ERROR:')) {
      throw new Error(trimmed.substring(6).trim());
    }

    return parseExtendScriptPayload(trimmed);
  }

  async isPhotoshopRunning(): Promise<boolean> {
    try {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Photoshop.exe"');
      return stdout.toLowerCase().includes('photoshop.exe');
    } catch {
      return false;
    }
  }

  async launchPhotoshop(photoshopPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.logger.info(`Launching Photoshop: ${photoshopPath}`);

      const child = spawn(photoshopPath, [], {
        detached: true,
        stdio: 'ignore',
      });

      child.unref();

      // Wait a bit for Photoshop to start
      setTimeout(() => {
        resolve();
      }, 5000);

      child.on('error', (error) => {
        reject(new Error(`Failed to launch Photoshop: ${error.message}`));
      });
    });
  }
}
