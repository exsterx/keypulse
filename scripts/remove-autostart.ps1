# Removes the autostart scheduled task created by install-autostart.ps1.
$ErrorActionPreference = "Stop"

$taskName = "TelegramKeywordMonitor"
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
Write-Host "Autostart removed (task '$taskName' deleted)."
