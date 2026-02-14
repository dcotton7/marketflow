export interface DrawingPoint {
  time: number;
  price: number;
}

export interface DrawingData {
  id: number | string;
  toolType: "trendline" | "horizontal";
  points: { p1: DrawingPoint; p2?: DrawingPoint };
  styling?: { color?: string; width?: number; extend?: string };
}

class BaseDrawingPrimitive {
  _series: any = null;
  _requestUpdate: (() => void) | null = null;
  _selected = false;

  attached({ series, requestUpdate }: any) {
    this._series = series;
    this._requestUpdate = requestUpdate;
  }

  detached() {
    this._series = null;
    this._requestUpdate = null;
  }

  requestUpdate() {
    if (this._requestUpdate) this._requestUpdate();
  }

  updateAllViews() {
    return this;
  }

  paneViews() {
    return [this];
  }

  zOrder(): "top" {
    return "top";
  }

  renderer() {
    return this;
  }

  setSelected(selected: boolean) {
    this._selected = selected;
    this.requestUpdate();
  }
}

export class TrendLinePrimitive extends BaseDrawingPrimitive {
  _p1: DrawingPoint;
  _p2: DrawingPoint;
  _color: string;
  _width: number;
  _extend: string;
  drawingId: number | string;

  constructor(id: number | string, p1: DrawingPoint, p2: DrawingPoint, options: { color?: string; width?: number; extend?: string } = {}) {
    super();
    this.drawingId = id;
    this._p1 = p1;
    this._p2 = p2;
    this._color = options.color || "#2962FF";
    this._width = options.width || 2;
    this._extend = options.extend || "none";
  }

  updatePoints(p1: DrawingPoint, p2: DrawingPoint) {
    this._p1 = p1;
    this._p2 = p2;
    this.requestUpdate();
  }

  getPixelCoords(): { x1: number | null; y1: number | null; x2: number | null; y2: number | null } {
    if (!this._series) return { x1: null, y1: null, x2: null, y2: null };
    const ts = this._series.chart().timeScale();
    const x1 = ts.timeToCoordinate(this._p1.time as any);
    const y1 = this._series.priceToCoordinate(this._p1.price);
    const x2 = ts.timeToCoordinate(this._p2.time as any);
    const y2 = this._series.priceToCoordinate(this._p2.price);
    return { x1, y1, x2, y2 };
  }

  draw(target: any) {
    if (!this._series) return;

    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const ratio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;
      const ts = this._series.chart().timeScale();

      const x1Raw = ts.timeToCoordinate(this._p1.time as any);
      const x2Raw = ts.timeToCoordinate(this._p2.time as any);
      const y1Raw = this._series.priceToCoordinate(this._p1.price);
      const y2Raw = this._series.priceToCoordinate(this._p2.price);

      if (x1Raw == null || x2Raw == null || y1Raw == null || y2Raw == null) return;

      const x1 = Math.round(x1Raw * ratio);
      const x2 = Math.round(x2Raw * ratio);
      const y1 = Math.round(y1Raw * vRatio);
      const y2 = Math.round(y2Raw * vRatio);

      let startX = x1, startY = y1, endX = x2, endY = y2;
      const dx = x2 - x1;
      const dy = y2 - y1;

      if (dx !== 0 && (this._extend === "right" || this._extend === "both")) {
        const slope = dy / dx;
        endX = scope.bitmapSize.width;
        endY = y2 + slope * (endX - x2);
      }
      if (dx !== 0 && (this._extend === "left" || this._extend === "both")) {
        const slope = dy / dx;
        startX = 0;
        startY = y1 - slope * (x1 - startX);
      }

      ctx.save();

      ctx.lineWidth = this._width * ratio;
      ctx.strokeStyle = this._color;
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      if (this._selected) {
        ctx.lineWidth = (this._width + 2) * ratio;
        ctx.strokeStyle = "rgba(255,255,255,0.3)";
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
      }

      const handleR = (this._selected ? 6 : 4) * ratio;
      this._drawHandle(ctx, x1, y1, handleR, ratio);
      this._drawHandle(ctx, x2, y2, handleR, ratio);

      ctx.restore();
    });
  }

  _drawHandle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, ratio: number) {
    ctx.fillStyle = this._color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5 * ratio;
    ctx.stroke();
  }
}

