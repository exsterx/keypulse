# Registers a Windows Task Scheduler task that starts the monitor at logon,
# keeps it running and restarts it automatically if it crashes.
# Run this script once. It must be run from the project's scripts folder or by full path.

$ErrorActionPreference = "Stop"

$taskName = "TelegramKeywordMonitor"
$startScript = Join-Path $PSScriptRoot "start-hidden.ps1"

$action = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$startScript`""

$trigger = New-ScheduledTaskTrigger -AtLogOn

$settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Telegram Keyword Monitor autostart" -Force

Write-Host "Autostart registered. Task name: $taskName"
Write-Host "The monitor will now start automatically when you log in to Windows."
