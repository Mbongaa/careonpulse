$ErrorActionPreference = "Stop"

$taskName = "Careon TGC Production Sync"
$runnerPath = Join-Path $PSScriptRoot "run-tgc-sync.ps1"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`""
$trigger = New-ScheduledTaskTrigger -Weekly -WeeksInterval 1 -DaysOfWeek Monday -At "06:00"
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 15)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Weekly full TGC EPD export, validation, and Careon Supabase production refresh." `
  -Force | Out-Null

Write-Output "Installed scheduled task '$taskName' for Mondays at 06:00."
