#requires -Version 5.1
<#
  Third-Party Model Patch — activator (Windows).

  Closes Antigravity safely, (re)applies the model patch to app.asar via
  scripts/apply-model-patch.mjs, verifies the result, and relaunches the app.

  Usage:
    powershell -NoProfile -ExecutionPolicy Bypass -File activate-patch.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File activate-patch.ps1 -StatusOnly
    powershell -NoProfile -ExecutionPolicy Bypass -File activate-patch.ps1 -VerifyOnly
    powershell -NoProfile -ExecutionPolicy Bypass -File activate-patch.ps1 -ForceClose -AutoRestart
#>
param(
    [switch]$AutoRestart,
    [switch]$ForceClose,
    [switch]$StatusOnly,
    [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
$PluginRoot = Split-Path -Parent $PSScriptRoot
$ApplyScript = Join-Path $PluginRoot 'scripts\apply-model-patch.mjs'
$AppExe = Join-Path (Split-Path -Parent (Split-Path -Parent $PluginRoot)) 'Antigravity.exe'
# Fall back to the standard install location if the plugin was moved.
if (-not (Test-Path $AppExe)) {
    $AppExe = Join-Path $env:LOCALAPPDATA 'Programs\antigravity\Antigravity.exe'
}

function Write-Msg([string]$text) {
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Write-Host "[$ts] $text"
}

function Find-Node {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\antigravity\resources\app.asar.unpacked\node_modules\.bin\node.cmd'),
        (Join-Path $env:APPDATA 'Antigravity-ProA\bin\agy-node.cmd'),
        'C:\Program Files\nodejs\node.exe'
    )
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    return $null
}

function Stop-Antigravity([switch]$Force) {
    $procs = Get-Process -Name 'Antigravity', 'language_server' -ErrorAction SilentlyContinue
    if (-not $procs) { return }
    if ($Force) {
        Write-Msg 'Closing Antigravity and language server...'
        Stop-Process -Name 'language_server' -Force -ErrorAction SilentlyContinue
        Stop-Process -Name 'Antigravity' -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
    } else {
        Write-Msg 'Waiting for Antigravity to exit (close it manually if needed)...'
        while (Get-Process -Name 'Antigravity', 'language_server' -ErrorAction SilentlyContinue) {
            Start-Sleep -Seconds 1
        }
        Start-Sleep -Seconds 1
    }
}

$Node = Find-Node
if (-not $Node) {
    Write-Msg 'ERROR: Node.js not found. Install Node 18+ (or add it to PATH), then re-run.'
    exit 1
}

if ($StatusOnly) {
    & $Node $ApplyScript --status
    exit $LASTEXITCODE
}
if ($VerifyOnly) {
    & $Node $ApplyScript --verify
    exit $LASTEXITCODE
}

Stop-Antigravity -Force:$ForceClose

Write-Msg 'Applying third-party model patch...'
& $Node $ApplyScript --apply
$rc = $LASTEXITCODE
if ($rc -ne 0) {
    Write-Msg "Patch apply failed (exit $rc). See messages above."
    exit $rc
}

if ($AutoRestart -and (Test-Path $AppExe)) {
    Write-Msg "Relaunching Antigravity ($AppExe)..."
    Start-Process -FilePath $AppExe
} else {
    Write-Msg 'Done. Start Antigravity manually; custom models appear in Settings.'
}
