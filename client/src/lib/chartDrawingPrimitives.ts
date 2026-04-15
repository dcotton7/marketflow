import type { ISeriesApi } from "lightweight-charts";

export interface DrawingPoint {
  time: number;
  price: number;
}

export interface DrawingData {
  id: number | string;
  toolType: "horizontal";
  points: { p1: DrawingPoint; p2?: DrawingPoint };
  styling?: { color?: string; width?: number; extend?: string; lineStyle?: "solid" | "dotted" | "dashed" };
}

export function hitTestHorizontalDrawings(
  drawings: DrawingData[],
  series: ISeriesApi<"Candlestick">,
  _clickX: number,
  clickY: number,
  grabRadius = 10
): { drawingId: number | string; handle: "p1" } | null {
  for (const d of drawings) {
    if (d.toolType === "horizontal" && d.points.p1 && typeof d.points.p1.price === "number") {
      const y = series.priceToCoordinate(d.points.p1.price);
      if (y != null && Math.abs(clickY - y) < grabRadius) {
        return { drawingId: d.id, handle: "p1" };
      }
    }
  }
  return null;
}
