# Discord Watch -- read-only capture of Discord channels from the Discord desktop app.
#
# Two read-only sources, one JSON object per line on stdout:
#   1. Every top-level window that shows a watched channel, through Windows UI Automation (the accessibility tree):
#      the Discord app, Discord PTB and Canary, the app's pop-out windows, and a Chrome / Edge / Firefox window whose
#      active tab is discord.com. So Don can read any channel in his main Discord while a second window stays parked on
#      #live-stream-chat. Discord only renders what is on screen, so keep that window scrolled to the newest.
#      A message seen in two windows is emitted once (same message key).
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

# Window list and state, read only: EnumWindows, IsWindowVisible, IsIconic and GetWindowText never focus a window or
# send Discord anything.
if (-not ("DW.Win" -as [type])) {
  Add-Type -Namespace DW -Name Win -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
public delegate bool EnumProc(System.IntPtr h, System.IntPtr l);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, System.IntPtr l);
public static System.Collections.Generic.List<object[]> TopWindows() {
  var r = new System.Collections.Generic.List<object[]>();
  EnumWindows((h, l) => {
    if (!IsWindowVisible(h)) return true;
    var sb = new System.Text.StringBuilder(512);
    GetWindowText(h, sb, 512);
    if (sb.Length == 0) return true;
    uint pid; GetWindowThreadProcessId(h, out pid);
    r.Add(new object[] { h, (int)pid, sb.ToString(), IsIconic(h) });
    return true;
  }, System.IntPtr.Zero);
  return r;
}
'@
}

$DesktopApps = @{ "discord" = "desktop"; "discordptb" = "ptb"; "discordcanary" = "canary" }
$Browsers = @("chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc")

# "#📈︱trading-floor | Market Pulse - Discord" (desktop), the same plus " - Google Chrome" / " - Microsoft Edge" /
# " — Mozilla Firefox" (browser), sometimes with an unread count "(3) " or "• " in front, or "Discord | #chan | Server".
function Split-Title([string]$title) {
  $t = $title -replace '\s+(-|—)\s+(Google Chrome|Microsoft.{0,2}Edge|Mozilla Firefox|Brave|Opera|Vivaldi|Arc)$', ''
  $t = $t -replace '^\(\d+\)\s*', '' -replace '^[•●]\s*', ''
  $isDiscord = $false
  # Edge: "... - Discord and 3 more pages - Work"; Chrome profiles: "... - Discord - Person 1".
  if ($t -match '^(.*?)\s+-\s+Discord(\s+and \d+ more pages?)?(\s+-\s+.*)?$') { $isDiscord = $true; $t = $Matches[1] }
  elseif ($t -match '^Discord\s+\|\s+') { $isDiscord = $true; $t = $t -replace '^Discord\s+\|\s+', '' }
  elseif ($t -eq 'Discord') { $isDiscord = $true; $t = '' }
  $parts = $t -split '\s\|\s', 2
  $chan = if ($parts.Count -ge 1 -and $parts[0].StartsWith('#')) { $parts[0].TrimStart('#').Trim() } else { "" }
  $server = if ($chan -and $parts.Count -ge 2) { $parts[1].Trim() } else { "" }
  return @{ channel = $chan; server = $server; isDiscord = $isDiscord }
}

# One row per top-level window: which app it is and what it shows. Browsers count only when their title says Discord
# (the active tab is what Chrome and Edge render and expose).
function Get-DiscordWindowsFrom($rows) {
  $out = @()
  foreach ($r in $rows) {
    $proc = ([string]$r.process).ToLowerInvariant() -replace '\.exe$', ''
    $ti = Split-Title ([string]$r.title)
    $kind = if ($DesktopApps.ContainsKey($proc)) { $DesktopApps[$proc] } elseif ($Browsers -contains $proc -and $ti.isDiscord) { "browser" } else { $null }
    if (-not $kind) { continue }
    $chan = Normalize-Channel $ti.channel
    $out += [pscustomobject]@{
      Handle = $r.handle; Kind = $kind; Title = [string]$r.title; Minimized = [bool]$r.minimized
      ChannelName = $ti.channel; Channel = $chan; Server = $ti.server; Watched = [bool]($chan -and $Watched -contains $chan)
    }
  }
  return $out
}

$script:ProcNames = @{}
function Get-ProcName([int]$id) {
  if (-not $script:ProcNames.ContainsKey($id)) {
    $n = ""
    try { $n = (Get-Process -Id $id -ErrorAction Stop).ProcessName } catch {}
    $script:ProcNames[$id] = $n
  }
  return $script:ProcNames[$id]
}

function Get-DiscordWindows {
  if ($script:ProcNames.Count -gt 500) { $script:ProcNames = @{} }
  $rows = foreach ($w in [DW.Win]::TopWindows()) {
    [pscustomobject]@{ handle = $w[0]; process = (Get-ProcName $w[1]); title = $w[2]; minimized = $w[3] }
  }
  return @(Get-DiscordWindowsFrom @($rows))
}

