# Install / update / start MarketFlow ToSLink on this Windows PC.
# Called by ToSLink.cmd (first run) and by the marketflow-toslink: protocol (later starts).
param(
  [string]$Origin = ""
)

$ErrorActionPreference = "Stop"
$MfDir = Join-Path $env:LOCALAPPDATA "MarketFlow"
$Agent = Join-Path $MfDir "tos-agent.ps1"
$Win = Join-Path $MfDir "tos-win.ps1"
$Starter = Join-Path $MfDir "start-toslink.cmd"
$OriginFile = Join-Path $MfDir "origin.txt"
$Protocol = "marketflow-toslink"

function Test-SafeOrigin([string]$raw) {
  return $raw -match '^https?://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
}

if (-not (Test-Path $MfDir)) {
  New-Item -ItemType Directory -Path $MfDir | Out-Null
}

if (-not $Origin) {
  if (Test-Path $OriginFile) {
    $Origin = (Get-Content -Raw -Path $OriginFile).Trim()
  }
}
$Origin = $Origin.Trim().TrimEnd("/")

function Save-Origin([string]$value) {
  [System.IO.File]::WriteAllText($OriginFile, $value)
}

function Write-Starter {
  $body = @"
@echo off
title MarketFlow ToSLink
echo MarketFlow ToSLink - leave this window open while using Charts.
echo After it says listening: Settings, Calibrate, then click the ToS symbol box.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%LOCALAPPDATA%\MarketFlow\tos-agent.ps1"
echo.
pause
"@
  [System.IO.File]::WriteAllText($Starter, $body)
}

function Register-Protocol {
  $cmdValue = '"' + $Starter + '"'
  & reg.exe add "HKCU\Software\Classes\$Protocol" /ve /d "URL:MarketFlow ToSLink" /f | Out-Null
  & reg.exe add "HKCU\Software\Classes\$Protocol" /v "URL Protocol" /d "" /f | Out-Null
  & reg.exe add "HKCU\Software\Classes\$Protocol\shell\open\command" /ve /d $cmdValue /f | Out-Null
  $runValue = "powershell.exe -NoProfile -WindowStyle Minimized -ExecutionPolicy Bypass -File `"$Agent`""
  & reg.exe add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "MarketFlowToSLink" /d $runValue /f | Out-Null
}

function Get-HelperFiles {
  if (-not (Test-SafeOrigin $Origin)) {
    throw "No app origin saved. Download ToSLink.cmd from Settings and run it once."
  }
  Write-Host "Updating ToSLink files from $Origin ..."
  Invoke-WebRequest -UseBasicParsing -Uri "$Origin/tos-helper/tos-agent.ps1" -OutFile $Agent
  Invoke-WebRequest -UseBasicParsing -Uri "$Origin/tos-helper/tos-win.ps1" -OutFile $Win
  $Lead = Join-Path $MfDir "fidelity-lead"
  if (-not (Test-Path $Lead)) { New-Item -ItemType Directory -Path $Lead | Out-Null }
  Invoke-WebRequest -UseBasicParsing -Uri "$Origin/tos-helper/fidelity-lead/manifest.json" -OutFile (Join-Path $Lead "manifest.json")
  Invoke-WebRequest -UseBasicParsing -Uri "$Origin/tos-helper/fidelity-lead/content.js" -OutFile (Join-Path $Lead "content.js")
  Invoke-WebRequest -UseBasicParsing -Uri "$Origin/tos-helper/fidelity-lead/background.js" -OutFile (Join-Path $Lead "background.js")
  Save-Origin $Origin
}

$updated = $false
if (Test-SafeOrigin $Origin) {
  try {
    Get-HelperFiles
    $updated = $true
  } catch {
    Write-Host "Could not update files: $($_.Exception.Message)"
    if (-not (Test-Path $Agent) -or -not (Test-Path $Win)) {
      throw "ToSLink is not installed yet. Download ToSLink.cmd from Settings while you are online, then double-click it."
    }
    Write-Host "Starting the copy already on this PC..."
  }
} elseif (-not (Test-Path $Agent) -or -not (Test-Path $Win)) {
  throw "ToSLink is not installed yet. Download ToSLink.cmd from Settings, then double-click it."
}

Write-Starter
try {
  Register-Protocol
  if ($updated) {
    Write-Host "Installed. Next time, click Start helper in Settings (allow the browser to open MarketFlow ToSLink)."
  }
} catch {
  Write-Host "Could not register Start helper shortcut: $($_.Exception.Message)"
  Write-Host "You can still start ToSLink by running this window / ToSLink.cmd."
}

Write-Host ""
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Agent
