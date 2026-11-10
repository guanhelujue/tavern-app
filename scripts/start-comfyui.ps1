param(
  [string]$ComfyRoot = 'F:\ComfyUI-aki-v1.6\ComfyUI-aki-v1.6\ComfyUI',
  [string]$Python = 'F:\ComfyUI-aki-v1.6\ComfyUI-aki-v1.6\python\python.exe',
  [ValidateSet('127.0.0.1', '0.0.0.0')][string]$Listen = '127.0.0.1',
  [ValidateRange(1, 65535)][int]$Port = 8188,
  [string]$CorsOrigin = 'http://localhost:8081',
  [switch]$Restart
)
$ErrorActionPreference = 'Stop'
$baseUrl = "http://127.0.0.1:$Port"
if ($CorsOrigin -notmatch '^http://(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$') { throw 'CorsOrigin must be a local HTTP origin.' }
$corsUri = [Uri]$CorsOrigin
if ($corsUri.Port -lt 1 -or $corsUri.Port -gt 65535) { throw 'Invalid CORS origin port.' }
$existingServer = $null
try { $existingServer = Invoke-RestMethod -Uri "$baseUrl/system_stats" -TimeoutSec 3 } catch { }
if ($existingServer.system.comfyui_version -and -not $Restart) { Write-Output 'ComfyUI is already running. Use -Restart to load changed nodes.'; exit 0 }
$comfyDirectory = (Resolve-Path -LiteralPath $ComfyRoot).Path
$pythonExecutable = (Resolve-Path -LiteralPath $Python).Path
$projectDirectory = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$nodeSource = Join-Path $projectDirectory 'integrations\comfyui\tavern_comic_pages.py'
$nodeTarget = Join-Path $comfyDirectory 'custom_nodes\tavern_comic_pages.py'
if (-not (Test-Path -LiteralPath (Join-Path $comfyDirectory 'main.py'))) { throw 'Invalid ComfyUI directory.' }
if (Test-Path -LiteralPath $nodeTarget) {
  if ((Get-FileHash -LiteralPath $nodeTarget).Hash -ne (Get-FileHash -LiteralPath $nodeSource).Hash) {
    Copy-Item -LiteralPath $nodeTarget -Destination "$nodeTarget.backup-$(Get-Date -Format yyyyMMdd-HHmmss)"
  }
}
Copy-Item -LiteralPath $nodeSource -Destination $nodeTarget -Force

$server = $null
try { $server = Invoke-RestMethod -Uri "$baseUrl/system_stats" -TimeoutSec 3 } catch { }
if ($server) {
  if (-not $server.system.comfyui_version) { throw 'Port is occupied by a different service; leaving it running.' }
  if (-not $Restart) { Write-Output 'ComfyUI is already running; leaving it running.'; exit 0 }
  $mainFile = [IO.Path]::GetFullPath([string]$server.system.argv[0])
  if ($mainFile -ne (Join-Path $comfyDirectory 'main.py')) { throw 'Another ComfyUI instance owns this port; leaving it running.' }
  $queue = Invoke-RestMethod -Uri "$baseUrl/queue" -TimeoutSec 5
  if ($queue.queue_running.Count -or $queue.queue_pending.Count) { throw 'ComfyUI has queued work; no restart performed.' }
  $serverProcesses = @(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -eq $pythonExecutable -and
    ($_.CommandLine -like "*$comfyDirectory\main.py*" -or $_.CommandLine -like "*$PSScriptRoot\comfyui-server.py*")
  })
  if ($serverProcesses.Count -ne 1) { throw 'Cannot identify exactly one ComfyUI process; no restart performed.' }
  Stop-Process -Id $serverProcesses[0].ProcessId
  Wait-Process -Id $serverProcesses[0].ProcessId -Timeout 10 -ErrorAction SilentlyContinue
}

$bootstrap = Join-Path $PSScriptRoot 'comfyui-server.py'
$logFile = Join-Path $projectDirectory 'output\comfy-api-server\server.log'
$commandLine = '"{0}" -X utf8 "{1}" --comfy-root "{2}" --log-file "{3}" --listen {4} --port {5} --enable-cors-header "{6}" --preview-method auto --disable-xformers --use-pytorch-cross-attention --cuda-malloc' -f $pythonExecutable, $bootstrap, $comfyDirectory, $logFile, $Listen, $Port, $CorsOrigin
# WMI creates the hidden service outside the terminal's job lifetime. Closing
# this chat therefore cannot terminate an already submitted ComfyUI queue.
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
$created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
  CommandLine = $commandLine; CurrentDirectory = $comfyDirectory; ProcessStartupInformation = $startup
}
if ($created.ReturnValue -ne 0) { throw "ComfyUI start failed (Win32 result $($created.ReturnValue))." }
$deadline = (Get-Date).AddSeconds(180)
do {
  try { $stats = Invoke-RestMethod -Uri "$baseUrl/system_stats" -TimeoutSec 2; if ($stats.system.comfyui_version) { Write-Output "ComfyUI ready at $baseUrl; PID=$($created.ProcessId); log=$logFile"; exit 0 } } catch { }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)
throw "ComfyUI has not become ready. Check $logFile"
