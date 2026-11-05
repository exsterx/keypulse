# Runs the monitor in a hidden PowerShell window for Task Scheduler.
# All output is appended to logs\console.log.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

New-Item -ItemType Directory -Force -Path (Join-Path $root "logs") | Out-Null
$consoleLog = Join-Path $root "logs\console.log"

if (-not (Test-Path (Join-Path $root "node_modules"))) {
    & npm install --ignore-scripts --no-audit --no-fund | Out-File -Append -Encoding utf8 $consoleLog
    & node scripts\fetch-native.cjs | Out-File -Append -Encoding utf8 $consoleLog
} elseif (-not (Test-Path (Join-Path $root "node_modules\better-sqlite3\build\Release\better_sqlite3.node"))) {
    & node scripts\fetch-native.cjs | Out-File -Append -Encoding utf8 $consoleLog
}

if (-not (Test-Path (Join-Path $root "dist\index.js"))) {
    & npm run build | Out-File -Append -Encoding utf8 $consoleLog
}

& node dist\index.js *>> $consoleLog
