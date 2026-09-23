param(
  [int]$Count = 30,
  [int]$SampleIntervalMs = 5,
  [string]$Endpoint = 'http://127.0.0.1:38452/diagnostic/state',
  [ValidateSet('state', 'ping', 'batchplay', 'documents', 'selection', 'layers', 'brushes', 'brush-settings', 'preview', 'sample-color', 'sample-colors', 'history', 'foreground-color')]
  [string]$ResponseKind = 'state',
  [ValidateSet('any', 'empty', 'open')]
  [string]$ExpectedDocumentState = 'any'
)

$ErrorActionPreference = 'Stop'

Add-Type @'
using System;
using System.Runtime.InteropServices;

public static class PhotoshopMcpForegroundProbe {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@

function Get-ForegroundProcessId {
  $processId = [uint32]0
  $hwnd = [PhotoshopMcpForegroundProbe]::GetForegroundWindow()
  if ($hwnd -eq [IntPtr]::Zero) { return 0 }
  [void][PhotoshopMcpForegroundProbe]::GetWindowThreadProcessId($hwnd, [ref]$processId)
  return [int]$processId
}

$photoshop = Get-Process -Name Photoshop -ErrorAction Stop | Select-Object -First 1
$initialPid = Get-ForegroundProcessId
$initialProcess = Get-Process -Id $initialPid -ErrorAction SilentlyContinue
if ($initialPid -eq $photoshop.Id) {
  throw 'Foreground acceptance requires a non-Photoshop window to be foreground before the probe starts'
}

$job = Start-Job -ScriptBlock {
  param($Endpoint, $Count, $ResponseKind, $ExpectedDocumentState)
  $ErrorActionPreference = 'Stop'
  $roundTrips = @()
  for ($i = 0; $i -lt $Count; $i++) {
    $response = Invoke-RestMethod -Method Post -Uri $Endpoint
    if (-not $response.ok) {
      throw "UXP state diagnostic failed on iteration $i"
    }
    if ($ExpectedDocumentState -ne 'any') {
      $hasDocument = switch ($ResponseKind) {
        'state' { [bool]$response.data.hasDocument }
        'ping' { [int]$response.data.documentCount -gt 0 }
        'batchplay' { [int]$response.data.descriptor.numberOfDocuments -gt 0 }
        'documents' { [int]$response.data.count -gt 0 }
        'selection' { [bool]$response.data.context.hasDocument }
        'layers' { [bool]$response.data.context.hasDocument }
      }
      $expectedHasDocument = $ExpectedDocumentState -eq 'open'
      if ($hasDocument -ne $expectedHasDocument) {
        throw "Expected document state '$ExpectedDocumentState' during foreground acceptance; iteration $i observed hasDocument=$hasDocument"
      }
    }
    $roundTrips += [double]$response.round_trip_ms
  }
  [pscustomobject]@{
    calls = $Count
    min_ms = ($roundTrips | Measure-Object -Minimum).Minimum
    avg_ms = [Math]::Round(($roundTrips | Measure-Object -Average).Average, 2)
    max_ms = ($roundTrips | Measure-Object -Maximum).Maximum
  }
} -ArgumentList $Endpoint, $Count, $ResponseKind, $ExpectedDocumentState

$samples = 0
$photoshopSamples = 0
$photoshopTransitions = 0
$previousPid = $initialPid

while ($job.State -in @('NotStarted', 'Running')) {
  $pidNow = Get-ForegroundProcessId
  $samples++
  if ($pidNow -eq $photoshop.Id) {
    $photoshopSamples++
    if ($previousPid -ne $photoshop.Id) {
      $photoshopTransitions++
    }
  }
  $previousPid = $pidNow
  Start-Sleep -Milliseconds $SampleIntervalMs
  $job = Get-Job -Id $job.Id
}

$jobResult = Receive-Job -Job $job
$jobState = $job.State
$jobReason = $job.ChildJobs[0].JobStateInfo.Reason
Remove-Job -Job $job

if ($jobState -ne 'Completed') {
  throw "Diagnostic worker failed: $jobReason"
}

$result = [ordered]@{
  endpoint = $Endpoint
  response_kind = $ResponseKind
  expected_document_state = $ExpectedDocumentState
  calls = $jobResult.calls
  sample_interval_ms = $SampleIntervalMs
  foreground_samples = $samples
  initial_foreground_pid = $initialPid
  initial_foreground_process = $initialProcess.ProcessName
  photoshop_pid = $photoshop.Id
  photoshop_samples = $photoshopSamples
  photoshop_transitions = $photoshopTransitions
  round_trip_ms = [ordered]@{
    min = $jobResult.min_ms
    avg = $jobResult.avg_ms
    max = $jobResult.max_ms
  }
  pass = ($photoshopSamples -eq 0 -and $photoshopTransitions -eq 0)
}

$result | ConvertTo-Json -Depth 4
if (-not $result.pass) { exit 1 }
