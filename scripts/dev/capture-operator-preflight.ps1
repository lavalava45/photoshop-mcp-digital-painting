param(
  [Parameter(Mandatory = $true)][int]$ChildPid,
  [Parameter(Mandatory = $true)][string]$Output
)

$ErrorActionPreference = 'Stop'

function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
      return ([System.BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
    } finally {
      $sha.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

function File-Evidence([string]$Path) {
  $item = Get-Item -LiteralPath $Path
  return [ordered]@{
    path = $Path.Replace((Get-Location).Path + '\', '').Replace('\', '/')
    size = $item.Length
    mtime_utc = $item.LastWriteTimeUtc.ToString('o')
    sha256 = Get-Sha256 $item.FullName
  }
}

$child = Get-CimInstance Win32_Process -Filter "ProcessId=$ChildPid"
if (-not $child) { throw "Photoshop MCP child PID $ChildPid is not running" }

$entry = File-Evidence (Join-Path (Get-Location) 'dist\cos-plugin.js')
$index = File-Evidence (Join-Path (Get-Location) 'dist\index.js')
$stateTools = File-Evidence (Join-Path (Get-Location) 'dist\tools\state-tools.js')
$connectionModule = File-Evidence (Join-Path (Get-Location) 'dist\platform\connection.js')
$creationUtc = $child.CreationDate.ToUniversalTime()
$entryMtime = [DateTime]::Parse($entry.mtime_utc).ToUniversalTime()
$indexMtime = [DateTime]::Parse($index.mtime_utc).ToUniversalTime()
$stateToolsMtime = [DateTime]::Parse($stateTools.mtime_utc).ToUniversalTime()
$connectionMtime = [DateTime]::Parse($connectionModule.mtime_utc).ToUniversalTime()

if ($creationUtc -le $entryMtime -or $creationUtc -le $indexMtime -or $creationUtc -le $stateToolsMtime -or $creationUtc -le $connectionMtime) {
  throw 'Current MCP child predates the current built dist files; restart/refresh before accepting runtime identity.'
}

$health = Invoke-RestMethod -Uri 'http://127.0.0.1:38452/health' -Method Get
if (-not $health.ok -or -not $health.plugin_connected) {
  throw 'UXP companion is not connected'
}
if ($health.bridge_revision -ne $health.expected_bridge_revision) {
  throw "UXP bridge revision mismatch: actual=$($health.bridge_revision) expected=$($health.expected_bridge_revision)"
}

$acceptedIds = @('final-build-brush-19')
$acceptedOperations = @()
foreach ($id in $acceptedIds) {
  $recordPath = Join-Path (Get-Location) ".photoshop-runtime\controller\operations\$id.json"
  if (-not (Test-Path $recordPath)) { throw "Missing acceptance operation record: $id" }
  $record = Get-Content -Raw -LiteralPath $recordPath | ConvertFrom-Json
  if ([int]$record.pid -ne $ChildPid) {
    throw "Acceptance operation $id ran under PID $($record.pid), expected current child $ChildPid"
  }
  $acceptedOperations += [ordered]@{
    operation_id = $id
    child_pid = [int]$record.pid
    tool = [string]$record.tool
    phase = [string]$record.phase
    execution = if ($record.verdict.execution_outcome) { [string]$record.verdict.execution_outcome } elseif ($record.operation_receipt.execution) { [string]$record.operation_receipt.execution } else { $null }
  }
}

$gitHead = (& git rev-parse HEAD).Trim()
$gitBranch = (& git branch --show-current).Trim()

$result = [ordered]@{
  protocol = 'photoshop.operator_preflight.v1'
  captured_at_utc = [DateTime]::UtcNow.ToString('o')
  git = [ordered]@{
    branch = $gitBranch
    head = $gitHead
  }
  loaded_child = [ordered]@{
    pid = [int]$child.ProcessId
    parent_pid = [int]$child.ParentProcessId
    creation_utc = $creationUtc.ToString('o')
    executable = [string]$child.ExecutablePath
    command_line = [string]$child.CommandLine
    started_after_current_dist_build = $true
  }
  dist = [ordered]@{
    entry = $entry
    index = $index
    state_tools = $stateTools
    connection = $connectionModule
  }
  uxp_companion = [ordered]@{
    connected = [bool]$health.plugin_connected
    transport = [string]$health.transport
    bridge_revision = [string]$health.bridge_revision
    expected_bridge_revision = [string]$health.expected_bridge_revision
    revision_match = ($health.bridge_revision -eq $health.expected_bridge_revision)
    registration_protocol_required_by_loaded_server = 'photoshop.uxp.registration.v1'
    registration_protocol_acceptance_note = 'The loaded server marks plugin_connected=true only after accepting the current registration protocol and exact bridge revision.'
    active_document = $health.active_document
    document_count = [int]$health.document_count
  }
  acceptance_operations = $acceptedOperations
}

$directory = Split-Path -Parent $Output
if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
$result | ConvertTo-Json -Depth 10 | Set-Content -Encoding UTF8 -Path $Output
