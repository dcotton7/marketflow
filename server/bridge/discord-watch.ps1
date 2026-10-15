# Discord Watch -- read-only capture of Discord channels from the Discord desktop app.
#
# Two read-only sources, one JSON object per line on stdout:
#   1. The open channel, through Windows UI Automation (the accessibility tree), when it is one of
#      the watched channels. Discord only renders what is on screen, so keep it scrolled to the newest.
#   2. Discord's Windows notifications (pop-ups), from the Windows notification history, so posts in
#      channels that are not open (trade-call channels) are still caught.
#
#   {"type":"msg", ...}     a channel message seen for the first time
#   {"type":"toast", ...}   a Discord notification seen for the first time
#   {"type":"status", ...}  heartbeat every few seconds
#   {"type":"stopped", ...} the script is exiting (kill switch)
#
# Never focuses, clicks, scrolls, types into, or invokes anything in Discord, and never removes notifications.
# Kill switch: if server/bridge/DISCORD_WATCH_OFF.txt exists the script exits on its next poll.

param(
  [string]$Channel = "live-stream-chat",
  [string]$Also = "live-long-ideas,live-short-ideas,nick-drendel",
  [int]$IntervalMs = 1500,
  [int]$StatusEverySec = 5
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$A = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
$Walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$KillFile = Join-Path $PSScriptRoot "DISCORD_WATCH_OFF.txt"
$FullDateRx = '^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4} \d{1,2}:\d{2}\s?[AP]M$'
$TimeRx = '^(Today at |Yesterday at |\d{1,2}/\d{1,2}/\d{4},? )?\d{1,2}:\d{2}\s?[AP]M$'

# Channel names carry emoji prefixes ("🟢live-long-ideas"); compare on letters, digits and dashes.
function Normalize-Channel([string]$s) { return (($s -replace '^Messages in ', '') -replace '[^A-Za-z0-9_-]', '').ToLowerInvariant() }
$Watched = @($Channel) + ($Also -split ',') | ForEach-Object { Normalize-Channel $_ } | Where-Object { $_ } | Select-Object -Unique

# --- Windows notification history (read-only) -------------------------------------------------
$script:Toasts = $null
$script:ToastAccess = "unavailable"
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:AsTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  [Windows.UI.Notifications.Management.UserNotificationListener, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  [Windows.UI.Notifications.UserNotification, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
  $script:Toasts = [Windows.UI.Notifications.Management.UserNotificationListener]::Current
  $script:ToastAccess = [string]$script:Toasts.GetAccessStatus()
} catch {
  $script:ToastAccess = "error: $($_.Exception.Message)"
}

function Await-WinRT($op, [Type]$t) {
  $task = $script:AsTask.MakeGenericMethod($t).Invoke($null, @($op))
  [void]$task.Wait(5000)
  return $task.Result
}

function Read-DiscordToasts {
  if (-not $script:Toasts -or $script:ToastAccess -ne "Allowed") { return @() }
  $list = Await-WinRT ($script:Toasts.GetNotificationsAsync([Windows.UI.Notifications.NotificationKinds]::Toast)) `
    ([System.Collections.Generic.IReadOnlyList[Windows.UI.Notifications.UserNotification]])
  $out = @()
  foreach ($n in $list) {
    $app = ""
    try { $app = [string]$n.AppInfo.DisplayInfo.DisplayName } catch {}
    if ($app -notlike "*Discord*") { continue }
    $b = $n.Notification.Visual.GetBinding([Windows.UI.Notifications.KnownNotificationBindings]::ToastGeneric)
    if (-not $b) { continue }
    $texts = @($b.GetTextElements() | ForEach-Object { [string]$_.Text })
    $out += [pscustomobject]@{ Id = [string]$n.Id; At = $n.CreationTime.UtcDateTime.ToString("o"); Texts = $texts; App = $app }
  }
  return $out
}

function Emit($obj) {
  [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}

function Get-DiscordWindow {
  $p = Get-Process -Name Discord -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if (-not $p) { return $null }
  return [pscustomobject]@{ Pid = $p.Id; Handle = $p.MainWindowHandle; Title = $p.MainWindowTitle }
}

function Split-Title([string]$title) {
  # "#live-stream-chat | MarketPulse - Discord"
  $t = $title -replace '\s*-\s*Discord$', ''
  $parts = $t -split '\s\|\s', 2
  $chan = if ($parts.Count -ge 1) { $parts[0].TrimStart('#').Trim() } else { "" }
  $server = if ($parts.Count -ge 2) { $parts[1].Trim() } else { "" }
  return @{ channel = $chan; server = $server }
}

function Find-MessageList($handle) {
  $root = $A::FromHandle($handle)
  $cond = New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $CT::List)
  # Chromium builds its accessibility tree lazily: the first query can come back empty.
  for ($i = 0; $i -lt 3; $i++) {
    foreach ($l in $root.FindAll($TS::Descendants, $cond)) {
      $n = [string]$l.Current.Name
      if ($n -like "Messages in *" -and $Watched -contains (Normalize-Channel $n)) { return $l }
    }
    Start-Sleep -Milliseconds 600
  }
  return $null
}

function Get-Children($el) {
  $out = New-Object System.Collections.Generic.List[object]
  $c = $Walker.GetFirstChild($el)
  while ($c) { $out.Add($c); $c = $Walker.GetNextSibling($c) }
  return $out
}

function Get-Descendants($el) {
  $out = New-Object System.Collections.Generic.List[object]
  $queue = New-Object System.Collections.Queue
  foreach ($c in (Get-Children $el)) { $out.Add($c); $queue.Enqueue($c) }
  while ($queue.Count -gt 0) {
    $n = $queue.Dequeue()
    foreach ($c in (Get-Children $n)) { $out.Add($c); $queue.Enqueue($c) }
  }
  return $out
}

function Strip-AuthorLabel([string]$s) {
  $s = $s -replace '\s+replying to\s+.*$', ''
  $s = $s -replace '\s+Server Tag:\s*\S+.*$', ''
  return $s.Trim()
}

$script:LastAuthor = ""
$script:LastTag = ""

function Read-Message($item, $win) {
  $aid = $item.Current.AutomationId
  if ($aid -notmatch '^chat-messages-(\d+)-(\d+)$') { return $null }
  $channelId = $Matches[1]; $messageId = $Matches[2]

  $group = $null
  foreach ($c in (Get-Children $item)) {
    if ($c.Current.ClassName -like "*message__*") { $group = $c; break }
  }
  if (-not $group) { return $null }
  $label = $group.Current.Name

  $author = ""; $tag = ""; $time = ""; $replyTo = ""; $replyPreview = ""
  $textParts = New-Object System.Collections.Generic.List[string]
  $mentions = New-Object System.Collections.Generic.List[string]
  $links = New-Object System.Collections.Generic.List[string]
  $extras = New-Object System.Collections.Generic.List[string]
  $reactions = New-Object System.Collections.Generic.List[object]
  $media = New-Object System.Collections.Generic.List[string]
  $edited = $false
  $afterDownload = $false

  foreach ($c in (Get-Children $group)) {
    $cls = [string]$c.Current.ClassName
    $name = [string]$c.Current.Name
    $type = $c.Current.ControlType

    # Attachment hover link "Download" is followed by a Text "Download" label.
    if ($afterDownload) {
      $afterDownload = $false
      if ($type -eq $CT::Text -and $name -eq "Download") { continue }
    }
    if ($type -eq $CT::Hyperlink -and $cls -like "*hoverButton*") { $afterDownload = $true; continue }
    if ($cls -like "*MediaMosaic*" -or $cls -like "*mediaAttachment*" -or $cls -like "*attachment*") {
      foreach ($d in (Get-Descendants $c)) {
        $dn = [string]$d.Current.Name
        $dt = $d.Current.ControlType
        if ($dn -eq "Video") { $media.Add("video") }
        elseif ($dt -eq $CT::Image) { $media.Add($(if ($dn -and $dn.Length -gt 4) { "image: $dn" } else { "image" })) }
        elseif ($dt -eq $CT::Hyperlink -and $dn -and $dn -ne "Download") { $media.Add("file: $dn") }
      }
      if ($media.Count -eq 0) { $media.Add("attachment") }
      continue
    }
    if ($type -eq $CT::Button -and $cls -like "*emojiContainer*") {
      if ($name) { $textParts.Add($name) }
      continue
    }

    if ($cls -like "*repliedMessage*") {
      foreach ($d in (Get-Descendants $c)) {
        $dc = [string]$d.Current.ClassName
        if ($dc -like "*username*" -and -not $replyTo) { $replyTo = $d.Current.Name.TrimStart('@') }
        elseif ($dc -like "*repliedTextPreview*") { $replyPreview = $d.Current.Name }
      }
      continue
    }
    if ($cls -like "*header_*") {
      foreach ($d in (Get-Descendants $c)) {
        $dn = [string]$d.Current.Name
        $dc = [string]$d.Current.ClassName
        if ($dc -like "*username*" -and -not $author) { $author = $dn }
        elseif ($dn -like "Server Tag:*") { $tag = ($dn -replace '^Server Tag:\s*', '').Trim() }
        elseif ($dn -match $TimeRx -and -not $time) { $time = $dn }
      }
      if (-not $time -and $name -match '(\d{1,2}:\d{2}\s?[AP]M)$') { $time = $Matches[1] }
      continue
    }
    if ($cls -like "*reactions*") {
      foreach ($d in (Get-Children $c)) {
        $dn = [string]$d.Current.Name
        if ($dn -match '^(.+?), (\d+) reactions?') {
          $reactions.Add(@{ emoji = $Matches[1]; count = [int]$Matches[2] })
        }
      }
      continue
    }
    if ($name -eq "Message Actions" -or $cls -like "*buttons__*") { continue }

    if ($type -eq $CT::Text) {
      if ($name -match $FullDateRx) { continue }
      if ($name -match '^\(?edited\)?$') { $edited = $true; continue }
      if ($name -eq "(" -or $name -eq ")") { continue }
      if ($name) { $textParts.Add($name) }
      continue
    }
    if ($type -eq $CT::Button -and $cls -like "*mention*") {
      $mentions.Add($name.TrimStart('@'))
      $textParts.Add($name)
      continue
    }
    if ($type -eq $CT::Hyperlink) {
      if ($name) { $links.Add($name); $textParts.Add($name) }
      continue
    }
    if ($type -eq $CT::Image) {
      if ($name -and $name.Length -le 4) { $textParts.Add($name) } else { $media.Add("image") }
      continue
    }

    # Time-only group on continuation messages; embeds / attachments otherwise.
    $inner = Get-Descendants $c
    $isTimeOnly = $true
    foreach ($d in $inner) {
      $dn = [string]$d.Current.Name
      if ($dn -and $dn -notmatch $TimeRx) { $isTimeOnly = $false }
      if ($dn -match $TimeRx -and -not $time) { $time = $dn }
    }
    if ($isTimeOnly) { continue }
    foreach ($d in $inner) {
      $dt = $d.Current.ControlType
      $dn = [string]$d.Current.Name
      if ($dt -eq $CT::Image) { $media.Add("image"); continue }
      if ($dt -eq $CT::Hyperlink -and $dn) { $links.Add($dn); continue }
      if ($dn -and $dn -match '\S' -and $dn -notmatch $FullDateRx -and $extras.Count -lt 12) { $extras.Add($dn) }
    }
  }

  if (-not $author) {
    $prefix = ($label -split ' , ', 2)[0]
    $author = Strip-AuthorLabel $prefix
    if (-not $tag -and $prefix -match 'Server Tag:\s*(\S+)') { $tag = $Matches[1] }
  }
  if (-not $author) { $author = $script:LastAuthor; if (-not $tag) { $tag = $script:LastTag } }
  if ($author) { $script:LastAuthor = $author; $script:LastTag = $tag }
  if (-not $time -and $label -match ' , (\d{1,2}:\d{2}\s?[AP]M)$') { $time = $Matches[1] }

  $text = (($textParts -join '') -replace '[ \t]+', ' ' -replace '\s*\r?\n\s*(\r?\n\s*)+', "`n").Trim()

  return [ordered]@{
    type         = "msg"
    id           = $messageId
    channelId    = $channelId
    channel      = $win.channel
    server       = $win.server
    author       = $author
    tag          = $tag
    time         = $time
    text         = $text
    mentions     = $mentions.ToArray()
    links        = $links.ToArray()
    replyTo      = $replyTo
    replyPreview = $replyPreview
    reactions    = $reactions.ToArray()
    media        = $media.ToArray()
    extras       = $extras.ToArray()
    edited       = $edited
    label        = $label
    capturedAt   = (Get-Date).ToUniversalTime().ToString("o")
  }
}

$seen = New-Object System.Collections.Generic.HashSet[string]
$seenOrder = New-Object System.Collections.Generic.Queue[string]
$seenToasts = New-Object System.Collections.Generic.HashSet[string]
$list = $null
$listChannel = ""
$listTitle = ""
$lastStatus = [DateTime]::MinValue
$firstPass = $true
$firstToastPass = $true
$lastError = ""
$toastCount = 0

Emit @{ type = "started"; channels = $Watched; pid = $PID; intervalMs = $IntervalMs; toastAccess = $script:ToastAccess }

while ($true) {
  if (Test-Path $KillFile) {
    Emit @{ type = "stopped"; reason = "kill switch file present" }
    exit 0
  }

  $win = Get-DiscordWindow
  $titleInfo = if ($win) { Split-Title $win.Title } else { @{ channel = ""; server = "" } }
  $openChannel = Normalize-Channel $titleInfo.channel
  $visible = 0

  try {
    if (-not $win) {
      $list = $null; $listTitle = ""
    } else {
      if ($win.Title -ne $listTitle) {
        # Channel switched: re-find the list; the first read of a channel is its on-screen history.
        $list = $null
        $listTitle = $win.Title
        $listChannel = ""
        if ($Watched -contains $openChannel) {
          $list = Find-MessageList $win.Handle
          if ($list) { $listChannel = Normalize-Channel $list.Current.Name; $firstPass = $true }
          else { $listTitle = "" }
        }
      }
      if ($list) {
        $items = $list.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)
        $visible = $items.Count
        $script:LastAuthor = ""; $script:LastTag = ""
        $info = @{ channel = $listChannel; server = $titleInfo.server }
        foreach ($it in $items) {
          $aid = ""
          try { $aid = $it.Current.AutomationId } catch { continue }
          if ($aid -notlike "chat-messages-*") { continue }
          if ($seen.Contains($aid)) {
            # Keep author inheritance correct for the next unseen continuation message.
            try {
              foreach ($c in (Get-Children $it)) {
                if ($c.Current.ClassName -like "*message__*") {
                  $p = Strip-AuthorLabel (($c.Current.Name -split ' , ', 2)[0])
                  if ($p) { $script:LastAuthor = $p }
                  break
                }
              }
            } catch {}
            continue
          }
          $msg = $null
          try { $msg = Read-Message $it $info } catch { $lastError = "$($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" }
          if (-not $msg) { continue }
          $msg.initial = $firstPass
          [void]$seen.Add($aid)
          $seenOrder.Enqueue($aid)
          if ($seenOrder.Count -gt 20000) { [void]$seen.Remove($seenOrder.Dequeue()) }
          Emit $msg
        }
        $firstPass = $false
      }
    }
  } catch {
    $lastError = $_.Exception.Message
    $list = $null; $listTitle = ""
  }

  try {
    foreach ($t in (Read-DiscordToasts)) {
      if (-not $seenToasts.Add($t.Id)) { continue }
      $toastCount++
      Emit ([ordered]@{ type = "toast"; nid = $t.Id; at = $t.At; texts = $t.Texts; initial = $firstToastPass })
    }
    $firstToastPass = $false
  } catch {
    $lastError = "notifications: $($_.Exception.Message)"
  }

  $now = Get-Date
  if (($now - $lastStatus).TotalSeconds -ge $StatusEverySec) {
    Emit ([ordered]@{
      type        = "status"
      window      = [bool]$win
      title       = if ($win) { $win.Title } else { "" }
      openChannel = $openChannel
      server      = $titleInfo.server
      watching    = $Channel
      channels    = $Watched
      capturing   = $listChannel
      listFound   = [bool]$list
      visible     = $visible
      seen        = $seen.Count
      toastAccess = $script:ToastAccess
      toasts      = $toastCount
      lastError   = $lastError
      at          = $now.ToUniversalTime().ToString("o")
    })
    $lastStatus = $now
    $lastError = ""
  }

  Start-Sleep -Milliseconds $IntervalMs
}

