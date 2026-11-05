# Creates a timestamped backup of local data, keywords, excludes and .env.
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$dest = Join-Path $root "backup-$stamp"

New-Item -ItemType Directory -Path $dest | Out-Null

if (Test-Path (Join-Path $root "data")) {
    Copy-Item (Join-Path $root "data") (Join-Path $dest "data") -Recurse
}
Copy-Item (Join-Path $root "keywords.txt") $dest
Copy-Item (Join-Path $root "exclude_words.txt") $dest
if (Test-Path (Join-Path $root ".env")) {
    Copy-Item (Join-Path $root ".env") $dest
}

Write-Host "Backup created: $dest"
Write-Host "To restore: stop the app, then copy the contents of this folder back into the project root."