export class HorizontalLinePrimitive extends BaseDrawingPrimitive {
  _price: number;
  _color: string;
  _width: number;
  drawingId: number | string;

  constructor(id: number | string, price: number, options: { color?: string; width?: number } = {}) {
    super();
    this.drawingId = id;
    this._price = price;
    this._color = options.color || "#FF6D00";
    this._width = options.width || 1;
  }

  updatePrice(price: number) {
    this._price = price;
    this.requestUpdate();
  }

  getPixelCoords(): { y: number | null } {
    if (!this._series) return { y: null };
    const y = this._series.priceToCoordinate(this._price);
    return { y };
  }

  draw(target: any) {
    if (!this._series) return;

    target.useBitmapCoordinateSpace((scope: any) => {
      const ctx = scope.context;
      const ratio = scope.horizontalPixelRatio;
      const vRatio = scope.verticalPixelRatio;
      const width = scope.bitmapSize.width;

      const yRaw = this._series.priceToCoordinate(this._price);
      if (yRaw == null) return;

      const y = Math.round(yRaw * vRatio);

      ctx.save();

      ctx.setLineDash([6 * ratio, 4 * ratio]);
      ctx.lineWidth = this._width * ratio;
      ctx.strokeStyle = this._color;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      if (this._selected) {
        ctx.lineWidth = (this._width + 2) * ratio;
        ctx.strokeStyle = "rgba(255,255,255,0.2)";
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      const handleR = (this._selected ? 6 : 4) * ratio;
      const handleX = 30 * ratio;
      ctx.fillStyle = this._color;
      ctx.beginPath();
      ctx.arc(handleX, y, handleR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5 * ratio;
      ctx.stroke();

      const fontSize = Math.round(11 * ratio);
      ctx.font = `500 ${fontSize}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = this._color;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      const priceLabel = this._price.toFixed(2);
      ctx.fillText(priceLabel, width - 6 * ratio, y - 8 * vRatio);

      ctx.restore();
    });
  }
}

export function hitTestDrawings(
  drawings: DrawingData[],
  primitives: (TrendLinePrimitive | HorizontalLinePrimitive)[],
  clickX: number,
  clickY: number,
  grabRadius = 10
): { drawingId: number | string; handle: "p1" | "p2" | "line" } | null {
  for (const prim of primitives) {
    if (prim instanceof TrendLinePrimitive) {
      const { x1, y1, x2, y2 } = prim.getPixelCoords();
      if (x1 == null || y1 == null || x2 == null || y2 == null) continue;

      if (Math.hypot(clickX - x1, clickY - y1) < grabRadius) {
        return { drawingId: prim.drawingId, handle: "p1" };
      }
      if (Math.hypot(clickX - x2, clickY - y2) < grabRadius) {
        return { drawingId: prim.drawingId, handle: "p2" };
      }

      const lineLen = Math.hypot(x2 - x1, y2 - y1);
      if (lineLen > 0) {
        const t = Math.max(0, Math.min(1, ((clickX - x1) * (x2 - x1) + (clickY - y1) * (y2 - y1)) / (lineLen * lineLen)));
        const projX = x1 + t * (x2 - x1);
        const projY = y1 + t * (y2 - y1);
        if (Math.hypot(clickX - projX, clickY - projY) < grabRadius) {
          return { drawingId: prim.drawingId, handle: "line" };
        }
      }
    } else if (prim instanceof HorizontalLinePrimitive) {
      const { y } = prim.getPixelCoords();
      if (y == null) continue;

      if (Math.abs(clickY - y) < grabRadius) {
        return { drawingId: prim.drawingId, handle: "p1" };
      }
    }
  }
  return null;
}
