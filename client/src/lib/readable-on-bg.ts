/** Pick #rrggbb foreground for text/icons on a solid #rrggbb background. */
export function pickForegroundForBg(bgHex: string): string {
  const raw = bgHex.trim().replace("#", "");
  if (raw.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(raw)) return "#0f172a";
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.45 ? "#0f172a" : "#f8fafc";
}
