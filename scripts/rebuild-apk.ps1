[CmdletBinding()]
param(
  [ValidateSet('full', 'standard')]
  [string]$Variant = 'full',
  [switch]$SkipClean,
  [switch]$InstallDependencies
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$androidRoot = Join-Path $projectRoot 'android'
$featureFile = Join-Path $projectRoot 'src/config/build-features.ts'
$gradlePath = Join-Path $androidRoot 'gradlew.bat'
$apkSource = Join-Path $androidRoot 'app/build/outputs/apk/release/guanhelujue-release.apk'
$outputDirectory = Join-Path $projectRoot ("dist/{0}" -f $Variant)
$apkTarget = Join-Path $outputDirectory ("guanhelujue-{0}.apk" -f $Variant)
$logDirectory = Join-Path $projectRoot 'dist/logs'
$logPath = Join-Path $logDirectory ("rebuild-{0}-{1}.log" -f $Variant, (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Assert-Path([string]$Path, [string]$Description) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "$Description not found: $Path"
  }
}

function Invoke-NativeStep([string]$Name, [string]$Command, [string[]]$Arguments) {
  Write-Host "`n[$Name]" -ForegroundColor Cyan
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Name failed with exit code $LASTEXITCODE."
  }
}

function Remove-GeneratedPath([string]$Path, [string]$Description) {
  if (Test-Path -LiteralPath $Path) {
    Write-Host "Removing generated $Description" -ForegroundColor DarkGray
    Remove-Item -LiteralPath $Path -Recurse -Force
  }
}

Assert-Command 'node'
Assert-Command 'npm'
Assert-Command 'java'
Assert-Path $androidRoot 'Android project'
Assert-Path $gradlePath 'Gradle wrapper'
Assert-Path $featureFile 'Build feature file'

New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$transcriptStarted = $false
$originalFeatureContent = [System.IO.File]::ReadAllText($featureFile)
$featureChanged = $false

try {
  Start-Transcript -LiteralPath $logPath -Force | Out-Null
  $transcriptStarted = $true

  Write-Host "APK rebuild started: variant=$Variant" -ForegroundColor Green
  Write-Host "Project: $projectRoot"
  Write-Host "Log: $logPath"

  if ($InstallDependencies) {
    Invoke-NativeStep 'Install locked dependencies' 'npm' @('ci')
  }

  $expectedFeature = if ($Variant -eq 'standard') { 'false' } else { 'true' }
  $featurePattern = 'export const ENABLE_QUICK_TRAVEL = (true|false);'
  if ($originalFeatureContent -notmatch $featurePattern) {
    throw 'ENABLE_QUICK_TRAVEL declaration was not found; refusing to build an uncertain APK.'
  }
  $currentFeature = $Matches[1]
  if ($currentFeature -ne $expectedFeature) {
    $featureRegex = [regex]::new(
      $featurePattern,
      [System.Text.RegularExpressions.RegexOptions]::Multiline
    )
    $nextFeatureContent = $featureRegex.Replace(
      $originalFeatureContent,
      "export const ENABLE_QUICK_TRAVEL = $expectedFeature;",
      1
    )
    [System.IO.File]::WriteAllText($featureFile, $nextFeatureContent, [System.Text.UTF8Encoding]::new($false))
    $featureChanged = $true
    Write-Host "Temporary build feature mode: ENABLE_QUICK_TRAVEL=$expectedFeature" -ForegroundColor Yellow
  }

  Push-Location $androidRoot
  try {
    if (-not $SkipClean) {
      # React Native's CMake clean can fail when a dependency's generated JNI
      # directory was removed or regenerated. Remove only generated outputs so
      # the next Gradle invocation can recreate autolinking from scratch.
      Remove-GeneratedPath (Join-Path $androidRoot 'app/build') 'app/build'
      Remove-GeneratedPath (Join-Path $androidRoot 'app/.cxx') 'app/.cxx'
      Remove-GeneratedPath (Join-Path $androidRoot 'build') 'build'
      Invoke-NativeStep 'Clean Android release outputs' $gradlePath @('clean')
    }

    # Never accept an APK left by an earlier failed or skipped build.
    if (Test-Path -LiteralPath $apkSource) {
      Remove-Item -LiteralPath $apkSource -Force
    }

    Invoke-NativeStep 'Assemble Android release APK' $gradlePath @('app:assembleRelease')
  }
  finally {
    Pop-Location
  }
  Assert-Path $apkSource 'Release APK'

  New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
  Copy-Item -LiteralPath $apkSource -Destination $apkTarget -Force
  Assert-Path $apkTarget 'Packaged APK'

  $sizeMb = [math]::Round((Get-Item -LiteralPath $apkTarget).Length / 1MB, 2)
  Write-Host "`nAPK created: $apkTarget ($sizeMb MB)" -ForegroundColor Green
  Write-Host "Build log: $logPath" -ForegroundColor DarkGray
}
finally {
  if ($featureChanged) {
    [System.IO.File]::WriteAllText($featureFile, $originalFeatureContent, [System.Text.UTF8Encoding]::new($false))
    Write-Host 'Source restored to its original build feature mode.' -ForegroundColor Cyan
  }
  if ($transcriptStarted) {
    Stop-Transcript | Out-Null
  }
}
