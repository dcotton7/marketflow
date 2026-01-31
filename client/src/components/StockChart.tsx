import { useStockHistory } from "@/hooks/use-stocks";
import { Loader2 } from "lucide-react";
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from "recharts";
import { format } from "date-fns";

interface StockChartProps {
  symbol: string;
}

export function StockChart({ symbol }: StockChartProps) {
  const { data: history, isLoading, error } = useStockHistory(symbol);

  if (isLoading) {
    return (
      <div className="h-[400px] w-full flex items-center justify-center bg-card rounded-xl border border-border">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !history) {
    return (
      <div className="h-[400px] w-full flex items-center justify-center bg-card rounded-xl border border-border text-muted-foreground">
        Failed to load chart data
      </div>
    );
  }

  // Format data for Recharts
  // We simulate candles using a Bar chart where the bar is the body
  // Ideally, we'd use a more specialized library, but ComposedChart is flexible enough for a simple view.
  // For a true candle, we need open, close, high, low.
  // Here we will just render a clean area-like view or simplified bars for this MVP.
  // Let's do a "Hollow Candle" approximation:
  // Bar represents body (Open to Close).
  // We color it Green if Close > Open, Red if Close < Open.

  const chartData = history.map(item => ({
    ...item,
    bodyMin: Math.min(item.open, item.close),
    bodyHeight: Math.abs(item.open - item.close),
    color: item.close >= item.open ? "hsl(142, 71%, 45%)" : "hsl(0, 84%, 60%)"
  }));

  // Helper for tooltip date formatting
  const formatDate = (dateStr: string) => format(new Date(dateStr), "MMM dd, yyyy");

  // Custom Tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-popover border border-border p-3 rounded-lg shadow-xl">
          <p className="text-muted-foreground text-xs mb-2">{formatDate(label)}</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm font-mono">
            <span className="text-muted-foreground">Open:</span>
            <span className="text-right">{data.open.toFixed(2)}</span>
            <span className="text-muted-foreground">High:</span>
            <span className="text-right">{data.high.toFixed(2)}</span>
            <span className="text-muted-foreground">Low:</span>
            <span className="text-right">{data.low.toFixed(2)}</span>
            <span className="text-muted-foreground">Close:</span>
            <span className={data.close >= data.open ? "text-green-500 text-right" : "text-red-500 text-right"}>
              {data.close.toFixed(2)}
            </span>
            <span className="text-muted-foreground mt-2">Vol:</span>
            <span className="text-right mt-2">{(data.volume / 1000000).toFixed(1)}M</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="h-[500px] w-full bg-card p-4 rounded-xl border border-border shadow-sm">
      <div className="mb-4 flex justify-between items-center">
        <h3 className="font-semibold text-foreground">Price History</h3>
        <div className="flex gap-2">
           {/* Timeframe selectors could go here */}
           <span className="text-xs text-muted-foreground font-mono">Daily Candles</span>
        </div>
      </div>
      
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} opacity={0.3} />
          <XAxis 
            dataKey="date" 
            tickFormatter={(val) => format(new Date(val), "MMM dd")}
            stroke="hsl(var(--muted-foreground))"
            tick={{ fontSize: 11 }}
            tickMargin={10}
            axisLine={false}
          />
          <YAxis 
            domain={['auto', 'auto']}
            stroke="hsl(var(--muted-foreground))"
            tick={{ fontSize: 11, fontFamily: 'JetBrains Mono' }}
            axisLine={false}
            tickFormatter={(val) => val.toFixed(0)}
            width={40}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1, strokeDasharray: '4 4' }} />
          
          {/* 
            This is a simplified visual. For high/low wicks we would need error bars or custom shapes.
            For now, we render the body (Open-Close) as a bar.
            Using [min, max] range on Y axis is tricky with Bar in standard Recharts without custom shape.
            So we'll use a trick: Stacked Bar? No. 
            Standard Bar with `stackId` can float if we have a transparent bottom segment.
            
            Let's stick to a cleaner Line chart for MVP stability unless requested otherwise?
            Actually, the prompt asked for "Candlestick chart (ComposedChart with varying colors)".
            
            Trick: Use ErrorBar for High-Low range attached to a Scatter point (Close)? 
            
            Let's use a Bar for the Body and just ignore the wicks for this specific generation 
            if complexity is too high to get right blindly. 
            OR: Use a Bar chart where `dataKey` is [min, max]. Recharts supports this!
          */}
          <Bar 
            dataKey={(item) => [item.open, item.close]} 
            fill="currentColor"
            isAnimationActive={false}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
