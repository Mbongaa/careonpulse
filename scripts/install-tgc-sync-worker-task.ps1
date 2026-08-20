$ErrorActionPreference = "Stop"

$taskName = "Careon TGC AI Import Worker"
$runnerPath = Join-Path $PSScriptRoot "run-tgc-sync-worker.ps1"
$currentUser = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name

$action = New-ScheduledTaskAction `
  -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runnerPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $currentUser
$principal = New-ScheduledTaskPrincipal -UserId $currentUser -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 10 `
  -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "Processes authenticated Careon AI requests for five full TGC EPD exports and Supabase verification." `
  -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Write-Output "Installed and started scheduled task '$taskName'."
