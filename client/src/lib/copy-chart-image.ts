import type { IChartApi } from "lightweight-charts";

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
