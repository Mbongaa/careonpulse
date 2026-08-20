$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot "logs"
$logPath = Join-Path $logDirectory "tgc-sync-worker.log"

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location -LiteralPath $projectRoot

$startedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"
"[$startedAt] Starting Careon TGC queue worker." | Tee-Object -FilePath $logPath -Append

& npm.cmd run worker:tgc *>&1 | Tee-Object -FilePath $logPath -Append
$workerExitCode = $LASTEXITCODE

$finishedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"
"[$finishedAt] Careon TGC queue worker stopped with exit code $workerExitCode." | Tee-Object -FilePath $logPath -Append
exit $workerExitCode
