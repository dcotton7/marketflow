# ToS window targeting — called by tos-bridge.ts
# Actions: calibrate | navigate
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("calibrate", "navigate")]
  [string]$Action,
  [string]$Symbol = "",
  [int]$X = 0,
  [int]$Y = 0
)

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

public static class TosWin {
  public const int SW_RESTORE = 9;
  public const uint GA_ROOT = 2;
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
  public const byte VK_MENU = 0x12;
  public const byte VK_CONTROL = 0x11;
  public const byte VK_A = 0x41;
  public const byte VK_RETURN = 0x0D;
  public const uint KEYEVENTF_KEYUP = 0x0002;

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [StructLayout(LayoutKind.Sequential)]
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr hWnd, uint gaFlags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, int extra);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
  public const int VK_LBUTTON = 0x01;

  static List<IntPtr> found = new List<IntPtr>();

  public static bool LeftButtonDown() {
    return (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0;
  }

  public static string WindowTitle(IntPtr hWnd) {
    var sb = new StringBuilder(512);
    GetWindowText(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }

  public static IntPtr RootFromPoint(int x, int y) {
    var p = new POINT { X = x, Y = y };
    var h = WindowFromPoint(p);
    if (h == IntPtr.Zero) return IntPtr.Zero;
    var root = GetAncestor(h, GA_ROOT);
    return root != IntPtr.Zero ? root : h;
  }

  public static string ProcessName(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return "";
    uint pid;
    GetWindowThreadProcessId(hWnd, out pid);
    try { return Process.GetProcessById((int)pid).ProcessName; }
    catch { return ""; }
  }

  public static bool IsBrowser(string proc) {
    var n = (proc ?? "").ToLowerInvariant();
    return n == "chrome" || n == "msedge" || n == "msedgewebview2" || n == "firefox" ||
           n == "brave" || n == "opera" || n == "cursor" || n == "code" || n == "electron";
  }

  public static bool IsTos(string proc, string title) {
    var p = (proc ?? "").ToLowerInvariant();
    var t = (title ?? "").ToLowerInvariant();
    if (p.Contains("thinkorswim")) return true;
    if (t.Contains("thinkorswim")) return true;
    return false;
  }

  public static bool ContainsPoint(IntPtr hWnd, int x, int y) {
    RECT r;
    if (!GetWindowRect(hWnd, out r)) return false;
    return x >= r.Left && x < r.Right && y >= r.Top && y < r.Bottom;
  }

  public static bool FocusWindow(IntPtr hWnd) {
    if (hWnd == IntPtr.Zero) return false;
    ShowWindow(hWnd, SW_RESTORE);
    var fg = GetForegroundWindow();
    uint pidDummy;
    uint fgTid = GetWindowThreadProcessId(fg, out pidDummy);
    uint thisTid = GetCurrentThreadId();
    keybd_event(VK_MENU, 0, 0, UIntPtr.Zero);
    keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    if (fgTid != 0 && fgTid != thisTid) AttachThreadInput(thisTid, fgTid, true);
    BringWindowToTop(hWnd);
    bool ok = SetForegroundWindow(hWnd);
    if (fgTid != 0 && fgTid != thisTid) AttachThreadInput(thisTid, fgTid, false);
    return ok || GetForegroundWindow() == hWnd;
  }

  public static void Click(int x, int y) {
    SetCursorPos(x, y);
    mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
    mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
  }

  public static void SendCtrlA() {
    keybd_event(VK_CONTROL, 0, 0, UIntPtr.Zero);
    keybd_event(VK_A, 0, 0, UIntPtr.Zero);
    keybd_event(VK_A, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
    keybd_event(VK_CONTROL, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  public static void SendEnter() {
    keybd_event(VK_RETURN, 0, 0, UIntPtr.Zero);
    keybd_event(VK_RETURN, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
  }

  static bool EnumCb(IntPtr hWnd, IntPtr lParam) {
    if (!IsWindowVisible(hWnd)) return true;
    if (IsTos(ProcessName(hWnd), WindowTitle(hWnd))) found.Add(hWnd);
    return true;
  }

  public static IntPtr[] FindTosWindows() {
    found = new List<IntPtr>();
    EnumWindows(EnumCb, IntPtr.Zero);
    return found.ToArray();
  }
}
"@ | Out-Null
[void][TosWin]::SetProcessDPIAware()

function Write-Result($obj) {
  ($obj | ConvertTo-Json -Compress)
}

function Get-HitInfo([int]$px, [int]$py) {
  $h = [TosWin]::RootFromPoint($px, $py)
  $proc = [TosWin]::ProcessName($h)
  $title = [TosWin]::WindowTitle($h)
  [pscustomobject]@{
    proc  = $proc
    title = $title
    isTos = [TosWin]::IsTos($proc, $title)
    isBrowser = [TosWin]::IsBrowser($proc)
  }
}

if ($Action -eq "calibrate") {
  $deadline = (Get-Date).AddSeconds(15)
  # Ignore the Calibrate click in Chrome — wait for that button to be released.
  while ([TosWin]::LeftButtonDown() -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 20
  }
  $clicked = $false
  $px = 0
  $py = 0
  while ((Get-Date) -lt $deadline) {
    if ([TosWin]::LeftButtonDown()) {
      $p = [System.Windows.Forms.Cursor]::Position
      $px = $p.X
      $py = $p.Y
      while ([TosWin]::LeftButtonDown() -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 20
      }
      $clicked = $true
      break
    }
    Start-Sleep -Milliseconds 20
  }
  if (-not $clicked) {
    Write-Result @{
      ok = $false
      error = "Timed out. Click Calibrate, then click once on the ToS pop-out symbol box (not Scanner)."
    }
    exit 2
  }
  $hit = Get-HitInfo $px $py
  if ($hit.isBrowser) {
    Write-Result @{
      ok = $false
      error = "That click was on $($hit.proc) (Scanner/browser). Click Calibrate, then click the ToS pop-out symbol box."
      x = $px; y = $py; process = $hit.proc; title = $hit.title
    }
    exit 2
  }
  if (-not $hit.isTos) {
    Write-Result @{
      ok = $false
      error = "That click was on '$($hit.proc)' ($($hit.title)), not Thinkorswim. Click the ToS pop-out symbol box."
      x = $px; y = $py; process = $hit.proc; title = $hit.title
    }
    exit 2
  }
  Write-Result @{
    ok = $true
    x = $px
    y = $py
    process = $hit.proc
    title = $hit.title
  }
  exit 0
}

# navigate
if (-not $Symbol) {
  Write-Result @{ ok = $false; error = "symbol is required" }
  exit 2
}

$tosWindows = [TosWin]::FindTosWindows()
if ($tosWindows.Count -eq 0) {
  Write-Result @{ ok = $false; error = "Thinkorswim is not open. Open a ToS chart pop-out, then Calibrate on its symbol box." }
  exit 2
}

$target = [IntPtr]::Zero
foreach ($h in $tosWindows) {
  if ([TosWin]::ContainsPoint($h, $X, $Y)) { $target = $h; break }
}
if ($target -eq [IntPtr]::Zero) {
  Write-Result @{
    ok = $false
    error = "Calibrated point ($X,$Y) is not on a Thinkorswim window. Recalibrate on the ToS pop-out symbol box (not Scanner charts)."
  }
  exit 2
}

$prev = [TosWin]::GetForegroundWindow()
[void][TosWin]::FocusWindow($target)
Start-Sleep -Milliseconds 250
[TosWin]::Click($X, $Y)
Start-Sleep -Milliseconds 200

$hit = Get-HitInfo $X $Y
if ($hit.isBrowser -or -not $hit.isTos) {
  if ($prev -ne [IntPtr]::Zero) { [void][TosWin]::FocusWindow($prev) }
  Write-Result @{
    ok = $false
    error = "Click hit $($hit.proc) ($($hit.title)), not Thinkorswim. Recalibrate on the ToS pop-out symbol box so Ctrl+A cannot select Scanner cells."
    process = $hit.proc
    title = $hit.title
  }
  exit 2
}

[TosWin]::SendCtrlA()
Start-Sleep -Milliseconds 80
[System.Windows.Forms.SendKeys]::SendWait($Symbol)
Start-Sleep -Milliseconds 80
[TosWin]::SendEnter()
Start-Sleep -Milliseconds 120
if ($prev -ne [IntPtr]::Zero) { [void][TosWin]::FocusWindow($prev) }

Write-Result @{ ok = $true; symbol = $Symbol; process = $hit.proc; title = $hit.title }
exit 0
