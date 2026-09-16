# Local ToS helper. Live and LOCAL pages talk to this PC at 127.0.0.1:7737.
# Leave this window open. Recalibrate from Settings after you move Thinkorswim.
param(
  [int]$Port = 7737
)

$ErrorActionPreference = "Stop"
$TosWin = Join-Path $PSScriptRoot "tos-win.ps1"
$CalDir = Join-Path $env:LOCALAPPDATA "MarketFlow"
$CalFile = Join-Path $CalDir "tos-calibration.json"

if (-not (Test-Path $TosWin)) {
  Write-Host "Missing tos-win.ps1 next to this script: $TosWin"
  exit 1
}

function Get-Calibration {
  if (-not (Test-Path $CalFile)) { return $null }
  try { return Get-Content -Raw -Path $CalFile | ConvertFrom-Json } catch { return $null }
}

function Save-Calibration($cal) {
  if (-not (Test-Path $CalDir)) { New-Item -ItemType Directory -Path $CalDir | Out-Null }
  ($cal | ConvertTo-Json) | Set-Content -Path $CalFile -Encoding UTF8
}

function Parse-TosJson([string]$stdout) {
  $start = $stdout.IndexOf("{")
  $end = $stdout.LastIndexOf("}")
  if ($start -lt 0 -or $end -le $start) {
    $preview = $stdout.Trim()
    if ($preview.Length -gt 200) { $preview = $preview.Substring(0, 200) }
    throw "ToS helper returned no result. $preview"
  }
  $json = $stdout.Substring($start, $end - $start + 1)
  return ($json | ConvertFrom-Json)
}

function Invoke-TosWin([string[]]$WinArgs) {
  $out = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $TosWin @WinArgs | Out-String
  return Parse-TosJson $out
}

function Write-Cors([System.Net.HttpListenerResponse]$res) {
  $res.AppendHeader("Access-Control-Allow-Origin", "*")
  $res.AppendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  $res.AppendHeader("Access-Control-Allow-Headers", "Content-Type, Access-Control-Request-Private-Network")
  $res.AppendHeader("Access-Control-Allow-Private-Network", "true")
}

function Write-Json($ctx, [int]$code, $obj) {
  $json = $obj | ConvertTo-Json -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $ctx.Response.StatusCode = $code
  $ctx.Response.ContentType = "application/json; charset=utf-8"
  Write-Cors $ctx.Response
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.Close()
}

function Read-Body($ctx) {
  $reader = New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}

$script:lastNavSymbol = ""
$script:lastNavAt = Get-Date "2000-01-01"

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Prefixes.Add("http://localhost:$Port/")
try {
  $listener.Start()
} catch {
  $msg = $_.Exception.Message
  Write-Host "Could not listen on port $Port - $msg"
  exit 1
}

Write-Host "MarketFlow ToSLink helper listening on http://127.0.0.1:$Port/"
Write-Host "Leave this window open. Settings, Calibrate, then click the ToS symbol box."
Write-Host "Recalibrate whenever you move Thinkorswim."

while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $reqPath = $ctx.Request.Url.AbsolutePath.TrimEnd("/").ToLowerInvariant()
  if ($reqPath -eq "") { $reqPath = "/" }
    $method = $ctx.Request.HttpMethod.ToUpperInvariant()
    Write-Host "$method $reqPath"

    try {
    if ($method -eq "OPTIONS") {
      $ctx.Response.StatusCode = 204
      Write-Cors $ctx.Response
      $ctx.Response.Close()
      continue
    }

    if ($method -eq "GET" -and ($reqPath -eq "/status" -or $reqPath -eq "/")) {
      $cal = Get-Calibration
      $pos = $null
      if ($cal) {
        $pos = @{ x = [int]$cal.x; y = [int]$cal.y }
      }
      Write-Json $ctx 200 @{
        available    = $true
        calibrated   = [bool]$cal
        position     = $pos
        calibratedAt = $(if ($cal) { $cal.calibratedAt } else { $null })
        process      = $(if ($cal) { $cal.process } else { $null })
        title        = $(if ($cal) { $cal.title } else { $null })
        helper       = $true
      }
      continue
    }

    if ($method -eq "POST" -and $reqPath -eq "/calibrate") {
      Write-Host "Calibrate: click the Thinkorswim symbol box (15s)..."
      $result = Invoke-TosWin @("-Action", "calibrate")
      if (-not $result.ok) {
        Write-Json $ctx 400 @{ error = [string]$result.error }
        continue
      }
      $cal = @{
        x            = [int]$result.x
        y            = [int]$result.y
        calibratedAt = [DateTime]::UtcNow.ToString("o")
        process      = [string]$result.process
        title        = [string]$result.title
      }
      Save-Calibration $cal
      Write-Host ("Locked at ({0}, {1})" -f $cal.x, $cal.y)
      Write-Json $ctx 200 @{
        ok           = $true
        x            = $cal.x
        y            = $cal.y
        calibratedAt = $cal.calibratedAt
        process      = $cal.process
        title        = $cal.title
      }
      continue
    }

    if (($method -eq "GET" -or $method -eq "POST") -and $reqPath -eq "/navigate") {
      $cal = Get-Calibration
      if (-not $cal) {
        Write-Json $ctx 400 @{ error = "Not calibrated. Settings, Calibrate, then click the ToS symbol box." }
        continue
      }
      $symbol = [string]$ctx.Request.QueryString["symbol"]
      if (-not $symbol -and $method -eq "POST") {
        $navBody = $null
        $raw = Read-Body $ctx
        if ($raw) {
          try { $navBody = $raw | ConvertFrom-Json } catch { $navBody = $null }
          if ($navBody) { $symbol = [string]$navBody.symbol }
          if (-not $symbol) { $symbol = $raw.Trim().Trim('"') }
        }
      }
      if (-not $symbol) {
        Write-Json $ctx 400 @{ error = "symbol is required" }
        continue
      }
      $up = $symbol.ToUpperInvariant()
      $now = Get-Date
      if ($up -eq $script:lastNavSymbol -and ($now - $script:lastNavAt).TotalMilliseconds -lt 900) {
        Write-Host "Skipped duplicate $up"
        Write-Json $ctx 200 @{ ok = $true; symbol = $up; skipped = $true }
        continue
      }
      $result = Invoke-TosWin @(
        "-Action", "navigate",
        "-Symbol", $up,
        "-X", ([string][int]$cal.x),
        "-Y", ([string][int]$cal.y)
      )
      if (-not $result.ok) {
        Write-Json $ctx 400 @{ error = [string]$result.error }
        continue
      }
      $script:lastNavSymbol = $up
      $script:lastNavAt = Get-Date
      Write-Host "Navigated to $up"
      Write-Json $ctx 200 @{ ok = $true; symbol = $up }
      continue
    }

    Write-Json $ctx 404 @{ error = "not found" }
  } catch {
    $errMsg = $_.Exception.Message
    Write-Host "Error: $errMsg"
    try { Write-Json $ctx 500 @{ error = $errMsg } } catch { }
  }
}
