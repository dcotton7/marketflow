import type { IChartApi } from "lightweight-charts";
import { DEFAULT_COMPANY_LOGO_OPACITY, getCompanyLogoOpacity } from "@/lib/chartLogoPrefs";

export const COMPANY_LOGO_OPACITY = DEFAULT_COMPANY_LOGO_OPACITY;

export type ChartShareLegendItem = {
  label: string;
  color: string;
  isDotted: boolean;
  isDashed: boolean;
};

export type ChartShareCaptureFn = () => HTMLCanvasElement | null;

export function companyLogoSrc(symbol: string): string {
  const s = symbol.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return s ? `/api/sentinel/company-logo/${encodeURIComponent(s)}?v=3` : "";
}

export function formatIntradayCopyLabel(tf: string): string {
  const t = tf.toLowerCase();
  if (t === "5min" || t === "5m") return "Intraday 5m";
  if (t === "15min" || t === "15m") return "Intraday 15m";
  if (t === "30min" || t === "30m") return "Intraday 30m";
  return `Intraday ${tf}`;
}

export function buildChartCopyFilename(symbol: string | undefined, scope: string): string {
  const ticker = (symbol || "chart").replace(/[^A-Za-z0-9._-]/g, "").toUpperCase() || "CHART";
  const day = new Date().toISOString().slice(0, 10);
  const slug = scope.replace(/[^A-Za-z0-9._-]/g, "") || "chart";
  return `${ticker}_${slug}_${day}.png`;
}

export function screenshotChart(chart: IChartApi | null | undefined): HTMLCanvasElement | null {
  if (!chart) return null;
  try {
    // Top layer includes drawings; leave the crosshair off.
    return chart.takeScreenshot(true, false);
  } catch {
    return null;
  }
}

function drawShareLegend(
  ctx: CanvasRenderingContext2D,
  legend: ChartShareLegendItem[],
  scale: number,
): void {
  if (!legend.length) return;
  const pad = 8 * scale;
  const rowH = 16 * scale;
  const swatchW = 12 * scale;
  const fontPx = Math.max(10, 11 * scale);
  ctx.font = `500 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
  let maxLabel = 0;
  for (const item of legend) {
    maxLabel = Math.max(maxLabel, ctx.measureText(item.label).width);
  }
  const boxW = pad * 2 + swatchW + 6 * scale + maxLabel;
  const boxH = pad * 2 + rowH * legend.length;
  ctx.fillStyle = "rgba(15, 23, 42, 0.82)";
  ctx.fillRect(8 * scale, 8 * scale, boxW, boxH);
  legend.forEach((item, i) => {
    const y = 8 * scale + pad + i * rowH + rowH * 0.55;
    const x = 8 * scale + pad;
    ctx.strokeStyle = item.color;
    ctx.fillStyle = item.color;
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + swatchW, y);
    if (item.isDotted) ctx.setLineDash([1.5 * scale, 2 * scale]);
    else if (item.isDashed) ctx.setLineDash([4 * scale, 3 * scale]);
    else ctx.setLineDash([]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#94a3b8";
    ctx.fillText(item.label, x + swatchW + 6 * scale, y + fontPx * 0.35);
  });
}

export function compositeChartShareImage(
  shot: HTMLCanvasElement,
  opts: {
    logo?: HTMLImageElement | null;
    legend: ChartShareLegendItem[];
    scale: number;
    opacity?: number;
  },
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = shot.width;
  out.height = shot.height;
  const ctx = out.getContext("2d");
  if (!ctx) return shot;
  ctx.drawImage(shot, 0, 0);

  const logo = opts.logo;
  if (logo && logo.complete && logo.naturalWidth > 0) {
    const maxW = shot.width * 0.42;
    const maxH = shot.height * 0.42;
    const ratio = Math.min(maxW / logo.naturalWidth, maxH / logo.naturalHeight);
    const dw = logo.naturalWidth * ratio;
    const dh = logo.naturalHeight * ratio;
    ctx.globalAlpha = opts.opacity ?? getCompanyLogoOpacity();
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(logo, (shot.width - dw) / 2, (shot.height - dh) / 2, dw, dh);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }

  drawShareLegend(ctx, opts.legend, Math.max(0.5, opts.scale));
  return out;
}

export function stitchChartCanvases(
  panes: { canvas: HTMLCanvasElement; label: string }[],
  header: string,
): HTMLCanvasElement {
  const gap = 8;
  const headerH = header ? 36 : 0;
  const labelH = 22;
  const widths = panes.map((p) => p.canvas.width);
  const heights = panes.map((p) => p.canvas.height);
  const contentH = Math.max(0, ...heights);
  const width = Math.max(1, widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, panes.length - 1));
  const height = Math.max(1, headerH + labelH + contentH);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, width, height);
  if (header) {
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "600 16px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(header, 12, 24);
  }
  let x = 0;
  for (const pane of panes) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(pane.label, x + 8, headerH + 16);
    ctx.drawImage(pane.canvas, x, headerH + labelH);
    x += pane.canvas.width + gap;
  }
  return out;
}

export async function copyCanvasToClipboard(
  canvas: HTMLCanvasElement,
  filename: string,
): Promise<"copied" | "downloaded"> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not create image");
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return "copied";
  } catch {
    const link = document.createElement("a");
    link.download = filename;
    link.href = canvas.toDataURL("image/png");
    link.click();
    return "downloaded";
  }
}
