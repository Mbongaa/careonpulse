param(
  [ValidatePattern("^(?:[01][0-9]|2[0-3]):[0-5][0-9]$")]
  [string]$At = "02:30"
)

$ErrorActionPreference = "Stop"

$taskName = "Careon Facturatie Storage Offsite Backup"
$runnerPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "run-facturatie-storage-backup.ps1"))
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

if (-not (Test-Path -LiteralPath $runnerPath -PathType Leaf)) {
  throw "De Facturatie Storage-backuprunner ontbreekt."
}

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 15)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Daily encrypted, completion-last Facturatie Storage backup with central metadata-only status." `
  -Force | Out-Null

Write-Output "Installed scheduled task '$taskName' for every day at $At."
