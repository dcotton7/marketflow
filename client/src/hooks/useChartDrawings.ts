import { useState, useRef, useCallback, useEffect } from "react";
import { IChartApi, ISeriesApi } from "lightweight-charts";
import {
  DrawingData,
  DrawingPoint,
  TrendLinePrimitive,
  HorizontalLinePrimitive,
  hitTestDrawings,
} from "@/lib/chartDrawingPrimitives";
import { apiRequest } from "@/lib/queryClient";

export type DrawingToolType = "trendline" | "horizontal" | null;
type ToolMode = "idle" | "drawing" | "dragging";

interface UseChartDrawingsOptions {
  ticker: string;
  timeframe: string;
  chartRef: React.MutableRefObject<IChartApi | null>;
  seriesRef: React.MutableRefObject<ISeriesApi<"Candlestick"> | null>;
  enabled: boolean;
}

interface HitResult {
  drawingId: number | string;
  handle: "p1" | "p2" | "line";
}

export function useChartDrawings({
  ticker,
  timeframe,
  chartRef,
  seriesRef,
  enabled,
}: UseChartDrawingsOptions) {
  const [drawings, setDrawings] = useState<DrawingData[]>([]);
  const [activeTool, setActiveTool] = useState<DrawingToolType>(null);
  const [mode, setMode] = useState<ToolMode>("idle");
  const [selectedId, setSelectedId] = useState<number | string | null>(null);

  const primitivesRef = useRef<(TrendLinePrimitive | HorizontalLinePrimitive)[]>([]);
  const tempPointRef = useRef<DrawingPoint | null>(null);
  const dragInfoRef = useRef<HitResult | null>(null);
  const dragOrigRef = useRef<DrawingData | null>(null);
  const modeRef = useRef(mode);
  const activeToolRef = useRef(activeTool);
  const drawingsRef = useRef(drawings);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { drawingsRef.current = drawings; }, [drawings]);

  const loadDrawings = useCallback(async () => {
    if (!ticker || !timeframe) return;
    try {
      const resp = await fetch(`/api/chart-drawings?ticker=${encodeURIComponent(ticker)}&timeframe=${encodeURIComponent(timeframe)}`, {
        credentials: "include",
      });
      if (!resp.ok) {
        if (resp.status === 401) return;
        return;
      }
      const data = await resp.json();
      const mapped: DrawingData[] = data.map((d: any) => ({
        id: d.id,
        toolType: d.toolType,
        points: d.points,
        styling: d.styling,
      }));
      setDrawings(mapped);
    } catch {
    }
  }, [ticker, timeframe]);

  useEffect(() => {
    if (enabled && ticker) {
      loadDrawings();
    }
    return () => {
      setDrawings([]);
      setMode("idle");
      setActiveTool(null);
      tempPointRef.current = null;
    };
  }, [ticker, timeframe, enabled, loadDrawings]);

  const saveDrawingToDb = useCallback(async (drawing: DrawingData) => {
    try {
      const resp = await apiRequest("POST", "/api/chart-drawings", {
        ticker,
        timeframe,
        toolType: drawing.toolType,
        points: drawing.points,
        styling: drawing.styling,
      });
      const saved = await resp.json();
      setDrawings(prev => prev.map(d => d.id === drawing.id ? { ...d, id: saved.id } : d));
    } catch {
    }
  }, [ticker, timeframe]);

  const updateDrawingInDb = useCallback(async (id: number | string, points: any, styling?: any) => {
    if (typeof id !== "number") return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await apiRequest("PUT", `/api/chart-drawings/${id}`, { points, styling });
      } catch {
      }
    }, 300);
  }, []);

  const deleteDrawingFromDb = useCallback(async (id: number | string) => {
    if (typeof id !== "number") return;
    try {
      await apiRequest("DELETE", `/api/chart-drawings/${id}`);
    } catch {
    }
  }, []);

  const syncPrimitivesToChart = useCallback(() => {
    const series = seriesRef.current;
    if (!series) return;

    for (const prim of primitivesRef.current) {
      try { series.detachPrimitive(prim); } catch {}
    }
    primitivesRef.current = [];

    for (const d of drawingsRef.current) {
      let prim: TrendLinePrimitive | HorizontalLinePrimitive;
      if (d.toolType === "trendline" && d.points.p1 && d.points.p2) {
        prim = new TrendLinePrimitive(d.id, d.points.p1, d.points.p2, {
          color: d.styling?.color || "#2962FF",
          width: d.styling?.width || 2,
          extend: d.styling?.extend || "none",
        });
      } else if (d.toolType === "horizontal" && d.points.p1) {
        prim = new HorizontalLinePrimitive(d.id, d.points.p1.price, {
          color: d.styling?.color || "#FF6D00",
          width: d.styling?.width || 1,
        });
      } else {
        continue;
      }
      prim.setSelected(d.id === selectedId);
      series.attachPrimitive(prim);
      primitivesRef.current.push(prim);
    }
  }, [seriesRef, selectedId]);

  useEffect(() => {
    syncPrimitivesToChart();
  }, [drawings, selectedId, syncPrimitivesToChart]);

  const handleChartClick = useCallback((param: any) => {
    if (!enabled) return;
    if (!param.point) return;

    const series = seriesRef.current;
    if (!series) return;

    let clickedPrice: number | null = null;
    if (typeof param.point.y === "number") {
      const p = series.coordinateToPrice(param.point.y);
      if (p !== null && isFinite(p as number)) clickedPrice = p as number;
    }

    let clickedTime: number | null = null;
    if (param.time) {
      if (typeof param.time === "object") {
        const t = param.time as { year: number; month: number; day: number };
        clickedTime = Math.floor(new Date(Date.UTC(t.year, t.month - 1, t.day)).getTime() / 1000);
      } else {
        clickedTime = param.time as number;
      }
    }

    if (modeRef.current === "idle" && !activeToolRef.current) {
      const hit = hitTestDrawings(drawingsRef.current, primitivesRef.current, param.point.x, param.point.y);
      if (hit) {
        setSelectedId(prev => prev === hit.drawingId ? null : hit.drawingId);
      } else {
        setSelectedId(null);
      }
      return;
    }

    if (activeToolRef.current === "horizontal" && clickedPrice !== null) {
      const newDrawing: DrawingData = {
        id: `temp_${Date.now()}`,
        toolType: "horizontal",
        points: { p1: { time: 0, price: clickedPrice } },
        styling: { color: "#FF6D00", width: 1 },
      };
      setDrawings(prev => [...prev, newDrawing]);
      saveDrawingToDb(newDrawing);
      setActiveTool(null);
      setMode("idle");
      return;
    }

    if (activeToolRef.current === "trendline" && clickedPrice !== null && clickedTime !== null) {
      if (!tempPointRef.current) {
        tempPointRef.current = { time: clickedTime, price: clickedPrice };
        setMode("drawing");
      } else {
        const newDrawing: DrawingData = {
          id: `temp_${Date.now()}`,
          toolType: "trendline",
          points: {
            p1: tempPointRef.current,
            p2: { time: clickedTime, price: clickedPrice },
          },
          styling: { color: "#2962FF", width: 2, extend: "none" },
        };
        setDrawings(prev => [...prev, newDrawing]);
        saveDrawingToDb(newDrawing);
        tempPointRef.current = null;
        setActiveTool(null);
        setMode("idle");
      }
      return;
    }
  }, [enabled, seriesRef, saveDrawingToDb]);

  const handleMouseDown = useCallback((param: any) => {
    if (!enabled || !param.point) return;
    if (activeToolRef.current) return;

    const hit = hitTestDrawings(drawingsRef.current, primitivesRef.current, param.point.x, param.point.y);
    if (hit) {
      const drawing = drawingsRef.current.find(d => d.id === hit.drawingId);
      if (drawing) {
        dragInfoRef.current = hit;
        dragOrigRef.current = JSON.parse(JSON.stringify(drawing));
        setSelectedId(hit.drawingId);
        setMode("dragging");
      }
    }
  }, [enabled]);

  const handleMouseMove = useCallback((param: any) => {
    if (!enabled || modeRef.current !== "dragging" || !dragInfoRef.current || !param.point) return;

    const series = seriesRef.current;
    if (!series) return;

    let newPrice: number | null = null;
    if (typeof param.point.y === "number") {
      const p = series.coordinateToPrice(param.point.y);
      if (p !== null && isFinite(p as number)) newPrice = p as number;
    }

    let newTime: number | null = null;
    if (param.time) {
      if (typeof param.time === "object") {
        const t = param.time as { year: number; month: number; day: number };
        newTime = Math.floor(new Date(Date.UTC(t.year, t.month - 1, t.day)).getTime() / 1000);
      } else {
        newTime = param.time as number;
      }
    }

    if (newPrice == null) return;

    const { drawingId, handle } = dragInfoRef.current;

    setDrawings(prev => prev.map(d => {
      if (d.id !== drawingId) return d;

      if (d.toolType === "horizontal") {
        return { ...d, points: { ...d.points, p1: { ...d.points.p1, price: newPrice! } } };
      }

      if (d.toolType === "trendline" && d.points.p2) {
        if (handle === "p1" && newTime != null) {
          return { ...d, points: { ...d.points, p1: { time: newTime, price: newPrice! } } };
        }
        if (handle === "p2" && newTime != null) {
          return { ...d, points: { ...d.points, p2: { time: newTime, price: newPrice! } } };
        }
        if (handle === "line" && dragOrigRef.current && newTime != null) {
          const orig = dragOrigRef.current;
          const priceDelta = newPrice! - (orig.points.p1.price + (orig.points.p2!.price - orig.points.p1.price) / 2);
          return {
            ...d,
            points: {
              p1: { ...orig.points.p1, price: orig.points.p1.price + priceDelta },
              p2: { ...orig.points.p2!, price: orig.points.p2!.price + priceDelta },
            },
          };
        }
      }
      return d;
    }));
  }, [enabled, seriesRef]);

  const handleMouseUp = useCallback(() => {
    if (modeRef.current === "dragging" && dragInfoRef.current) {
      const { drawingId } = dragInfoRef.current;
      const drawing = drawingsRef.current.find(d => d.id === drawingId);
      if (drawing) {
        updateDrawingInDb(drawing.id, drawing.points, drawing.styling);
      }
      dragInfoRef.current = null;
      dragOrigRef.current = null;
      setMode("idle");
    }
  }, [updateDrawingInDb]);

  const deleteDrawing = useCallback((id: number | string) => {
    setDrawings(prev => prev.filter(d => d.id !== id));
    deleteDrawingFromDb(id);
    if (selectedId === id) setSelectedId(null);
  }, [selectedId, deleteDrawingFromDb]);

  const deleteSelected = useCallback(() => {
    if (selectedId != null) {
      deleteDrawing(selectedId);
    }
  }, [selectedId, deleteDrawing]);

  const clearAll = useCallback(async () => {
    setDrawings([]);
    setSelectedId(null);
    try {
      await apiRequest("DELETE", `/api/chart-drawings?ticker=${encodeURIComponent(ticker)}&timeframe=${encodeURIComponent(timeframe)}`);
    } catch {}
  }, [ticker, timeframe]);

  const cancelDrawing = useCallback(() => {
    tempPointRef.current = null;
    setActiveTool(null);
    setMode("idle");
  }, []);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelDrawing();
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId != null) {
        deleteSelected();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [cancelDrawing, deleteSelected, selectedId]);

  const cleanup = useCallback(() => {
    const series = seriesRef.current;
    if (!series) return;
    for (const prim of primitivesRef.current) {
      try { series.detachPrimitive(prim); } catch {}
    }
    primitivesRef.current = [];
  }, [seriesRef]);

  return {
    drawings,
    activeTool,
    setActiveTool: (tool: DrawingToolType) => {
      setActiveTool(tool);
      setMode(tool ? "drawing" : "idle");
      tempPointRef.current = null;
      setSelectedId(null);
    },
    mode,
    selectedId,
    handleChartClick,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    deleteDrawing,
    deleteSelected,
    clearAll,
    cancelDrawing,
    cleanup,
    syncPrimitivesToChart,
  };
}