# Test hook: classify a mocked window list (JSON array of {process,title,minimized}) and exit. Reads no windows.
if ($env:DISCORD_WATCH_CLASSIFY) {
  # PowerShell 5.1 hands a JSON array on as one object; ForEach-Object unrolls it.
  $rows = @(Get-Content -Raw -Encoding UTF8 -LiteralPath $env:DISCORD_WATCH_CLASSIFY | ConvertFrom-Json | ForEach-Object { $_ })
  $i = 0
  foreach ($r in $rows) { $r | Add-Member -NotePropertyName handle -NotePropertyValue ([IntPtr](++$i)) -Force }
  $res = @(Get-DiscordWindowsFrom $rows) | ForEach-Object {
    [ordered]@{ kind = $_.Kind; channel = $_.Channel; channelName = $_.ChannelName; server = $_.Server; watched = $_.Watched; minimized = $_.Minimized }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @($res) -Compress -Depth 4))
  exit 0
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

# One seen-set for every window: a message's key (chat-messages-<channel>-<message>) is the same in each window, so a
# post shown by two windows is emitted once.
$seen = New-Object System.Collections.Generic.HashSet[string]
$seenOrder = New-Object System.Collections.Generic.Queue[string]
$seenToasts = New-Object System.Collections.Generic.HashSet[string]
# Per window handle: the message list found for its current title.
$tracked = @{}
$lastStatus = [DateTime]::MinValue
$firstToastPass = $true
$lastError = ""
$toastCount = 0

Emit @{ type = "started"; channels = $Watched; pid = $PID; intervalMs = $IntervalMs; toastAccess = $script:ToastAccess }

function Read-WindowList($t) {
  $items = $t.List.FindAll($TS::Children, [System.Windows.Automation.Condition]::TrueCondition)
  $t.Visible = $items.Count
  $script:LastAuthor = ""; $script:LastTag = ""
  $info = @{ channel = $t.ListChannel; server = $t.Server }
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
    try { $msg = Read-Message $it $info } catch { $script:lastError = "$($_.Exception.Message) (line $($_.InvocationInfo.ScriptLineNumber))" }
    if (-not $msg) { continue }
    $msg.initial = $t.FirstPass
    $msg.window = $t.Kind
    [void]$seen.Add($aid)
    $seenOrder.Enqueue($aid)
    if ($seenOrder.Count -gt 20000) { [void]$seen.Remove($seenOrder.Dequeue()) }
    Emit $msg
  }
  $t.FirstPass = $false
}

while ($true) {
  if (Test-Path $KillFile) {
    Emit @{ type = "stopped"; reason = "kill switch file present" }
    exit 0
  }

  $wins = @()
  try { $wins = @(Get-DiscordWindows) } catch { $lastError = "windows: $($_.Exception.Message)" }
  $live = @{}
  foreach ($w in $wins) {
    $key = [string]$w.Handle
    $live[$key] = $true
    $t = $tracked[$key]
    if (-not $t -or $t.Title -ne $w.Title) {
      # New window or channel switched: re-find the list; the first read of a channel is its on-screen history.
      $t = [pscustomobject]@{ Title = $w.Title; Kind = $w.Kind; Server = $w.Server; List = $null; ListChannel = ""; FirstPass = $true; Visible = 0; Tries = 0 }
      $tracked[$key] = $t
    }
    $w | Add-Member -NotePropertyName State -NotePropertyValue $t -Force
    if (-not $w.Watched -or $w.Minimized) { $t.List = $null; continue }
    try {
      # A list that isn't there yet (Chromium builds its tree lazily) is looked for on 5 polls, then every 20th.
      if (-not $t.List -and ($t.Tries -lt 5 -or $t.Tries % 20 -eq 0)) {
        $t.Tries++
        $t.List = Find-MessageList $w.Handle
        if ($t.List) { $t.ListChannel = Normalize-Channel $t.List.Current.Name; $t.FirstPass = $true }
      } elseif (-not $t.List) { $t.Tries++ }
      if ($t.List) { Read-WindowList $t }
    } catch {
      $lastError = "$($w.Kind): $($_.Exception.Message)"
      $t.List = $null
    }
  }
  foreach ($k in @($tracked.Keys)) { if (-not $live.ContainsKey($k)) { $tracked.Remove($k) } }

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
    # The single-window fields below describe one window, for older readers: the one capturing if any, else the main
    # Discord app's, else the first Discord window. `windows` lists every one.
    $capt = @($wins | Where-Object { $_.State -and $_.State.List })
    $prim = if ($capt.Count) { $capt[0] } else { @($wins | Where-Object { $_.Kind -eq "desktop" }) + @($wins) | Select-Object -First 1 }
    $running = $wins.Count -gt 0
    if (-not $running) { $running = [bool](Get-Process -Name Discord, DiscordPTB, DiscordCanary -ErrorAction SilentlyContinue) }
    Emit ([ordered]@{
      type        = "status"
      window      = [bool]$prim
      running     = $running
      minimized   = if ($prim) { [bool]$prim.Minimized } else { $false }
      title       = if ($prim) { $prim.Title } else { "" }
      openChannel = if ($prim) { $prim.Channel } else { "" }
      server      = if ($prim) { $prim.Server } else { "" }
      channelName = if ($prim) { $prim.ChannelName } else { "" }
      watching    = $Channel
      channels    = $Watched
      capturing   = (@($capt | ForEach-Object { $_.State.ListChannel } | Select-Object -Unique) -join ",")
      listFound   = $capt.Count -gt 0
      visible     = [int](($capt | ForEach-Object { $_.State.Visible } | Measure-Object -Sum).Sum)
      windows     = @($wins | ForEach-Object {
        [ordered]@{ kind = $_.Kind; channel = $_.Channel; server = $_.Server; minimized = $_.Minimized; watched = $_.Watched; capturing = [bool]($_.State -and $_.State.List) }
      })
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

