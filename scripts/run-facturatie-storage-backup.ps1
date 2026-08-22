$ErrorActionPreference = "Stop"

$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$packagePath = Join-Path $projectRoot "package.json"
$logDirectory = Join-Path $projectRoot "logs"
$logPath = Join-Path $logDirectory "facturatie-storage-backup.log"
$mutex = [System.Threading.Mutex]::new($false, "Local\CareonFacturatieStorageBackup")
$lockHeld = $false

try {
  if (-not (Test-Path -LiteralPath $packagePath -PathType Leaf)) {
    throw "Careon package.json ontbreekt."
  }
  $lockHeld = $mutex.WaitOne(0)
  if (-not $lockHeld) {
    throw "Een Facturatie Storage-backuprun is al actief."
  }
  if (-not (Test-Path -LiteralPath $logDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $logDirectory | Out-Null
  }

  Push-Location $projectRoot
  try {
    $startedAt = [DateTimeOffset]::UtcNow.ToString("O")
    $commandOutput = @(& npm.cmd run backup:facturatie-storage:offsite -- --upload 2>&1)
    $commandExit = $LASTEXITCODE
    $finishedAt = [DateTimeOffset]::UtcNow.ToString("O")
    $logLines = @("[$startedAt] FACTURATIE_STORAGE_SCHEDULE=START")
    $logLines += $commandOutput | ForEach-Object { $_.ToString() }
    $logLines += "[$finishedAt] FACTURATIE_STORAGE_SCHEDULE=END exit=$commandExit"
    Add-Content -LiteralPath $logPath -Value $logLines -Encoding UTF8
    if ($commandExit -ne 0) {
      throw "De versleutelde Facturatie Storage-backup is mislukt."
    }
  }
  finally {
    Pop-Location
  }
}
finally {
  if ($lockHeld) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}
