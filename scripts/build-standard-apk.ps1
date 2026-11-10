$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'rebuild-apk.ps1') -Variant standard
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
