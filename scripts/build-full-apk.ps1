$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'rebuild-apk.ps1') -Variant full
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
