/**
 * One-file ToSLink launcher for end users.
 * Settings downloads ToSLink.cmd; that file installs into %LOCALAPPDATA%\MarketFlow
 * and registers marketflow-toslink: so later starts can come from the browser.
 */

export const TOSLINK_PROTOCOL = "marketflow-toslink";

const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/;

export function sanitizeTosHelperOrigin(raw: string): string | null {
  const trimmed = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!ORIGIN_RE.test(trimmed)) return null;
  return trimmed;
}

export function tosHelperOriginFromRequest(input: {
  protocol?: string;
  headers?: Record<string, string | string[] | undefined>;
}): string | null {
  const headers = input.headers ?? {};
  const header = (name: string): string => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(v)) return String(v[0] ?? "").split(",")[0].trim();
    return String(v ?? "").split(",")[0].trim();
  };
  const proto = header("x-forwarded-proto") || input.protocol || "";
  const host = header("x-forwarded-host") || header("host");
  if (!proto || !host) return null;
  return sanitizeTosHelperOrigin(`${proto}://${host}`);
}

export function buildTosLinkCmd(origin: string): string {
  const safe = sanitizeTosHelperOrigin(origin);
  if (!safe) {
    throw new Error("invalid ToSLink origin");
  }
  const lines = [
    "@echo off",
    "title MarketFlow ToSLink",
    "setlocal",
    `set "ORIGIN=${safe}"`,
    'set "MFDIR=%LOCALAPPDATA%\\MarketFlow"',
    'if not exist "%MFDIR%" mkdir "%MFDIR%"',
    "echo MarketFlow ToSLink - leave this window open while using Charts.",
    "echo Downloading helper files...",
    "echo.",
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri \'%ORIGIN%/tos-helper/install-toslink.ps1\' -OutFile \'%LOCALAPPDATA%\\MarketFlow\\install-toslink.ps1\'"',
    "if errorlevel 1 (",
    "  echo.",
    "  echo Could not download the installer.",
    '  if exist "%MFDIR%\\tos-agent.ps1" (',
    "    echo Starting the copy already on this PC...",
    '    powershell -NoProfile -ExecutionPolicy Bypass -File "%MFDIR%\\tos-agent.ps1"',
    "  ) else (",
    "    echo Download ToSLink.cmd again from Settings while you are online.",
    "  )",
    "  echo.",
    "  pause",
    "  exit /b 1",
    ")",
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%MFDIR%\\install-toslink.ps1" -Origin "%ORIGIN%"',
    "echo.",
    "pause",
    "",
  ];
  return lines.join("\r\n");
}
