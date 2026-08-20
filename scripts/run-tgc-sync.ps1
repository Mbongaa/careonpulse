$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot "logs"
$logPath = Join-Path $logDirectory "tgc-sync.log"

New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Set-Location -LiteralPath $projectRoot

$startedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"
"[$startedAt] Starting scheduled TGC production sync." | Tee-Object -FilePath $logPath -Append

& npm.cmd run sync:tgc *>&1 | Tee-Object -FilePath $logPath -Append
$syncExitCode = $LASTEXITCODE

$finishedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss K"
"[$finishedAt] TGC production sync finished with exit code $syncExitCode." | Tee-Object -FilePath $logPath -Append
exit $syncExitCode
