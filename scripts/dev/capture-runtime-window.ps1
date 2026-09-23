param(
  [Parameter(Mandatory = $true)][string]$Output,
  [int]$DurationSeconds = 12,
  [int]$SampleMs = 50
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ForegroundProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

function Get-ForegroundProcess {
  $window = [ForegroundProbe]::GetForegroundWindow()
  [uint32]$pidValue = 0
  [void][ForegroundProbe]::GetWindowThreadProcessId($window, [ref]$pidValue)
  if ($pidValue -eq 0) {
    return @{ pid = 0; name = $null }
  }
  try {
    $proc = Get-Process -Id $pidValue -ErrorAction Stop
    return @{ pid = [int]$pidValue; name = $proc.ProcessName }
  } catch {
    return @{ pid = [int]$pidValue; name = $null }
  }
}

function Snapshot-Processes {
  $map = @{}
  Get-Process | ForEach-Object {
    try {
      $start = $_.StartTime.ToUniversalTime().ToString('o')
    } catch {
      $start = $null
    }
    $map[[string]$_.Id] = @{
      pid = $_.Id
      name = $_.ProcessName
      start_utc = $start
    }
  }
  return $map
}

$startedUtc = [DateTime]::UtcNow
$baseline = Snapshot-Processes
$baselineForeground = Get-ForegroundProcess
$photoshopPids = @(
  $baseline.Values |
    Where-Object { $_.name -match '^Photoshop$' } |
    ForEach-Object { [int]$_.pid }
)

$foregroundTransitions = @()
$previousForegroundKey = $null
$newProcesses = @{}
$deadline = [DateTime]::UtcNow.AddSeconds($DurationSeconds)

while ([DateTime]::UtcNow -lt $deadline) {
  $fg = Get-ForegroundProcess
  $fgKey = "$($fg.pid)|$($fg.name)"
  if ($fgKey -ne $previousForegroundKey) {
    $foregroundTransitions += @{
      at_utc = [DateTime]::UtcNow.ToString('o')
      pid = $fg.pid
      name = $fg.name
    }
    $previousForegroundKey = $fgKey
  }

  Get-Process | ForEach-Object {
    $key = [string]$_.Id
    if ($_.Id -eq $PID) { return }
    if (-not $baseline.ContainsKey($key) -and -not $newProcesses.ContainsKey($key)) {
      try { $start = $_.StartTime.ToUniversalTime().ToString('o') } catch { $start = $null }
      $newProcesses[$key] = @{
        pid = $_.Id
        name = $_.ProcessName
        start_utc = $start
      }
    }
  }
  Start-Sleep -Milliseconds $SampleMs
}

$endedUtc = [DateTime]::UtcNow
$photoshopForegroundTransitions = @(
  $foregroundTransitions |
    Where-Object { $photoshopPids -contains [int]$_.pid }
)
$legacyHelperNames = @('cscript', 'wscript', 'cmd', 'osascript')
$legacyHelpers = @(
  $newProcesses.Values |
    Where-Object { $legacyHelperNames -contains ([string]$_.name).ToLowerInvariant() }
)

$result = [ordered]@{
  protocol = 'photoshop.runtime_window_trace.v1'
  started_at_utc = $startedUtc.ToString('o')
  ended_at_utc = $endedUtc.ToString('o')
  duration_ms = [int]($endedUtc - $startedUtc).TotalMilliseconds
  sample_interval_ms = $SampleMs
  monitor_pid = $PID
  photoshop_pids = $photoshopPids
  baseline_foreground = $baselineForeground
  foreground_transitions = $foregroundTransitions
  photoshop_foreground_transition_count = $photoshopForegroundTransitions.Count
  photoshop_foreground_transitions = $photoshopForegroundTransitions
  new_processes = @($newProcesses.Values | Sort-Object pid)
  legacy_helper_processes = $legacyHelpers
  no_legacy_helper_process_observed = ($legacyHelpers.Count -eq 0)
  no_photoshop_foreground_transition_observed = ($photoshopForegroundTransitions.Count -eq 0)
}

$directory = Split-Path -Parent $Output
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
$result | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -Path $Output
